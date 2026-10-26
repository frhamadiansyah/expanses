import { splitExpenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  activeBookId,
  archiveBook,
  categoryIdsByKey,
  categoryIdsOfBook,
  createAccount,
  createBook,
  deleteBook,
  inBook,
  listArchivedBooks,
  listBooks,
  nativeBalances,
  netWorthAt,
  personalBook,
  planBookDelete,
  postTransaction,
  saveBudget,
  setActiveBook,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';
import { shareBookForTest } from './sync/sync-helpers';

/* Deleting a workspace for good (not archiving it). Invented names and figures throughout. */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function world() {
  current = await setupDb();
  const { database, ws } = current;
  const personal = (await personalBook(database, ws)).id;
  const shop = await createBook(database, ws, { name: 'Corner Shop', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const family = await createBook(database, ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const bank = (await createAccount(database, ws, { name: 'Main bank', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
  const dining = (await categoryIdsByKey(database, inBook(ws, shop)))['food_beverage.restaurants']!;
  const familyDining = (await categoryIdsByKey(database, inBook(ws, family)))['food_beverage.restaurants']!;
  const personalDining = (await categoryIdsByKey(database, inBook(ws, personal)))['food_beverage.restaurants']!;
  return { database, ws, personal, shop, family, bank, dining, familyDining, personalDining };
}
type World = Awaited<ReturnType<typeof world>>;

const spend = (w: World, bookId: string, category: string, amount: number, on = '2026-05-10') =>
  postTransaction(w.database, inBook(w.ws, bookId), {
    occurredOn: on,
    description: 'Supplier lunch',
    lines: [
      { accountId: category, amountMinor: amount, currency: 'IDR' },
      { accountId: w.bank, amountMinor: -amount, currency: 'IDR' },
    ],
  });

const statuses = async (w: World) => (await w.database.db.values<[string]>(sql`SELECT status FROM transactions`)).map(([s]) => s);
const bookIds = async (w: World) => (await listBooks(w.database, w.ws)).map((b) => b.id);

describe('deleting a workspace', () => {
  it('deletes an empty workspace outright, out of the open list and the archived one', async () => {
    const w = await world();
    const plan = await planBookDelete(w.database, w.ws, w.shop);
    expect(plan).toMatchObject({ transactions: 0, budgets: 0, empty: true, refusal: null });
    expect(plan.categories).toBeGreaterThan(0);
    const before = await categoryIdsOfBook(w.database, w.shop);
    await deleteBook(w.database, w.ws, w.shop);
    expect((await listBooks(w.database, w.ws)).map((b) => b.name)).toEqual(['Personal', 'Family']);
    expect(await listArchivedBooks(w.database, w.ws)).toEqual([]);
    expect(await categoryIdsOfBook(w.database, w.shop)).toEqual([]);
    // Its categories are archived, none left live.
    const live = await w.database.db.values(sql`SELECT count(*) FROM accounts WHERE id IN ${before} AND archived_at IS NULL`);
    expect(live).toEqual([[0]]);
  });

  it('voids everything filed in it, restores balances and net worth, and removes categories and budgets', async () => {
    const w = await world();
    const worth = async () => (await netWorthAt(w.database, w.ws, '2026-12-31', {})).netWorthMinor;
    const first = await spend(w, w.personal, w.personalDining, 10_000, '2026-05-01');
    const beforeBalances = await nativeBalances(w.database, w.ws);
    const beforeWorth = await worth();
    const a = await spend(w, w.shop, w.dining, 250_000);
    const b = await spend(w, w.shop, w.dining, 80_000, '2026-05-12');
    expect((await nativeBalances(w.database, w.ws))[w.bank]).toBe(beforeBalances[w.bank]! - 330_000);
    await saveBudget(w.database, inBook(w.ws, w.shop), { categoryAccountId: w.dining, amountMinor: 900_000 });

    const plan = await planBookDelete(w.database, w.ws, w.shop);
    expect(plan).toMatchObject({ transactions: 2, budgets: 1, empty: false, refusal: null });

    const done = await deleteBook(w.database, w.ws, w.shop);
    expect(done).toMatchObject({ transactions: 2, budgets: 1 });
    expect(await nativeBalances(w.database, w.ws)).toEqual(beforeBalances);
    expect(await worth()).toBe(beforeWorth);
    expect(await w.database.db.values(sql`SELECT status FROM transactions WHERE id IN (${a}, ${b})`)).toEqual([['void'], ['void']]);
    // The ledger keeps its record: voided, not erased. The other workspace's money is untouched.
    expect(await w.database.db.values(sql`SELECT status FROM transactions WHERE id = ${first}`)).toEqual([['posted']]);
    expect(await w.database.db.values(sql`SELECT count(*) FROM budgets`)).toEqual([[0]]);
    expect(await w.database.db.values(sql`SELECT count(*) FROM book_transactions WHERE book_id = ${w.shop}`)).toEqual([[0]]);
    expect(await bookIds(w)).not.toContain(w.shop);
    expect((await listArchivedBooks(w.database, w.ws)).map((x) => x.id)).not.toContain(w.shop);
    expect(await w.database.db.values(sql`SELECT count(*) FROM books WHERE id = ${w.shop}`)).toEqual([[0]]);
  });

  it('deletes an archived workspace too', async () => {
    const w = await world();
    await spend(w, w.shop, w.dining, 1_000);
    await archiveBook(w.database, w.ws, w.shop);
    await deleteBook(w.database, w.ws, w.shop);
    expect(await listArchivedBooks(w.database, w.ws)).toEqual([]);
  });

  it('falls back to Personal when the deleted workspace was the open one', async () => {
    const w = await world();
    await setActiveBook(w.database, w.ws, w.shop);
    expect(await activeBookId(w.database, w.ws)).toBe(w.shop);
    await deleteBook(w.database, w.ws, w.shop);
    expect(await activeBookId(w.database, w.ws)).toBe(w.personal);
  });

  it('refuses the Personal workspace', async () => {
    const w = await world();
    await expect(deleteBook(w.database, w.ws, w.personal)).rejects.toMatchObject({ code: 'PERSONAL_BOOK' });
    expect((await planBookDelete(w.database, w.ws, w.personal)).refusal).toMatch(/cannot be deleted/);
  });

  it('refuses a shared workspace, and one joined from someone else, with nothing changed', async () => {
    const w = await world();
    await spend(w, w.shop, w.dining, 5_000);
    await shareBookForTest(w.database, w.shop);
    await expect(deleteBook(w.database, w.ws, w.shop)).rejects.toMatchObject({ code: 'SHARED', message: expect.stringContaining('Stop sharing it first') });
    expect((await statuses(w)).every((s) => s === 'posted')).toBe(true);
    expect(await bookIds(w)).toContain(w.shop);

    await w.database.db.run(sql`UPDATE books SET kind = 'shared' WHERE id = ${w.family}`);
    await shareBookForTest(w.database, w.family);
    await expect(deleteBook(w.database, w.ws, w.family)).rejects.toMatchObject({ code: 'SHARED' });
    expect(await w.database.db.values(sql`SELECT count(*) FROM books WHERE id = ${w.family}`)).toEqual([[1]]);
  });

  it('refuses a purchase split with another workspace, and changes nothing', async () => {
    const w = await world();
    const card = await createAccount(w.database, w.ws, { name: 'Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await spend(w, w.shop, w.dining, 40_000);
    const split = await postTransaction(w.database, inBook(w.ws, w.shop), {
      occurredOn: '2026-05-20',
      description: 'Pasar Sentosa',
      lines: splitExpenseLines({
        paymentAccountId: card.id,
        currency: 'IDR',
        splits: [
          { categoryAccountId: w.dining, amountMinor: 90_000 },
          { categoryAccountId: w.familyDining, amountMinor: 45_000 },
        ],
      }),
      acrossBooks: true,
    });
    const balances = await nativeBalances(w.database, w.ws);
    const plan = await planBookDelete(w.database, w.ws, w.shop);
    expect(plan.refusalCode).toBe('SPLIT');
    await expect(deleteBook(w.database, w.ws, w.shop)).rejects.toMatchObject({ code: 'SPLIT' });
    expect(await nativeBalances(w.database, w.ws)).toEqual(balances);
    expect(await w.database.db.values(sql`SELECT status FROM transactions WHERE id = ${split}`)).toEqual([['posted']]);
    expect((await statuses(w)).every((s) => s === 'posted')).toBe(true);
    expect(await w.database.db.values(sql`SELECT count(*) FROM book_categories WHERE book_id = ${w.shop}`)).not.toEqual([[0]]);
    expect(await bookIds(w)).toContain(w.shop);
  });

  it('refuses a transaction whose lines touch two workspaces, and changes nothing', async () => {
    const w = await world();
    const id = await spend(w, w.shop, w.dining, 7_000);
    // A line on another workspace's category slipped in beside the shop's own (bypassing the posting rule that forbids it).
    await w.database.db.run(
      sql`INSERT INTO entries (id, workspace_id, transaction_id, account_id, amount_minor, currency, fx_rate_to_base, amount_base_minor) VALUES ('stray', ${w.ws.workspaceId}, ${id}, ${w.familyDining}, 1, 'IDR', 1, 1)`,
    );
    await expect(deleteBook(w.database, w.ws, w.shop)).rejects.toMatchObject({ code: 'SPLIT' });
    expect(await w.database.db.values(sql`SELECT status FROM transactions WHERE id = ${id}`)).toEqual([['posted']]);
    expect(await bookIds(w)).toContain(w.shop);
  });

  it('is all or nothing: a failure partway leaves every transaction posted', async () => {
    const w = await world();
    const ok = await spend(w, w.shop, w.dining, 3_000, '2026-05-02');
    const later = await spend(w, w.shop, w.dining, 4_000, '2026-05-03');
    // Newest first: `later` is voided, then `ok` is met as a sale and refuses; the void of `later` must go back.
    await w.database.db.run(
      sql`INSERT INTO asset_sales (id, workspace_id, account_id, sold_on, sold_for_minor, cash_account_id, transaction_id, created_at)
          VALUES ('s', ${w.ws.workspaceId}, ${w.bank}, '2026-05-02', 3000, ${w.bank}, ${ok}, '2026-05-02')`,
    );
    await expect(deleteBook(w.database, w.ws, w.shop)).rejects.toMatchObject({ code: 'CANNOT_VOID' });
    expect(await w.database.db.values(sql`SELECT status FROM transactions WHERE id IN (${ok}, ${later})`)).toEqual([['posted'], ['posted']]);
    expect(await bookIds(w)).toContain(w.shop);
  });
});
