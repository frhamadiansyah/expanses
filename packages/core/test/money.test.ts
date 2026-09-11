import { describe, expect, it } from 'vitest';
import {
  convertMinor,
  currencyInfo,
  formatMinor,
  minorToMajorString,
  MoneyError,
  parseMajor,
  roundHalfAwayFromZero,
  UnknownCurrencyError,
  uuidv7,
} from '../src/index';

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('currencies', () => {
  it('uses product exponents', () => {
    expect(currencyInfo('IDR').exponent).toBe(0);
    expect(currencyInfo('USD').exponent).toBe(2);
    expect(currencyInfo('KWD').exponent).toBe(3);
  });
  it('rejects unknown codes', () => {
    expect(() => currencyInfo('XXX')).toThrow(UnknownCurrencyError);
  });
});

describe('roundHalfAwayFromZero', () => {
  it('rounds halves away from zero and normalizes -0', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(Object.is(roundHalfAwayFromZero(-0.2), 0)).toBe(true);
  });
});

describe('parseMajor', () => {
  it('parses rupiah with thousands separators', () => {
    expect(parseMajor('500.000', 'IDR')).toBe(500000);
    expect(parseMajor('1,250,000', 'IDR')).toBe(1250000);
    expect(parseMajor('75000', 'IDR')).toBe(75000);
  });
  it('parses decimals for 2-exponent currencies with either separator', () => {
    expect(parseMajor('450.50', 'THB')).toBe(45050);
    expect(parseMajor('1.234,56', 'USD')).toBe(123456);
    expect(parseMajor('1,234.5', 'USD')).toBe(123450);
    expect(parseMajor('12', 'USD')).toBe(1200);
  });
  it('treats a 3-digit group as thousands, not decimals', () => {
    expect(parseMajor('1,234', 'USD')).toBe(123400);
  });
  it('handles negatives and rejects junk', () => {
    expect(parseMajor('-20', 'IDR')).toBe(-20);
    expect(() => parseMajor('abc', 'IDR')).toThrow(MoneyError);
    expect(() => parseMajor('', 'IDR')).toThrow(MoneyError);
  });
});

describe('formatting', () => {
  it('formats with currency exponent', () => {
    expect(nbsp(formatMinor(500000, 'IDR'))).toBe('Rp 500.000');
    expect(nbsp(formatMinor(123456, 'USD', 'en-US'))).toBe('$1,234.56');
  });
  it('renders form input strings', () => {
    expect(minorToMajorString(500000, 'IDR')).toBe('500000');
    expect(minorToMajorString(5, 'USD')).toBe('0.05');
    expect(minorToMajorString(-123456, 'USD')).toBe('-1234.56');
  });
});

describe('convertMinor', () => {
  it('converts across exponents', () => {
    // 450.00 THB at 536.49 IDR per THB = 241,420.5 -> 241,421 IDR
    expect(convertMinor(45000, 'THB', 'IDR', 536.49)).toBe(241421);
    // 17,509 IDR at 1/17509 USD per IDR = 1.00 USD
    expect(convertMinor(17509, 'IDR', 'USD', 1 / 17509)).toBe(100);
  });
  it('is identity for same currency and rejects bad rates', () => {
    expect(convertMinor(123, 'IDR', 'IDR', 999)).toBe(123);
    expect(() => convertMinor(1, 'USD', 'IDR', 0)).toThrow(MoneyError);
    expect(() => convertMinor(1.5, 'IDR', 'USD', 1)).toThrow(MoneyError);
  });
});

describe('uuidv7', () => {
  it('produces version-7 variant-10 ids ordered by time', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});
