import { currencyInfo } from './currencies';

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function assertMinor(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer of minor units, got ${value}`);
  }
}

export function roundHalfAwayFromZero(x: number): number {
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return r === 0 ? 0 : r;
}

/**
 * Parses user-typed major units into minor units.
 * The last "." or "," followed by 1..exponent digits is the decimal separator;
 * every other "." or "," is a thousands separator.
 */
export function parseMajor(input: string, currency: string): number {
  return parseAtExponent(input, currency, currencyInfo(currency).exponent);
}

/**
 * Which way a figure with cents is rounded to a currency that has none: 'up' for money out (an expense, a refund of
 * one — the card charges the purchase rounded up), 'down' for money in (an income).
 */
export type RoundDirection = 'up' | 'down';

/**
 * An exact figure in hundredths, as whole units rounded `direction`. The magnitude is rounded and the sign kept, so
 * a refund of 12.500,30 rounded up is −12.501.
 *
 * Integer arithmetic only: `n / 100` in floating point can land on the wrong side of a whole number near the top of
 * the safe range.
 */
export function wholeFromHundredths(hundredths: number, direction: RoundDirection): number {
  assertMinor(hundredths, 'hundredths');
  const magnitude = Math.abs(hundredths);
  const cents = magnitude % 100;
  const floor = (magnitude - cents) / 100;
  const whole = direction === 'up' && cents !== 0 ? floor + 1 : floor;
  return hundredths < 0 && whole !== 0 ? -whole : whole;
}

/**
 * Like `parseMajor`, but a currency with no minor unit (IDR, JPY, KRW — by exponent, never by name) also takes up to
 * two decimals: the figure comes back rounded `direction` to whole units, with the exact magnitude in hundredths
 * beside it when the decimals are not zero (12.500,30 → 12.501 up, 12.500 down, exact 1250030). A whole figure, or
 * one whose decimals are zero, has no exact figure.
 *
 * The separators are read by the same rule as `parseMajor`, so "12.500" is still twelve thousand five hundred. A
 * currency with decimals of its own is read exactly as `parseMajor` reads it and never has an exact figure.
 */
export function parseFractionalMajor(text: string, currency: string, direction: RoundDirection): { minor: number; exactHundredths: number | null } {
  const { exponent } = currencyInfo(currency);
  if (exponent !== 0) return { minor: parseMajor(text, currency), exactHundredths: null };
  const hundredths = parseAtExponent(text, currency, 2);
  const exact = Math.abs(hundredths);
  return { minor: wholeFromHundredths(hundredths, direction), exactHundredths: exact % 100 === 0 ? null : exact };
}

/** `parseMajor`'s reading, at a given number of decimals rather than the currency's own. */
function parseAtExponent(input: string, currency: string, exponent: number): number {
  let s = input.trim().replace(/[\s_]/g, '');
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) {
    throw new MoneyError(`Invalid amount: "${input}"`);
  }
  let intPart = s;
  let fracPart = '';
  // A trailing group of up to max(exponent, 2) digits is decimals; a 3-digit group on a 0-2 exponent currency is thousands.
  const m = /^(.*)[.,](\d+)$/.exec(s);
  if (m && m[2]!.length <= Math.max(exponent, 2)) {
    intPart = m[1]!;
    fracPart = m[2]!;
  }
  if (fracPart.length > exponent) {
    if (/[^0]/.test(fracPart.slice(exponent))) {
      throw new MoneyError(`${currency} allows ${exponent} decimal places: "${input}"`);
    }
    fracPart = fracPart.slice(0, exponent);
  }
  intPart = intPart.replace(/[.,]/g, '') || '0';
  const minor = Number(intPart) * 10 ** exponent + Number(fracPart.padEnd(exponent, '0') || '0');
  assertMinor(minor);
  return negative ? -minor : minor;
}

export function formatMinor(amountMinor: number, currency: string, locale = 'id-ID'): string {
  assertMinor(amountMinor);
  const { exponent } = currencyInfo(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(amountMinor / 10 ** exponent);
}

/** Minor units in a decimal string without currency symbol, for form inputs. */
export function minorToMajorString(amountMinor: number, currency: string): string {
  assertMinor(amountMinor);
  const { exponent } = currencyInfo(currency);
  if (exponent === 0) return String(amountMinor);
  const sign = amountMinor < 0 ? '-' : '';
  const abs = String(Math.abs(amountMinor)).padStart(exponent + 1, '0');
  return `${sign}${abs.slice(0, -exponent)}.${abs.slice(-exponent)}`;
}

/** rate = units of `to` per 1 major unit of `from`. */
export function convertMinor(amountMinor: number, from: string, to: string, rate: number): number {
  assertMinor(amountMinor);
  if (from === to) return amountMinor;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new MoneyError(`Invalid FX rate ${rate} for ${from}->${to}`);
  }
  const shift = currencyInfo(to).exponent - currencyInfo(from).exponent;
  const raw = Number((amountMinor * rate * 10 ** shift).toPrecision(15));
  const result = roundHalfAwayFromZero(raw);
  assertMinor(result, 'converted amount');
  return result;
}

/**
 * Parses a user-typed FX rate. With both "." and "," present, the last one is the decimal separator.
 * A separator that repeats is thousands grouping. A single separator is a decimal point,
 * so "16.500" reads as 16.5 — callers must show a preview and sanity-check against known rates.
 */
export function parseRate(input: string): number {
  const s = input.trim().replace(/[\s_]/g, '');
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) throw new MoneyError(`Invalid rate: "${input}"`);
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let normalized = s;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    normalized = s.split(decimal === '.' ? ',' : '.').join('').replace(decimal, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    normalized = s.split(sep).length > 2 ? s.split(sep).join('') : s.replace(sep, '.');
  }
  const rate = Number(normalized);
  if (!Number.isFinite(rate) || rate <= 0) throw new MoneyError(`Rate must be a positive number: "${input}"`);
  return rate;
}
