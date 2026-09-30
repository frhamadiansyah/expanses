import { describe, expect, it } from 'vitest';
import { brokerFeeDefaults, DEFAULT_BROKER_FEES, idxCharge, idxTickSize, isIdxTick, parsePercentPpm, ppmOf, ppmPercent, stepIdxPrice } from '../src/index';

describe('IDX’s price steps', () => {
  it('are 1, 2, 5, 10 and 25 rupiah by band', () => {
    expect([199, 200, 499, 500, 1_995, 2_000, 4_990, 5_000, 6_150].map(idxTickSize)).toEqual([1, 2, 2, 5, 5, 10, 10, 25, 25]);
    expect(isIdxTick(6_150)).toBe(true);
    expect(isIdxTick(6_160)).toBe(false);
    expect(isIdxTick(4_990)).toBe(true);
    expect(isIdxTick(0)).toBe(false);
  });

  it('step a price up and down, across a band’s edge, and onto a step from between two', () => {
    expect(stepIdxPrice(6_150, 1)).toBe(6_175);
    expect(stepIdxPrice(6_150, -1)).toBe(6_125);
    expect(stepIdxPrice(5_000, -1)).toBe(4_990);
    expect(stepIdxPrice(4_990, 1)).toBe(5_000);
    expect(stepIdxPrice(200, -1)).toBe(199);
    expect(stepIdxPrice(6_160, 1)).toBe(6_175);
    expect(stepIdxPrice(6_160, -1)).toBe(6_150);
    expect(stepIdxPrice(1, -1)).toBe(1);
  });
});

describe('a broker’s fee', () => {
  const stockbit = brokerFeeDefaults('Stockbit');
  const mandiri = brokerFeeDefaults('Mandiri Sekuritas');

  it('starts from the broker’s own rates, and 0,15% / 0,25% for any other', () => {
    expect(stockbit).toEqual({ buyPpm: 1_500, sellPpm: 2_500, minDailyMinor: null });
    expect(mandiri).toEqual({ buyPpm: 1_800, sellPpm: 2_800, minDailyMinor: 5_000 });
    expect(brokerFeeDefaults('Mirae')).toEqual({ buyPpm: 1_500, sellPpm: 2_500, minDailyMinor: null });
    expect(brokerFeeDefaults('My broker')).toEqual(DEFAULT_BROKER_FEES);
  });

  it('rounds to the whole rupiah, a half up', () => {
    expect(ppmOf(1_230_000, 1_500)).toBe(1_845);
    expect(ppmOf(3_087_500, 2_500)).toBe(7_719); // 7.718,75
    expect(ppmOf(1_000, 1_500)).toBe(2); // 1,5
  });

  it('adds to a buy: 2 lots at 6.150', () => {
    expect(idxCharge({ kind: 'buy', grossMinor: 1_230_000, fees: stockbit, etf: false, chargedTodayMinor: 0 })).toEqual({
      feeMinor: 1_845, taxMinor: 0, ratePpm: 1_500, minimumApplied: false, totalMinor: 1_231_845,
    });
  });

  it('comes off a sale, with the 0,1% final tax inside it', () => {
    expect(idxCharge({ kind: 'sell', grossMinor: 3_087_500, fees: stockbit, etf: false, chargedTodayMinor: 0 })).toEqual({
      feeMinor: 4_631, taxMinor: 3_088, ratePpm: 2_500, minimumApplied: false, totalMinor: 3_079_781,
    });
  });

  it('sells an ETF without the final tax, 0,1% cheaper', () => {
    expect(idxCharge({ kind: 'sell', grossMinor: 1_000_000, fees: stockbit, etf: true, chargedTodayMinor: 0 })).toEqual({
      feeMinor: 1_500, taxMinor: 0, ratePpm: 1_500, minimumApplied: false, totalMinor: 998_500,
    });
  });

  it('meets a daily minimum across the day’s trades at that broker, never going below the rate', () => {
    // A small buy: 0,18% of 500.000 is 900, the minimum takes it to 5.000.
    expect(idxCharge({ kind: 'buy', grossMinor: 500_000, fees: mandiri, etf: false, chargedTodayMinor: 0 })).toMatchObject({ feeMinor: 5_000, minimumApplied: true, totalMinor: 505_000 });
    // 3.000 already charged that day: 2.000 more reaches it.
    expect(idxCharge({ kind: 'buy', grossMinor: 500_000, fees: mandiri, etf: false, chargedTodayMinor: 3_000 })).toMatchObject({ feeMinor: 2_000, minimumApplied: true });
    // Already met: the rate alone.
    expect(idxCharge({ kind: 'buy', grossMinor: 500_000, fees: mandiri, etf: false, chargedTodayMinor: 6_000 })).toMatchObject({ feeMinor: 900, minimumApplied: false });
    // A big trade's rate is above the minimum anyway.
    expect(idxCharge({ kind: 'buy', grossMinor: 10_000_000, fees: mandiri, etf: false, chargedTodayMinor: 0 })).toMatchObject({ feeMinor: 18_000, minimumApplied: false });
    // A small sale: the minimum is what is charged, the final tax still its 0,1% of it.
    expect(idxCharge({ kind: 'sell', grossMinor: 500_000, fees: mandiri, etf: false, chargedTodayMinor: 0 })).toEqual({ feeMinor: 4_500, taxMinor: 500, ratePpm: 2_800, minimumApplied: true, totalMinor: 495_000 });
  });

  it('reads and writes a rate as a percentage', () => {
    expect(parsePercentPpm('0,15')).toBe(1_500);
    expect(parsePercentPpm('0.28%')).toBe(2_800);
    expect(parsePercentPpm('0,1513')).toBe(1_513);
    expect(() => parsePercentPpm('abc')).toThrow(/percentage/);
    expect(ppmPercent(1_500)).toBe('0,15%');
    expect(ppmPercent(1_513)).toBe('0,1513%');
  });
});
