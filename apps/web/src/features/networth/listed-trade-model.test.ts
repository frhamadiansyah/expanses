import { describe, expect, it } from 'vitest';
import { feeRowText as rawFeeRowText, lotsText, workedOut } from './listed-trade-model';

// The money format joins Rp to the figure with a no-break space.
const feeRowText = (o: Parameters<typeof rawFeeRowText>[0]) => rawFeeRowText(o).replace(/\s/g, ' ');

describe('workedOut', () => {
  const charge = { feeMinor: 1_853, taxMinor: 0 };
  it('is the broker’s charge for a trade made now', () => {
    expect(workedOut(false, charge)).toEqual(charge);
    expect(workedOut(false, null)).toBeNull();
  });
  it('is no fee and no tax for a past purchase or sale, whatever the broker charges', () => {
    expect(workedOut(true, charge)).toEqual({ feeMinor: 0, taxMinor: 0 });
    expect(workedOut(true, { feeMinor: 2_600, taxMinor: 1_040 })).toEqual({ feeMinor: 0, taxMinor: 0 });
    expect(workedOut(true, null)).toEqual({ feeMinor: 0, taxMinor: 0 });
  });
});

describe('feeRowText', () => {
  it('reads the rate first, then the amount', () => {
    expect(feeRowText({ past: false, typed: false, chargedMinor: 2_500, ratePpm: 1_500, currency: 'IDR' })).toBe('0,15% · Rp 2.500');
  });
  it('reads just the amount once one is typed', () => {
    expect(feeRowText({ past: false, typed: true, chargedMinor: 3_000, ratePpm: 1_500, currency: 'IDR' })).toBe('Rp 3.000');
  });
  it('reads None for a past trade, until a fee is typed', () => {
    expect(feeRowText({ past: true, typed: false, chargedMinor: 0, ratePpm: null, currency: 'IDR' })).toBe('None');
    expect(feeRowText({ past: true, typed: true, chargedMinor: 3_000, ratePpm: null, currency: 'IDR' })).toBe('Rp 3.000');
  });
});

describe('lotsText', () => {
  it('names the lots and the shares they make', () => {
    expect(lotsText(1, 100)).toBe('1 lot · 100 shares');
    expect(lotsText(2, 100)).toBe('2 lots · 200 shares');
  });
});
