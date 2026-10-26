import { splitExpenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  budgetSheetFor,
  cardStatementLines,
  categoryIdsByKey,
  categoryTotalsIn,
  createAccount,
  createBook,
  createCardAccount,
  eventSpendingBetween,
  inBook,
  listTransactions,
  nativeBalances,
  ownerScope,
  periodFlows,
  personalBook,
  postTransaction,
  replaceTransaction,
  saveCardTerms,
  saveEvent,
} from '../src/index';
import { MIGRATIONS } from '../src/migrations';
import { setupDb, type TestDb } from './helpers';

/*
 * Each line of a split on its own (0096), in invented figures: Rp 4.500.000 on a credit card at Toko Sinar Jaya, Rp
 * 4.000.000 office supplies for Business, and for Family Rp 300.000 groceries and Rp 200.000 restaurants. Two lines of
 * the same workspace are two switches: excluding Groceries leaves Restaurants counted. The card keeps the whole charge.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const BUSINESS_PART = 4_000_000;
const WHOLE = 4_500_000;

async function books() {
  current = await setupDb();
  const { database, ws } = current;
  const personal = (await personalBook(database, ws)).id;
  const family = await createBook(database, ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const card = await createCardAccount(database, ws, { name: 'Visa', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-01-01' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 10, dueDay: 25, creditLimitMinor: null, annualFeeMinor: null });
  const groceries = (await categoryIdsByKey(database, inBook(ws, family)))['household.groceries']!;
  const dining = (await categoryIdsByKey(database, inBook(ws, family)))['food_beverage.restaurants']!;
  const office = (await createAccount(database, inBook(ws, business), { name: 'Office supplies', kind: 'expense', subtype: 'category', currency: null })).id;
  return { database, ws, personal, family, business, card: card.id, groceries, dining, office };
}

type Books = Awaited<ReturnType<typeof books>>;

const lines = (h: Books) => [
  { categoryAccountId: h.office, amountMinor: BUSINESS_PART },
  { categoryAccountId: h.groceries, amountMinor: 300_000 },
  { categoryAccountId: h.dining, amountMinor: 200_000 },
];

const purchase = (h: Books, parts: { categoryAccountId: string; amountMinor: number }[] = lines(h)) => ({
  occurredOn: '2026-05-20',
  description: 'Toko Sinar Jaya',
  lines: splitExpenseLines({ paymentAccountId: h.card, currency: 'IDR', splits: parts }),
  acrossBooks: true,
});

const spent = async (h: Books, bookId: string) =>
  (await categoryTotalsIn(h.database, inBook(h.ws, bookId), 'expense', '2026-05-01', '2026-05-31')).rows.reduce((sum, row) => sum + row.amountBaseMinor, 0);
const budgeted = async (h: Books, bookId: string) => (await budgetSheetFor(h.database, inBook(h.ws, bookId), '2026-05')).spendingActualMinor;
const health = async (h: Books, bookId?: string) =>
  (await periodFlows(h.database, bookId ? inBook(h.ws, bookId) : ownerScope(h.ws), { from: '2026-05-01', to: '2026-05-31' })).spendingMinor;
const owed = async (h: Books) => -((await nativeBalances(h.database, h.ws))[h.card] ?? 0) || 0;
const partFlags = async (h: Books, id: string) =>
  (await h.database.db.values<[string, number]>(sql`SELECT book_id, excluded FROM book_transaction_splits WHERE transaction_id = ${id}`))
    .map(([book, excluded]) => [book, Number(excluded)] as const)
    .sort((x, y) => Number(y[0] === h.business) - Number(x[0] === h.business));
const wholeFlag = async (h: Books, id: string) =>
  Number((await h.database.db.values<[number]>(sql`SELECT excluded FROM transaction_flags WHERE transaction_id = ${id}`))[0]?.[0] ?? 0);
/** The categories of the lines left out on their own, by the lines' rows. */
const lineRows = async (h: Books, id: string) =>
  (await h.database.db.values<[string]>(sql`SELECT account_id FROM transaction_line_excluded WHERE transaction_id = ${id}`)).map(([account]) => account).sort();
/** Each category line of the purchase as a list reads it: whether it is left out. */
const outOf = async (h: Books, id: string) => {
  const [view] = await listTransactions(h.database, inBook(h.ws, h.family), { id });
  return Object.fromEntries(view!.entries.filter((e) => e.accountKind === 'expense').map((e) => [e.accountId, e.excluded === true]));
};

describe('each line on its own (0096)', () => {
  it('is migration 0096', () => {
    expect(MIGRATIONS.find((m) => m.version === 96)).toMatchObject({ name: 'split_line_excluded' });
  });

  it('two lines of one workspace: excluding Groceries leaves Restaurants counted, in every report', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), { ...purchase(h), excludedParts: [h.groceries] });

    expect(await spent(h, h.family)).toBe(200_000);
    expect(await budgeted(h, h.family)).toBe(200_000);
    expect(await health(h, h.family)).toBe(200_000);
    expect(await spent(h, h.business)).toBe(BUSINESS_PART);
    expect(await health(h)).toBe(BUSINESS_PART + 200_000);
    expect((await categoryTotalsIn(h.database, ownerScope(h.ws), 'expense', '2026-05-01', '2026-05-31')).rows.reduce((s, r) => s + r.amountBaseMinor, 0)).toBe(
      BUSINESS_PART + 200_000,
    );

    // Only that line is said: neither a part flag nor the purchase's own flag. The card keeps the whole charge.
    expect(await lineRows(h, id)).toEqual([h.groceries]);
    expect(await partFlags(h, id)).toEqual([
      [h.business, 0],
      [h.family, 0],
    ]);
    expect(await wholeFlag(h, id)).toBe(0);
    expect(await owed(h)).toBe(WHOLE);
    const statement = (await cardStatementLines(h.database, h.ws, h.card)).filter((line) => line.transactionId === id);
    expect(statement[0]).toMatchObject({ owedMinor: WHOLE, countedMinor: WHOLE });

    expect(await outOf(h, id)).toMatchObject({ [h.groceries]: true, [h.dining]: false });
    const [view] = await listTransactions(h.database, inBook(h.ws, h.family), { id });
    expect(view!.excluded).toBe(false);
    expect(view!.splitBooks?.map((book) => [book.name, book.excluded])).toEqual([
      ['Family', false],
      ['Business', false],
    ]);
  });

  it('the other line instead, then both, then one switched back on: each changes only what it names', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), { ...purchase(h), excludedParts: [h.dining] });
    expect(await spent(h, h.family)).toBe(300_000);
    const both = await replaceTransaction(h.database, inBook(h.ws, h.business), id, { ...purchase(h), excludedParts: [h.groceries, h.dining] });
    // Both lines out is the Family part excluded, written as 0090 wrote it, with no line rows.
    expect(await spent(h, h.family)).toBe(0);
    expect(await partFlags(h, both)).toEqual([
      [h.business, 0],
      [h.family, 1],
    ]);
    expect(await lineRows(h, both)).toEqual([]);
    expect(await outOf(h, both)).toMatchObject({ [h.groceries]: true, [h.dining]: true, [h.office]: false });
    const [view] = await listTransactions(h.database, inBook(h.ws, h.family), { id: both });
    expect(view!.splitBooks?.map((book) => [book.name, book.excluded])).toEqual([
      ['Family', true],
      ['Business', false],
    ]);
    const back = await replaceTransaction(h.database, inBook(h.ws, h.business), both, { ...purchase(h), excludedParts: [h.dining] });
    expect(await spent(h, h.family)).toBe(300_000);
    expect(await partFlags(h, back)).toEqual([
      [h.business, 0],
      [h.family, 0],
    ]);
    expect(await lineRows(h, back)).toEqual([h.dining]);
  });

  it('an event’s spending leaves out the excluded line only', async () => {
    const h = await books();
    const eventId = await saveEvent(h.database, h.ws, { name: 'Pameran Mei', startsOn: '2026-05-18', endsOn: '2026-05-22' });
    await postTransaction(h.database, inBook(h.ws, h.business), { ...purchase(h), eventId, excludedParts: [h.groceries] });
    expect((await eventSpendingBetween(h.database, inBook(h.ws, h.family), '2026-05-01', '2026-05-31')).amountMinor).toBe(200_000);
    expect((await eventSpendingBetween(h.database, ownerScope(h.ws), '2026-05-01', '2026-05-31')).amountMinor).toBe(BUSINESS_PART + 200_000);
  });

  it('a line in another workspace is excluded on its own', async () => {
    const h = await books();
    await postTransaction(h.database, inBook(h.ws, h.business), { ...purchase(h), excludedParts: [h.office] });
    expect(await spent(h, h.business)).toBe(0);
    expect(await spent(h, h.family)).toBe(500_000);
  });

  it('the whole purchase excluded excludes every line, and one added while it is excluded is excluded', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), { ...purchase(h), excludedFromReport: true });
    expect(await spent(h, h.family)).toBe(0);
    expect(await spent(h, h.business)).toBe(0);
    expect(await outOf(h, id)).toMatchObject({ [h.groceries]: true, [h.dining]: true });
    expect(await owed(h)).toBe(WHOLE);
    // The form names every line it holds excluded, a new one included.
    const added = await replaceTransaction(h.database, inBook(h.ws, h.business), id, {
      ...purchase(h, [...lines(h), { categoryAccountId: h.office, amountMinor: 1_000 }]),
      excludedFromReport: false,
      excludedParts: [h.office, h.groceries, h.dining],
    });
    expect(await spent(h, h.business)).toBe(0);
    expect(await spent(h, h.family)).toBe(0);
    expect(await owed(h)).toBe(WHOLE + 1_000);
    expect(await partFlags(h, added)).toEqual([
      [h.business, 1],
      [h.family, 1],
    ]);
  });

  it('an edit that does not say keeps each line as it was', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), { ...purchase(h), excludedParts: [h.groceries] });
    const renamed = await replaceTransaction(h.database, inBook(h.ws, h.business), id, { ...purchase(h), description: 'Toko Sinar Jaya Abadi' });
    expect(await lineRows(h, renamed)).toEqual([h.groceries]);
    expect(await spent(h, h.family)).toBe(200_000);
    const cleared = await replaceTransaction(h.database, inBook(h.ws, h.business), renamed, { ...purchase(h), excludedParts: [] });
    expect(await lineRows(h, cleared)).toEqual([]);
    expect(await spent(h, h.family)).toBe(500_000);
  });

  it('a purchase saved under 0090 with a part excluded reads as every line of that workspace excluded', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), purchase(h));
    // The old shape: the Family part flagged on its workspace's row.
    await h.database.db.run(sql`UPDATE book_transaction_splits SET excluded = 1 WHERE transaction_id = ${id} AND book_id = ${h.family}`);
    expect(await spent(h, h.family)).toBe(0);
    expect(await spent(h, h.business)).toBe(BUSINESS_PART);
    expect(await health(h, h.family)).toBe(0);
    expect(await budgeted(h, h.family)).toBe(0);
    expect(await outOf(h, id)).toMatchObject({ [h.groceries]: true, [h.dining]: true, [h.office]: false });
    // Edited without naming lines, the part stays excluded.
    const kept = await replaceTransaction(h.database, inBook(h.ws, h.business), id, { ...purchase(h), description: 'Toko Sinar Jaya Abadi' });
    expect(await partFlags(h, kept)).toEqual([
      [h.business, 0],
      [h.family, 1],
    ]);
    expect(await spent(h, h.family)).toBe(0);
  });

  it('a database stopped before 0096 has no table and reads every line counted, but for a part flagged whole', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), purchase(h));
    await h.database.db.run(sql`DROP TABLE transaction_line_excluded`);
    await h.database.db.run(sql`UPDATE book_transaction_splits SET excluded = 1 WHERE transaction_id = ${id} AND book_id = ${h.family}`);
    // A fresh handle: nothing remembers the table was there.
    expect(await spent(h, h.family)).toBe(0);
    expect(await spent(h, h.business)).toBe(BUSINESS_PART);
  });

  it('the legacy part flag is overwritten by an edit that names lines', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), purchase(h));
    await h.database.db.run(sql`UPDATE book_transaction_splits SET excluded = 1 WHERE transaction_id = ${id} AND book_id = ${h.family}`);
    const edited = await replaceTransaction(h.database, inBook(h.ws, h.business), id, { ...purchase(h), excludedParts: [h.office] });
    expect(await spent(h, h.family)).toBe(500_000);
    expect(await spent(h, h.business)).toBe(0);
    expect(await partFlags(h, edited)).toEqual([
      [h.business, 1],
      [h.family, 0],
    ]);
  });

  it('a purchase in one workspace: one line out is a row, not the purchase’s flag; the card is whole', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.family), {
      ...purchase(h, [
        { categoryAccountId: h.groceries, amountMinor: 300_000 },
        { categoryAccountId: h.dining, amountMinor: 200_000 },
      ]),
      excludedParts: [h.groceries],
    });
    expect(await wholeFlag(h, id)).toBe(0);
    expect(await lineRows(h, id)).toEqual([h.groceries]);
    expect(await spent(h, h.family)).toBe(200_000);
    expect(await budgeted(h, h.family)).toBe(200_000);
    expect(await health(h, h.family)).toBe(200_000);
    expect(await owed(h)).toBe(500_000);
    const [view] = await listTransactions(h.database, inBook(h.ws, h.family), { id });
    expect(view!.excluded).toBe(false);
    expect(view!.entries.find((e) => e.accountId === h.groceries)?.excluded).toBe(true);
    expect(view!.entries.find((e) => e.accountId === h.dining)?.excluded).toBeUndefined();
  });

  it('moving a purchase to another workspace keeps each line’s switch', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.family), {
      ...purchase(h, [
        { categoryAccountId: h.groceries, amountMinor: 300_000 },
        { categoryAccountId: h.dining, amountMinor: 200_000 },
      ]),
      excludedParts: [h.groceries],
    });
    const there = await categoryIdsByKey(h.database, inBook(h.ws, h.business));
    const bGroceries = there['household.groceries']!;
    const bDining = there['food_beverage.restaurants']!;
    const moved = await replaceTransaction(h.database, inBook(h.ws, h.family), id, {
      ...purchase(h, [
        { categoryAccountId: bGroceries, amountMinor: 300_000 },
        { categoryAccountId: bDining, amountMinor: 200_000 },
      ]),
      acrossBooks: false,
      moveToBook: true,
      excludedParts: [bGroceries],
    });
    expect(await lineRows(h, moved)).toEqual([bGroceries]);
    expect(await spent(h, h.business)).toBe(200_000);
    expect(await spent(h, h.family)).toBe(0);
  });
});
