import { describe, expect, it } from 'vitest';
import { formatPriceMicro, formatUnits, parsePriceMicro, parseUnits, priceMicroFrom, UnitsError, unitsValueMinor } from '../src/index';

describe('units', () => {
  it('reads id-ID grouping and four decimals', () => {
    expect(parseUnits('45.678,1234')).toBe(45_678_123_400);
    expect(parseUnits('3000')).toBe(3_000_000_000);
    expect(parseUnits('0,0001')).toBe(100);
  });

  it('reads a dot as a decimal separator when the group is not three digits', () => {
    expect(parseUnits('3000.5')).toBe(3_000_500_000);
    expect(parseUnits('1.000')).toBe(1_000_000_000);
  });

  it('rejects letters, negatives and more than six decimals', () => {
    for (const bad of ['abc', '', '-5', '1,2345678']) {
      expect(() => parseUnits(bad), bad).toThrow(UnitsError);
    }
  });

  it('trims trailing zeros and groups thousands', () => {
    expect(formatUnits(45_678_123_400)).toBe('45.678,1234');
    expect(formatUnits(32_000_000)).toBe('32');
    expect(formatUnits(100)).toBe('0,0001');
  });

  it('round trips text through parse and format', () => {
    for (const text of ['45.678,1234', '32', '0,0001', '1.000']) {
      expect(formatUnits(parseUnits(text)), text).toBe(text);
    }
  });
});

describe('prices', () => {
  it('keeps two decimals of an IDR fund price exactly', () => {
    expect(parsePriceMicro('1.842,11', 'IDR')).toBe(1_842_110_000);
    expect(parsePriceMicro('1842,11', 'IDR')).toBe(1_842_110_000);
  });

  it('keeps cents of a USD price', () => {
    expect(parsePriceMicro('9.87', 'USD')).toBe(987_000_000);
  });

  it('formats back with the currency symbol', () => {
    expect(formatPriceMicro(1_842_110_000, 'IDR').replace(/\u00a0/g, ' ')).toBe('Rp 1.842,11');
    expect(formatPriceMicro(1_842_000_000_000, 'IDR').replace(/\u00a0/g, ' ')).toBe('Rp 1.842.000');
  });
});

describe('unitsValueMinor', () => {
  it('values 32 g at Rp 1.842.000 a gram', () => {
    expect(unitsValueMinor(32_000_000, 1_842_000_000_000)).toBe(58_944_000);
  });

  it('values fund units at a two-decimal NAV', () => {
    expect(unitsValueMinor(45_678_123_400, 1_842_110_000)).toBe(84_144_128);
  });

  it('rounds half away from zero', () => {
    expect(unitsValueMinor(1_500_000, 1_000_000)).toBe(2);
    expect(unitsValueMinor(500_000, 1_000_000)).toBe(1);
    expect(unitsValueMinor(-1_500_000, 1_000_000)).toBe(-2);
  });

  it('stays exact for amounts far beyond 2^53 before scaling', () => {
    expect(unitsValueMinor(1_000_000_000_000, 9_000_000_000)).toBe(9_000_000_000);
  });
});

describe('priceMicroFrom', () => {
  it('returns the average price of a position', () => {
    expect(priceMicroFrom(58_944_000, 32_000_000)).toBe(1_842_000_000_000);
    expect(priceMicroFrom(10_000_000, 4_000_000)).toBe(2_500_000_000_000);
  });

  it('rejects zero units', () => {
    expect(() => priceMicroFrom(1000, 0)).toThrow(UnitsError);
  });
});

import { formatLots, lotsOf, unitsFromLots } from '../src/index';

describe('lots', () => {
  it('turns shares into lots of a hundred', () => {
    expect(lotsOf(1_200_000_000, 100)).toBe(12);
    expect(lotsOf(150_000_000, 100)).toBe(1.5);
  });

  it('turns lots back into shares', () => {
    expect(unitsFromLots(3, 100)).toBe(300_000_000);
    expect(unitsFromLots(1, 1)).toBe(1_000_000);
  });

  it('counts a US stock in single shares', () => {
    expect(lotsOf(12_000_000, 1)).toBe(12);
    expect(formatLots(12_000_000, 1)).toBe('12 shares');
  });

  it('says both the lots and the shares', () => {
    expect(formatLots(1_200_000_000, 100)).toBe('12 lot (1.200 shares)');
    expect(formatLots(150_000_000, 100)).toBe('1,5 lot (150 shares)');
  });

  it('refuses a negative number of lots', () => {
    expect(() => unitsFromLots(-1, 100)).toThrow(UnitsError);
  });
});
