import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { activeBookId, archiveBook, createAccount, createBook, inBook, listAccounts, listBooks, ownerScope, personalBook, renameBook, setActiveBook } from '../src/index';
import { setupDb } from './helpers';

describe('books', () => {
  it('gives every new workspace a Personal book holding its categories', async () => {
    const { database, ws } = await setupDb();
    const [personal, ...rest] = await listBooks(database, ws);
    expect(personal).toMatchObject({ name: 'Personal', kind: 'personal', baseCurrency: 'IDR', countEventsInBudget: false });
    expect(rest).toEqual([]);
    const categories = (await listAccounts(database, ws)).filter((a) => a.kind === 'expense' || a.kind === 'income');
    const [[filed]] = (await database.db.values<[number]>(sql`SELECT count(*) FROM book_categories WHERE book_id = ${personal!.id}`)) as [[number]];
    expect(Number(filed)).toBe(categories.length);
  });

  it('starts a new book empty, or with a copy of another book’s categories', async () => {
    const { database, ws } = await setupDb();
    const personal = await personalBook(database, ws);
    const empty = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', countEventsInBudget: true });
    const copied = await createBook(database, ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });

    const count = async (bookId: string) =>
      Number(((await database.db.values<[number]>(sql`SELECT count(*) FROM book_categories WHERE book_id = ${bookId}`)) as [[number]])[0][0]);
    expect(await count(empty)).toBe(0);
    expect(await count(copied)).toBe(await count(personal.id));

    // A copy is a new category, keeping its system key so card earning rules still recognise it.
    const keys = async (bookId: string) =>
      (await database.db.values<[string | null]>(sql`SELECT a.system_key FROM accounts a JOIN book_categories b ON b.category_account_id = a.id WHERE b.book_id = ${bookId} ORDER BY a.system_key`)).map((r) => r[0]);
    expect(await keys(copied)).toEqual(await keys(personal.id));
    expect((await listBooks(database, ws)).find((b) => b.id === empty)).toMatchObject({ countEventsInBudget: true });
  });

  it('files a new category into the book the context names', async () => {
    const { database, ws } = await setupDb();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const software = await createAccount(database, inBook(ws, business), { name: 'Software', kind: 'expense', subtype: 'category', currency: null });
    expect(await database.db.values(sql`SELECT book_id FROM book_categories WHERE category_account_id = ${software.id}`)).toEqual([[business]]);
    // No book named: the Personal book, as every category has always been.
    const other = await createAccount(database, ws, { name: 'Pets', kind: 'expense', subtype: 'category', currency: null });
    expect(await database.db.values(sql`SELECT book_id FROM book_categories WHERE category_account_id = ${other.id}`)).toEqual([[(await personalBook(database, ws)).id]]);
  });

  it('renames, archives, and remembers which book was open', async () => {
    const { database, ws } = await setupDb();
    const personal = await personalBook(database, ws);
    expect(await activeBookId(database, ws)).toBe(personal.id);
    const business = await createBook(database, ws, { name: 'Biz', kind: 'business', baseCurrency: 'IDR' });
    await renameBook(database, ws, business, 'Business');
    await setActiveBook(database, ws, business);
    expect(await activeBookId(database, ws)).toBe(business);

    await archiveBook(database, ws, business);
    expect((await listBooks(database, ws)).map((b) => b.name)).toEqual(['Personal']);
    // An archived book is no longer open; the app falls back to Personal.
    expect(await activeBookId(database, ws)).toBe(personal.id);
    await expect(archiveBook(database, ws, personal.id)).rejects.toThrow(/last/);
  });
});

describe('context helpers', () => {
  it('inBook narrows to a book; ownerScope drops it again for owner-level reads', () => {
    const ws = { workspaceId: 'ws1', baseCurrency: 'IDR' };
    const narrowed = inBook(ws, 'book1');
    expect(narrowed).toEqual({ workspaceId: 'ws1', baseCurrency: 'IDR', bookId: 'book1' });
    expect(ownerScope(narrowed)).toEqual({ workspaceId: 'ws1', baseCurrency: 'IDR' });
    // ownerScope never carries a bookId through, even if one somehow slipped in.
    expect(ownerScope(narrowed)).not.toHaveProperty('bookId');
  });
});
