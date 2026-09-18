import { describe, expect, it } from 'vitest';
import { bookMoneyFor, createBook, inBook, upsertRate } from '../src/index';
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
});
