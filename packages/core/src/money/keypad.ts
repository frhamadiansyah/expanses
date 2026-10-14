import { currencyInfo } from './currencies';
import { MoneyError, parseFractionalMajor, parseMajor, type RoundDirection, roundHalfAwayFromZero, wholeFromHundredths } from './money';

/**
 * A figure as typed, in minor units — read by `parseMajor` and by nothing else.
 *
 * This function exists only to turn `parseMajor`'s MoneyError into "cannot be read". It must never inspect "."
 * or "," itself: which of them is a decimal point depends on the figure, not on a country, and `parseMajor`
 * (through `parseAtExponent` in money.ts) is the one place in the app that decides it. Re-implementing that rule
 * here is how a keypad ends up reading "10.50" as a thousand and fifty dollars.
 */
function figure(text: string, currency: string): number | null {
  return readable(() => parseMajor(text, currency));
}

/**
 * A figure as typed on a currency with no minor unit, in hundredths — read by `parseFractionalMajor`, which reads
 * the separators by `parseMajor`'s own rule and only lets two decimals through.
 */
function hundredthsFigure(text: string, currency: string): number | null {
  return readable(() => {
    const { minor, exactHundredths } = parseFractionalMajor(text, currency, 'down');
    return exactHundredths ?? minor * 100;
  });
}

/** A non-negative reading, or null when the text is not a figure. */
function readable(read: () => number): number | null {
  try {
    const value = read();
    return value < 0 ? null : value;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

/** A plain count — how many of a thing, not an amount of money, so it is a whole number and never parsed as money. */
function count(text: string): number | null {
  return /^\d+$/.test(text) ? Number(text) : null;
}

export interface AmountOptions {
  /** An expense's figure may start with a minus: money back. */
  refund?: boolean;
  /**
   * A currency with no minor unit (IDR, JPY, KRW) takes up to two decimals, rounded this way once the whole
   * expression is worked out: 'up' for an expense or a refund, 'down' for an income. Ignored for a currency with
   * decimals of its own.
   */
  fractional?: RoundDirection;
}

/**
 * What DONE works out, in minor units: a plain amount, or a sum of them with × and ÷ by a plain count.
 *
 * Null when it cannot be read or comes to nothing or less, so the amount row keeps whatever it had and the keypad
 * stays open. Rounded once at the end, so 100÷3 three times over is still the bill.
 *
 * `refund` lets an expense's figure start with a minus: money back, returned as a negative figure. Only the very
 * first character may be that minus, the expression after it is worked out as usual ("−500000+50000" is −450.000),
 * and it must come to less than nothing — a minus that works out to a purchase is not read. Income, a transfer and
 * a split line never pass it, so a leading minus there is refused as it always was.
 *
 * `fractional` lets a currency with no minor unit take decimals; the figure is rounded in its direction, and
 * `evaluateExact` gives the exact figure beside it.
 */
export function evaluateAmount(expression: string, currency: string, options: AmountOptions = {}): number | null {
  if (options.fractional) return evaluateExact(expression, currency, options)?.minor ?? null;
  const result = signed(expression, options, (normalised) => {
    const minor = evaluateTotal(normalised, currency);
    return minor === null ? null : { minor };
  });
  return result?.minor ?? null;
}

/**
 * What DONE works out, with the exact figure: `minor` is what `evaluateAmount` returns, and `exactHundredths` is the
 * magnitude of the whole expression in hundredths when `fractional` is set, the currency has no minor unit and the
 * result is not a whole number of units; null otherwise.
 *
 * The operands are summed exactly in hundredths and rounded once, at the end: "12.500,30+0,80" is 12.501,10, so
 * 12.502 rounded up, exact 1250110. A count after × or ÷ is still a whole number, and a quotient is taken to the
 * nearest hundredth before it is rounded to units.
 */
export function evaluateExact(expression: string, currency: string, options: AmountOptions = {}): { minor: number; exactHundredths: number | null } | null {
  const direction = options.fractional;
  if (!direction || currencyInfo(currency).exponent !== 0) {
    const minor = evaluateAmount(expression, currency, { refund: options.refund });
    return minor === null ? null : { minor, exactHundredths: null };
  }
  return signed(expression, options, (normalised) => {
    const hundredths = combine(normalised, (text) => hundredthsFigure(text, currency));
    if (hundredths === null) return null;
    const exact = Math.abs(hundredths);
    return { minor: wholeFromHundredths(hundredths, direction), exactHundredths: exact % 100 === 0 ? null : exact };
  });
}

/**
 * The expression's figure with its sign rules applied: a leading minus only for a refund, and then only when it
 * comes to less than nothing in minor units; otherwise more than nothing. `total` works the normalised expression
 * out.
 */
function signed<T extends { minor: number }>(expression: string, options: { refund?: boolean }, total: (normalised: string) => T | null): T | null {
  const normalised = expression.replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\s+/g, '');
  if (options.refund && normalised.startsWith('-')) {
    const rest = normalised.slice(1);
    // "−" alone, "−−5" and "−+5" are not a refund of anything.
    if (!rest || /^[+\-*/]/.test(rest)) return null;
    // Read as nought less the rest: the minus belongs to the first figure, and what follows is ordinary arithmetic.
    const result = total(`0-${rest}`);
    return result !== null && result.minor < 0 ? result : null;
  }
  const result = total(normalised);
  return result !== null && result.minor > 0 ? result : null;
}

/** The expression's total in minor units, rounded once, whatever its sign; null when it cannot be read. */
function evaluateTotal(normalised: string, currency: string): number | null {
  return combine(normalised, (text) => figure(text, currency));
}

/**
 * The expression worked out with `read` for each figure, rounded half away from zero once at the end, whatever its
 * sign; null when it cannot be read. `read` decides the unit — minor units, or hundredths.
 */
function combine(normalised: string, read: (text: string) => number | null): number | null {
  if (!normalised || /^[+\-*/]/.test(normalised) || /[+\-*/]$/.test(normalised)) return null;
  const parts = normalised.split(/([+\-*/])/);
  const values: number[] = [];
  const adds: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i] ?? '';
    const operator = parts[i - 1];
    if (operator === '*' || operator === '/') {
      // The operand after × or ÷ is a count of things, so it is read as a whole number. Reading it as money would
      // multiply a dollar amount by 300 when the user typed 3.
      const times = count(text);
      if (times === null) return null;
      const last = values.length - 1;
      if (operator === '/') {
        if (times === 0) return null;
        values[last] = values[last]! / times;
      } else {
        values[last] = values[last]! * times;
      }
    } else {
      const value = read(text);
      if (value === null) return null;
      values.push(value);
      if (operator) adds.push(operator);
    }
  }
  let total = values[0] ?? 0;
  for (const [index, operator] of adds.entries()) total = operator === '-' ? total - values[index + 1]! : total + values[index + 1]!;
  const rounded = roundHalfAwayFromZero(total);
  return Number.isSafeInteger(rounded) ? rounded : null;
}
