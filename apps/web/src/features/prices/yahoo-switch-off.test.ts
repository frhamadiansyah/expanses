import { listPrices, recordListedClose, setSecurityPriceChoice } from '@expanses/db';
import { describe, expect, it, vi } from 'vitest';
import { listedChoiceOf, listedSourceOptions } from './price-sources';
import { refreshYahooCloses, type YahooGet } from './yahoo';
import { holdings } from './yahoo-fixtures';

vi.mock('./yahoo-switch', () => ({ YAHOO_PRICES_ENABLED: false }));

const bbca = { ticker: 'BBCA', market: 'IDX', currency: 'IDR' };

describe('with Yahoo Finance switched off', () => {
  it('offers only IDX’s file and typing, and a security that followed Yahoo follows IDX’s file', () => {
    expect(listedSourceOptions(bbca).map((option) => option.choice)).toEqual(['idx', 'typed']);
    expect(listedChoiceOf(bbca, null)).toBe('idx');
    expect(listedChoiceOf(bbca, 'yahoo')).toBe('idx');
    expect(listedChoiceOf({ ticker: 'AAPL', market: 'NASDAQ', currency: 'USD' }, 'yahoo')).toBe('typed');
  });

  it('never asks Yahoo, and keeps the Yahoo closes already stored', async () => {
    const { database, ws, ids, securityOf } = await holdings();
    await recordListedClose(database, ws, { securityId: securityOf('BBCA'), onDate: '2026-09-28', priceMicro: 6_225_000_000, source: 'yahoo' });
    await setSecurityPriceChoice(database, ws, securityOf('BBCA'), 'yahoo');
    const get = vi.fn<YahooGet>();
    expect(await refreshYahooCloses(database, ws, { get })).toBe(0);
    expect(get).not.toHaveBeenCalled();
    expect(await listPrices(database, ws, ids['BBCA · Stockbit']!)).toEqual([{ onDate: '2026-09-28', priceMicro: 6_225_000_000, source: 'yahoo' }]);
  });
});
