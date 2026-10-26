import { splitExpenseLines } from '@expanses/core';
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
  eventSpendingBetween,
  inBook,
  listTransactions,
  nativeBalances,
  NOT_COUNTED_LINE,
  ownerScope,
  periodFlows,
  personalBook,
  postTransaction,
  replaceTransaction,
  saveCardTerms,
  saveEvent,
  voidTransaction,
} from '../src/index';
import { MIGRATIONS } from '../src/migrations';
import { assertShareableTx } from '../src/sync/seed';
import { setupDb, type TestDb } from './helpers';

/*
 * A part of a split purchase left out of reports (0090), the owner's example in invented figures: Rp 4.500.000 on a
 * credit card at Toko Sinar Jaya, Rp 4.000.000 of it office supplies for Business and Rp 500.000 groceries for Family.
 *
 * A. A part in a workspace may be excluded from that workspace's reports on its own; the other parts count.
 * B. A part may be Not counted — in no workspace at all — and is in no report anywhere.
 *
 * Either way the card keeps the whole charge: its balance, its statement and its points see Rp 4.500.000.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const WHOLE = 4_500_000;
const BUSINESS_PART = 4_000_000;
const FAMILY_PART = 500_000;

async function books() {
  current = await setupDb();
  const { database, ws } = current;
  const personal = (await personalBook(database, ws)).id;
  const family = await createBook(database, ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const card = await createCardAccount(database, ws, { name: 'Visa', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-01-01' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 10, dueDay: 25, creditLimitMinor: null, annualFeeMinor: null });
  const groceries = (await categoryIdsByKey(database, inBook(ws, family)))['household.groceries']!;
  const familyDining = (await categoryIdsByKey(database, inBook(ws, family)))['food_beverage.restaurants']!;
  const office = (await createAccount(database, inBook(ws, business), { name: 'Office supplies', kind: 'expense', subtype: 'category', currency: null })).id;
  return { database, ws, personal, family, business, card: card.id, groceries, familyDining, office };
}

type Books = Awaited<ReturnType<typeof books>>;

const purchase = (h: Books, parts: { categoryAccountId: string; amountMinor: number }[] = [
  { categoryAccountId: h.office, amountMinor: BUSINESS_PART },
  { categoryAccountId: h.groceries, amountMinor: FAMILY_PART },
], occurredOn = '2026-05-20') => ({
  occurredOn,
  description: 'Toko Sinar Jaya',
  lines: splitExpenseLines({ paymentAccountId: h.card, currency: 'IDR', splits: parts }),
  acrossBooks: true,
});

/** What a workspace's Cashflow, category totals and budget count for May. */
const spent = async (h: Books, bookId: string) =>
  (await categoryTotalsIn(h.database, inBook(h.ws, bookId), 'expense', '2026-05-01', '2026-05-31')).rows.reduce((sum, row) => sum + row.amountBaseMinor, 0);
const budgeted = async (h: Books, bookId: string) => (await budgetSheetFor(h.database, inBook(h.ws, bookId), '2026-05')).spendingActualMinor;
const health = async (h: Books, bookId?: string) =>
  (await periodFlows(h.database, bookId ? inBook(h.ws, bookId) : ownerScope(h.ws), { from: '2026-05-01', to: '2026-05-31' })).spendingMinor;
const owed = async (h: Books) => -((await nativeBalances(h.database, h.ws))[h.card] ?? 0) || 0;
const earning = async (h: Books, id: string) =>
  (await cardSpendLines(h.database, h.ws, h.card, '2026-05-11', '2026-06-10')).filter((line) => line.transactionId === id).reduce((sum, line) => sum + line.amountMinor, 0);
/** Each part's workspace and its flag, Business first: the order a part was written in says nothing. */
const partFlags = async (h: Books, id: string) =>
  (await h.database.db.values<[string, number]>(sql`SELECT book_id, excluded FROM book_transaction_splits WHERE transaction_id = ${id}`))
    .map(([book, excluded]) => [book, Number(excluded)] as const)
    .sort((x, y) => Number(y[0] === h.business) - Number(x[0] === h.business));
const wholeFlag = async (h: Books, id: string) =>
  Number((await h.database.db.values<[number]>(sql`SELECT excluded FROM transaction_flags WHERE transaction_id = ${id}`))[0]?.[0] ?? 0);

describe('A. a part excluded from its workspace’s reports', () => {
  it('is migration 0090', () => {
    expect(MIGRATIONS.find((m) => m.version === 90)).toMatchObject({ name: 'split_part_excluded' });
    // 89 is the Electronic money subtype's.
    expect(MIGRATIONS.find((m) => m.version === 89)).toMatchObject({ name: 'electronic_money' });
  });

  it('counts every part when none is excluded', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), purchase(h));
    expect(await owed(h)).toBe(WHOLE);
    expect(await spent(h, h.business)).toBe(BUSINESS_PART);
    expect(await spent(h, h.family)).toBe(FAMILY_PART);
    expect(await partFlags(h, id)).toEqual([
      [h.business, 0],
      [h.family, 0],
    ]);
  });

  it('leaves Business’s part out of Business’s reports, Family counting its own, the card the whole charge', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), { ...purchase(h), excludedParts: [h.office] });

    // The card side is the whole charge, untouched.
    expect(await owed(h)).toBe(WHOLE);
    const statement = (await cardStatementLines(h.database, h.ws, h.card)).filter((line) => line.transactionId === id);
    expect(statement).toHaveLength(1);
    expect(statement[0]).toMatchObject({ owedMinor: WHOLE, countedMinor: WHOLE });
    expect(await earning(h, id)).toBe(WHOLE);

    // Business counts nothing of it, anywhere it adds spending up; Family counts its part.
    expect(await spent(h, h.business)).toBe(0);
    expect(await spent(h, h.family)).toBe(FAMILY_PART);
    expect(await budgeted(h, h.business)).toBe(0);
    expect(await budgeted(h, h.family)).toBe(FAMILY_PART);
    expect(await health(h, h.business)).toBe(0);
    expect(await health(h, h.family)).toBe(FAMILY_PART);
    // Owner-wide, only the parts that count.
    expect(await health(h)).toBe(FAMILY_PART);
    expect((await categoryTotalsIn(h.database, ownerScope(h.ws), 'expense', '2026-05-01', '2026-05-31')).rows.reduce((s, r) => s + r.amountBaseMinor, 0)).toBe(FAMILY_PART);

    // Said on the part, never on the purchase as a whole.
    expect(await partFlags(h, id)).toEqual([
      [h.business, 1],
      [h.family, 0],
    ]);
    expect(await wholeFlag(h, id)).toBe(0);
    const [view] = await listTransactions(h.database, inBook(h.ws, h.family), { id });
    expect(view!.excluded).toBe(false);
    expect(view!.splitBooks?.map((book) => [book.name, book.excluded])).toEqual([
      ['Family', false],
      ['Business', true],
    ]);
  });

  it('is named by every line of the part: both Family categories out is the Family part excluded', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.family), {
      ...purchase(h, [
        { categoryAccountId: h.office, amountMinor: BUSINESS_PART },
        { categoryAccountId: h.groceries, amountMinor: 300_000 },
        { categoryAccountId: h.familyDining, amountMinor: 200_000 },
      ]),
      excludedParts: [h.groceries, h.familyDining],
    });
    expect(await partFlags(h, id)).toEqual([
      [h.business, 0],
      [h.family, 1],
    ]);
    expect(await spent(h, h.family)).toBe(0);
    expect(await spent(h, h.business)).toBe(BUSINESS_PART);
  });

  it('leaves budgets and an event’s spending without the excluded part', async () => {
    const h = await books();
    const eventId = await saveEvent(h.database, h.ws, { name: 'Pameran Mei', startsOn: '2026-05-18', endsOn: '2026-05-22' });
    await postTransaction(h.database, inBook(h.ws, h.business), { ...purchase(h), eventId, excludedParts: [h.office] });
    expect((await eventSpendingBetween(h.database, ownerScope(h.ws), '2026-05-01', '2026-05-31')).amountMinor).toBe(FAMILY_PART);
    expect((await eventSpendingBetween(h.database, inBook(h.ws, h.business), '2026-05-01', '2026-05-31')).amountMinor).toBe(0);
  });

  it('counts again once the part is switched back on, and an edit that does not say keeps it as it was', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), { ...purchase(h), excludedParts: [h.office] });
    // A new note, the parts unmentioned: still excluded.
    const renamed = await replaceTransaction(h.database, inBook(h.ws, h.business), id, { ...purchase(h), description: 'Toko Sinar Jaya Abadi' });
    expect(await partFlags(h, renamed)).toEqual([
      [h.business, 1],
      [h.family, 0],
    ]);
    expect(await spent(h, h.business)).toBe(0);

    // Switched back: Business counts its 4.000.000 again.
    const counted = await replaceTransaction(h.database, inBook(h.ws, h.business), renamed, { ...purchase(h), excludedParts: [] });
    expect(await partFlags(h, counted)).toEqual([
      [h.business, 0],
      [h.family, 0],
    ]);
    expect(await spent(h, h.business)).toBe(BUSINESS_PART);
    expect(await budgeted(h, h.business)).toBe(BUSINESS_PART);
    expect(await spent(h, h.family)).toBe(FAMILY_PART);
    expect(await owed(h)).toBe(WHOLE);
  });

  it('excluding the whole purchase excludes every part, and keeps the purchase’s own flag off', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), { ...purchase(h), excludedFromReport: true });
    expect(await partFlags(h, id)).toEqual([
      [h.business, 1],
      [h.family, 1],
    ]);
    expect(await wholeFlag(h, id)).toBe(0);
    expect(await spent(h, h.business)).toBe(0);
    expect(await spent(h, h.family)).toBe(0);
    expect(await owed(h)).toBe(WHOLE);
  });

  it('in one workspace, every line out is the whole purchase excluded', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.family), {
      ...purchase(h, [
        { categoryAccountId: h.groceries, amountMinor: 300_000 },
        { categoryAccountId: h.familyDining, amountMinor: 200_000 },
      ]),
      excludedParts: [h.groceries, h.familyDining],
    });
    expect(await partFlags(h, id)).toEqual([]);
    expect(await wholeFlag(h, id)).toBe(1);
    expect(await spent(h, h.family)).toBe(0);
  });

  it('deleting the purchase takes every part away, excluded or not', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), { ...purchase(h), excludedParts: [h.office] });
    await voidTransaction(h.database, inBook(h.ws, h.family), id);
    expect(await owed(h)).toBe(0);
    expect(await spent(h, h.business)).toBe(0);
    expect(await spent(h, h.family)).toBe(0);
    expect(await health(h)).toBe(0);
    expect((await cardStatementLines(h.database, h.ws, h.card)).filter((line) => line.transactionId === id)).toEqual([]);
  });
});

describe('B. a part Not counted, in no workspace', () => {
  /** Rp 4.000.000 office supplies for Business; the Rp 500.000 left is nobody's spending. */
  const notCounted = (h: Books) => ({
    ...purchase(h, [
      { categoryAccountId: h.office, amountMinor: BUSINESS_PART },
      { categoryAccountId: NOT_COUNTED_LINE, amountMinor: FAMILY_PART },
    ]),
  });

  it('is in no workspace’s report, while the card owes, states and earns on the whole charge', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), notCounted(h));

    expect(await owed(h)).toBe(WHOLE);
    const statement = (await cardStatementLines(h.database, h.ws, h.card)).filter((line) => line.transactionId === id);
    expect(statement[0]).toMatchObject({ owedMinor: WHOLE, countedMinor: WHOLE, splitCategories: ['Office supplies', 'Not counted'] });
    expect(await earning(h, id)).toBe(WHOLE);

    expect(await spent(h, h.business)).toBe(BUSINESS_PART);
    expect(await spent(h, h.family)).toBe(0);
    expect(await spent(h, h.personal)).toBe(0);
    expect(await budgeted(h, h.business)).toBe(BUSINESS_PART);
    expect(await health(h, h.business)).toBe(BUSINESS_PART);
    // Read owner-wide, it is still in nothing: no report reads the Not counted account.
    expect(await health(h)).toBe(BUSINESS_PART);
    expect((await categoryTotalsIn(h.database, ownerScope(h.ws), 'expense', '2026-05-01', '2026-05-31')).rows.reduce((s, r) => s + r.amountBaseMinor, 0)).toBe(BUSINESS_PART);

    // Filed in Business alone, its one workspace; listed there and nowhere else.
    expect(await h.database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${id}`)).toEqual([[h.business]]);
    expect((await listTransactions(h.database, inBook(h.ws, h.family), { from: '2026-05-01', to: '2026-05-31' })).map((tx) => tx.id)).toEqual([]);
    const [view] = await listTransactions(h.database, inBook(h.ws, h.business), { id });
    expect(view!.entries.find((e) => e.accountSystemKey === 'not_counted')).toMatchObject({ accountKind: 'equity', accountName: 'Not counted', amountMinor: FAMILY_PART });
  });

  it('beside parts in two workspaces, each counts its own and the Not counted part none', async () => {
    const h = await books();
    const id = await postTransaction(
      h.database,
      inBook(h.ws, h.family),
      purchase(h, [
        { categoryAccountId: h.office, amountMinor: 3_000_000 },
        { categoryAccountId: h.groceries, amountMinor: FAMILY_PART },
        { categoryAccountId: NOT_COUNTED_LINE, amountMinor: 1_000_000 },
      ]),
    );
    expect(await partFlags(h, id)).toEqual([
      [h.business, 0],
      [h.family, 0],
    ]);
    expect(await spent(h, h.business)).toBe(3_000_000);
    expect(await spent(h, h.family)).toBe(FAMILY_PART);
    expect(await health(h)).toBe(3_500_000);
    expect(await owed(h)).toBe(WHOLE);
  });

  it('can be made a counted part again, and is gone with the purchase', async () => {
    const h = await books();
    const id = await postTransaction(h.database, inBook(h.ws, h.business), notCounted(h));
    const counted = await replaceTransaction(h.database, inBook(h.ws, h.business), id, purchase(h));
    expect(await spent(h, h.family)).toBe(FAMILY_PART);
    expect(await spent(h, h.business)).toBe(BUSINESS_PART);
    const back = await replaceTransaction(h.database, inBook(h.ws, h.business), counted, notCounted(h));
    expect(await spent(h, h.family)).toBe(0);
    await voidTransaction(h.database, inBook(h.ws, h.business), back);
    expect(await owed(h)).toBe(0);
    expect(await spent(h, h.business)).toBe(0);
  });

  it('is refused alone, or with nothing in it', async () => {
    const h = await books();
    await expect(
      postTransaction(h.database, inBook(h.ws, h.business), purchase(h, [{ categoryAccountId: NOT_COUNTED_LINE, amountMinor: WHOLE }])),
    ).rejects.toMatchObject({ code: 'NOT_COUNTED', message: expect.stringContaining('at least one part in a workspace') });
    await expect(
      postTransaction(h.database, inBook(h.ws, h.business), {
        occurredOn: '2026-05-20',
        description: 'Toko Sinar Jaya',
        lines: [
          { accountId: h.office, amountMinor: WHOLE + FAMILY_PART, currency: 'IDR' },
          { accountId: NOT_COUNTED_LINE, amountMinor: -FAMILY_PART, currency: 'IDR' },
          { accountId: h.card, amountMinor: -WHOLE, currency: 'IDR' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'NOT_COUNTED' });
    expect(await owed(h)).toBe(0);
  });

  it('is refused in a purchase with a part in a shared workspace, and a workspace holding one is not shared', async () => {
    const h = await books();
    const share = (bookId: string) =>
      h.database.db.run(
        sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, 'relay-1', 1, 'member-1', 'active', '2026-05-01T00:00:00Z')`,
      );
    const id = await postTransaction(h.database, inBook(h.ws, h.business), notCounted(h));
    await expect(h.database.transaction((tx) => assertShareableTx(tx, h.business))).rejects.toMatchObject({ code: 'HAS_NOT_COUNTED' });
    // Family holds none: it may be shared, and then a Not counted part beside a Family part is refused.
    await expect(h.database.transaction((tx) => assertShareableTx(tx, h.family))).resolves.toBeUndefined();
    await share(h.family);
    await expect(
      postTransaction(
        h.database,
        inBook(h.ws, h.family),
        purchase(h, [
          { categoryAccountId: h.groceries, amountMinor: FAMILY_PART },
          { categoryAccountId: NOT_COUNTED_LINE, amountMinor: BUSINESS_PART },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'NOT_COUNTED_SHARED' });
    // Folded into a workspace, the purchase may be shared after all.
    await replaceTransaction(h.database, inBook(h.ws, h.business), id, purchase(h, [{ categoryAccountId: h.office, amountMinor: WHOLE }]));
    await expect(h.database.transaction((tx) => assertShareableTx(tx, h.business))).resolves.toBeUndefined();
  });
});
