import { formatMinor, parsePriceMicro } from '@expanses/core';
import type { SecurityRow } from '@expanses/db';

/**
 * The pure half of the price page: which price "This changes" moves from, and what a save sends. Kept here so the
 * money in it is tested rather than only ever seen through the screen.
 */

/** The last price on or before `onDate` — the one a back-dated price moves from, never a later one. Prices newest first. */
export function lastPriceOnOrBefore<T extends { onDate: string }>(prices: readonly T[], onDate: string): T | null {
  return prices.find((row) => row.onDate <= onDate) ?? null;
}

/** The typed price, read in the security's own currency; null while there is no security yet or the text is not a price. */
export function typedPrice(price: string, security: Pick<SecurityRow, 'currency'> | undefined): number | null {
  if (!security || price.trim() === '') return null;
  try {
    return parsePriceMicro(price, security.currency);
  } catch {
    return null;
  }
}

/**
 * What Save sends: the price in the security's own currency, on a day no later than today. Refused before the
 * security has loaded, so a price is never read in the base currency by default.
 */
export function planPriceSave(p: { security: Pick<SecurityRow, 'id' | 'currency'> | undefined; price: string; onDate: string; today: string }): {
  securityId: string;
  onDate: string;
  priceMicro: number;
} {
  if (!p.security) throw new Error('The stock is still loading');
  if (p.onDate > p.today) throw new Error('A price cannot be dated after today');
  return { securityId: p.security.id, onDate: p.onDate, priceMicro: parsePriceMicro(p.price, p.security.currency) };
}

/** "+Rp 225.000", "−Rp 112.500" (the formatter's own sign), and no sign at all for no change. */
export const changeText = (changeMinor: number, currency: string): string => `${changeMinor > 0 ? '+' : ''}${formatMinor(changeMinor, currency)}`;
