import { describe, expect, it } from 'vitest';
import {
  bookMoneyFor,
  categoryTotalsBetween,
  categoryTotalsIn,
  createAccount,
  createBook,
  inBook,
  listTransactions,
  ownerScope,
  postTransaction,
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
});
