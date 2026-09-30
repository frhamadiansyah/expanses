import { describe, expect, it } from 'vitest';
import { dayLabel, estimatedTiles, gainPill, heroLine, monthEnd, percentOfFace, priceLine, pricedDaySeries, pricedTiles, quantityLabel, tradeLine } from './asset-page';

const M = 1_000_000;
const plain = (text: string | undefined) => text?.replace(/ /g, ' ');

describe('the gain beside the figure', () => {
  it('reads as money and a share of the cost, green up and red down', () => {
    expect(plain(gainPill(79_520_000, 72_370_000, 'IDR')?.text)).toBe('+Rp 7.150.000 · +9,9%');
    expect(gainPill(79_520_000, 72_370_000, 'IDR')?.tone).toBe('gain');
    const loss = gainPill(14_000_000, 22_000_000, 'IDR');
    expect(plain(loss?.text)).toBe('−Rp 8.000.000 · −36,4%');
    expect(loss?.tone).toBe('loss');
  });

  it('is not drawn when nothing was paid for it, nor while it is worth just what it cost', () => {
    expect(gainPill(5_000_000, 0, 'IDR')).toBeNull();
    expect(gainPill(2_100_000, 2_100_000, 'IDR')).toBeNull();
  });
});

describe('dates and quantities', () => {
  it('writes a day the way the app does, never ISO', () => {
    expect(dayLabel('2026-09-30')).toBe('30 Sep 2026');
    expect(dayLabel('2019-03-12')).toBe('12 Mar 2019');
  });

  it('counts shares in lots when they come in whole lots', () => {
    expect(quantityLabel(500 * M, 'shares', 100)).toBe('5 lots');
    expect(quantityLabel(100 * M, 'shares', 100)).toBe('1 lot');
    expect(quantityLabel(150 * M, 'shares', 100)).toBe('150 shares');
    expect(quantityLabel(32 * M, 'grams', null)).toBe('32 g');
  });

  it('reads a bond’s price as a share of its face', () => {
    expect(percentOfFace(1_020_000, 'IDR')).toBe('102% of face');
  });
});

describe('the line under the figure', () => {
  it('says what it is and how much, or where an estimate came from', () => {
    const base = { unitKind: null, unitsMicro: 0, lotSize: null, currency: 'IDR', valuation: null } as const;
    expect(heroLine({ ...base, kindLabel: 'Gold bullion', mode: 'market', unitKind: 'grams', unitsMicro: 32 * M })).toBe('Gold bullion · 32 g');
    expect(heroLine({ ...base, kindLabel: 'Listed shares', mode: 'market', unitKind: 'shares', unitsMicro: 500 * M, lotSize: 100 })).toBe('Listed shares · 5 lots');
    expect(heroLine({ ...base, kindLabel: 'House', mode: 'snapshot', valuation: { basis: 'appraisal', asOf: '2026-09-30' } })).toBe('House · appraisal, 30 Sep 2026');
    expect(heroLine({ ...base, kindLabel: 'Laptop', mode: 'snapshot' })).toBe('Laptop · what was paid');
    expect(heroLine({ ...base, kindLabel: 'Government bond', mode: 'market', unitKind: 'face', unitsMicro: 10_000_000 * M })).toBe('Government bond');
  });
});

describe('the numbers grid', () => {
  it('gives gold its grams, what went in, the average and the buyback a gram', () => {
    const tiles = pricedTiles({ unitKind: 'grams', unitsMicro: 32 * M, costMinor: 72_370_000, lotSize: null, currency: 'IDR', priceMicro: 2_485_000 * M, priceLabel: 'Buyback today' });
    expect(tiles.map((t) => [t.label, plain(t.value)])).toEqual([
      ['Total', '32 g'],
      ['Invested', 'Rp 72.370.000'],
      ['Average buy', 'Rp 2.261.562,5/g'],
      ['Buyback today', 'Rp 2.485.000/g'],
    ]);
  });

  it('gives shares lots and shares, and leaves the price off until there is one', () => {
    const tiles = pricedTiles({ unitKind: 'shares', unitsMicro: 500 * M, costMinor: 2_100_000, lotSize: 100, currency: 'IDR', priceMicro: null, priceLabel: 'Close today' });
    expect(tiles.map((t) => t.label)).toEqual(['Held', 'Invested', 'Average buy']);
    expect(tiles[0]!.value).toBe('5 lots · 500');
  });

  it('reads a bond in face and in % of face, never in units at Rp 1', () => {
    const tiles = pricedTiles({ unitKind: 'face', unitsMicro: 10_000_000 * M, costMinor: 10_000_000, lotSize: null, currency: 'IDR', priceMicro: 1_020_000, priceLabel: 'Price today' });
    expect(tiles.map((t) => [t.label, plain(t.value)])).toEqual([
      ['Face value', 'Rp 10.000.000'],
      ['Invested', 'Rp 10.000.000'],
      ['Average buy', '100% of face'],
      ['Price today', '102% of face'],
    ]);
  });

  it('gives an estimated thing what it cost and when, and what is yours when a loan bought it', () => {
    expect(estimatedTiles({ costMinor: 22_000_000, boughtOn: '2024-01-05', currency: 'IDR', loan: null }).map((t) => t.label)).toEqual(['Bought for', 'Bought on']);
    const house = estimatedTiles({ costMinor: 1_150_000_000, boughtOn: '2019-03-12', currency: 'IDR', loan: { valueMinor: 1_480_000_000, owedMinor: 500_000_000 } });
    expect(house.map((t) => [t.label, plain(t.value)])).toEqual([
      ['Bought for', 'Rp 1.150.000.000'],
      ['Bought on', '12 Mar 2019'],
      ['Yours', 'Rp 980.000.000'],
      ['Loan left', 'Rp 500.000.000'],
    ]);
  });
});

describe('each purchase on its own', () => {
  const gold = { unitKind: 'grams', lotSize: null, currency: 'IDR', incomeWord: 'Income' } as const;
  it('is valued at today’s price with its own gain or loss, fees counted in its cost', () => {
    const up = tradeLine({ kind: 'buy', occurredOn: '2025-09-19', unitsMicro: 10 * M, grossMinor: 20_395_000, feeMinor: 0 }, { ...gold, priceMicro: 2_485_000 * M });
    expect([up.title, plain(up.subtitle), plain(up.value), plain(up.note ?? ''), up.tone]).toEqual(['Bought 10 g', '19 Sep 2025 · Rp 2.039.500/g', 'Rp 24.850.000', '+Rp 4.455.000', 'gain']);
    const down = tradeLine({ kind: 'buy', occurredOn: '2026-07-11', unitsMicro: 10 * M, grossMinor: 25_900_000, feeMinor: 95_000 }, { ...gold, priceMicro: 2_485_000 * M });
    expect([plain(down.note ?? ''), down.tone]).toEqual(['−Rp 1.145.000', 'loss']);
  });

  it('says a sale and a payment in plain words', () => {
    const income = tradeLine({ kind: 'income', occurredOn: '2026-04-15', unitsMicro: 0, grossMinor: 48_000, feeMinor: 0 }, { ...gold, unitKind: 'shares', lotSize: 100, priceMicro: null, incomeWord: 'Dividend' });
    expect([income.title, income.subtitle, plain(income.value)]).toEqual(['Dividend', '15 Apr 2026', '+Rp 48.000']);
    expect(tradeLine({ kind: 'sell', occurredOn: '2026-05-01', unitsMicro: 5 * M, grossMinor: 12_000_000, feeMinor: 0 }, { ...gold, priceMicro: null }).title).toBe('Sold 5 g');
  });
});

describe('the price line', () => {
  const today = '2026-09-30';
  it('names a world price and a typed one, with the day each is for', () => {
    expect(priceLine({ latest: { onDate: today, source: 'world' }, followsWorld: true, failed: false, today })).toBe('World price (XAU) · 30 Sep 2026');
    expect(priceLine({ latest: { onDate: today, source: 'manual' }, followsWorld: true, failed: false, today })).toBe('Typed · 30 Sep 2026');
  });

  it('keeps an older price when today’s could not be fetched, and says ↻ tries again', () => {
    expect(priceLine({ latest: { onDate: '2026-09-28', source: 'world' }, followsWorld: true, failed: true, today })).toBe('World price (XAU) · 28 Sep 2026 · ↻ to try again');
    // A holding that takes only typed prices never fetches, so it never offers to try again.
    expect(priceLine({ latest: { onDate: '2026-09-28', source: 'manual' }, followsWorld: false, failed: true, today })).toBe('Typed · 28 Sep 2026');
    expect(priceLine({ latest: null, followsWorld: false, failed: false, today })).toBe('No price yet, so it is valued at what was paid');
  });
});

describe('a priced thing’s line', () => {
  const buy = (occurredOn: string, grams: number, grossMinor: number) => ({ id: occurredOn, accountId: 'g', kind: 'buy' as const, occurredOn, unitsMicro: grams * M, grossMinor, feeMinor: 0, taxMinor: 0, createdAt: occurredOn });
  it('values each day at what was held then and the latest price by then, at cost before any price', () => {
    const series = pricedDaySeries([buy('2026-09-27', 10, 20_000_000), buy('2026-09-29', 10, 22_000_000)], [{ onDate: '2026-09-29', priceMicro: 2_400_000 * M }], {
      accountId: 'g',
      currency: 'IDR',
      today: '2026-09-30',
      days: 4,
    });
    expect(series).toEqual([
      { on: '2026-09-26', minor: 0 },
      { on: '2026-09-27', minor: 20_000_000 },
      { on: '2026-09-28', minor: 20_000_000 },
      { on: '2026-09-29', minor: 48_000_000 },
      { on: '2026-09-30', minor: 48_000_000 },
    ]);
  });

  it('reads a month on its last day', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2026-09')).toBe('2026-09-30');
  });
});
