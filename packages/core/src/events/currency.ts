import { convertMinor } from '../money/money';
import { type DatedRate, pickRate } from '../money/rates';

/*
 * Currencies on a personal event's plan.
 *
 * An event may keep its plan in a currency of its own, and each item may be priced in another. Nothing is stored for the
 * ordinary case: an event or item with no currency of its own reads as the workspace's base currency, which is what
 * every one made before this existed was in. `unit_price_minor` follows its item: minor units of the item's currency
 * when the item has a currency row, minor units of the base currency when it has none (old data).
 */

/** The currency an item is priced in: its own when it has one, else the workspace's base. The one answer everywhere. */
export const itemCurrency = (stored: string | null | undefined, baseCurrency: string): string => stored ?? baseCurrency;

/** The currency an event plans in: its own when it has one, else the workspace's base. */
export const eventCurrency = (stored: string | null | undefined, baseCurrency: string): string => stored ?? baseCurrency;

/** One stored rate: units of `to` per 1 major unit of `from`, on a date. */
export interface RateRow {
  from: string;
  to: string;
  onDate: string;
  rate: number;
}

export interface Converter {
  /**
   * `minor` of `from` as `to`, at the rate that speaks for `onDate` (the day's own, else the latest earlier). Null when
   * no rate reaches: never a guess, and never the amount handed back unconverted.
   */
  convert(minor: number, from: string, to: string, onDate: string): number | null;
  /** Whether `currency` can be taken to the base currency on that date, which is what every cross rate is made of. */
  reaches(currency: string, onDate: string): boolean;
}

/**
 * A converter over a snapshot of stored rates. A pair is tried the way it was stored, then turned over, and when
 * neither is there the two legs through the base currency are multiplied into **one** rate — converted leg by leg the
 * amount would be rounded to whole base units in between, and a rupiah is worth more than a kuruş.
 */
export function makeConverter(rows: readonly RateRow[], baseCurrency: string): Converter {
  const byPair = new Map<string, DatedRate[]>();
  for (const row of rows) {
    const key = `${row.from}>${row.to}`;
    const held = byPair.get(key);
    if (held) held.push({ onDate: row.onDate, rate: row.rate });
    else byPair.set(key, [{ onDate: row.onDate, rate: row.rate }]);
  }
  const direct = (from: string, to: string, onDate: string): number | null => {
    const found = pickRate(byPair.get(`${from}>${to}`) ?? [], onDate);
    if (found) return found.rate;
    const back = pickRate(byPair.get(`${to}>${from}`) ?? [], onDate);
    return back ? 1 / back.rate : null;
  };
  const rateOf = (from: string, to: string, onDate: string): number | null => {
    if (from === to) return 1;
    const own = direct(from, to, onDate);
    if (own !== null || from === baseCurrency || to === baseCurrency) return own;
    const up = direct(from, baseCurrency, onDate);
    const down = direct(baseCurrency, to, onDate);
    return up !== null && down !== null ? up * down : null;
  };
  return {
    convert(minor, from, to, onDate) {
      if (from === to) return minor;
      const rate = rateOf(from, to, onDate);
      return rate === null ? null : convertMinor(minor, from, to, rate);
    },
    reaches: (currency, onDate) => currency === baseCurrency || direct(currency, baseCurrency, onDate) !== null,
  };
}

/** A converter that knows no rates: only a currency converted into itself comes back. */
export const NO_RATES: Converter = makeConverter([], '');

/**
 * Why a conversion failed: the currencies with no way to the base on that date, which is what a screen names. Empty when
 * the pair converts, or when the gap is a direct pair neither leg of which is missing.
 */
export function missingCurrencies(converter: Converter, baseCurrency: string, currencies: readonly string[], onDate: string): string[] {
  return [...new Set(currencies)].filter((currency) => currency !== baseCurrency && !converter.reaches(currency, onDate)).sort();
}

/** Where an event's currency may still be changed: before anything was bought for it. Said with the same words as a shared event. */
export function canChangeEventCurrency(boughtCount: number): boolean {
  return boughtCount === 0;
}

/**
 * A receipt's expense side, as `currency`: each entry exactly when it was already in that currency, else its base figure
 * converted at the receipt's day. Null when any entry needs a rate that is not there. The figure an item's share is
 * cut from, so a purchase paid in the event's own currency reads in it to the last unit.
 */
export function purchaseTotalIn(
  entries: readonly { amountMinor: number; currency: string; amountBaseMinor: number }[],
  currency: string,
  baseCurrency: string,
  onDate: string,
  converter: Converter,
): number | null {
  let total = 0;
  for (const entry of entries) {
    if (entry.currency === currency) {
      total += entry.amountMinor;
      continue;
    }
    const converted = converter.convert(entry.amountBaseMinor, baseCurrency, currency, onDate);
    if (converted === null) return null;
    total += converted;
  }
  return total;
}

/** An item's share of a receipt (stored in base) as the same part of the receipt in another currency, half up. */
export function shareIn(shareBaseMinor: number, totalBaseMinor: number, totalInMinor: number): number {
  if (totalBaseMinor <= 0) return 0;
  if (shareBaseMinor >= totalBaseMinor) return totalInMinor;
  const [share, base, total] = [BigInt(shareBaseMinor), BigInt(totalBaseMinor), BigInt(totalInMinor)];
  return Number((share * total * 2n + base) / (2n * base));
}
