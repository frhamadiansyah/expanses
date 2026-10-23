import { formatMinor, formatPriceMicro } from '@expanses/core';
import type { AccountRow, AssetProfileRow, AssetValueRow, HoldingLinkRow, SecurityRow, TradeRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { type HoldingLine, NO_BROKER, portfolioView } from './portfolio-view';
import {
  baseGainLine,
  baseGainOf,
  boughtAtRate,
  brokerPageModel,
  combinedSeries,
  dividendsInYear,
  idleCash,
  institutionLine,
  overallTiles,
  recentTrades,
  securityPageModel,
  soleHolding,
} from './security-view';

const line = (accountId: string, brokerName: string, currency = 'USD'): HoldingLine => ({
  accountId, name: accountId, brokerAccountId: brokerName === 'No broker named' ? null : `b-${accountId}`, brokerName, currency,
  unitsMicro: 10_000_000, valueMinor: 214_300, costMinor: 182_500, costBaseMinor: 28_835_000, stale: false, place: null,
});
const trade = (id: string, accountId: string, kind: TradeRow['kind'], occurredOn: string, grossMinor: number, feeMinor = 0, createdAt = `${occurredOn}T09:00:00Z`, taxMinor = 0): TradeRow =>
  ({ id, accountId, kind, occurredOn, createdAt, unitsMicro: 4_000_000, grossMinor, feeMinor, taxMinor, status: 'active' }) as TradeRow;
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
  it('names the missing rate for the gain in base — never a value of 0 read as −100%', () => {
    expect(baseGainLine(aapl, 'IDR')).toBe(`+20,8% · ${formatMinor(5_988_750, 'IDR')}`);
    expect(baseGainLine({ ...aapl, valueBaseMinor: null }, 'IDR')).toBe('No USD rate yet');
    expect(baseGainLine({ ...aapl, costBaseMinor: null }, 'IDR')).toBeNull();
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
  it('reads the rate off the whole cost, tax included', () => {
    // 182.000 + 500 fee + 1.250 tax = $1.837,50, pinned at Rp 29.032.500: 15.800 per dollar only with the tax counted.
    const taxed = [trade('t1', 'aapl-ib', 'buy', '2025-03-08', 182_000, 500, undefined, 1_250)];
    expect(recentTrades(taxed, stock, { t1: 29_032_500 }, 'IDR')[0]).toMatchObject({ pinnedBaseMinor: 29_032_500, pinnedRate: 15_800 });
  });
  it('shows a buy the ledger pinned at 0 as unknown — no rate worked out of it, and no "Rp 0"', () => {
    expect(recentTrades(trades, stock, { t1: 0 }, 'IDR').find((l) => l.id === 't1')).toMatchObject({ pinnedBaseMinor: null, pinnedRate: null });
    // A buy that cost nothing (a unit change booked as a buy) cost nothing in base too.
    const free = [trade('t0', 'aapl-ib', 'buy', '2025-03-08', 0)];
    expect(recentTrades(free, stock, { t0: 0 }, 'IDR')[0]).toMatchObject({ pinnedBaseMinor: 0, pinnedRate: null });
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
  it('never reads the parent’s own balance for its pockets, whatever the ledger says it holds', () => {
    const pockets = [
      { accountId: 'ib-usd', label: 'Cash idle · USD', currency: 'USD', minor: 45_010 },
      { accountId: 'ib-idr', label: 'Cash idle · IDR', currency: 'IDR', minor: 1_250_000 },
    ];
    expect(idleCash({ accountId: 'ib' }, accounts, { ...balances, ib: 0 }, 'IDR')).toEqual(pockets);
    expect(idleCash({ accountId: 'ib' }, accounts, { ...balances, ib: 777 }, 'IDR')).toEqual(pockets);
  });
});

// The pages' own reads (W4, W5, I8): what each screen draws comes out of these, so a lost wire fails here.
describe('the stock and broker pages', () => {
  const value = (accountId: string, name: string, currency: string, units: number, valueMinor: number, costMinor: number): AssetValueRow =>
    ({ accountId, name, currency, planGroup: 'invest', mode: 'market', unitsMicro: units * 1_000_000, stale: false, valueMinor, costMinor, source: 'price', asOf: '2026-09-19' }) as AssetValueRow;
  const security = (id: string, ticker: string, currency: string): SecurityRow => ({ id, ticker, name: ticker, market: currency === 'IDR' ? 'IDX' : 'NASDAQ', currency, lotSize: null, kind: 'share', source: 'catalogue' });
  const link = (accountId: string, securityId: string | null, brokerAccountId: string | null): HoldingLinkRow => ({ accountId, securityId, brokerAccountId });
  const view = portfolioView({
    values: [
      value('aapl-ib', 'AAPL · IB', 'USD', 10, 214_300, 182_500),
      value('bbca-1', 'BBCA 2019', 'IDR', 500, 4_887_500, 4_000_000),
      value('bbca-2', 'BBCA 2024', 'IDR', 300, 2_932_500, 2_900_000),
      value('tlkm-1', 'TLKM', 'IDR', 100, 287_000, 310_000),
      value('fund', 'Private fund', 'IDR', 10, 1_000_000, 900_000),
    ],
    profiles: [{ accountId: 'fund', assetKind: 'fund' } as AssetProfileRow],
    links: [link('aapl-ib', 'aapl', 'ib'), link('bbca-1', 'bbca', null), link('bbca-2', 'bbca', null), link('tlkm-1', 'tlkm', null)],
    securities: [security('aapl', 'AAPL', 'USD'), security('bbca', 'BBCA', 'IDR'), security('tlkm', 'TLKM', 'IDR')],
    accounts: [account('ib', 'USD'), account('ib-usd', 'USD', 'ib'), account('ib-idr', 'IDR', 'ib')],
    baseCosts: { 'aapl-ib': { unitsMicro: 0, costMinor: 28_835_000, realizedMinor: 0, incomeMinor: 0, byYear: {} } },
    baseCurrency: 'IDR',
    ratesToBase: { USD: 16_250 },
  });

  it('the stock page keeps each recent foreign buy’s pinned cost', () => {
    const model = securityPageModel({ view, securityId: 'aapl', trades: [trade('t1', 'aapl-ib', 'buy', '2025-03-08', 182_000, 500)], buyBaseMinor: { t1: 28_835_000 }, base: 'IDR' })!;
    expect(model.stock.title).toBe('AAPL');
    expect(model.recent).toMatchObject([{ id: 't1', pinnedBaseMinor: 28_835_000, pinnedRate: 15_800 }]);
    expect(securityPageModel({ view, securityId: 'gone', trades: [], buyBaseMinor: {}, base: 'IDR' })).toBeNull();
  });

  it('a broker page shows its idle cash, each pocket in its own currency', () => {
    const model = brokerPageModel({ view, key: 'ib', accounts: [account('ib', 'USD'), account('ib-usd', 'USD', 'ib'), account('ib-idr', 'IDR', 'ib')], balances: { 'ib-usd': 45_010, 'ib-idr': 1_250_000 }, base: 'IDR' })!;
    expect(model.cash.map((c) => [c.label, c.minor])).toEqual([['Cash idle · USD', 45_010], ['Cash idle · IDR', 1_250_000]]);
    // AAPL is held at this broker alone, so its row opens the holding, not the stock across brokers.
    expect(model.rows).toMatchObject([{ title: 'AAPL', opens: { accountId: 'aapl-ib' } }]);
    // Before the balances load there is no cash line to show, rather than a zero.
    expect(brokerPageModel({ view, key: 'ib', accounts: [], balances: undefined, base: 'IDR' })!.cash).toEqual([]);
  });

  it('the no-broker page names each of two holdings of one stock, never "BBCA" twice', () => {
    const model = brokerPageModel({ view, key: NO_BROKER, accounts: [], balances: {}, base: 'IDR' })!;
    expect(model.rows.map((r) => [r.title, r.opens])).toEqual([
      ['No broker named · BBCA 2019', { securityId: 'bbca' }],
      ['No broker named · BBCA 2024', { securityId: 'bbca' }],
      ['TLKM', { accountId: 'tlkm-1' }],
      ['Private fund', { accountId: 'fund' }],
    ]);
    expect(model.cash).toEqual([]);
  });
});

// The stock across its brokers (mockup C): what its card and its Institutions rows say.
describe('the stock across brokers', () => {
  it('opens the one holding straight away when there is only one, and the page across them when there are two', () => {
    expect(soleHolding({ holdings: [line('a', 'Stockbit')] })).toBe('a');
    expect(soleHolding({ holdings: [line('a', 'Stockbit'), line('b', 'Ajaib')] })).toBeNull();
  });

  it('adds each holding’s line day by day, and draws none from lines that do not share their days', () => {
    const a = [{ on: '2026-10-01', minor: 100 }, { on: '2026-10-02', minor: 130 }];
    const b = [{ on: '2026-10-01', minor: 40 }, { on: '2026-10-02', minor: 45 }];
    expect(combinedSeries([a, b])).toEqual([{ on: '2026-10-01', minor: 140 }, { on: '2026-10-02', minor: 175 }]);
    expect(combinedSeries([a, b.slice(1)])).toBeNull();
    expect(combinedSeries([a, [{ on: '2026-09-30', minor: 1 }, { on: '2026-10-01', minor: 2 }]])).toBeNull();
    expect(combinedSeries([])).toBeNull();
  });

  it('counts this year’s dividends from its own holdings only, before tax', () => {
    const trades = [
      trade('d1', 'a', 'income', '2026-03-14', 41_000),
      trade('d2', 'b', 'income', '2026-08-02', 12_500, 0, undefined, 1_250),
      trade('d3', 'a', 'income', '2025-11-20', 99_000), // last year
      trade('d4', 'c', 'income', '2026-05-05', 77_000), // another stock
      trade('b1', 'a', 'buy', '2026-02-01', 5_000_000),
    ];
    expect(dividendsInYear(trades, ['a', 'b'], '2026')).toBe(53_500);
    expect(dividendsInYear(trades, ['a', 'b'], '2024')).toBe(0);
  });

  it('fills the card with the shares, the average over every broker, the price and this year’s dividends', () => {
    // 12 lots at one broker and 3 at another: 1.500 shares that cost Rp 13.335.000 in all — Rp 8.890 a share.
    const stock = { unitsMicro: 1_500_000_000, costMinor: 13_335_000, currency: 'IDR', lotSize: 100 };
    const tiles = overallTiles({ stock, price: { priceMicro: 9_120_000_000, label: 'Last close', info: 'Yahoo Finance · 22 Oct 2026' }, dividendsMinor: 53_500 });
    expect(tiles.map((t) => [t.label, t.value])).toEqual([
      ['Shares', '15 lots · 1.500'],
      ['Average price', formatPriceMicro(8_890_000_000, 'IDR')],
      ['Last close', formatPriceMicro(9_120_000_000, 'IDR')],
      ['Dividends this year', formatMinor(53_500, 'IDR')],
    ]);
    // No price yet and nothing read of the dividends: those tiles are left off rather than drawn with a dash.
    expect(overallTiles({ stock, price: null, dividendsMinor: null }).map((t) => t.label)).toEqual(['Shares', 'Average price']);
  });

  it('gives each broker’s row its lots, its own average and its own gain in the tone it is read in', () => {
    expect(institutionLine({ unitsMicro: 1_200_000_000, costMinor: 10_620_000, valueMinor: 10_944_000, currency: 'IDR' }, 100)).toEqual({
      subtitle: `12 lots · avg ${formatPriceMicro(8_850_000_000, 'IDR')}`,
      gain: { text: '+3,1%', tone: 'gain' },
    });
    expect(institutionLine({ unitsMicro: 300_000_000, costMinor: 2_850_000, valueMinor: 2_736_000, currency: 'IDR' }, 100).gain).toEqual({ text: '−4,0%', tone: 'loss' });
    // Nothing paid for it: no gain to read, never one against a zero.
    expect(institutionLine({ unitsMicro: 300_000_000, costMinor: 0, valueMinor: 2_736_000, currency: 'IDR' }, 100).gain).toBeNull();
  });
});
