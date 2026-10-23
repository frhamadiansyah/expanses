import { describe, expect, it } from 'vitest';
import type { AssetRow } from './asset-rows';
import { linesByStock } from './stock-rows';

const M = 1_000_000;

function row(accountId: string, over: Partial<AssetRow> = {}): AssetRow {
  return {
    accountId,
    name: accountId,
    planGroup: 'invest',
    valueMinor: 1000,
    currency: 'IDR',
    method: 'Units × price',
    coretax: '',
    stale: false,
    sold: false,
    due: false,
    pockets: null,
    missing: [],
    converted: false,
    kind: { key: 'stock', label: 'Listed shares' },
    section: 'invest',
    person: null,
    ...over,
  };
}

const securities = [
  { id: 'bbca', ticker: 'BBCA', name: 'Bank Central Asia', lotSize: 100 },
  { id: 'aapl', ticker: 'AAPL', name: 'Apple', lotSize: null },
  { id: 'named', ticker: null, name: 'Named', lotSize: null },
];

describe('linesByStock', () => {
  it('folds a stock held at two brokers into one line where its first holding stood, adding up value and units', () => {
    const rows = [row('bbca-stockbit', { valueMinor: 10_944_000 }), row('aapl-1', { currency: 'USD' }), row('bbca-ajaib', { valueMinor: 2_736_000 })];
    const lines = linesByStock('stock', rows, {
      links: [
        { accountId: 'bbca-stockbit', securityId: 'bbca', brokerAccountId: 'stockbit' },
        { accountId: 'bbca-ajaib', securityId: 'bbca', brokerAccountId: 'ajaib' },
        { accountId: 'aapl-1', securityId: 'aapl', brokerAccountId: 'stockbit' },
      ],
      securities,
      units: new Map([
        ['bbca-stockbit', 1200 * M],
        ['bbca-ajaib', 300 * M],
        ['aapl-1', 10 * M],
      ]),
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]!.stock).toMatchObject({
      kind: 'stock',
      securityId: 'bbca',
      title: 'BBCA',
      subtitle: '15 lots · 2 brokers',
      valueMinor: 13_680_000,
      currency: 'IDR',
      stale: false,
    });
    expect(lines[0]!.stock!.rows.map((one) => one.accountId)).toEqual(['bbca-stockbit', 'bbca-ajaib']);
    // A stock at one broker stays as its holding's own row.
    expect(lines[1]!.row?.accountId).toBe('aapl-1');
  });

  it('says the holdings, not brokers, when both are kept at one place, and asks for a price when either does', () => {
    const lines = linesByStock('stock', [row('a'), row('b', { stale: true })], {
      links: [
        { accountId: 'a', securityId: 'aapl', brokerAccountId: null },
        { accountId: 'b', securityId: 'aapl', brokerAccountId: null },
      ],
      securities,
      units: new Map([
        ['a', 2 * M],
        ['b', 3 * M],
      ]),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.stock).toMatchObject({ subtitle: '5 shares · 2 holdings · Update price', stale: true });
  });

  it('leaves sold holdings, unlinked or ticker-less holdings and other drawers as they are', () => {
    const links = [
      { accountId: 'live', securityId: 'bbca', brokerAccountId: 'x' },
      { accountId: 'sold', securityId: 'bbca', brokerAccountId: 'y' },
      { accountId: 'n1', securityId: 'named', brokerAccountId: 'x' },
      { accountId: 'n2', securityId: 'named', brokerAccountId: 'y' },
    ];
    const rows = [row('live'), row('sold', { sold: true, valueMinor: 0 }), row('n1'), row('n2'), row('loose')];
    const lines = linesByStock('stock', rows, { links, securities, units: new Map() });
    expect(lines.map((line) => line.row?.accountId)).toEqual(['live', 'sold', 'n1', 'n2', 'loose']);
    // Another drawer is never read by stock, even when its rows are linked.
    const bonds = [row('live', { kind: { key: 'bond', label: 'Government bonds' } }), row('other', { kind: { key: 'bond', label: 'Government bonds' } })];
    const other = linesByStock('bond', bonds, { links: [...links, { accountId: 'other', securityId: 'bbca', brokerAccountId: 'y' }], securities, units: new Map() });
    expect(other.every((line) => line.row !== undefined)).toBe(true);
  });
});

// "Same fund as" (spec 2026-10-19-fund-by-amount) ties two places of one fund by giving both the same security.
describe('linesByStock, mutual funds', () => {
  const FUND = { key: 'fund', label: 'Mutual fund' };
  const fund = (accountId: string, over: Partial<AssetRow> = {}) => row(accountId, { kind: FUND, method: 'Money in', ...over });
  const tied = [{ id: 'mm', ticker: null, name: 'Harbour Money Market', lotSize: null }];
  const link = (accountId: string, securityId: string | null) => ({ accountId, securityId, brokerAccountId: null });
  const places = new Map([
    ['mm-app', 'Fund App'],
    ['mm-bank', 'Northbank'],
    ['mm-third', 'Third Broker'],
  ]);

  it('folds a fund tied at two places into one line by its own name, at both values added up', () => {
    const rows = [fund('mm-app', { valueMinor: 1_052_000 }), fund('loose', { valueMinor: 500_000 }), fund('mm-bank', { valueMinor: 2_340_000 })];
    const lines = linesByStock('fund', rows, { links: [link('mm-app', 'mm'), link('mm-bank', 'mm'), link('loose', null)], securities: tied, units: new Map(), places });
    expect(lines).toHaveLength(2);
    expect(lines[0]!.stock).toMatchObject({ kind: 'fund', securityId: 'mm', title: 'Harbour Money Market', subtitle: '2 places', valueMinor: 3_392_000, currency: 'IDR', stale: false });
    expect(lines[0]!.stock!.rows.map((one) => one.accountId)).toEqual(['mm-app', 'mm-bank']);
    // A fund tied to nothing keeps its own row, opening its own page.
    expect(lines[1]!.row?.accountId).toBe('loose');
  });

  it('keeps a fund its own row when the place it was tied to is archived or deleted, so not among the rows', () => {
    const lines = linesByStock('fund', [fund('mm-app')], { links: [link('mm-app', 'mm'), link('mm-bank', 'mm')], securities: tied, units: new Map(), places });
    expect(lines).toEqual([{ row: expect.objectContaining({ accountId: 'mm-app' }) }]);
    // The other place sold out: listed as sold, never folded into the live one.
    const sold = linesByStock('fund', [fund('mm-app'), fund('mm-bank', { sold: true, valueMinor: 0 })], { links: [link('mm-app', 'mm'), link('mm-bank', 'mm')], securities: tied, units: new Map(), places });
    expect(sold.map((line) => line.row?.accountId)).toEqual(['mm-app', 'mm-bank']);
  });

  it('folds three places tied to one another into one line, and asks for a value when any does', () => {
    const rows = [fund('mm-app'), fund('mm-bank', { stale: true }), fund('mm-third')];
    const lines = linesByStock('fund', rows, { links: [link('mm-app', 'mm'), link('mm-bank', 'mm'), link('mm-third', 'mm')], securities: tied, units: new Map(), places });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.stock).toMatchObject({ subtitle: '3 places · Update price', valueMinor: 3000, stale: true });
  });

  it('counts holdings, not places, when every place is the same institution or none is named', () => {
    const same = new Map([
      ['mm-app', 'Fund App'],
      ['mm-bank', 'fund app'],
    ]);
    const links = [link('mm-app', 'mm'), link('mm-bank', 'mm')];
    expect(linesByStock('fund', [fund('mm-app'), fund('mm-bank')], { links, securities: tied, units: new Map(), places: same })[0]!.stock!.subtitle).toBe('2 holdings');
    expect(linesByStock('fund', [fund('mm-app'), fund('mm-bank')], { links, securities: tied, units: new Map() })[0]!.stock!.subtitle).toBe('2 holdings');
  });
});
