import type { AccountRow, TradeRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import type { HoldingLine } from './portfolio-view';
import { baseGainOf, boughtAtRate, idleCash, recentTrades } from './security-view';

const line = (accountId: string, brokerName: string, currency = 'USD'): HoldingLine => ({
  accountId, name: accountId, brokerAccountId: brokerName === 'No broker named' ? null : `b-${accountId}`, brokerName, currency,
  unitsMicro: 10_000_000, valueMinor: 214_300, costMinor: 182_500, costBaseMinor: 28_835_000, stale: false,
});
const trade = (id: string, accountId: string, kind: TradeRow['kind'], occurredOn: string, grossMinor: number, feeMinor = 0, createdAt = `${occurredOn}T09:00:00Z`): TradeRow =>
  ({ id, accountId, kind, occurredOn, createdAt, unitsMicro: 4_000_000, grossMinor, feeMinor, taxMinor: 0, status: 'active' }) as TradeRow;
const account = (id: string, currency: string, parentId: string | null = null, archivedAt: string | null = null) =>
  ({ id, name: id, currency, kind: 'asset', subtype: 'fund', parentId, archivedAt }) as AccountRow;

describe('a foreign stock in base', () => {
  // The spec's AAPL: $2.143,00 at 16.250 is Rp 34.823.750 against Rp 28.835.000 put in at 15.800.
  const aapl = { currency: 'USD', costMinor: 182_500, costBaseMinor: 28_835_000, valueBaseMinor: 34_823_750 };
  it('gains what today’s value is over what was put in, rate movement included', () => {
    expect(baseGainOf(aapl)).toEqual({ gainMinor: 5_988_750, bps: 2077 });
  });
  it('has no gain in base without a rate, rather than a gain against nothing', () => {
    expect(baseGainOf({ ...aapl, valueBaseMinor: null })).toBeNull();
  });
  it('has no gain in base, and no bought-at rate, when what was put in is not known', () => {
    expect(baseGainOf({ ...aapl, costBaseMinor: null })).toBeNull();
    expect(boughtAtRate({ ...aapl, costBaseMinor: null }, 'IDR')).toBeNull();
  });
  it('was bought at the base cost over the native cost', () => {
    expect(boughtAtRate(aapl, 'IDR')).toBe(15_800);
    expect(boughtAtRate({ ...aapl, currency: 'IDR' }, 'IDR')).toBeNull();
    expect(boughtAtRate({ ...aapl, costMinor: 0 }, 'IDR')).toBeNull(); // units from a unit change cost nothing
    expect(boughtAtRate({ ...aapl, costBaseMinor: 0 }, 'IDR')).toBeNull();
  });
});

describe('recentTrades', () => {
  const stock = { currency: 'USD', holdings: [line('aapl-ib', 'Interactive Brokers'), line('aapl-x', 'No broker named'), line('aapl-y', 'No broker named')] };
  const trades = [
    trade('t1', 'aapl-ib', 'buy', '2025-03-08', 182_000, 500),
    trade('t2', 'aapl-ib', 'sell', '2026-01-10', 90_000),
    trade('t3', 'other', 'buy', '2026-02-01', 1_000),
    trade('t4', 'aapl-x', 'income', '2026-02-02', 1_200),
    trade('t5', 'aapl-y', 'buy', '2026-02-02', 50_000, 0, '2026-02-02T10:00:00Z'),
  ];
  it('lists only this stock’s holdings, newest first, and pins a foreign buy’s base cost at its own day’s rate', () => {
    const lines = recentTrades(trades, stock, { t1: 28_835_000, t5: 812_500 }, 'IDR');
    expect(lines.map((l) => l.id)).toEqual(['t5', 't4', 't2', 't1']);
    expect(lines.find((l) => l.id === 't1')).toMatchObject({ title: 'Bought 4 shares', brokerName: 'Interactive Brokers', day: '8 Mar 2025', grossMinor: 182_000, pinnedBaseMinor: 28_835_000, pinnedRate: 15_800 });
    expect(lines.find((l) => l.id === 't2')).toMatchObject({ title: 'Sold 4 shares', pinnedBaseMinor: null, pinnedRate: null });
    expect(lines.find((l) => l.id === 't4')).toMatchObject({ title: 'Income', pinnedBaseMinor: null });
  });
  it('names each broker-less holding’s trade on its own line', () => {
    const lines = recentTrades(trades, stock, {}, 'IDR');
    expect(lines.filter((l) => l.brokerName === 'No broker named').map((l) => l.accountId)).toEqual(['aapl-y', 'aapl-x']);
  });
  it('pins nothing for a stock in the base currency, and a buy the ledger never pinned has no rate rather than a zero one', () => {
    expect(recentTrades(trades, { ...stock, currency: 'IDR' }, { t1: 28_835_000 }, 'IDR').every((l) => l.pinnedBaseMinor === null)).toBe(true);
    expect(recentTrades(trades, stock, {}, 'IDR').find((l) => l.id === 't1')).toMatchObject({ pinnedBaseMinor: null, pinnedRate: null });
  });
  it('stops at ten', () => {
    const many = Array.from({ length: 12 }, (_, i) => trade(`m${i}`, 'aapl-ib', 'buy', `2026-03-${String(i + 1).padStart(2, '0')}`, 100));
    expect(recentTrades(many, stock, {}, 'IDR')).toHaveLength(10);
  });
});

describe('idleCash', () => {
  const accounts = [
    account('ib', 'USD'), account('ib-usd', 'USD', 'ib'), account('ib-idr', 'IDR', 'ib'), account('ib-old', 'SGD', 'ib', '2026-01-01'),
    account('stockbit', 'IDR'),
  ];
  const balances = { 'ib-usd': 45_010, 'ib-idr': 1_250_000, 'ib-old': 99, stockbit: 3_400_000 };
  it('is a plain broker’s own balance in its own currency', () => {
    expect(idleCash({ accountId: 'stockbit' }, accounts, balances, 'IDR')).toEqual([{ accountId: 'stockbit', label: 'Cash idle', currency: 'IDR', minor: 3_400_000 }]);
  });
  it('is each open pocket of a broker holding pockets, each in its own currency, never converted or added', () => {
    expect(idleCash({ accountId: 'ib' }, accounts, balances, 'IDR')).toEqual([
      { accountId: 'ib-usd', label: 'Cash idle · USD', currency: 'USD', minor: 45_010 },
      { accountId: 'ib-idr', label: 'Cash idle · IDR', currency: 'IDR', minor: 1_250_000 },
    ]);
  });
  it('is nothing for holdings kept with no broker', () => {
    expect(idleCash({ accountId: null }, accounts, balances, 'IDR')).toEqual([]);
  });
});
