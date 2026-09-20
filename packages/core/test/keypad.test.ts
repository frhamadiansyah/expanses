import { describe, expect, it } from 'vitest';
import { evaluateAmount, parseMajor } from '../src/index';

/*
 * Every figure the keypad reads is read by `parseMajor`, which is separator-agnostic: the last "." or "," followed
 * by 1..exponent digits is the decimal, every other one groups thousands. This file never states a second opinion
 * about separators — the first test below is the contract, and the rest are arithmetic on top of it.
 */
describe('what DONE works out', () => {
  // A single figure is exactly what the rest of the app would make of it. This is the whole of the convention:
  // if `evaluateAmount` and `parseMajor` ever part company, this test is the one that says so.
  it.each([
    ['85000', 'IDR'],
    ['85.000', 'IDR'],
    ['85,000', 'IDR'],
    ['1.234.567', 'IDR'],
    ['10.50', 'USD'],
    ['10,50', 'USD'],
    ['1,234.56', 'USD'],
    ['1.234,56', 'USD'],
    ['120', 'JPY'],
  ])('reads %s (%s) exactly as parseMajor does', (typed, currency) => {
    expect(evaluateAmount(typed, currency)).toBe(parseMajor(typed, currency));
  });

  it('adds and subtracts', () => {
    expect(evaluateAmount('120000+35000', 'IDR')).toBe(155_000);
    expect(evaluateAmount('100000−25000', 'IDR')).toBe(75_000);
    expect(evaluateAmount('100000-25000', 'IDR')).toBe(75_000);
    // Each operand is read by parseMajor, so a grouped figure adds up the same as a bare one.
    expect(evaluateAmount('120.000+35.000', 'IDR')).toBe(155_000);
    expect(evaluateAmount('10.50+2.25', 'USD')).toBe(1275);
  });

  it('multiplies and divides by a plain count, before it adds', () => {
    expect(evaluateAmount('85000×3', 'IDR')).toBe(255_000);
    expect(evaluateAmount('85000*3', 'IDR')).toBe(255_000);
    expect(evaluateAmount('450000÷4', 'IDR')).toBe(112_500);
    expect(evaluateAmount('10000+2000×3', 'IDR')).toBe(16_000);
    // The count is a count, not money: "3" after × is three of them, whatever the currency's exponent.
    expect(evaluateAmount('10.50×3', 'USD')).toBe(3150);
  });

  it('refuses a count that is not a whole number, rather than guessing what it meant', () => {
    expect(evaluateAmount('85000×2.5', 'IDR')).toBeNull();
    expect(evaluateAmount('85000÷1,5', 'IDR')).toBeNull();
  });

  it('rounds to the currency, away from zero', () => {
    expect(evaluateAmount('100÷3', 'IDR')).toBe(33);
    expect(evaluateAmount('10.00÷3', 'USD')).toBe(333);
    // 5÷2 = 2.5 exactly: floor would give 2, but "away from zero" rounds a true half up to 3.
    expect(evaluateAmount('5÷2', 'IDR')).toBe(3);
  });

  it('gives nothing back when it cannot be read, so the row keeps what it had', () => {
    expect(evaluateAmount('', 'IDR')).toBeNull();
    expect(evaluateAmount('85000+', 'IDR')).toBeNull();
    expect(evaluateAmount('abc', 'IDR')).toBeNull();
    expect(evaluateAmount('85000÷0', 'IDR')).toBeNull();
    // parseMajor throws on a figure with more decimals than the currency allows; DONE turns that into "not read"
    // rather than letting a MoneyError out of a keypad. (`parseMajor('100,50', 'IDR')` throws: IDR has no cents.)
    expect(() => parseMajor('100,50', 'IDR')).toThrow();
    expect(evaluateAmount('100,50', 'IDR')).toBeNull();
    // An amount is never negative: the sign is the mode, not the figure.
    expect(evaluateAmount('25000−85000', 'IDR')).toBeNull();
    expect(evaluateAmount('0', 'IDR')).toBeNull();
  });
});
