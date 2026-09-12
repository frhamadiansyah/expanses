import { currencyInfo } from '../money/currencies';
import { assertMinor } from '../money/money';

/** Units are stored as integers of one millionth of a unit: 4 decimals for fund units, 0,0001 g for gold. */
export const UNITS_SCALE = 1_000_000;
/** Prices are stored as integers of one millionth of a minor unit, so a NAV of 1.842,11 stays exact. */
export const PRICE_SCALE = 1_000_000;

const SCALE_BIG = 1_000_000_000_000n; // UNITS_SCALE * PRICE_SCALE

export class UnitsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnitsError';
  }
}

/** Half away from zero, on a non-negative numerator and denominator. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Parses typed units into millionths. A comma is always the decimal separator (id-ID);
 * a dot is thousands grouping unless it is followed by something other than three digits.
 */
export function parseUnits(input: string): number {
  const s = input.trim().replace(/[\s_]/g, '');
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) throw new UnitsError(`Invalid amount of units: "${input}"`);
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart = s;
  let fracPart = '';
  if (lastComma >= 0) {
    intPart = s.slice(0, lastComma);
    fracPart = s.slice(lastComma + 1);
  } else if (lastDot >= 0) {
    const tail = s.slice(lastDot + 1);
    if (tail.length !== 3) {
      intPart = s.slice(0, lastDot);
      fracPart = tail;
    }
  }
  if (/[.,]/.test(fracPart)) throw new UnitsError(`Invalid amount of units: "${input}"`);
  if (fracPart.length > 6) throw new UnitsError(`At most six decimal places: "${input}"`);
  const digits = intPart.replace(/[.,]/g, '') || '0';
  if (!/^\d*$/.test(digits)) throw new UnitsError(`Invalid amount of units: "${input}"`);
  const micro = Number(digits) * UNITS_SCALE + Number(fracPart.padEnd(6, '0') || '0');
  if (!Number.isSafeInteger(micro)) throw new UnitsError(`Amount of units is too large: "${input}"`);
  return micro;
}

/** Millionths back to typed text, id-ID grouping, trailing zeros dropped. */
export function formatUnits(unitsMicro: number, maxDecimals = 6): string {
  if (!Number.isSafeInteger(unitsMicro)) throw new UnitsError(`Units must be a whole number of millionths, got ${unitsMicro}`);
  const negative = unitsMicro < 0;
  const abs = Math.abs(unitsMicro);
  const whole = Math.floor(abs / UNITS_SCALE);
  const fraction = String(abs % UNITS_SCALE)
    .padStart(6, '0')
    .slice(0, maxDecimals)
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${new Intl.NumberFormat('id-ID').format(whole)}${fraction ? `,${fraction}` : ''}`;
}

/** Typed price per unit into millionths of a minor unit. */
export function parsePriceMicro(input: string, currency: string): number {
  const { exponent } = currencyInfo(currency);
  const priceMicro = parseUnits(input) * 10 ** exponent;
  if (!Number.isSafeInteger(priceMicro)) throw new UnitsError(`Price is too large: "${input}"`);
  return priceMicro;
}

export function formatPriceMicro(priceMicro: number, currency: string, locale = 'id-ID'): string {
  const { exponent } = currencyInfo(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent + 2,
  }).format(priceMicro / (PRICE_SCALE * 10 ** exponent));
}

/** Units × price in minor units, rounded half away from zero. Exact for values beyond 2^53 before scaling. */
export function unitsValueMinor(unitsMicro: number, priceMicro: number): number {
  if (!Number.isSafeInteger(unitsMicro) || !Number.isSafeInteger(priceMicro)) {
    throw new UnitsError(`Units and price must be whole numbers, got ${unitsMicro} and ${priceMicro}`);
  }
  const value = Number(divRound(BigInt(unitsMicro) * BigInt(priceMicro), SCALE_BIG));
  assertMinor(value, 'value');
  return value;
}

/** The price per unit implied by an amount, used for average cost and the price check on a trade. */
export function priceMicroFrom(grossMinor: number, unitsMicro: number): number {
  assertMinor(grossMinor, 'amount');
  if (!Number.isSafeInteger(unitsMicro) || unitsMicro === 0) throw new UnitsError('A price needs a number of units greater than zero');
  const priceMicro = Number(divRound(BigInt(grossMinor) * SCALE_BIG, BigInt(unitsMicro)));
  if (!Number.isSafeInteger(priceMicro)) throw new UnitsError('Price is too large');
  return priceMicro;
}
