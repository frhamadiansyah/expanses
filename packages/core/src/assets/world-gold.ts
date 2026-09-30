import { currencyInfo } from '../money/currencies';
import { PRICE_SCALE } from './units';

/**
 * Gold at the world price: what an ounce of it trades at, as the rate service quotes XAU, brought down to the gram a
 * holding is counted in. It is a spot price, not what a dealer buys back at — the page says so wherever it shows it.
 */

/** Grams in one troy ounce, the unit XAU is quoted in. */
export const GRAMS_PER_TROY_OUNCE = 31.1034768;

/** A price per troy ounce, in `currency`, as the price of one gram in the app's stored form (millionths of a minor unit). */
export function gramPriceMicroFromOunce(perOunce: number, currency: string): number {
  if (!(perOunce > 0)) throw new Error('A world gold price is above zero');
  const { exponent } = currencyInfo(currency);
  return Math.round((perOunce / GRAMS_PER_TROY_OUNCE) * PRICE_SCALE * 10 ** exponent);
}

/** Where a gold holding's price comes from: the world price, fetched once a day, or only what the owner types. */
export type GoldPriceChoice = 'world' | 'typed';

/** Where a stored price came from: typed by the owner, or fetched as the world price. */
export type PriceSource = 'manual' | 'world';

/**
 * Whether today's world price should be fetched. Only when the holding follows the world price and holds no price for
 * today at all: a price typed for today is the owner's and is never replaced by a fetch, and one already fetched today
 * is today's.
 */
export function wantsWorldPrice(choice: GoldPriceChoice, latest: { onDate: string } | null, today: string): boolean {
  return choice === 'world' && (latest === null || latest.onDate < today);
}

