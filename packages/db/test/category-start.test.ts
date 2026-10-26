import { BUSINESS_CATEGORIES } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { applyCategoryStart, createAccount, createBook, inBook, personalBook, postTransaction, renameAccount, saveBudget } from '../src/index';
import { setupDb } from './helpers';

type Row = { id: string; key: string | null; name: string; kind: string; archived: string | null };
type Db = Awaited<ReturnType<typeof setupDb>>['database'];

async function rowsOf(database: Db, bookId: string): Promise<Row[]> {
  const rows = await database.db.values<[string, string | null, string, string, string | null]>(sql`
    SELECT a.id, a.system_key, a.name, a.kind, a.archived_at FROM accounts a
      JOIN book_categories b ON b.category_account_id = a.id WHERE b.book_id = ${bookId} AND a.subtype = 'category'
     ORDER BY a.id`);
  return rows.map(([id, key, name, kind, archived]) => ({ id, key, name, kind, archived }));
}
const open = (rows: Row[]) => rows.filter((row) => !row.archived);
const byName = (rows: Row[], name: string) => rows.find((row) => row.name === name && !row.archived);

async function businessCopy() {
  const { database, ws } = await setupDb();
  const personal = await personalBook(database, ws);
  const shop = await createBook(database, ws, { name: 'Shop', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
  return { database, ws, personal, shop };
}

async function spend(database: Db, ws: Parameters<typeof postTransaction>[1], categoryId: string) {
  const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  await postTransaction(database, ws, {
    occurredOn: '2026-08-15',
    description: 'Rice',
    lines: [
      { accountId: categoryId, amountMinor: 50_000, currency: 'IDR' },
      { accountId: bank.id, amountMinor: -50_000, currency: 'IDR' },
    ],
  });
}

describe('applyCategoryStart', () => {
  it('adds every business name to that book only', async () => {
    const { database, ws, personal, shop } = await businessCopy();
    const before = await rowsOf(database, personal.id);
    const done = await applyCategoryStart(database, ws, { bookId: shop, start: 'business' });
    // Personal's own "Other income" is kept (the app posts into it), so the list does not add a second.
    expect(done.added).toEqual(BUSINESS_CATEGORIES.map((c) => c.name).filter((name) => name !== 'Other income'));
    const now = open(await rowsOf(database, shop));
    for (const spec of BUSINESS_CATEGORIES.filter((c) => c.name !== 'Other income')) {
      const row = now.find((r) => r.key === spec.key)!;
      expect([row.name, row.kind]).toEqual([spec.name, spec.kind]);
    }
    expect(now.filter((r) => r.name.toLowerCase() === 'other income')).toHaveLength(1);
    expect(await rowsOf(database, personal.id)).toEqual(before);
    expect(byName(before, 'Sales')).toBeUndefined();
  });

  it('archives untouched unused defaults, never one with a transaction or budget, nor one renamed', async () => {
    const { database, ws, shop } = await businessCopy();
    const groceries = byName(await rowsOf(database, shop), 'Groceries')!;
    await spend(database, ws, groceries.id);
    const movies = byName(await rowsOf(database, shop), 'Movies')!;
    await saveBudget(database, inBook(ws, shop), { categoryAccountId: movies.id, amountMinor: 100_000 });
    const games = byName(await rowsOf(database, shop), 'Games')!;
    await renameAccount(database, ws, games.id, 'My games');

    await applyCategoryStart(database, ws, { bookId: shop, start: 'business' });
    const rows = await rowsOf(database, shop);
    const state = (id: string) => rows.find((r) => r.id === id)!.archived;
    expect(state(groceries.id)).toBeNull();
    expect(state(movies.id)).toBeNull();
    expect(state(games.id)).toBeNull();
    // Their parents hold an open child, so they stay.
    expect(open(rows).some((r) => r.key === 'household')).toBe(true);
    expect(open(rows).some((r) => r.key === 'entertainment')).toBe(true);
    // An untouched, unused default goes, a whole family at once.
    expect(rows.find((r) => r.key === 'utilities.electricity')!.archived).not.toBeNull();
    expect(rows.find((r) => r.key === 'utilities')!.archived).not.toBeNull();
    expect(byName(rows, 'Restaurants')).toBeUndefined();
    // The ones the app posts into itself stay open.
    expect(open(rows).some((r) => r.key === 'miscellaneous.fees_charges')).toBe(true);
  });

  it('skips a name the book already has, case-insensitively', async () => {
    const { database, ws, shop } = await businessCopy();
    await createAccount(database, inBook(ws, shop), { name: 'sales', kind: 'income', subtype: 'category', currency: null });
    const done = await applyCategoryStart(database, ws, { bookId: shop, start: 'business' });
    expect(done.added).not.toContain('Sales');
    expect(open(await rowsOf(database, shop)).filter((r) => r.name.toLowerCase() === 'sales')).toHaveLength(1);
  });

  it('is idempotent', async () => {
    const { database, ws, shop } = await businessCopy();
    await applyCategoryStart(database, ws, { bookId: shop, start: 'business' });
    const first = await rowsOf(database, shop);
    expect(await applyCategoryStart(database, ws, { bookId: shop, start: 'business' })).toEqual({ added: [], archived: [] });
    expect(await rowsOf(database, shop)).toEqual(first);
  });

  it('personal changes nothing', async () => {
    const { database, ws, shop } = await businessCopy();
    const before = await rowsOf(database, shop);
    expect(await applyCategoryStart(database, ws, { bookId: shop, start: 'personal' })).toEqual({ added: [], archived: [] });
    expect(await rowsOf(database, shop)).toEqual(before);
  });

  it('empty archives unused categories only, keeping the ones in use', async () => {
    const { database, ws, shop } = await businessCopy();
    const groceries = byName(await rowsOf(database, shop), 'Groceries')!;
    await spend(database, ws, groceries.id);
    await applyCategoryStart(database, ws, { bookId: shop, start: 'empty' });
    const left = open(await rowsOf(database, shop)).map((r) => r.name);
    expect(left).toContain('Groceries');
    expect(left).toContain('Household');
    expect(left).not.toContain('Restaurants');
    expect(left).not.toContain('Sales');
  });

  it('is atomic: a failure part-way leaves the book as it was', async () => {
    const { database, ws, shop } = await businessCopy();
    const before = await rowsOf(database, shop);
    await database.execScript(`CREATE TRIGGER boom BEFORE INSERT ON book_categories WHEN NEW.book_id = '${shop}' BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    await expect(applyCategoryStart(database, ws, { bookId: shop, start: 'business' })).rejects.toThrow();
    expect(await rowsOf(database, shop)).toEqual(before);
  });

  it('refuses a workspace that is shared, and an unknown one', async () => {
    const { database, ws } = await setupDb();
    const joint = await createBook(database, ws, { name: 'Joint', kind: 'shared', baseCurrency: 'IDR' });
    await expect(applyCategoryStart(database, ws, { bookId: joint, start: 'business' })).rejects.toMatchObject({ code: 'SHARED' });
    await expect(applyCategoryStart(database, ws, { bookId: 'nope', start: 'business' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
