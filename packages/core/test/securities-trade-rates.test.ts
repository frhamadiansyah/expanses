import { describe, expect, it } from 'vitest';
import { convertMinor, perUnitInBase, rateFromAmounts, taxHoldingName, tradeCashMinor, type TradeInput, tradeRateNeeds } from '../src/index';

describe('tradeRateNeeds', () => {
  it('asks nothing when all of it is base', () => {
    expect(tradeRateNeeds('IDR', 'IDR', 'IDR')).toEqual({ charged: false, derived: null, dayRates: [] });
  });
  it('asks the day’s rate for a foreign holding paid from the same currency', () => {
    expect(tradeRateNeeds('USD', 'USD', 'IDR')).toEqual({ charged: false, derived: null, dayRates: ['USD'] });
  });
  it('works the rate out from the two amounts when one side is base', () => {
    expect(tradeRateNeeds('USD', 'IDR', 'IDR')).toEqual({ charged: true, derived: 'USD', dayRates: [] });
    expect(tradeRateNeeds('IDR', 'USD', 'IDR')).toEqual({ charged: true, derived: 'USD', dayRates: [] });
  });
  it('needs both day rates when neither side is base', () => {
    expect(tradeRateNeeds('USD', 'SGD', 'IDR')).toEqual({ charged: true, derived: null, dayRates: ['SGD', 'USD'] });
  });
});

describe('rateFromAmounts', () => {
  it('is base per one major unit, and converts back to exactly what was charged', () => {
    expect(rateFromAmounts(182_500, 'USD', 28_835_000, 'IDR')).toBe(15_800);
    // Non-round on purpose: $1,234.57 that cost Rp 20.000.001.
    const rate = rateFromAmounts(123_457, 'USD', 20_000_001, 'IDR');
    expect(convertMinor(123_457, 'USD', 'IDR', rate)).toBe(20_000_001);
  });
  it('respects each currency’s exponent', () => {
    expect(rateFromAmounts(1_000, 'KWD', 53_000_000, 'IDR')).toBe(53_000_000); // 1,000 KWD
    const jpy = rateFromAmounts(10_000, 'JPY', 1_070_000, 'IDR'); // ¥10.000 for Rp 1.070.000
    expect(jpy).toBe(107);
    const toUsd = rateFromAmounts(16_250_000, 'IDR', 100_000, 'USD');
    expect(convertMinor(16_250_000, 'IDR', 'USD', toUsd)).toBe(100_000);
  });
  it('refuses nothing for something', () => {
    expect(() => rateFromAmounts(0, 'USD', 1, 'IDR')).toThrow();
    expect(() => rateFromAmounts(1, 'USD', 0, 'IDR')).toThrow();
  });
});

describe('tradeCashMinor', () => {
  const trade = (kind: TradeInput['kind'], grossMinor: number, feeMinor: number, taxMinor: number): TradeInput => ({ kind, occurredOn: '2026-03-08', unitsMicro: 3_000_000, grossMinor, feeMinor, taxMinor });
  it('is what tradePostings moves through the cash account — read off the postings, not restated', () => {
    expect(tradeCashMinor(trade('buy', 1_000, 15, 3))).toBe(1_018);
    expect(tradeCashMinor(trade('sell', 1_000, 15, 3))).toBe(982);
    expect(tradeCashMinor(trade('income', 1_000, 15, 3))).toBe(997); // an income carries no fee
    expect(tradeCashMinor({ ...trade('unit_change', 0, 0, 0) })).toBe(0);
  });
  it('is nothing for a sell whose fees ate the proceeds, never a negative amount to derive a rate from', () => {
    expect(tradeCashMinor(trade('sell', 1_000, 900, 200))).toBe(0);
  });
});

describe('perUnitInBase', () => {
  it('is one major unit in base minor units', () => {
    expect(perUnitInBase(15_800, 'USD', 'IDR')).toBe(15_800);
    expect(perUnitInBase(16_199.97, 'USD', 'IDR')).toBe(16_200);
  });
});

describe('taxHoldingName', () => {
  const bbca = { ticker: 'BBCA', name: 'Bank Central Asia Tbk.', kind: 'share' as const };
  it('names a share by ticker and the broker', () => {
    expect(taxHoldingName(bbca, 'Stockbit', 'BBCA · Stockbit')).toBe('Saham BBCA — Stockbit');
    expect(taxHoldingName(bbca, null, 'BBCA')).toBe('Saham BBCA');
  });
  it('names anything else by its name', () => {
    expect(taxHoldingName({ ticker: 'VOO', name: 'Vanguard S&P 500 ETF', kind: 'etf' }, 'Interactive Brokers', 'x')).toBe('Vanguard S&P 500 ETF — Interactive Brokers');
    expect(taxHoldingName({ ticker: null, name: 'Private fund', kind: 'other' }, null, 'x')).toBe('Private fund');
  });
  it('keeps the account’s name when there is no security', () => {
    expect(taxHoldingName(null, 'Stockbit', 'Antam gold bars')).toBe('Antam gold bars');
  });
});
