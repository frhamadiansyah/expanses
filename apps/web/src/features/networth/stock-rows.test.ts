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
  { id: 'bbca', ticker: 'BBCA', lotSize: 100 },
  { id: 'aapl', ticker: 'AAPL', lotSize: null },
  { id: 'named', ticker: null, lotSize: null },
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
    const funds = [row('live', { kind: { key: 'fund', label: 'Mutual fund' } }), row('other', { kind: { key: 'fund', label: 'Mutual fund' } })];
    const other = linesByStock('fund', funds, { links: [...links, { accountId: 'other', securityId: 'bbca', brokerAccountId: 'y' }], securities, units: new Map() });
    expect(other.every((line) => line.row !== undefined)).toBe(true);
  });
});
