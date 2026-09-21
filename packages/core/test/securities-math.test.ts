import { describe, expect, it } from 'vitest';
import { formatBps, gainBps, percentShares, portfolioSummary, positionAfter, positionInBase, type TradeRecord } from '../src/index';

const t = (id: string, kind: TradeRecord['kind'], occurredOn: string, shares: number, grossMinor: number): TradeRecord => ({
  id, accountId: 'aapl', kind, occurredOn, createdAt: `${occurredOn}T00:00:00Z`, unitsMicro: shares * 1_000_000, grossMinor, feeMinor: 0, taxMinor: 0,
});

describe('positionInBase', () => {
  // Two buys at two rates, then 4 of 15 shares sold. 4/15 is not a .25/.5/.75 fraction, so a floor, a round and a
  // wrong proportion all give different figures here.
  const trades = [
    t('b1', 'buy', '2025-03-08', 10, 182_500), // $1,825.00 at 15.800 → Rp 28.835.000
    t('b2', 'buy', '2026-01-21', 5, 107_035), //  $1,070.35 at 16.100 → Rp 17.232.635
    t('s1', 'sell', '2026-06-01', 4, 90_000),
    { ...t('d1', 'income', '2026-07-01', 0, 5_000) },
  ];
  const base = { b1: 28_835_000, b2: 17_232_635 };

  it('keeps each buy at its own day’s base cost, and a sell takes its average share of it', () => {
    const position = positionInBase(trades, base);
    expect(position.unitsMicro).toBe(11_000_000);
    expect(position.costMinor).toBe(33_782_932); // 46.067.635 − divRound(46.067.635 × 4, 15)
    expect(position.byYear).toEqual({
      '2025': { unitsMicro: 7_333_333, costMinor: 21_145_666 },
      '2026': { unitsMicro: 3_666_667, costMinor: 12_637_266 },
    });
  });

  it('is not the native cost, nor the native cost at any single rate', () => {
    const native = positionAfter(trades);
    // Cents: what the old report wrongly filed as rupiah. 289.535 − divRound(289.535 × 4, 15) = 289.535 − 77.209.
    expect(native.costMinor).toBe(212_326);
    expect(positionInBase(trades, base).costMinor).not.toBe(Math.round((native.costMinor / 100) * 16_300));
  });

  it('stops at upTo, and refuses a buy it has no base cost for rather than counting it as nothing', () => {
    expect(positionInBase(trades, base, '2025-12-31').byYear).toEqual({ '2025': { unitsMicro: 10_000_000, costMinor: 28_835_000 } });
    expect(() => positionInBase(trades, { b1: 28_835_000 })).toThrow(/b2/);
  });
});

describe('percentShares', () => {
  it('floors each share and gives what is left to the largest part', () => {
    // 70,32 · 18,11 · 11,57: rounding would say 70/18/12, largest-remainder 70/18/12; the rule says 71/18/11.
    expect(percentShares([60_251_750, 15_515_000, 9_915_500])).toEqual([71, 18, 11]);
  });
  it('adds up to 100, and is all zeros when there is nothing', () => {
    expect(percentShares([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(percentShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentShares([0, 0])).toEqual([0, 0]);
    expect(percentShares([])).toEqual([]);
  });

  it('divides exactly where plain float division does not: 390.000.000.000.117 is exactly 39% of 1.000.000.000.000.300', () => {
    // part * 100 is 39.000.000.000.011.700 — past 2^53, so it is no longer the nearest double to the exact
    // integer. Number(prod) / total then lands on 38,999999999999992895, and Math.floor reads it as 38, not 39.
    // Only exact BigInt division gets this right. The second part (the largest) is also an exact percentage
    // (61%), so the largest-remainder correction adds nothing and cannot hide a wrong first share.
    expect(percentShares([390_000_000_000_117, 610_000_000_000_183])).toEqual([39, 61]);
  });
});

describe('gainBps and formatBps', () => {
  it('is signed basis points of cost, half away from zero', () => {
    expect(gainBps(85_682_250, 78_008_060)).toBe(984);
    expect(gainBps(5_740_000, 6_200_000)).toBe(-742);
    expect(gainBps(100, 0)).toBeNull();
  });
  it('reads one decimal, half away from zero, with a real minus sign', () => {
    expect(formatBps(984)).toBe('+9,8%');
    expect(formatBps(985)).toBe('+9,9%'); // 98,5 tenths → 99, not 98
    expect(formatBps(-742)).toBe('−7,4%');
    expect(formatBps(-745)).toBe('−7,5%');
    expect(formatBps(0)).toBe('0,0%');
  });
});

describe('portfolioSummary', () => {
  // The mockup's portfolio, figure for figure.
  const holdings = [
    { currency: 'USD', valueMinor: 214_300, costMinor: 182_500, costBaseMinor: 28_835_000 }, // AAPL
    { currency: 'USD', valueMinor: 156_480, costMinor: 149_460, costBaseMinor: 24_063_060 }, // VOO
    { currency: 'IDR', valueMinor: 9_775_000, costMinor: 8_750_000, costBaseMinor: 8_750_000 }, // BBCA · Stockbit
    { currency: 'IDR', valueMinor: 4_887_500, costMinor: 4_700_000, costBaseMinor: 4_700_000 }, // BBCA · Mandiri
    { currency: 'IDR', valueMinor: 5_740_000, costMinor: 6_200_000, costBaseMinor: 6_200_000 }, // TLKM
    { currency: 'IDR', valueMinor: 5_028_000, costMinor: 5_460_000, costBaseMinor: 5_460_000 }, // BBRI
  ];

  it('totals in base, and names the part that is the exchange rate moving', () => {
    expect(portfolioSummary(holdings, 'IDR', { USD: 16_250 })).toEqual({
      valueBaseMinor: 85_682_250,
      costBaseMinor: 78_008_060,
      gainBaseMinor: 7_674_190,
      gainBps: 984,
      currencyMoveMinor: 1_199_070, // 60.251.750 at today’s rate − 59.052.680 at the rates bought at
      converted: true,
      missingRates: [],
    });
  });

  it('gives a negative move when the base currency strengthened, summed signed', () => {
    expect(portfolioSummary(holdings.slice(0, 2), 'IDR', { USD: 15_000 }).currencyMoveMinor).toBe(
      (32_145_000 - 33_859_400) + (23_472_000 - 25_193_280),
    );
  });

  it('refuses a total it has no rate for, as sumToBase does: no figure and the currency named, never the rest summed', () => {
    // The first draft summed the rupiah holdings alone (25.430.500) — exactly the partial total sumToBase exists to refuse.
    expect(portfolioSummary(holdings, 'IDR', {})).toEqual({
      valueBaseMinor: null,
      costBaseMinor: 78_008_060, // what was put in is pinned in base, so it is known without today's rate
      gainBaseMinor: null,
      gainBps: null,
      currencyMoveMinor: null,
      converted: true,
      missingRates: ['USD'],
    });
  });

  it('leaves what was put in unknown when a foreign holding has no base cost — never a silent zero', () => {
    const unknown = { currency: 'USD', valueMinor: 214_300, costMinor: 182_500, costBaseMinor: null };
    expect(portfolioSummary([unknown, holdings[2]!], 'IDR', { USD: 16_250 })).toEqual({
      valueBaseMinor: 34_823_750 + 9_775_000, // the value needs today's rate only, so it is known
      costBaseMinor: null,
      gainBaseMinor: null,
      gainBps: null,
      currencyMoveMinor: null,
      converted: true,
      missingRates: [],
    });
  });

  it('needs no rate for a foreign holding worth nothing, as sumToBase does', () => {
    const summary = portfolioSummary([{ currency: 'USD', valueMinor: 0, costMinor: 0, costBaseMinor: 0 }, holdings[4]!], 'IDR', {});
    expect(summary).toMatchObject({ valueBaseMinor: 5_740_000, missingRates: [], converted: false, currencyMoveMinor: 0 });
  });

  it('keeps the at-cost-rates line exact past 2^53, where value × costBase alone is Rp 800+ triliun', () => {
    // 883.735.873 × 915.152.478 = 809.007…×10^15, well past Number.MAX_SAFE_INTEGER (2^53 ≈ 9,007×10^15) — an
    // entirely ordinary foreign holding's value times its base cost, not a whale scenario. Chosen so a plain
    // Number multiply-then-round actually gives a different integer (2.272.582.639.006) than exact BigInt
    // division (2.272.582.639.005), not merely one that happens to still round the same by luck.
    const holding = { currency: 'USD', valueMinor: 883_735_873, costMinor: 355_874, costBaseMinor: 915_152_478 };
    expect(Number.isSafeInteger(holding.valueMinor * holding.costBaseMinor)).toBe(false);
    const summary = portfolioSummary([holding], 'IDR', { USD: 16_000 });
    expect(summary).toMatchObject({
      valueBaseMinor: 141_397_739_680,
      costBaseMinor: 915_152_478,
      gainBaseMinor: 140_482_587_202,
      currencyMoveMinor: -2_131_184_899_325, // 141.397.739.680 − 2.272.582.639.005 (the exact at-cost-rates figure)
    });
  });
});
