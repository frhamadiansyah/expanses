import { currencyInfo } from './currencies';
import { convertMinor, MoneyError } from './money';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

type Rates = Readonly<Record<string, number>>;

const rateOf = (code: string, baseCurrency: string, ratesToBase: Rates): number | null => {
  if (code === baseCurrency) return 1;
  const rate = ratesToBase[code];
  return rate !== undefined && rate > 0 ? rate : null;
};

/**
 * Amounts in several currencies as one figure in the base currency — or none at all.
 *
 * A missing rate gives `totalMinor: null` and names the currency. It never adds the rest without it, and never adds
 * a foreign amount's minor units as if they were base: both are the mixed-currency defect `/net-worth/loans` has.
 * Signed amounts are added as they are, so an overdrawn pocket lowers the total.
 */
export function sumToBase({
  amounts,
  baseCurrency,
  ratesToBase,
}: {
  amounts: readonly { minor: number; currency: string }[];
  baseCurrency: string;
  ratesToBase: Rates;
}): { totalMinor: number | null; missing: string[] } {
  const missing = [...new Set(amounts.filter((a) => rateOf(a.currency, baseCurrency, ratesToBase) === null).map((a) => a.currency))].sort();
  if (missing.length > 0) return { totalMinor: null, missing };
  // Accumulated as BigInt, not float64: each term is a safe integer (convertMinor checks it), but a large positive
  // term followed by a large negative one can round past 2^53 and back down without the final total ever leaving
  // the safe range — a float64 running sum would lose units silently in that case. BigInt addition is exact.
  const totalBig = amounts.reduce((sum, a) => sum + BigInt(convertMinor(a.minor, a.currency, baseCurrency, rateOf(a.currency, baseCurrency, ratesToBase)!)), 0n);
  if (totalBig > MAX_SAFE || totalBig < MIN_SAFE) throw new MoneyError(`total must be a safe integer of minor units, got ${totalBig}`);
  return { totalMinor: Number(totalBig), missing: [] };
}

export interface ExchangeCost {
  fromBaseMinor: number;
  toBaseMinor: number;
  /** Positive: the bank's rate cost this much. Negative: it gave this much more than the day's rate. */
  costMinor: number;
}

/**
 * What an exchange at the bank's rate cost, against the day's rates. The ledger records the same figure: each leg
 * of `exchangeLines` is converted by `convertMinor` at these rates, so the Currency exchange account's base total
 * for the posting is exactly `costMinor`.
 */
export function exchangeCost({
  fromMinor,
  fromCurrency,
  toMinor,
  toCurrency,
  baseCurrency,
  ratesToBase,
}: {
  fromMinor: number;
  fromCurrency: string;
  toMinor: number;
  toCurrency: string;
  baseCurrency: string;
  ratesToBase: Rates;
}): ExchangeCost | null {
  const a = rateOf(fromCurrency, baseCurrency, ratesToBase);
  const b = rateOf(toCurrency, baseCurrency, ratesToBase);
  if (a === null || b === null) return null;
  const fromBaseMinor = convertMinor(fromMinor, fromCurrency, baseCurrency, a);
  const toBaseMinor = convertMinor(toMinor, toCurrency, baseCurrency, b);
  return { fromBaseMinor, toBaseMinor, costMinor: fromBaseMinor - toBaseMinor };
}

/** Units that arrived per unit that left, in major units. For display only: nothing stores it or posts with it. */
export function impliedRate({ fromMinor, fromCurrency, toMinor, toCurrency }: { fromMinor: number; fromCurrency: string; toMinor: number; toCurrency: string }): number | null {
  if (!(fromMinor > 0) || !(toMinor > 0)) return null;
  const major = (minor: number, code: string) => minor / 10 ** currencyInfo(code).exponent;
  return major(toMinor, toCurrency) / major(fromMinor, fromCurrency);
}
