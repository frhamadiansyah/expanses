import { describe, expect, it, vi } from 'vitest';
import { findRate, resolveRates, upsertRate } from '../src/index';
import { setupDb } from './helpers';

describe('fx rates', () => {
  it('keeps manual rates over fetched ones', async () => {
    const { database } = await setupDb();
    await upsertRate(database, { fromCurrency: 'THB', toCurrency: 'IDR', onDate: '2026-09-05', rate: 536.49, source: 'frankfurter', sourceDate: '2026-09-05' });
    await upsertRate(database, { fromCurrency: 'THB', toCurrency: 'IDR', onDate: '2026-09-05', rate: 540, source: 'manual', sourceDate: '2026-09-05' });
    await upsertRate(database, { fromCurrency: 'THB', toCurrency: 'IDR', onDate: '2026-09-05', rate: 530, source: 'frankfurter', sourceDate: '2026-09-05' });
    expect(await findRate(database, 'THB', 'IDR', '2026-09-05')).toEqual({ rate: 540, onDate: '2026-09-05', source: 'manual', stale: false });
    expect((await findRate(database, 'THB', 'IDR', '2026-09-09'))?.stale).toBe(true);
    expect(await findRate(database, 'THB', 'IDR', '2026-09-01')).toBeUndefined();
  });

  it('lets a corrected KMK rate replace the one already stored', async () => {
    const { database } = await setupDb();
    // A rate typed from the wrong week, then corrected. A tax figure must not be stuck at the mistake.
    await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: '2026-12-31', rate: 16_000, source: 'kmk', sourceDate: '2026-12-30', note: 'KMK 40/MK/EF.2/2026' });
    await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: '2026-12-31', rate: 17_714, source: 'kmk', sourceDate: '2026-12-30', note: 'KMK 42/MK/EF.2/2026' });

    expect((await findRate(database, 'USD', 'IDR', '2026-12-31'))?.rate).toBe(17_714);
  });

  it('still keeps a hand-entered rate safe from a fetched one', async () => {
    const { database } = await setupDb();
    await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: '2026-12-31', rate: 17_714, source: 'kmk', sourceDate: '2026-12-30' });
    await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: '2026-12-31', rate: 16_100, source: 'frankfurter', sourceDate: '2026-12-31' });

    expect((await findRate(database, 'USD', 'IDR', '2026-12-31'))?.rate).toBe(17_714);
  });

  it('resolves cached, fetched, stale, and missing rates', async () => {
    const { database } = await setupDb();
    await upsertRate(database, { fromCurrency: 'THB', toCurrency: 'IDR', onDate: '2026-09-05', rate: 536.49, source: 'frankfurter', sourceDate: '2026-09-05' });
    await upsertRate(database, { fromCurrency: 'SGD', toCurrency: 'IDR', onDate: '2026-08-01', rate: 12000, source: 'frankfurter', sourceDate: '2026-08-01' });
    const fetcher = vi.fn(async (from: string) => {
      if (from === 'USD') return { rate: 17509, sourceDate: '2026-09-05' };
      throw new Error('offline');
    });
    const result = await resolveRates(database, {
      currencies: ['IDR', 'THB', 'USD', 'SGD', 'JPY'],
      baseCurrency: 'IDR',
      onDate: '2026-09-05',
      today: '2026-09-11',
      fetcher,
    });
    expect(result).toEqual({ rates: { THB: 536.49, USD: 17509, SGD: 12000 }, stale: ['SGD'], missing: ['JPY'] });
    expect(fetcher).not.toHaveBeenCalledWith('THB', 'IDR', '2026-09-05');
    expect((await findRate(database, 'USD', 'IDR', '2026-09-05'))?.rate).toBe(17509);
  });

  it('clamps future dates to today', async () => {
    const { database } = await setupDb();
    const fetcher = vi.fn(async () => ({ rate: 2, sourceDate: '2026-09-11' }));
    await resolveRates(database, { currencies: ['USD'], baseCurrency: 'IDR', onDate: '2026-12-01', today: '2026-09-11', fetcher });
    expect(fetcher).toHaveBeenCalledWith('USD', 'IDR', '2026-09-11');
  });
});
