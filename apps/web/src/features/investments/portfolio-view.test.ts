import type { AccountRow, AssetProfileRow, AssetValueRow, HoldingLinkRow, SecurityRow } from '@expanses/db';
import { formatMinor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { groupAssets } from '../networth/asset-rows';
import { brokerSubtitle, dayLabel, NO_BROKER, portfolioView, priceChangeLines, putInLine, stockSubtitle } from './portfolio-view';

const value = (accountId: string, currency: string, units: number, valueMinor: number, costMinor: number, stale = false): AssetValueRow =>
  ({ accountId, name: accountId, currency, planGroup: 'invest', mode: 'market', unitsMicro: units * 1_000_000, stale, valueMinor, costMinor, source: 'price', asOf: '2026-09-19' }) as AssetValueRow;
const profile = (accountId: string, assetKind: AssetProfileRow['assetKind']) => ({ accountId, assetKind }) as AssetProfileRow;
const account = (id: string, name: string, currency: string) => ({ id, name, currency, kind: 'asset', parentId: null, archivedAt: null }) as AccountRow;
const security = (id: string, ticker: string, currency: string, lotSize: number | null): SecurityRow => ({ id, ticker, name: ticker, market: currency === 'IDR' ? 'IDX' : 'NASDAQ', currency, lotSize, kind: 'share', source: 'catalogue' });
const link = (accountId: string, securityId: string | null, brokerAccountId: string | null): HoldingLinkRow => ({ accountId, securityId, brokerAccountId });
const position = (costMinor: number) => ({ unitsMicro: 0, costMinor, realizedMinor: 0, incomeMinor: 0, byYear: {} });

const listed = [
  value('aapl-ib', 'USD', 10, 214_300, 182_500), value('voo-ib', 'USD', 3, 156_480, 149_460),
  value('bbca-sb', 'IDR', 1_000, 9_775_000, 8_750_000), value('bbca-ms', 'IDR', 500, 4_887_500, 4_700_000),
  value('tlkm-sb', 'IDR', 2_000, 5_740_000, 6_200_000, true), value('bbri-ms', 'IDR', 1_200, 5_028_000, 5_460_000),
];
const inputs = {
  values: [...listed, value('gold', 'IDR', 10, 19_000_000, 18_600_000), value('fund', 'IDR', 100, 1_000_000, 900_000), value('sold', 'IDR', 0, 0, 0)],
  profiles: [profile('gold', 'gold'), profile('fund', 'fund'), profile('sold', 'stock')],
  links: [
    link('aapl-ib', 'aapl', 'ib'), link('voo-ib', 'voo', 'ib'), link('bbca-sb', 'bbca', 'sb'),
    link('bbca-ms', 'bbca', 'ms'), link('tlkm-sb', 'tlkm', 'sb'), link('bbri-ms', 'bbri', 'ms'),
  ],
  securities: [security('aapl', 'AAPL', 'USD', null), security('voo', 'VOO', 'USD', null), security('bbca', 'BBCA', 'IDR', 100), security('tlkm', 'TLKM', 'IDR', 100), security('bbri', 'BBRI', 'IDR', 100)],
  accounts: [account('ib', 'Interactive Brokers', 'USD'), account('sb', 'Stockbit', 'IDR'), account('ms', 'Mandiri Sekuritas', 'IDR')],
  baseCosts: { 'aapl-ib': position(28_835_000), 'voo-ib': position(24_063_060) },
  baseCurrency: 'IDR',
  ratesToBase: { USD: 16_250 },
};
const withoutFund = { ...inputs, values: inputs.values.filter((v) => v.accountId !== 'fund') };

describe('portfolioView', () => {
  it('reads by stock, largest first, a stock at two brokers once', () => {
    const view = portfolioView(withoutFund);
    expect(view.stocks.map((s) => s.title)).toEqual(['AAPL', 'VOO', 'BBCA', 'TLKM', 'BBRI']);
    const bbca = view.stocks.find((s) => s.title === 'BBCA')!;
    expect(bbca).toMatchObject({ unitsMicro: 1_500_000_000, valueMinor: 14_662_500, costMinor: 13_450_000, gainBps: 901, lotSize: 100 });
    expect(bbca.holdings.map((h) => h.brokerName)).toEqual(['Stockbit', 'Mandiri Sekuritas']);
    expect(view.stocks.find((s) => s.title === 'AAPL')).toMatchObject({ currency: 'USD', valueMinor: 214_300, valueBaseMinor: 34_823_750, costBaseMinor: 28_835_000 });
    expect(view.stocks.find((s) => s.title === 'TLKM')!.stale).toBe(true); // "Update price", as the Assets row says
  });

  it('sums the whole portfolio in base and names the exchange-rate part', () => {
    expect(portfolioView(withoutFund).summary).toMatchObject({ valueBaseMinor: 85_682_250, costBaseMinor: 78_008_060, gainBps: 984, currencyMoveMinor: 1_199_070, converted: true });
  });

  it('is the Assets page’s Investments group regrouped: the same total at the same rates', () => {
    const assets = groupAssets(listed, [], { accounts: inputs.accounts, baseCurrency: 'IDR', ratesToBase: inputs.ratesToBase });
    expect(portfolioView({ ...inputs, values: listed }).summary.valueBaseMinor).toBe(assets.find((g) => g.group === 'invest')!.totalMinor);
    expect(assets.find((g) => g.group === 'invest')!.totalMinor).toBe(85_682_250);
  });

  it('lists each broker in its own currency with a share that adds to 100 — floor and remainder, 71 · 18 · 11', () => {
    expect(portfolioView(withoutFund).brokers.map((b) => [b.name, b.currency, b.valueMinor, b.sharePercent])).toEqual([
      ['Interactive Brokers', 'USD', 370_780, 71],
      ['Stockbit', 'IDR', 15_515_000, 18],
      ['Mandiri Sekuritas', 'IDR', 9_915_500, 11],
    ]);
  });

  it('keeps an unlinked fund as its own row under No broker named, and leaves gold and sold holdings out', () => {
    const view = portfolioView(inputs);
    expect(view.stocks.find((s) => s.accountId === 'fund')).toMatchObject({ securityId: null, title: 'fund' });
    expect(view.stocks.some((s) => s.accountId === 'gold' || s.accountId === 'sold')).toBe(false);
    expect(view.brokers.find((b) => b.key === NO_BROKER)).toMatchObject({ name: 'No broker named', currency: 'IDR', valueMinor: 1_000_000 });
  });

  it('adds a broker holding two currencies up in base through sumToBase, with no own-currency figure', () => {
    const view = portfolioView({ ...withoutFund, links: withoutFund.links.map((l) => (l.accountId === 'aapl-ib' ? { ...l, brokerAccountId: 'sb' } : l)) });
    expect(view.brokers.find((b) => b.name === 'Stockbit')).toMatchObject({ currency: null, valueMinor: null, total: { totalMinor: 34_823_750 + 15_515_000, missing: [] } });
  });

  it('shows a foreign holding with no base cost as unknown, naming it, and never adds it as zero', () => {
    const view = portfolioView({ ...withoutFund, baseCosts: { 'voo-ib': position(24_063_060) } });
    expect(view.costUnknown).toEqual(['aapl-ib']);
    expect(view.summary).toMatchObject({ costBaseMinor: null, gainBaseMinor: null, valueBaseMinor: 85_682_250 });
    expect(view.stocks.find((s) => s.title === 'AAPL')!.costBaseMinor).toBeNull();
    expect(view.stocks.find((s) => s.title === 'VOO')!.costBaseMinor).toBe(24_063_060);
    expect(view.brokers.find((b) => b.name === 'Interactive Brokers')!.costBaseMinor).toBeNull();
    expect(view.brokers.find((b) => b.name === 'Stockbit')!.costBaseMinor).toBe(8_750_000 + 6_200_000);
    // A foreign holding that cost nothing costs nothing in base, and needs no pinned figure.
    const free = portfolioView({ ...withoutFund, values: [value('aapl-ib', 'USD', 10, 214_300, 0)], baseCosts: {} });
    expect(free.costUnknown).toEqual([]);
    expect(free.summary.costBaseMinor).toBe(0);
  });

  it('refuses every total it has no rate for, naming the currency, and shares nothing out of a whole it cannot add up', () => {
    const view = portfolioView({ ...withoutFund, ratesToBase: {} });
    expect(view.summary).toMatchObject({ valueBaseMinor: null, missingRates: ['USD'] });
    expect(view.brokers.find((b) => b.name === 'Interactive Brokers')!.total).toEqual({ totalMinor: null, missing: ['USD'] });
    // Stockbit's own figure is exact in rupiah; only its share of a total nobody can add up is withheld.
    expect(view.brokers.map((b) => b.sharePercent)).toEqual([null, null, null]);
    expect(view.brokers.find((b) => b.name === 'Stockbit')!.valueMinor).toBe(15_515_000);
  });
});

describe('priceChangeLines', () => {
  it('is each holding’s value at the new price and its move from the last', () => {
    const bbca = portfolioView(inputs).stocks.find((s) => s.title === 'BBCA')!;
    expect(priceChangeLines(bbca.holdings, 9_550_000_000, 9_775_000_000).map((l) => [l.valueMinor, l.changeMinor])).toEqual([[9_775_000, 225_000], [4_887_500, 112_500]]);
    expect(priceChangeLines(bbca.holdings, null, 9_775_000_000)[0]!.changeMinor).toBeNull();
  });
});

describe('two holdings of one security with no broker', () => {
  // Until a holding is told where it is kept, each stays its own line: nothing merges them, and nothing hides one.
  const twoUnkept = {
    ...withoutFund,
    links: withoutFund.links.map((l) => (l.accountId === 'bbca-sb' || l.accountId === 'bbca-ms' ? { ...l, brokerAccountId: null } : l)),
  };
  it('are one stock row with each holding listed, and each listed under No broker named', () => {
    const view = portfolioView(twoUnkept);
    const bbca = view.stocks.find((s) => s.title === 'BBCA')!;
    expect(bbca.holdings.map((h) => [h.accountId, h.brokerName])).toEqual([['bbca-sb', 'No broker named'], ['bbca-ms', 'No broker named']]);
    expect(view.brokers.find((b) => b.key === NO_BROKER)!.holdings.map((h) => h.accountId)).toEqual(['bbca-sb', 'bbca-ms']);
  });
  it('say two holdings, never two brokers', () => {
    const bbca = portfolioView(twoUnkept).stocks.find((s) => s.title === 'BBCA')!;
    expect(stockSubtitle(bbca)).toBe('15 lot (1.500 shares) · No broker named · 2 holdings · +9,0%');
  });
});

describe('the row subtitles', () => {
  const view = portfolioView(withoutFund);
  it('name the shares, lots where the market has them, where they are kept, the gain and a stale price', () => {
    expect(stockSubtitle(view.stocks.find((s) => s.title === 'BBCA')!)).toBe('15 lot (1.500 shares) · 2 brokers · +9,0%');
    expect(stockSubtitle(view.stocks.find((s) => s.title === 'AAPL')!)).toBe('10 shares · Interactive Brokers · +17,4%');
    expect(stockSubtitle(view.stocks.find((s) => s.title === 'TLKM')!)).toBe('20 lot (2.000 shares) · Stockbit · −7,4% · Update price');
  });
  it('count a broker’s holdings, its one currency and its share', () => {
    expect(view.brokers.map(brokerSubtitle)).toEqual(['2 holdings · USD · 71%', '2 holdings · IDR · 18%', '2 holdings · IDR · 11%']);
  });
});

describe('putInLine', () => {
  it('is the figure when every cost is known, and names the holdings when one is not — never a zero', () => {
    expect(putInLine(78_008_060, [], 'IDR')).toBe(formatMinor(78_008_060, 'IDR'));
    expect(putInLine(null, ['AAPL · Interactive Brokers'], 'IDR')).toBe('Not known — no IDR cost for AAPL · Interactive Brokers');
    expect(putInLine(null, ['AAPL · IB', 'VOO · IB'], 'IDR')).toBe('Not known — no IDR cost for AAPL · IB, VOO · IB');
  });
});

describe('dayLabel', () => {
  it('reads "8 Mar 2025", with the three-letter month on every engine (en-GB writes "Sept" on some)', () => {
    expect(dayLabel('2025-03-08')).toBe('8 Mar 2025');
    expect(dayLabel('2026-09-22')).toBe('22 Sep 2026');
  });
});
