import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  activeBookId,
  addSetCategory,
  archiveAccount,
  archiveBook,
  BookError,
  booksSchema,
  createAccount,
  createBook,
  createCategorySet,
  createWorkspace,
  inBook,
  listAccounts,
  listBooks,
  ownerScope,
  personalBook,
  postTransaction,
  renameBook,
  setActiveBook,
} from '../src/index';
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

    // Tree shape carries over too: a copied child points at its own book's copied parent, never the source's id.
    const tree = async (bookId: string) => {
      const rows = await database.db.values<[string, string, string | null]>(
        sql`SELECT a.id, a.name, a.parent_id FROM accounts a JOIN book_categories b ON b.category_account_id = a.id WHERE b.book_id = ${bookId}`,
      );
      return new Map(rows.map(([accountId, name, parentId]) => [name, { id: accountId, parentId }]));
    };
    const personalTree = await tree(personal.id);
    const copiedTree = await tree(copied);
    let sawAChild = false;
    for (const [name, row] of personalTree) {
      if (!row.parentId) continue;
      sawAChild = true;
      const parentName = [...personalTree].find(([, v]) => v.id === row.parentId)?.[0];
      expect(copiedTree.get(name)!.parentId).toBe(copiedTree.get(parentName!)!.id);
      expect(copiedTree.get(name)!.parentId).not.toBe(row.parentId);
    }
    expect(sawAChild).toBe(true);
  });

  it('refuses to copy categories from a book outside this workspace', async () => {
    const { database, ws } = await setupDb();
    const other = await createWorkspace(database, { name: 'Other', type: 'personal', baseCurrency: 'IDR' });
    const otherPersonal = await personalBook(database, other);

    await expect(createBook(database, ws, { name: 'Sneaky', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: otherPersonal.id })).rejects.toThrow(BookError);
    // Nothing was left behind by the failed attempt: it fails atomically, book included.
    expect((await listBooks(database, ws)).map((b) => b.name)).toEqual(['Personal']);
  });

  it('refuses to copy categories from an archived book', async () => {
    const { database, ws } = await setupDb();
    const biz = await createBook(database, ws, { name: 'Biz', kind: 'business', baseCurrency: 'IDR' });
    await archiveBook(database, ws, biz);

    await expect(createBook(database, ws, { name: 'Copy', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: biz })).rejects.toThrow(BookError);
  });

  it('excludes category-set members when copying, even one a migrated database also filed in the book', async () => {
    const { database, ws } = await setupDb();
    const personal = await personalBook(database, ws);
    const setId = await createCategorySet(database, ws, 'Holiday');
    // A name with no collision among DEFAULT_CATEGORIES (which does include a plain "Flights"), so the assertion
    // below can only pass because the set member was excluded, not because of an unrelated name clash.
    const skiTrip = await addSetCategory(database, ws, setId, 'Ski Trip Fund');
    // addSetCategory does not file a set category into any book, but migration 0042 backfilled every income/expense
    // account into the Personal book regardless of set membership — reproduce that so the exclusion is exercised.
    await database.db.insert(booksSchema.bookCategories).values({ categoryAccountId: skiTrip, workspaceId: ws.workspaceId, bookId: personal.id });

    const copied = await createBook(database, ws, { name: 'Copy', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    const names = (
      await database.db.values<[string]>(sql`SELECT a.name FROM accounts a JOIN book_categories b ON b.category_account_id = a.id WHERE b.book_id = ${copied}`)
    ).map((r) => r[0]);
    expect(names).not.toContain('Ski Trip Fund');
  });

  it('files a child at the top level when its parent is archived and so is not being copied', async () => {
    const { database, ws } = await setupDb();
    const source = await createBook(database, ws, { name: 'Source', kind: 'business', baseCurrency: 'IDR' });
    const parent = await createAccount(database, inBook(ws, source), { name: 'Parent', kind: 'expense', subtype: 'category', currency: null });
    await createAccount(database, inBook(ws, source), { name: 'Child', kind: 'expense', subtype: 'category', currency: null, parentId: parent.id });
    await archiveAccount(database, ws, parent.id);

    const copied = await createBook(database, ws, { name: 'Copy', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: source });
    const rows = await database.db.values<[string, string | null]>(
      sql`SELECT a.name, a.parent_id FROM accounts a JOIN book_categories b ON b.category_account_id = a.id WHERE b.book_id = ${copied}`,
    );
    expect(rows).toEqual([['Child', null]]);
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

describe('posting into a book', () => {
  it('files spending into its category’s book and a transfer into none', async () => {
    const { database, ws } = await setupDb();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const meals = await createAccount(database, inBook(ws, business), { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });

    const dinner = await postTransaction(database, ws, {
      occurredOn: '2026-08-15',
      description: 'Supplier dinner',
      lines: [
        { accountId: meals.id, amountMinor: 640_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -640_000, currency: 'IDR' },
      ],
    });
    const payment = await postTransaction(database, ws, {
      occurredOn: '2026-08-20',
      description: 'Card bill',
      lines: [
        { accountId: card.id, amountMinor: 640_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -640_000, currency: 'IDR' },
      ],
    });
    expect(await database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${dinner}`)).toEqual([[business]]);
    expect(await database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${payment}`)).toEqual([]);
  });

  it('refuses one transaction spending in two books', async () => {
    const { database, ws } = await setupDb();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const meals = await createAccount(database, inBook(ws, business), { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });
    const pets = await createAccount(database, ws, { name: 'Pets', kind: 'expense', subtype: 'category', currency: null });
    await expect(
      postTransaction(database, ws, {
        occurredOn: '2026-08-15',
        description: 'Mixed',
        lines: [
          { accountId: meals.id, amountMinor: 100, currency: 'IDR' },
          { accountId: pets.id, amountMinor: 100, currency: 'IDR' },
          { accountId: card.id, amountMinor: -200, currency: 'IDR' },
        ],
      }),
    ).rejects.toThrow(/two workspaces/);
    // Refused before anything was written: no entries were left behind for either category.
    expect(await database.db.values(sql`SELECT count(*) FROM entries WHERE account_id IN (${meals.id}, ${pets.id})`)).toEqual([[0]]);
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
