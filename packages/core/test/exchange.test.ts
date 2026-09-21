import { describe, expect, it } from 'vitest';
import { exchangeCost, impliedRate, sumToBase } from '../src/index';

describe('adding pockets up', () => {
  it('converts each pocket at its own rate and adds them — the mockup’s three pockets', () => {
    // $2,400.00 at 16.250 = 39.000.000; S$1,150.00 at 12.680 = 14.582.000; Rp 5.400.000 as it is.
    expect(
      sumToBase({
        amounts: [
          { minor: 240_000, currency: 'USD' },
          { minor: 115_000, currency: 'SGD' },
          { minor: 5_400_000, currency: 'IDR' },
        ],
        baseCurrency: 'IDR',
        ratesToBase: { USD: 16_250, SGD: 12_680 },
      }),
    ).toEqual({ totalMinor: 58_982_000, missing: [] });
  });

  it('gives no total when one rate is missing, and names it', () => {
    const got = sumToBase({
      amounts: [
        { minor: 240_000, currency: 'USD' },
        { minor: 115_000, currency: 'SGD' },
        { minor: 5_400_000, currency: 'IDR' },
      ],
      baseCurrency: 'IDR',
      ratesToBase: { USD: 16_250 },
    });
    // Not 44.400.000 (the SGD pocket dropped) and not 44.515.000 (its minor units added as rupiah).
    expect(got).toEqual({ totalMinor: null, missing: ['SGD'] });
  });

  it('subtracts an overdrawn pocket rather than adding it', () => {
    // −$10.00 at 16.000 is −160.000; with Rp 1.000.000 that is 840.000. Absolute values would say 1.160.000.
    expect(
      sumToBase({ amounts: [{ minor: -1_000, currency: 'USD' }, { minor: 1_000_000, currency: 'IDR' }], baseCurrency: 'IDR', ratesToBase: { USD: 16_000 } }),
    ).toEqual({ totalMinor: 840_000, missing: [] });
  });

  it('rounds each conversion half away from zero, not down', () => {
    // $1.03 at 15.940,37 = 16.418,5811 → 16.419. Flooring gives 16.418.
    expect(sumToBase({ amounts: [{ minor: 103, currency: 'USD' }], baseCurrency: 'IDR', ratesToBase: { USD: 15_940.37 } }).totalMinor).toBe(16_419);
  });

  it('refuses a total past 2^53 rather than rounding it', () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    expect(() => sumToBase({ amounts: [{ minor: big, currency: 'IDR' }, { minor: big, currency: 'IDR' }], baseCurrency: 'IDR', ratesToBase: {} })).toThrow('safe integer');
  });

  it('needs no rate for the base currency itself', () => {
    expect(sumToBase({ amounts: [{ minor: 5_400_000, currency: 'IDR' }], baseCurrency: 'IDR', ratesToBase: {} })).toEqual({ totalMinor: 5_400_000, missing: [] });
  });
});

describe('what the bank’s rate cost', () => {
  it('is what left minus what arrived, both at the day’s rate — the mockup’s $500 → S$638', () => {
    expect(
      exchangeCost({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: { USD: 16_250, SGD: 12_680 } }),
    ).toEqual({ fromBaseMinor: 8_125_000, toBaseMinor: 8_089_840, costMinor: 35_160 });
  });

  it('is negative when the bank gave more than the day’s rate', () => {
    expect(
      exchangeCost({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 65_000, toCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: { USD: 16_250, SGD: 12_680 } })!.costMinor,
    ).toBe(-117_000);
  });

  it('reads each side at its own exponent — USD (2) into IDR (0)', () => {
    // $100.50 at 16.250 = 1.633.125; Rp 1.630.000 arrived; 3.125 lost. Reading 10050 as rupiah would say 1.619.950 gained.
    expect(exchangeCost({ fromMinor: 10_050, fromCurrency: 'USD', toMinor: 1_630_000, toCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: { USD: 16_250 } })).toEqual({
      fromBaseMinor: 1_633_125,
      toBaseMinor: 1_630_000,
      costMinor: 3_125,
    });
  });

  it('reads three decimals for KWD', () => {
    // KWD 1.234 at 53.000,7 = 65.402,8638 → 65.403.
    expect(exchangeCost({ fromMinor: 1_234, fromCurrency: 'KWD', toMinor: 65_000, toCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: { KWD: 53_000.7 } })!.costMinor).toBe(403);
  });

  it('is unknown without both rates', () => {
    expect(exchangeCost({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: { USD: 16_250 } })).toBeNull();
  });
});

describe('the bank’s rate', () => {
  it('is what arrived per unit that left, in major units', () => {
    expect(impliedRate({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD' })).toBeCloseTo(1.276, 10);
    expect(impliedRate({ fromMinor: 10_050, fromCurrency: 'USD', toMinor: 1_630_000, toCurrency: 'IDR' })).toBeCloseTo(16_218.905472, 5);
    // Reading KWD at two decimals would give 5.267,42 — ten times too small.
    expect(impliedRate({ fromMinor: 1_234, fromCurrency: 'KWD', toMinor: 65_000, toCurrency: 'IDR' })).toBeCloseTo(52_674.230146, 5);
  });

  it('is unknown until both figures are more than zero', () => {
    expect(impliedRate({ fromMinor: 0, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD' })).toBeNull();
    expect(impliedRate({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 0, toCurrency: 'SGD' })).toBeNull();
  });
});
