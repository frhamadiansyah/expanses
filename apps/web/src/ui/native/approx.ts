import { convertMinor, formatMinor } from '@expanses/core';

type Rates = Readonly<Record<string, number>>;

/** The line under a foreign figure: it converted at the held rate, marked ≈. Null in the base currency. */
export function approxLine(minor: number, currency: string, baseCurrency: string, ratesToBase: Rates): string | null {
  if (currency === baseCurrency) return null;
  const rate = ratesToBase[currency];
  if (rate === undefined || !(rate > 0)) return `No ${currency} rate yet`;
  return `≈ ${formatMinor(convertMinor(minor, currency, baseCurrency, rate), baseCurrency)}`;
}

/** "16.250 IDR per 1 USD" — the wording `chargedHint` already uses for a rate. */
export const rateLine = (rate: number, currency: string, baseCurrency: string, locale = 'id-ID') =>
  `${rate.toLocaleString(locale, { maximumFractionDigits: 4 })} ${baseCurrency} per 1 ${currency}`;

/**
 * A grouped row's figure — a parent that adds its children up and holds nothing itself. The total when every rate
 * is held, else the missing rates named: never the sum of the rest (`sumToBase` already refused it).
 */
export function groupedFigure(total: { totalMinor: number | null; missing: readonly string[] }, baseCurrency: string): { text: string; complete: boolean } {
  if (total.totalMinor === null) return { text: `No ${total.missing.join(', ')} rate yet`, complete: false };
  return { text: `≈ ${formatMinor(total.totalMinor, baseCurrency)}`, complete: true };
}
