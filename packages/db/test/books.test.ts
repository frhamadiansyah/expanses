import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  activeBookId,
  addSetCategory,
  archiveAccount,
  archiveBook,
  BookError,
  categoryIdsOfBook,
  categoryTotalsBetween,
  clearIncomeOverride,
  createAccount,
  createBook,
  createCategorySet,
  createWorkspace,
  ensureCategoryKeys,
  ensureDefaultCategorySets,
  inBook,
  listAccounts,
  listBooks,
  listCategorySets,
  getBudgetIncome,
  listBudgets,
  listExpenseTemplates,
  listTransactions,
  ownerScope,
  personalBook,
  postTransaction,
  renameBook,
  saveBudget,
  saveExpectedIncome,
  saveExpenseTemplate,
  setActiveBook,
  setBookEventsInBudget,
  setIncomeOverride,
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
    // A set category is filed in its set's book (Personal here), as migration 0042 also filed every set member, so the
    // copy has to exclude it by set membership rather than by book.
    await addSetCategory(database, ws, setId, 'Ski Trip Fund');

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
    // Personal is also the last book here, but it is refused for being Personal, not merely for being last
    // (the 'the Personal workspace is found by what it is' describe block below covers the last-book case on its own).
    await expect(archiveBook(database, ws, personal.id)).rejects.toMatchObject({ code: 'PERSONAL_BOOK' });
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

describe('reading one book', () => {
  it('adds up only the open book’s categories', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const meals = await createAccount(database, inBook(ws, business), { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });
    const pets = await createAccount(database, ws, { name: 'Pets', kind: 'expense', subtype: 'category', currency: null });
    const spend = (categoryId: string, amountMinor: number) =>
      postTransaction(database, ws, {
        occurredOn: '2026-08-15',
        description: 'x',
        lines: [
          { accountId: categoryId, amountMinor, currency: 'IDR' },
          { accountId: card.id, amountMinor: -amountMinor, currency: 'IDR' },
        ],
      });
    await spend(meals.id, 640_000);
    await spend(pets.id, 150_000);

    const ids = async (bookId?: string) =>
      (await categoryTotalsBetween(database, bookId ? inBook(ws, bookId) : ws, 'expense', '2026-08-01', '2026-08-31')).map((r) => r.accountId).sort();
    expect(await ids(business)).toEqual([meals.id]);
    expect(await ids(personal)).toEqual([pets.id]);
    expect(await ids()).toEqual([meals.id, pets.id].sort());
  });

  it('counts a set’s categories in the book the set is filed in', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    // A set's categories are not filed in book_categories themselves: they travel with their set.
    const setId = await createCategorySet(database, inBook(ws, business), 'Trade fair');
    const booth = await addSetCategory(database, ws, setId, 'Booth');
    await postTransaction(database, ws, {
      occurredOn: '2026-08-15',
      description: 'Booth rental',
      lines: [
        { accountId: booth, amountMinor: 900_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -900_000, currency: 'IDR' },
      ],
    });
    const ids = async (bookId: string) => (await categoryTotalsBetween(database, inBook(ws, bookId), 'expense', '2026-08-01', '2026-08-31')).map((r) => r.accountId);
    expect(await ids(business)).toEqual([booth]);
    expect(await ids(personal)).toEqual([]);
  });

  it('files a new set category into its set’s book, and spending into it into that book', async () => {
    const { database, ws } = await setupDb();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const setId = await createCategorySet(database, inBook(ws, business), 'Trade fair');
    // Added from a context naming no book: the set decides, not the context.
    const booth = await addSetCategory(database, ws, setId, 'Booth');
    expect(await database.db.values(sql`SELECT book_id FROM book_categories WHERE category_account_id = ${booth}`)).toEqual([[business]]);

    const rental = await postTransaction(database, ws, {
      occurredOn: '2026-08-15',
      description: 'Booth rental',
      lines: [
        { accountId: booth, amountMinor: 900_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -900_000, currency: 'IDR' },
      ],
    });
    expect(await database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${rental}`)).toEqual([[business]]);
  });

  it('files the default sets’ categories into Personal, even with another book open', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const created = await ensureDefaultCategorySets(database, inBook(ws, business));
    expect(created.length).toBeGreaterThan(0);
    expect(await listCategorySets(database, inBook(ws, business))).toEqual([]);
    expect((await listCategorySets(database, inBook(ws, personal))).map((set) => set.name).sort()).toEqual([...created].sort());
    // Every one of their categories has a book row, and it is Personal's.
    const unfiled = await database.db.values(
      sql`SELECT m.category_account_id FROM category_set_members m LEFT JOIN book_categories b ON b.category_account_id = m.category_account_id
          WHERE m.workspace_id = ${ws.workspaceId} AND (b.book_id IS NULL OR b.book_id != ${personal})`,
    );
    expect(unfiled).toEqual([]);
  });

  it('lists and files category sets by book', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const fair = await createCategorySet(database, inBook(ws, business), 'Trade fair');
    // No book named: Personal, as every set has always been.
    const holiday = await createCategorySet(database, ws, 'Holiday');
    expect(await database.db.values(sql`SELECT book_id FROM book_category_sets WHERE set_id = ${fair}`)).toEqual([[business]]);
    expect(await database.db.values(sql`SELECT book_id FROM book_category_sets WHERE set_id = ${holiday}`)).toEqual([[personal]]);

    const names = async (scope: typeof ws) => (await listCategorySets(database, scope)).map((set) => set.name);
    expect(await names(inBook(ws, business))).toEqual(['Trade fair']);
    expect(await names(inBook(ws, personal))).toEqual(['Holiday']);
    expect(await names(ws)).toEqual(['Holiday', 'Trade fair']);
  });

  it('files the default sets, and any default category created on open, into Personal', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    const created = await ensureDefaultCategorySets(database, ws);
    expect(created.length).toBeGreaterThan(0);
    expect((await listCategorySets(database, inBook(ws, personal))).map((set) => set.name).sort()).toEqual([...created].sort());

    // A default the workspace is missing is recreated on open; it lands in Personal like the rest of the tree.
    const [[gift]] = (await database.db.values<[string]>(sql`SELECT id FROM accounts WHERE workspace_id = ${ws.workspaceId} AND system_key = 'utilities.gas_energy'`)) as [[string]];
    await database.db.run(sql`DELETE FROM book_categories WHERE category_account_id = ${gift}`);
    await database.db.run(sql`DELETE FROM accounts WHERE id = ${gift}`);
    expect((await ensureCategoryKeys(database, ws)).created).toContain('utilities.gas_energy');
    const [[recreated]] = (await database.db.values<[string]>(sql`SELECT id FROM accounts WHERE workspace_id = ${ws.workspaceId} AND system_key = 'utilities.gas_energy'`)) as [[string]];
    expect(await categoryIdsOfBook(database, personal)).toContain(recreated);
  });

  it('lists the book’s transactions and every transfer, never another book’s spending', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const meals = await createAccount(database, inBook(ws, business), { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });
    const post = (description: string, a: string, b: string) =>
      postTransaction(database, ws, { occurredOn: '2026-08-15', description, lines: [{ accountId: a, amountMinor: 1000, currency: 'IDR' }, { accountId: b, amountMinor: -1000, currency: 'IDR' }] });
    await post('Supplier dinner', meals.id, card.id);
    await post('Card bill', card.id, bank.id);

    const names = async (bookId: string) => (await listTransactions(database, inBook(ws, bookId))).map((t) => t.description).sort();
    expect(await names(business)).toEqual(['Card bill', 'Supplier dinner']);
    expect(await names(personal)).toEqual(['Card bill']);
  });
});

describe('budgets, expected income and bills by book', () => {
  it('keeps budgets, expected income and bills to their own book', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const software = await createAccount(database, inBook(ws, business), { name: 'Software', kind: 'expense', subtype: 'category', currency: null });
    const pets = await createAccount(database, ws, { name: 'Pets', kind: 'expense', subtype: 'category', currency: null });

    await saveBudget(database, inBook(ws, business), { categoryAccountId: software.id, amountMinor: 1_000_000 });
    await saveBudget(database, inBook(ws, personal), { categoryAccountId: pets.id, amountMinor: 500_000 });
    await saveExpectedIncome(database, inBook(ws, business), 20_000_000);
    await saveExpenseTemplate(database, inBook(ws, business), { name: 'Figma', categoryAccountId: software.id, moneyAccountId: bank.id, amountMinor: 260_000, dayOfMonth: 2 });

    expect((await listBudgets(database, inBook(ws, business), '2026-09')).map((b) => b.categoryAccountId)).toEqual([software.id]);
    expect((await getBudgetIncome(database, inBook(ws, business), '2026-09')).amountMinor).toBe(20_000_000);
    expect((await getBudgetIncome(database, inBook(ws, personal), '2026-09')).amountMinor).not.toBe(20_000_000);
    expect((await listExpenseTemplates(database, inBook(ws, business))).map((t) => t.name)).toEqual(['Figma']);
    expect(await listExpenseTemplates(database, inBook(ws, personal))).toEqual([]);
  });

  it('writes without a book to Personal too, so the old table and the book table agree', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;

    // Saved with no book named, the way the sample seed and every pre-books caller does.
    await saveExpectedIncome(database, ws, 41_500_000);
    expect((await getBudgetIncome(database, ws, '2026-09')).amountMinor).toBe(41_500_000);
    expect((await getBudgetIncome(database, inBook(ws, personal), '2026-09')).amountMinor).toBe(41_500_000);

    // Saved again through Personal's own id, the old table (which unscoped reads use) still agrees.
    await saveExpectedIncome(database, inBook(ws, personal), 45_000_000);
    expect((await getBudgetIncome(database, ws, '2026-09')).amountMinor).toBe(45_000_000);
    expect((await getBudgetIncome(database, inBook(ws, personal), '2026-09')).amountMinor).toBe(45_000_000);
  });
});

describe('expected-income overrides, dual-written like saveExpectedIncome', () => {
  it('with Personal named, updates both the old table and the book table', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;

    await setIncomeOverride(database, inBook(ws, personal), { month: '2026-10', amountMinor: 5_000_000 });
    expect((await getBudgetIncome(database, ws, '2026-10')).amountMinor).toBe(5_000_000);
    expect((await getBudgetIncome(database, inBook(ws, personal), '2026-10')).amountMinor).toBe(5_000_000);

    await clearIncomeOverride(database, inBook(ws, personal), '2026-10');
    expect((await getBudgetIncome(database, ws, '2026-10')).overridden).toBe(false);
    expect((await getBudgetIncome(database, inBook(ws, personal), '2026-10')).overridden).toBe(false);
  });

  it('with a Business book named, touches only that book: an unscoped read still shows the old figure', async () => {
    const { database, ws } = await setupDb();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    await saveExpectedIncome(database, ws, 41_500_000);

    await setIncomeOverride(database, inBook(ws, business), { month: '2026-10', amountMinor: 9_000_000 });
    expect((await getBudgetIncome(database, inBook(ws, business), '2026-10')).amountMinor).toBe(9_000_000);
    expect((await getBudgetIncome(database, ws, '2026-10')).amountMinor).toBe(41_500_000);
    expect((await getBudgetIncome(database, ws, '2026-10')).overridden).toBe(false);

    await clearIncomeOverride(database, inBook(ws, business), '2026-10');
    expect((await getBudgetIncome(database, inBook(ws, business), '2026-10')).overridden).toBe(false);
    // The old, unscoped figure was never touched by Business's override or its clearing.
    expect((await getBudgetIncome(database, ws, '2026-10')).amountMinor).toBe(41_500_000);
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

describe('the Personal workspace is found by what it is', () => {
  it('stays Personal when a workspace made before it is archived, and cannot itself be archived', async () => {
    const { database, ws } = await setupDb();
    const personal = await personalBook(database, ws);
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });

    // Personal is the book of kind 'personal', not merely the first row.
    await database.db.run(sql`UPDATE books SET sort_order = 5 WHERE id = ${personal.id}`);
    expect((await personalBook(database, ws)).id).toBe(personal.id);

    await expect(archiveBook(database, ws, personal.id)).rejects.toMatchObject({ code: 'PERSONAL_BOOK' });
    await archiveBook(database, ws, business);
    expect((await listBooks(database, ws)).map((b) => b.name)).toEqual(['Personal']);
  });

  it('refuses a second Personal, an unknown id, an unsupported currency and an unknown kind', async () => {
    const { database, ws } = await setupDb();
    await expect(createBook(database, ws, { name: 'Also me', kind: 'personal', baseCurrency: 'IDR' })).rejects.toMatchObject({ code: 'ONE_PERSONAL' });
    await expect(createBook(database, ws, { name: 'Biz', kind: 'business', baseCurrency: 'ZZZ' })).rejects.toMatchObject({ code: 'BAD_CURRENCY' });
    await expect(createBook(database, ws, { name: 'Biz', kind: 'club' as never, baseCurrency: 'IDR' })).rejects.toMatchObject({ code: 'BAD_KIND' });
    await expect(renameBook(database, ws, 'no-such-book', 'Nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(archiveBook(database, ws, 'no-such-book')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(setActiveBook(database, ws, 'no-such-book')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('remembers whether a workspace counts event spending in its budget', async () => {
    const { database, ws } = await setupDb();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', countEventsInBudget: true });
    expect((await listBooks(database, ws)).find((b) => b.id === business)).toMatchObject({ countEventsInBudget: true });
    await setBookEventsInBudget(database, ws, business, false);
    expect((await listBooks(database, ws)).find((b) => b.id === business)).toMatchObject({ countEventsInBudget: false });
  });
});
