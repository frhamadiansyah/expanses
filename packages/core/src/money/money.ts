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
  const { exponent } = currencyInfo(currency);
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
  if (exponent > 0) {
    const m = /^(.*)[.,](\d+)$/.exec(s);
    if (m && m[2]!.length <= exponent) {
      intPart = m[1]!;
      fracPart = m[2]!;
    }
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
