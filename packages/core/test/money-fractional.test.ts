import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MoneyError, parseFractionalMajor, parseMajor, wholeFromHundredths } from '../src/index';

const run = { numRuns: 400, seed: 20261014 } as const;

/** Thousands marks the Indonesian way: "12.500". */
const dotted = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** Thousands marks the English way: "12,500". */
const commaed = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

describe('parseFractionalMajor on a currency with no minor unit', () => {
  it('rounds an expense up and an income down, and keeps the exact figure in hundredths', () => {
    expect(parseFractionalMajor('12.500,30', 'IDR', 'up')).toEqual({ minor: 12_501, exactHundredths: 1_250_030 });
    expect(parseFractionalMajor('12.500,30', 'IDR', 'down')).toEqual({ minor: 12_500, exactHundredths: 1_250_030 });
    expect(parseFractionalMajor('12,345.67', 'IDR', 'down')).toEqual({ minor: 12_345, exactHundredths: 1_234_567 });
    expect(parseFractionalMajor('12345,6', 'IDR', 'up')).toEqual({ minor: 12_346, exactHundredths: 1_234_560 });
    expect(parseFractionalMajor('0,30', 'IDR', 'up')).toEqual({ minor: 1, exactHundredths: 30 });
    expect(parseFractionalMajor('0,30', 'IDR', 'down')).toEqual({ minor: 0, exactHundredths: 30 });
  });

  it('gives no exact figure when the fraction is zero or absent', () => {
    expect(parseFractionalMajor('12.500', 'IDR', 'up')).toEqual({ minor: 12_500, exactHundredths: null });
    expect(parseFractionalMajor('12.500,00', 'IDR', 'up')).toEqual({ minor: 12_500, exactHundredths: null });
    expect(parseFractionalMajor('12500', 'IDR', 'down')).toEqual({ minor: 12_500, exactHundredths: null });
  });

  it('reads the same separators parseMajor reads: a three-digit group is thousands', () => {
    expect(parseFractionalMajor('12.500', 'IDR', 'up').minor).toBe(parseMajor('12.500', 'IDR'));
    expect(parseFractionalMajor('1,234,567', 'IDR', 'up').minor).toBe(parseMajor('1,234,567', 'IDR'));
  });

  it('rounds the magnitude of a negative figure and keeps the exact figure positive', () => {
    expect(parseFractionalMajor('-12.500,30', 'IDR', 'up')).toEqual({ minor: -12_501, exactHundredths: 1_250_030 });
    expect(parseFractionalMajor('-12.500,30', 'IDR', 'down')).toEqual({ minor: -12_500, exactHundredths: 1_250_030 });
  });

  it('treats JPY and KRW the same way, by exponent rather than by name', () => {
    expect(parseFractionalMajor('1,250.50', 'JPY', 'up')).toEqual({ minor: 1_251, exactHundredths: 125_050 });
    expect(parseFractionalMajor('1,250.50', 'KRW', 'down')).toEqual({ minor: 1_250, exactHundredths: 125_050 });
  });

  it('throws MoneyError on what parseMajor refuses', () => {
    expect(() => parseFractionalMajor('abc', 'IDR', 'up')).toThrow(MoneyError);
    expect(() => parseFractionalMajor('', 'IDR', 'up')).toThrow(MoneyError);
    expect(() => parseFractionalMajor('12,5a', 'IDR', 'up')).toThrow(MoneyError);
  });

  it('property: minor is the ceiling (up) or floor (down) of the exact figure', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000_000 }), fc.integer({ min: 0, max: 99 }), fc.boolean(), fc.boolean(), (whole, cents, indonesian, up) => {
        const text = indonesian ? `${dotted(whole)},${String(cents).padStart(2, '0')}` : `${commaed(whole)}.${String(cents).padStart(2, '0')}`;
        const exact = whole * 100 + cents;
        const result = parseFractionalMajor(text, 'IDR', up ? 'up' : 'down');
        expect(result.minor).toBe(up ? Math.ceil(exact / 100) : Math.floor(exact / 100));
        expect(result.exactHundredths).toBe(cents === 0 ? null : exact);
      }),
      run,
    );
  });

  it('property: a whole figure gives the same minor as parseMajor and no exact figure', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000_000 }), fc.constantFrom(dotted, commaed, String), fc.boolean(), (whole, write, up) => {
        const text = write(whole);
        expect(parseFractionalMajor(text, 'IDR', up ? 'up' : 'down')).toEqual({ minor: parseMajor(text, 'IDR'), exactHundredths: null });
      }),
      run,
    );
  });
});

describe('parseFractionalMajor on a currency with decimals', () => {
  it('behaves exactly like parseMajor', () => {
    expect(parseFractionalMajor('10.50', 'USD', 'up')).toEqual({ minor: 1050, exactHundredths: null });
    expect(parseFractionalMajor('1.234,56', 'EUR', 'down')).toEqual({ minor: 123_456, exactHundredths: null });
    expect(() => parseFractionalMajor('10.505', 'USD', 'up')).not.toThrow();
    expect(parseFractionalMajor('10.505', 'USD', 'up').minor).toBe(parseMajor('10.505', 'USD'));
  });

  it('property: same minor as parseMajor for any cents, either direction, never an exact figure', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000_000 }), fc.boolean(), (cents, up) => {
        const text = `${commaed(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, '0')}`;
        expect(parseFractionalMajor(text, 'USD', up ? 'up' : 'down')).toEqual({ minor: cents, exactHundredths: null });
      }),
      run,
    );
  });
});

describe('wholeFromHundredths', () => {
  it('rounds the magnitude up or down and keeps the sign', () => {
    expect(wholeFromHundredths(1_250_030, 'up')).toBe(12_501);
    expect(wholeFromHundredths(1_250_030, 'down')).toBe(12_500);
    expect(wholeFromHundredths(-1_250_030, 'up')).toBe(-12_501);
    expect(wholeFromHundredths(-1_250_030, 'down')).toBe(-12_500);
    expect(wholeFromHundredths(1_250_000, 'up')).toBe(12_500);
    expect(Object.is(wholeFromHundredths(-30, 'down'), 0)).toBe(true);
  });

  it('property: stays exact near the top of the safe range, where a float division would not', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (n) => {
        const big = BigInt(n);
        expect(BigInt(wholeFromHundredths(n, 'down'))).toBe(big / 100n);
        expect(BigInt(wholeFromHundredths(n, 'up'))).toBe((big + 99n) / 100n);
      }),
      run,
    );
  });
});
