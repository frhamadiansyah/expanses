import { PRICE_SCALE } from '../assets/units';
import { currencyInfo } from '../money/currencies';

/**
 * Where a listed share's price comes from. The price is the security's, so the choice is too: one answer for every
 * broker that holds it. Three answers — Yahoo Finance's daily close, fetched by the app; IDX's daily file, imported by
 * the owner; or only what the owner types. A typed price for a day is the owner's and no other source replaces it.
 */
export type ListedPriceChoice = 'yahoo' | 'idx' | 'typed';

/** Where a stored security price came from: typed, fetched from Yahoo Finance, or read from IDX's daily file. */
export type ListedPriceSource = 'manual' | 'yahoo' | 'idx';

/** A price older than this many days is called out on its page, with the way to update it. */
export const STALE_PRICE_DAYS = 3;

/** Whether a security trades on the Indonesia Stock Exchange, so IDX's daily file can price it. */
export function isIdxListing(security: { ticker: string | null; market: string; currency: string }): boolean {
  if (!security.ticker) return false;
  // A share named by its owner may carry no market; in rupiah it can only be IDX's.
  return security.market === 'IDX' || (security.market === '' && security.currency === 'IDR');
}

/**
 * The choice a security follows. No choice saved is Yahoo Finance where it can be (the switch is on and the security
 * has a Yahoo symbol); a Yahoo choice that cannot be followed — Yahoo switched off, or no symbol — falls back to IDX's
 * file for an IDX share and to typing for anything else. Its stored prices stay either way.
 */
export function listedPriceChoice(stored: ListedPriceChoice | null, o: { yahoo: boolean; yahooSymbol: boolean; idx: boolean }): ListedPriceChoice {
  const wanted = stored ?? 'yahoo';
  if (wanted === 'typed') return 'typed';
  if (wanted === 'yahoo' && o.yahoo && o.yahooSymbol) return 'yahoo';
  return o.idx ? 'idx' : 'typed';
}

/** Whole days from a price's date to today. */
export function priceAgeDays(onDate: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${onDate}T00:00:00Z`)) / 86_400_000);
}

/** A close as the app stores a price: millionths of the currency's minor unit (a whole-rupiah close is exact). */
export function closePriceMicro(close: number, currency: string): number {
  if (!(close > 0)) throw new Error('A close is above zero');
  const { exponent } = currencyInfo(currency);
  return Math.round(close * 10 ** exponent * PRICE_SCALE);
}
