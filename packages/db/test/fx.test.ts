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
