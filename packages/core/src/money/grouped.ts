import { groupTypedAmount } from '../assets/fund-trade';
import { currencyInfo } from './currencies';
import { MoneyError, minorToMajorString, parseMajor } from './money';

/**
 * A stored amount as an amount field shows it: grouped in id-ID, a dot every three and — for a currency with cents —
 * a comma before the cents. 2500000000 minor of IDR is "2.500.000.000"; 123456 minor of USD is "1.234,56".
 */
export function groupedMajorString(amountMinor: number, currency: string): string {
  return groupTypedAmount(minorToMajorString(amountMinor, currency).replace('.', ','), currency);
}

/**
 * The figure in an amount field typed through `groupTypedAmount`, in minor units. In that text a dot is always a
 * thousands mark and a comma is always the decimal mark, whatever the currency: `parseMajor` alone would read the
 * "1.234" of a three-decimal currency (a dinar, 1234 of it typed) as one and a quarter, since it takes a last group
 * of up to three digits there for decimals.
 */
export function parseGroupedMajor(text: string, currency: string): number {
  const trimmed = text.trim();
  const negative = trimmed.startsWith('-');
  const s = negative ? trimmed.slice(1) : trimmed;
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) throw new MoneyError(`Invalid amount: "${text}"`);
  const comma = s.indexOf(',');
  const signed = (digits: string) => parseMajor(negative ? `-${digits}` : digits, currency);
  if (comma < 0) return signed(s.replace(/\./g, ''));
  if (s.indexOf(',', comma + 1) >= 0) throw new MoneyError(`Invalid amount: "${text}"`);
  const { exponent } = currencyInfo(currency);
  const cents = s.slice(comma + 1);
  if (exponent === 0 && /[^0]/.test(cents)) throw new MoneyError(`${currency} allows 0 decimal places: "${text}"`);
  return signed(`${s.slice(0, comma).replace(/\./g, '') || '0'}${cents ? `.${cents}` : ''}`);
}
