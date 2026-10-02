import { listPrices, setSecurityPriceChoice, upsertSecurityPrice } from '@expanses/db';
import { describe, expect, it, vi } from 'vitest';
import { refreshYahooCloses, type YahooGet } from './yahoo';
import { holdings, yahooChart } from './yahoo-fixtures';

const evening = new Date('2026-09-30T18:00:00+07:00');

describe('the daily Yahoo Finance close', () => {
  it('asks once per symbol, stores each close as the day’s price, and skips a security set to typing', async () => {
    const { database, ws, ids, securityOf } = await holdings();
    await setSecurityPriceChoice(database, ws, securityOf('TLKM'), 'typed');
    const get = vi.fn<YahooGet>(async () => ({ status: 200, data: yahooChart(6_150) }));
    expect(await refreshYahooCloses(database, ws, { get, now: evening })).toBe(1);
    expect(get.mock.calls.map(([url]) => url)).toEqual(['https://query1.finance.yahoo.com/v8/finance/chart/BBCA.JK?range=5d&interval=1d']);
    expect(await listPrices(database, ws, ids['BBCA · Mandiri']!)).toEqual([{ onDate: '2026-09-29', priceMicro: 6_150_000_000, source: 'yahoo' }]);
    expect(await listPrices(database, ws, ids['TLKM']!)).toEqual([]);
  });

  it('never overwrites a price typed for that day, and a failure leaves the last price', async () => {
    const { database, ws, ids, securityOf } = await holdings();
    await upsertSecurityPrice(database, ws, { securityId: securityOf('BBCA'), onDate: '2026-09-29', priceMicro: 6_100_000_000 });
    await upsertSecurityPrice(database, ws, { securityId: securityOf('TLKM'), onDate: '2026-09-21', priceMicro: 2_400_000_000 });
    const get = vi.fn<YahooGet>(async (url) => {
      if (url.includes('TLKM')) throw new TypeError('Failed to fetch');
      return { status: 200, data: yahooChart(6_150) };
    });
    expect(await refreshYahooCloses(database, ws, { get, now: evening })).toBe(0);
    expect(await listPrices(database, ws, ids['BBCA · Stockbit']!)).toEqual([{ onDate: '2026-09-29', priceMicro: 6_100_000_000, source: 'manual' }]);
    expect(await listPrices(database, ws, ids['TLKM']!)).toEqual([{ onDate: '2026-09-21', priceMicro: 2_400_000_000, source: 'manual' }]);
  });

  it('refuses a close in another currency', async () => {
    const { database, ws, ids } = await holdings();
    const get: YahooGet = async () => ({ status: 200, data: yahooChart(6_150, 'USD') });
    expect(await refreshYahooCloses(database, ws, { get, now: evening })).toBe(0);
    expect(await listPrices(database, ws, ids['TLKM']!)).toEqual([]);
  });
});
