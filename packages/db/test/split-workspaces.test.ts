import { type CaptureLine, splitExpenseLines, type StatementPeriod } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  budgetSheetFor,
  cardSpendLines,
  cardStatementLines,
  categoryIdsByKey,
  categoryTotalsIn,
  createAccount,
  createBook,
  createCardAccount,
  inBook,
  listTransactions,
  nativeBalances,
  ownerScope,
  personalBook,
  postTransaction,
  prepareStatementCheck,
  replaceTransaction,
  saveCardTerms,
  voidTransaction,
} from '../src/index';
import { assertShareableTx } from '../src/sync/seed';
import { setupDb, type TestDb } from './helpers';

/*
 * One purchase split across two workspaces (0084): one card charge, its category lines filed in Family and Business.
 * Each workspace counts its own part; the card, its statement and its points see the whole charge. Invented figures.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function threeBooks() {
  current = await setupDb();
  const { database, ws } = current;
  const personal = (await personalBook(database, ws)).id;
  const family = await createBook(database, ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const card = await createCardAccount(database, ws, { name: 'Visa', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-01-01' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 10, dueDay: 25, creditLimitMinor: null, annualFeeMinor: null });
  const groceries = (await categoryIdsByKey(database, inBook(ws, family)))['household.groceries']!;
  const familyDining = (await categoryIdsByKey(database, inBook(ws, family)))['food_beverage.restaurants']!;
  const personalGroceries = (await categoryIdsByKey(database, inBook(ws, personal)))['household.groceries']!;
  const office = (await createAccount(database, inBook(ws, business), { name: 'Office supplies', kind: 'expense', subtype: 'category', currency: null })).id;
  return { database, ws, personal, family, business, card: card.id, groceries, familyDining, personalGroceries, office };
}

type Books = Awaited<ReturnType<typeof threeBooks>>;

/** Pasar Sentosa, Rp 1.350.000 on the card: Rp 900.000 groceries for Family, Rp 450.000 office supplies for Business. */
const market = (h: Books, parts: { categoryAccountId: string; amountMinor: number }[] = [
  { categoryAccountId: h.groceries, amountMinor: 900_000 },
  { categoryAccountId: h.office, amountMinor: 450_000 },
]) => ({
  occurredOn: '2026-05-20',
  description: 'Pasar Sentosa',
  lines: splitExpenseLines({ paymentAccountId: h.card, currency: 'IDR', splits: parts }),
});

const spent = async (h: Books, bookId: string) =>
  (await categoryTotalsIn(h.database, inBook(h.ws, bookId), 'expense', '2026-05-01', '2026-05-31')).rows.reduce((sum, row) => sum + row.amountBaseMinor, 0);

const listed = async (h: Books, bookId: string) => (await listTransactions(h.database, inBook(h.ws, bookId), { from: '2026-05-01', to: '2026-05-31' })).map((tx) => tx.id);

const filing = async (h: Books, id: string) => ({
  one: await h.database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${id}`),
  split: (await h.database.db.values<[string]>(sql`SELECT book_id FROM book_transaction_splits WHERE transaction_id = ${id} ORDER BY rowid`)).map(([book]) => book),
});

describe('a purchase split across workspaces', () => {
  it('is one transaction filed in each workspace with a part, and nowhere else', async () => {
    const h = await threeBooks();
    const id = await postTransaction(h.database, inBook(h.ws, h.family), { ...market(h), acrossBooks: true });
    expect(await filing(h, id)).toEqual({ one: [], split: [h.family, h.business] });

    // Listed once in each workspace with a part, never in the third, and once read owner-wide.
    expect(await listed(h, h.family)).toEqual([id]);
    expect(await listed(h, h.business)).toEqual([id]);
    expect(await listed(h, h.personal)).toEqual([]);
    expect((await listTransactions(h.database, ownerScope(h.ws), { id })).length).toBe(1);

    // The view is the whole purchase; each category line says whose part it is.
    const [view] = await listTransactions(h.database, inBook(h.ws, h.family), { id });
    expect(view!.splitBooks?.map((book) => book.name)).toEqual(['Family', 'Business']);
    expect(view!.entries.filter((e) => e.accountKind === 'expense').map((e) => [e.amountMinor, e.bookId])).toEqual([
      [900_000, h.family],
      [450_000, h.business],
    ]);
    expect(view!.entries.find((e) => e.accountId === h.card)).toMatchObject({ amountMinor: -1_350_000 });
    expect(view!.entries.find((e) => e.accountId === h.card)).not.toHaveProperty('bookId');
  });

  it('counts only each workspace’s own part in its spending and its budget', async () => {
    const h = await threeBooks();
    await postTransaction(h.database, inBook(h.ws, h.family), { ...market(h), acrossBooks: true });
    expect(await spent(h, h.family)).toBe(900_000);
    expect(await spent(h, h.business)).toBe(450_000);
    expect(await spent(h, h.personal)).toBe(0);
    expect((await budgetSheetFor(h.database, inBook(h.ws, h.family), '2026-05')).spendingActualMinor).toBe(900_000);
    expect((await budgetSheetFor(h.database, inBook(h.ws, h.business), '2026-05')).spendingActualMinor).toBe(450_000);
  });

  it('leaves the card, its statement and its points the whole charge', async () => {
    const h = await threeBooks();
    const id = await postTransaction(h.database, inBook(h.ws, h.family), { ...market(h), acrossBooks: true });
    expect((await nativeBalances(h.database, h.ws))[h.card]).toBe(-1_350_000);

    const lines = (await cardStatementLines(h.database, h.ws, h.card)).filter((line) => line.transactionId === id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ owedMinor: 1_350_000, countedMinor: 1_350_000, spending: true, splitCategories: ['Groceries', 'Office supplies'] });

    // Points read every line charged to the card, whichever workspace is open.
    for (const ws of [h.ws, inBook(h.ws, h.family), inBook(h.ws, h.business)]) {
      const earning = (await cardSpendLines(h.database, ws, h.card, '2026-05-11', '2026-06-10')).filter((line) => line.transactionId === id);
      expect(earning.reduce((sum, line) => sum + line.amountMinor, 0)).toBe(1_350_000);
    }
  });

  it('is matched as the one line the bank prints, from either workspace', async () => {
    const h = await threeBooks();
    const id = await postTransaction(h.database, inBook(h.ws, h.family), { ...market(h), acrossBooks: true });
    const at = (x: number, y: number, text: string, w = 0.2): CaptureLine => ({ text, box: [x, y, w, 0.02], height: 0.02 });
    const shot = [at(0.05, 0.1, '20MAY', 0.1), at(0.25, 0.1, 'PASAR SENTOSA', 0.5), at(0.85, 0.1, '1,350,000', 0.12), at(0.05, 0.25, 'New Balance', 0.3), at(0.85, 0.25, '1,350,000', 0.12)];
    const period: StatementPeriod = { start: '2026-05-11', end: '2026-06-10' };
    for (const bookId of [h.family, h.business]) {
      const prepared = await prepareStatementCheck(h.database, inBook(h.ws, bookId), { cardAccountId: h.card, period, images: [shot], today: '2026-07-01' });
      expect(prepared.rows.map((row) => row.outcome)).toMatchObject([{ status: 'matched', candidateIds: [id] }]);
    }
  });

  it('is refused without being asked for, as categories from two workspaces always were', async () => {
    const h = await threeBooks();
    await expect(postTransaction(h.database, inBook(h.ws, h.family), market(h))).rejects.toMatchObject({ code: 'TWO_BOOKS' });
  });

  it('may have a part in one workspace shared with a household, never in two', async () => {
    const h = await threeBooks();
    const share = (bookId: string, relay: string) =>
      h.database.db.run(
        sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${relay}, 1, 'member-1', 'unshared', '2026-05-01T00:00:00Z')`,
      );
    // Shared once and read-only since: what a split may touch is decided by the share being here at all.
    await share(h.business, 'relay-1');
    await share(h.family, 'relay-2');
    await expect(postTransaction(h.database, inBook(h.ws, h.family), { ...market(h), acrossBooks: true })).rejects.toMatchObject({
      code: 'SPLIT_SHARED',
      message: expect.stringContaining('one shared workspace at most'),
    });
    expect(await listed(h, h.family)).toEqual([]);
    await h.database.db.run(sql`DELETE FROM shared_books WHERE book_id = ${h.business}`);
    await h.database.db.run(sql`DELETE FROM shared_books WHERE book_id = ${h.family}`);
    const id = await postTransaction(h.database, inBook(h.ws, h.family), { ...market(h), acrossBooks: true });
    expect(await filing(h, id)).toEqual({ one: [], split: [h.family, h.business] });
  });
});

describe('editing and deleting a split across workspaces', () => {
  it('changes every part together, from either workspace, and stays split', async () => {
    const h = await threeBooks();
    const id = await postTransaction(h.database, inBook(h.ws, h.family), { ...market(h), acrossBooks: true });
    const edited = await replaceTransaction(
      h.database,
      inBook(h.ws, h.business),
      id,
      market(h, [
        { categoryAccountId: h.groceries, amountMinor: 800_000 },
        { categoryAccountId: h.office, amountMinor: 550_000 },
      ]),
    );
    expect(await h.database.db.values(sql`SELECT status FROM transactions WHERE id = ${id}`)).toEqual([['void']]);
    expect(await filing(h, edited)).toEqual({ one: [], split: [h.family, h.business] });
    expect(await spent(h, h.family)).toBe(800_000);
    expect(await spent(h, h.business)).toBe(550_000);
    expect(await listed(h, h.family)).toEqual([edited]);
    expect(await listed(h, h.business)).toEqual([edited]);
    expect((await nativeBalances(h.database, h.ws))[h.card]).toBe(-1_350_000);
  });

  it('splits a saved purchase, and takes a split back to one of its workspaces', async () => {
    const h = await threeBooks();
    const whole = await postTransaction(h.database, inBook(h.ws, h.family), market(h, [{ categoryAccountId: h.groceries, amountMinor: 1_350_000 }]));
    expect(await filing(h, whole)).toEqual({ one: [[h.family]], split: [] });

    const split = await replaceTransaction(h.database, inBook(h.ws, h.family), whole, { ...market(h), acrossBooks: true });
    expect(await filing(h, split)).toEqual({ one: [], split: [h.family, h.business] });

    const back = await replaceTransaction(h.database, inBook(h.ws, h.business), split, market(h, [{ categoryAccountId: h.office, amountMinor: 1_350_000 }]));
    expect(await filing(h, back)).toEqual({ one: [[h.business]], split: [] });
    expect(await listed(h, h.family)).toEqual([]);
    expect(await spent(h, h.business)).toBe(1_350_000);
  });

  it('refuses an edit that leaves none of its parts where they were', async () => {
    const h = await threeBooks();
    const id = await postTransaction(h.database, inBook(h.ws, h.family), { ...market(h), acrossBooks: true });
    await expect(
      replaceTransaction(h.database, inBook(h.ws, h.family), id, market(h, [{ categoryAccountId: h.personalGroceries, amountMinor: 1_350_000 }])),
    ).rejects.toMatchObject({ code: 'OTHER_BOOK' });
    expect(await listed(h, h.family)).toEqual([id]);
  });

  it('refuses moving a split to one workspace: its parts stay where they are', async () => {
    const h = await threeBooks();
    const id = await postTransaction(h.database, inBook(h.ws, h.family), { ...market(h), acrossBooks: true });
    await expect(
      replaceTransaction(h.database, inBook(h.ws, h.family), id, { ...market(h, [{ categoryAccountId: h.personalGroceries, amountMinor: 1_350_000 }]), moveToBook: true }),
    ).rejects.toMatchObject({ code: 'SPLIT_MOVE' });
    // Nor can a move make one: a move re-files the whole purchase in one workspace.
    const whole = await postTransaction(h.database, inBook(h.ws, h.personal), market(h, [{ categoryAccountId: h.personalGroceries, amountMinor: 1_350_000 }]));
    await expect(replaceTransaction(h.database, inBook(h.ws, h.personal), whole, { ...market(h), acrossBooks: true, moveToBook: true })).rejects.toMatchObject({
      code: 'SPLIT_MOVE',
    });
    expect(await listed(h, h.family)).toEqual([id]);
  });

  it('deletes every part together', async () => {
    const h = await threeBooks();
    const id = await postTransaction(h.database, inBook(h.ws, h.family), { ...market(h), acrossBooks: true });
    await voidTransaction(h.database, inBook(h.ws, h.business), id);
    expect(await listed(h, h.family)).toEqual([]);
    expect(await listed(h, h.business)).toEqual([]);
    expect(await spent(h, h.family)).toBe(0);
    expect(await spent(h, h.business)).toBe(0);
    expect((await nativeBalances(h.database, h.ws))[h.card] ?? 0).toBe(0);
    expect((await cardStatementLines(h.database, h.ws, h.card)).filter((line) => line.transactionId === id)).toEqual([]);
  });

  it('keeps a split within one workspace filed there, as before', async () => {
    const h = await threeBooks();
    const id = await postTransaction(
      h.database,
      inBook(h.ws, h.family),
      { ...market(h, [{ categoryAccountId: h.groceries, amountMinor: 900_000 }, { categoryAccountId: h.familyDining, amountMinor: 450_000 }]), acrossBooks: true },
    );
    expect(await filing(h, id)).toEqual({ one: [[h.family]], split: [] });
    const [view] = await listTransactions(h.database, inBook(h.ws, h.family), { id });
    expect(view!.splitBooks).toBeUndefined();
    expect((await cardStatementLines(h.database, h.ws, h.card))[0]!.splitCategories).toBeUndefined();
  });

  it('lets a workspace holding a split be shared, unless the split’s other part is in a shared workspace already', async () => {
    const h = await threeBooks();
    const id = await postTransaction(h.database, inBook(h.ws, h.family), { ...market(h), acrossBooks: true });
    const shareable = (bookId: string) => h.database.transaction((tx) => assertShareableTx(tx, bookId));
    // Either side may be shared: the split travels in it as its part there.
    await expect(shareable(h.family)).resolves.toBeUndefined();
    await expect(shareable(h.business)).resolves.toBeUndefined();
    await h.database.db.run(
      sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${h.family}, 'relay-1', 1, 'member-1', 'active', '2026-05-01T00:00:00Z')`,
    );
    // With Family shared, Business may not be too while the split holds parts in both.
    await expect(shareable(h.business)).rejects.toMatchObject({ code: 'HAS_SPLITS' });
    await h.database.db.run(sql`DELETE FROM shared_books WHERE book_id = ${h.family}`);
    await voidTransaction(h.database, inBook(h.ws, h.family), id);
    await h.database.db.run(
      sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${h.family}, 'relay-1', 1, 'member-1', 'active', '2026-05-01T00:00:00Z')`,
    );
    await expect(shareable(h.business)).resolves.toBeUndefined();
  });
});

describe('a split with a part in the first workspace', () => {
  // The capture run (`npm run test:capture`) shares each first workspace and checks every write to it against what goes
  // out: here a split's part there, edited, folded away and back, made whole and split again, then deleted.
  it('is edited, folded, split again and deleted like any other', async () => {
    const h = await threeBooks();
    const parts = (own: number, office: number) =>
      market(h, [
        { categoryAccountId: h.personalGroceries, amountMinor: own },
        { categoryAccountId: h.office, amountMinor: office },
      ]);
    const id = await postTransaction(h.database, inBook(h.ws, h.personal), { ...parts(700_000, 650_000), acrossBooks: true });
    const edited = await replaceTransaction(h.database, inBook(h.ws, h.business), id, parts(800_000, 550_000));
    expect(await spent(h, h.personal)).toBe(800_000);
    const folded = await replaceTransaction(h.database, inBook(h.ws, h.business), edited, market(h, [{ categoryAccountId: h.office, amountMinor: 1_350_000 }]));
    expect(await spent(h, h.personal)).toBe(0);
    const again = await replaceTransaction(h.database, inBook(h.ws, h.business), folded, { ...parts(600_000, 750_000), acrossBooks: true });
    const whole = await replaceTransaction(h.database, inBook(h.ws, h.personal), again, market(h, [{ categoryAccountId: h.personalGroceries, amountMinor: 1_350_000 }]));
    expect(await filing(h, whole)).toEqual({ one: [[h.personal]], split: [] });
    const split = await replaceTransaction(h.database, inBook(h.ws, h.personal), whole, { ...parts(500_000, 850_000), acrossBooks: true });
    expect(await spent(h, h.personal)).toBe(500_000);
    expect(await spent(h, h.business)).toBe(850_000);
    await voidTransaction(h.database, inBook(h.ws, h.personal), split);
    expect(await spent(h, h.personal)).toBe(0);
    expect((await nativeBalances(h.database, h.ws))[h.card] ?? 0).toBe(0);
  });
});
