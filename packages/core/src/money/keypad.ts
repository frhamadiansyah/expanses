import { MoneyError, parseMajor, roundHalfAwayFromZero } from './money';

/**
 * A figure as typed, in minor units — read by `parseMajor` and by nothing else.
 *
 * This function exists only to turn `parseMajor`'s MoneyError into "cannot be read". It must never inspect "."
 * or "," itself: which of them is a decimal point depends on the figure, not on a country, and `parseMajor`
 * (money.ts:21-55) is the one place in the app that decides it. Re-implementing that rule here is how a keypad
 * ends up reading "10.50" as a thousand and fifty dollars.
 */
function figure(text: string, currency: string): number | null {
  try {
    const minor = parseMajor(text, currency);
    return minor < 0 ? null : minor;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

/** A plain count — how many of a thing, not an amount of money, so it is a whole number and never parsed as money. */
function count(text: string): number | null {
  return /^\d+$/.test(text) ? Number(text) : null;
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
 */
export function evaluateAmount(expression: string, currency: string, options: { refund?: boolean } = {}): number | null {
  const normalised = expression.replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\s+/g, '');
  if (options.refund && normalised.startsWith('-')) {
    const rest = normalised.slice(1);
    // "−" alone, "−−5" and "−+5" are not a refund of anything.
    if (!rest || /^[+\-*/]/.test(rest)) return null;
    // Read as nought less the rest: the minus belongs to the first figure, and what follows is ordinary arithmetic.
    const minor = evaluateTotal(`0-${rest}`, currency);
    return minor !== null && minor < 0 ? minor : null;
  }
  const minor = evaluateTotal(normalised, currency);
  return minor !== null && minor > 0 ? minor : null;
}

/** The expression's total in minor units, rounded once, whatever its sign; null when it cannot be read. */
function evaluateTotal(normalised: string, currency: string): number | null {
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
      const value = figure(text, currency);
      if (value === null) return null;
      values.push(value);
      if (operator) adds.push(operator);
    }
  }
  let total = values[0] ?? 0;
  for (const [index, operator] of adds.entries()) total = operator === '-' ? total - values[index + 1]! : total + values[index + 1]!;
  const minor = roundHalfAwayFromZero(total);
  return Number.isSafeInteger(minor) ? minor : null;
}
