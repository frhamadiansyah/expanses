import { describe, expect, it } from 'vitest';
import idxFile from '../securities/idx.json';
import usFile from '../securities/us.json';
import { expandList, type ListFile, loadSecurityList, MARKETS, searchSecurities, validateSecurityList } from '../src/index';

/*
 * The IDX list is generated from the exchange's Daftar Saham, which is still to come from the owner (idx.co.id refuses
 * a download). Until it lands, idx.json is an empty list and every assertion about its rows waits; they run on their
 * own the day the generated file is committed.
 */
const idxPending = (idxFile as ListFile).rows.length === 0;

describe('the bundled lists', () => {
  it('are valid, with no duplicate ticker on a market', () => {
    expect(validateSecurityList(idxFile, 'idx')).toEqual([]);
    expect(validateSecurityList(usFile, 'us')).toEqual([]);
  });
  it.skipIf(idxPending)('carry as many IDX rows as the exchange publishes', () => {
    expect((idxFile as ListFile).rows.length).toBeGreaterThan(850);
    expect((idxFile as ListFile).rows.length).toBeLessThan(1_100);
  });
  it('carry as many US rows as the exchanges publish', () => {
    expect((usFile as ListFile).rows.length).toBeGreaterThan(3_000);
    expect((usFile as ListFile).rows.length).toBeLessThan(13_000);
  });
  it('leave out what is not an ordinary holding: test issues, warrants, rights and units', () => {
    const rows = (usFile as ListFile).rows;
    // Nasdaq's own flags: a fifth letter W, R or U is a warrant, a right or a unit; CQS's .WS / .W / .RT / .R / .U the same.
    expect(rows.filter(([ticker, , market]) => market === 'NASDAQ' && /^[A-Z]{4}[WRU]$/.test(ticker))).toEqual([]);
    expect(rows.filter(([ticker]) => /\.(WS|W|RT|R|U)$/.test(ticker))).toEqual([]);
    expect(rows.filter(([, name]) => /\b(tick pilot|test (stock|issue))\b/i.test(name) || /\b(warrants?|rights?|units?)\b/i.test(name))).toEqual([]);
    // Real stocks and ETFs stay: a 4-letter Nasdaq ticker ending in W, R or U is an ordinary share.
    expect(rows.some(([ticker]) => ticker === 'ROKU')).toBe(true);
  });
  it.skipIf(idxPending)('carry the IDX names the owner holds, on the right market', async () => {
    const idx = (await loadSecurityList('idx')).securities;
    for (const ticker of ['BBCA', 'TLKM', 'BBRI']) expect(idx.find((s) => s.ticker === ticker)).toMatchObject({ market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share' });
  });
  it('carry the US names the owner holds, on the right market', async () => {
    const us = (await loadSecurityList('us')).securities;
    expect(us.find((s) => s.ticker === 'AAPL')).toMatchObject({ market: 'NASDAQ', currency: 'USD', lotSize: null, kind: 'share' });
    expect(us.find((s) => s.ticker === 'VOO')).toMatchObject({ market: 'NYSE ARCA', currency: 'USD', lotSize: null, kind: 'etf' });
  });
  it('loads an empty list as an empty list', async () => {
    const idx = await loadSecurityList('idx');
    expect(idx.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(idx.securities)).toBe(true);
  });
});

describe('validateSecurityList', () => {
  it('names each problem', () => {
    // TLKM is a well-formed IDX ticker, so row 4's only problems are its name, market and kind.
    const bad = { asOf: '2026-09-21', rows: [['BBCA', 'A', 'IDX', 's'], ['BBCA', 'B', 'IDX', 's'], ['bbri', 'C', 'IDX', 's'], ['TLKM', '', 'MARS', 'x'], ['AAPL', 'Apple', 'NASDAQ', 's']] };
    expect(validateSecurityList(bad, 'idx')).toEqual([
      'IDX:BBCA is listed twice',
      'Row 3: "bbri" is not a IDX ticker',
      'Row 4: no name',
      'Row 4: unknown market "MARS"',
      'Row 4: kind must be s or e',
      'Row 5: unknown market "NASDAQ"', // a US market is not the IDX list's, although AAPL has an IDX ticker's shape
    ]);
    expect(validateSecurityList({ rows: [] }, 'idx')).toEqual(['asOf must be YYYY-MM-DD']);
  });
});

describe('expandList', () => {
  it('fills currency and lot size from the market', () => {
    expect(expandList({ asOf: '2026-09-21', rows: [['BBCA', 'x', 'IDX', 's'], ['VOO', 'y', 'NYSE ARCA', 'e']] })).toEqual([
      { ticker: 'BBCA', name: 'x', market: 'IDX', currency: MARKETS.IDX!.currency, lotSize: 100, kind: 'share' },
      { ticker: 'VOO', name: 'y', market: 'NYSE ARCA', currency: 'USD', lotSize: null, kind: 'etf' },
    ]);
  });
});

describe('searchSecurities', () => {
  const rows = [
    { ticker: 'AAPL', name: 'Apple', market: 'NASDAQ' },
    { ticker: 'APPF', name: 'AppFolio', market: 'NASDAQ' },
    { ticker: 'AMAT', name: 'Applied Materials', market: 'NASDAQ' },
    { ticker: 'PAPL', name: 'Pineapple Holdings', market: 'NYSE' },
    { ticker: 'AAP', name: 'Advance Auto Parts', market: 'NYSE' },
    { ticker: null, name: 'Private fund', market: '' },
  ];
  it('ranks exact ticker, ticker prefix, a word of the name, then the name containing it', () => {
    expect(searchSecurities(rows, 'app').map((r) => r.ticker)).toEqual(['APPF', 'AAPL', 'AMAT', 'PAPL']);
    expect(searchSecurities(rows, ' aap ').map((r) => r.ticker)).toEqual(['AAP', 'AAPL']);
  });
  it('finds a security with no ticker by name, and nothing for an empty query', () => {
    expect(searchSecurities(rows, 'private').map((r) => r.name)).toEqual(['Private fund']);
    expect(searchSecurities(rows, '  ')).toEqual([]);
  });
  it('stops at the limit', () => {
    expect(searchSecurities(rows, 'a', 2)).toHaveLength(2);
  });
});
