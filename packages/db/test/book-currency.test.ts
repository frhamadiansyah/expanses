import { isoDate } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  bookMoneyFor,
  budgetSheetFor,
  categoryTotalsBetween,
  categoryTotalsIn,
  createAccount,
  createBook,
  getBudgetIncome,
  inBook,
  listBooks,
  listBudgets,
  listTransactions,
  ownerScope,
  postTransaction,
  saveBudget,
  saveExpectedIncome,
  setBookBaseCurrency,
  upsertRate,
} from '../src/index';
import { setupDb } from './helpers';

describe('the money a workspace reads in', () => {
  it('does nothing at all when the workspace reads in the owner’s currency', async () => {
    const { database, ws } = await setupDb();
    const money = await bookMoneyFor(database, ws);
    expect(money).toMatchObject({ converts: false, currency: 'IDR' });
    expect(money.convert(85_000, 'IDR', '2026-09-10')).toBe(85_000);
  });

  it('converts each amount at the rate on its own date, and says what it could not convert', async () => {
    const { database, ws } = await setupDb();
    const sgd = await createBook(database, ws, { name: 'Singapore', kind: 'business', baseCurrency: 'SGD' });
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: '2026-08-01', rate: 0.0000845, source: 'manual', sourceDate: '2026-08-01' });
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: '2026-09-01', rate: 0.000083, source: 'manual', sourceDate: '2026-09-01' });
    const money = await bookMoneyFor(database, inBook(ws, sgd));

    expect(money).toMatchObject({ converts: true, currency: 'SGD' });
    // IDR has no minor units and SGD has two, so 12.000.000 rupiah at 0,000083 is S$996.00.
    expect(money.convert(12_000_000, 'IDR', '2026-09-10')).toBe(99_600);
    // A date before any rate is not guessed at: it is left out and named.
    expect(money.convert(12_000_000, 'IDR', '2026-07-01')).toBeNull();
    // An amount already in the workspace's own currency is simply itself.
    expect(money.convert(6_000, 'SGD', '2026-07-01')).toBe(6_000);
    expect(money.missing()).toEqual([{ currency: 'IDR', onDate: '2026-07-01' }]);
  });

  it('reads a rate backwards when only the other direction is on file', async () => {
    const { database, ws } = await setupDb();
    const sgd = await createBook(database, ws, { name: 'Singapore', kind: 'business', baseCurrency: 'SGD' });
    // What the user's own data holds: foreign→rupiah rows, entered whenever a purchase in another money was
    // posted. Without reading them backwards a workspace in dollars would drop nearly every amount it has.
    await upsertRate(database, { fromCurrency: 'SGD', toCurrency: 'IDR', onDate: '2026-08-01', rate: 11_500, source: 'manual', sourceDate: '2026-08-01' });
    await upsertRate(database, { fromCurrency: 'SGD', toCurrency: 'IDR', onDate: '2026-09-01', rate: 12_000, source: 'manual', sourceDate: '2026-09-01' });
    const money = await bookMoneyFor(database, inBook(ws, sgd));

    // 12.000.000 rupiah at 12.000 rupiah to the dollar is S$1.000,00.
    expect(money.convert(12_000_000, 'IDR', '2026-09-10')).toBe(100_000);
    // The same "exact day, else the latest earlier" rule, on the inverted pair: August's row speaks for August.
    // 1.000 rupiah at 11.500 is S$0,0869… — rounded half away from zero to nine cents.
    expect(money.convert(1_000, 'IDR', '2026-08-15')).toBe(9);
    // Before every rate, either way round, is still nothing.
    expect(money.convert(12_000_000, 'IDR', '2026-07-01')).toBeNull();
    expect(money.missing()).toEqual([{ currency: 'IDR', onDate: '2026-07-01' }]);
  });

  it('prefers the rate stored the way it is asked for over the inverse of the other', async () => {
    const { database, ws } = await setupDb();
    const sgd = await createBook(database, ws, { name: 'Singapore', kind: 'business', baseCurrency: 'SGD' });
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: '2026-09-01', rate: 0.000083, source: 'manual', sourceDate: '2026-09-01' });
    await upsertRate(database, { fromCurrency: 'SGD', toCurrency: 'IDR', onDate: '2026-09-01', rate: 12_000, source: 'manual', sourceDate: '2026-09-01' });
    const money = await bookMoneyFor(database, inBook(ws, sgd));

    // 0,000083 gives S$996,00; the inverse of 12.000 would have given S$1.000,00.
    expect(money.convert(12_000_000, 'IDR', '2026-09-10')).toBe(99_600);
  });

  it('reads a workspace’s chart, list, budget and bills in its own currency, and leaves out what it cannot convert', async () => {
    const { database, ws } = await setupDb();
    const sgd = await createBook(database, ws, { name: 'Singapore', kind: 'business', baseCurrency: 'SGD' });
    const book = inBook(ws, sgd);
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: '2026-09-01', rate: 0.000083, source: 'manual', sourceDate: '2026-09-01' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const meals = await createAccount(database, book, { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });
    const spend = (occurredOn: string, amountMinor: number) =>
      postTransaction(database, book, {
        occurredOn,
        description: 'Dinner',
        lines: [
          { accountId: meals.id, amountMinor, currency: 'IDR' },
          { accountId: card.id, amountMinor: -amountMinor, currency: 'IDR' },
        ],
      });
    await spend('2026-09-10', 12_000_000);
    await spend('2026-08-10', 6_000_000); // before any rate

    const totals = await categoryTotalsIn(database, book, 'expense', '2026-08-01', '2026-09-30');
    expect(totals.currency).toBe('SGD');
    expect(totals.rows).toEqual([{ accountId: meals.id, amountBaseMinor: 99_600, transactions: 1 }]);
    expect(totals.missing).toEqual([{ currency: 'IDR', onDate: '2026-08-10' }]);

    // The owner's own figures are untouched: the same two purchases in rupiah.
    const owner = await categoryTotalsBetween(database, ownerScope(ws), 'expense', '2026-08-01', '2026-09-30');
    expect(owner.find((row) => row.accountId === meals.id)?.amountBaseMinor).toBe(18_000_000);

    // The day's total on the list reads in the workspace's currency too.
    const [newest] = await listTransactions(database, book, { from: '2026-09-01', to: '2026-09-30' });
    expect(newest!.entries.find((entry) => entry.accountId === meals.id)?.amountBaseMinor).toBe(99_600);
    // And the purchase itself still says what was paid.
    expect(newest!.entries.find((entry) => entry.accountId === meals.id)?.amountMinor).toBe(12_000_000);
  });

  it('carries a workspace’s caps and expected income across when its currency changes, and refuses without a rate', async () => {
    const { database, ws } = await setupDb();
    const biz = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const book = inBook(ws, biz);
    const software = await createAccount(database, book, { name: 'Software', kind: 'expense', subtype: 'category', currency: null });
    await saveBudget(database, book, { categoryAccountId: software.id, amountMinor: 12_000_000 });
    await saveExpectedIncome(database, book, 240_000_000);

    await expect(setBookBaseCurrency(database, ws, biz, 'SGD')).rejects.toMatchObject({ code: 'NO_RATE' });

    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: isoDate(), rate: 0.000083, source: 'manual', sourceDate: isoDate() });
    expect(await setBookBaseCurrency(database, ws, biz, 'SGD')).toMatchObject({ rate: 0.000083 });

    expect((await listBooks(database, ws)).find((b) => b.id === biz)).toMatchObject({ baseCurrency: 'SGD' });
    expect((await listBudgets(database, book, '2026-09')).find((row) => row.categoryAccountId === software.id)?.amountMinor).toBe(99_600);
    expect((await getBudgetIncome(database, book, '2026-09')).amountMinor).toBe(1_992_000);
    // Personal is untouched: one workspace's currency is nobody else's business.
    expect((await listBooks(database, ws)).find((b) => b.kind === 'personal')).toMatchObject({ baseCurrency: 'IDR' });
  });

  it('reads a workspace’s caps in its own currency and compares them against actuals converted into it', async () => {
    const { database, ws } = await setupDb();
    const sgd = await createBook(database, ws, { name: 'Singapore', kind: 'business', baseCurrency: 'SGD' });
    const book = inBook(ws, sgd);
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: '2026-09-01', rate: 0.000083, source: 'manual', sourceDate: '2026-09-01' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const meals = await createAccount(database, book, { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });
    // The cap is S$1.000 a month, typed in the money this workspace reads in — not the owner's rupiah.
    await saveBudget(database, book, { categoryAccountId: meals.id, amountMinor: 100_000 });
    await postTransaction(database, book, {
      occurredOn: '2026-09-10',
      description: 'Dinner',
      lines: [
        { accountId: meals.id, amountMinor: 12_000_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -12_000_000, currency: 'IDR' },
      ],
    });

    const sheet = await budgetSheetFor(database, book, '2026-09');
    expect(sheet.currency).toBe('SGD');
    // Plan and actual are both in SGD, so S$996 spent against a S$1.000 cap is under it — in rupiah it would
    // have read as twelve million against a cap of a thousand, and every line would have been over.
    expect(sheet.capsTotalMinor).toBe(100_000);
    expect(sheet.spendingActualMinor).toBe(99_600);
    expect(sheet.lines.find((line) => line.name === 'Client meals')).toMatchObject({ capMinor: 100_000, totalMinor: 99_600, overMinor: 0 });
    expect(sheet.overCount).toBe(0);
  });
});
