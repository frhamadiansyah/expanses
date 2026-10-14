import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluateAmount, evaluateExact, parseFractionalMajor, parseMajor } from '../src/index';

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

describe('a refund typed with a leading minus', () => {
  it('reads a leading minus as a refund only when the caller allows one', () => {
    expect(evaluateAmount('−450000', 'IDR', { refund: true })).toBe(-450_000);
    expect(evaluateAmount('-450.000', 'IDR', { refund: true })).toBe(-450_000);
    // Without the option a leading minus is refused, as before: Income, Transfer and split lines.
    expect(evaluateAmount('−450000', 'IDR')).toBeNull();
    expect(evaluateAmount('−450000', 'IDR', { refund: false })).toBeNull();
  });

  it('works out an expression after the minus', () => {
    // Deposit 500.000 back less the 50.000 toll: −450.000.
    expect(evaluateAmount('−500000+50000', 'IDR', { refund: true })).toBe(-450_000);
    expect(evaluateAmount('−10.50×2', 'USD', { refund: true })).toBe(-2100);
  });

  it('still reads a plain figure as a purchase when refunds are allowed', () => {
    expect(evaluateAmount('450000', 'IDR', { refund: true })).toBe(450_000);
    expect(evaluateAmount('100000−25000', 'IDR', { refund: true })).toBe(75_000);
  });

  it('refuses a minus that does not come to money back, and a bare minus', () => {
    expect(evaluateAmount('−100+500', 'IDR', { refund: true })).toBeNull();
    expect(evaluateAmount('−', 'IDR', { refund: true })).toBeNull();
    expect(evaluateAmount('−0', 'IDR', { refund: true })).toBeNull();
    expect(evaluateAmount('−−5', 'IDR', { refund: true })).toBeNull();
    expect(evaluateAmount('+5', 'IDR', { refund: true })).toBeNull();
  });
});

describe('decimals on a currency with no minor unit, when the caller allows them', () => {
  const run = { numRuns: 300, seed: 20261014 } as const;

  it('sums the operands exactly in hundredths and rounds once, at the end', () => {
    // 12.500,30 + 0,80 = 12.501,10, rounded once. Rounding each operand first would give 12.500 + 0 = 12.500 for an
    // income, where the exact sum rounds down to 12.501.
    expect(evaluateExact('12.500,30+0,80', 'IDR', { fractional: 'up' })).toEqual({ minor: 12_502, exactHundredths: 1_250_110 });
    expect(evaluateAmount('12.500,30+0,80', 'IDR', { fractional: 'up' })).toBe(12_502);
    expect(evaluateExact('12.500,30+0,80', 'IDR', { fractional: 'down' })).toEqual({ minor: 12_501, exactHundredths: 1_250_110 });
    // 0,30 + 0,70 is one whole rupiah: no exact figure, and no rounding to do.
    expect(evaluateExact('0,30+0,70', 'IDR', { fractional: 'up' })).toEqual({ minor: 1, exactHundredths: null });
  });

  it('rounds an expense up and an income down', () => {
    expect(evaluateExact('12.500,30', 'IDR', { fractional: 'up' })).toEqual({ minor: 12_501, exactHundredths: 1_250_030 });
    expect(evaluateExact('12.345,67', 'IDR', { fractional: 'down' })).toEqual({ minor: 12_345, exactHundredths: 1_234_567 });
  });

  it('keeps × and ÷ counts whole', () => {
    expect(evaluateExact('12.500,30×2', 'IDR', { fractional: 'up' })).toEqual({ minor: 25_001, exactHundredths: 2_500_060 });
    expect(evaluateExact('12.500,30×2,5', 'IDR', { fractional: 'up' })).toBeNull();
    expect(evaluateExact('100,50÷2', 'IDR', { fractional: 'down' })).toEqual({ minor: 50, exactHundredths: 5025 });
  });

  it('reads a refund: the minor is negative and rounded up in size, the exact figure is positive', () => {
    expect(evaluateExact('−12.500,30', 'IDR', { refund: true, fractional: 'up' })).toEqual({ minor: -12_501, exactHundredths: 1_250_030 });
    expect(evaluateAmount('−12.500,30', 'IDR', { refund: true, fractional: 'up' })).toBe(-12_501);
    // Without the refund option a leading minus is still refused.
    expect(evaluateExact('−12.500,30', 'IDR', { fractional: 'up' })).toBeNull();
  });

  it('gives nothing back when the figure comes to nothing once rounded', () => {
    expect(evaluateExact('0,30', 'IDR', { fractional: 'down' })).toBeNull();
    expect(evaluateExact('0,30', 'IDR', { fractional: 'up' })).toEqual({ minor: 1, exactHundredths: 30 });
    expect(evaluateExact('', 'IDR', { fractional: 'up' })).toBeNull();
    expect(evaluateExact('12,5+', 'IDR', { fractional: 'up' })).toBeNull();
  });

  it('still refuses decimals when the option is absent, as it always did', () => {
    expect(evaluateAmount('12.500,30', 'IDR')).toBeNull();
    expect(evaluateExact('12.500,30', 'IDR')).toBeNull();
    expect(evaluateExact('12.500', 'IDR')).toEqual({ minor: 12_500, exactHundredths: null });
  });

  it('leaves a currency with decimals alone', () => {
    expect(evaluateExact('10.50+2.25', 'USD', { fractional: 'up' })).toEqual({ minor: 1275, exactHundredths: null });
    expect(evaluateAmount('10.00÷3', 'USD', { fractional: 'up' })).toBe(333);
  });

  it('property: a single figure reads as parseFractionalMajor reads it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000_000 }), fc.integer({ min: 0, max: 99 }), fc.boolean(), (whole, cents, up) => {
        const text = `${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${String(cents).padStart(2, '0')}`;
        const direction = up ? 'up' : 'down';
        expect(evaluateExact(text, 'IDR', { fractional: direction })).toEqual(parseFractionalMajor(text, 'IDR', direction));
      }),
      run,
    );
  });

  it('property: a sum of decimal operands is the ceiling or floor of the exact total', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000_000_000 }), { minLength: 1, maxLength: 5 }), fc.boolean(), (operands, up) => {
        const text = operands.map((h) => `${Math.floor(h / 100)},${String(h % 100).padStart(2, '0')}`).join('+');
        const exact = operands.reduce((a, b) => a + b, 0);
        const minor = up ? Math.ceil(exact / 100) : Math.floor(exact / 100);
        const result = evaluateExact(text, 'IDR', { fractional: up ? 'up' : 'down' });
        if (minor <= 0) expect(result).toBeNull();
        else expect(result).toEqual({ minor, exactHundredths: exact % 100 === 0 ? null : exact });
      }),
      run,
    );
  });

  it('property: a whole expression gives what evaluateAmount gave without the option, and no exact figure', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 1_000_000_000 }), { minLength: 1, maxLength: 4 }), fc.boolean(), (operands, up) => {
        const text = operands.join('+');
        expect(evaluateExact(text, 'IDR', { fractional: up ? 'up' : 'down' })).toEqual({ minor: evaluateAmount(text, 'IDR'), exactHundredths: null });
      }),
      run,
    );
  });
});
