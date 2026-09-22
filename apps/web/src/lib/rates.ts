import { isoDate, parseRate } from '@expanses/core';
import { type Database, findRate, upsertRate, type WorkspaceContext } from '@expanses/db';

/** Human-readable reading of a typed rate, so "16.500" visibly shows as 16,5 before it is saved. */
export function ratePreview(input: string, from: string, to: string): string | null {
  if (!input.trim()) return null;
  try {
    const rate = parseRate(input);
    return `Reads as 1 ${from} = ${rate.toLocaleString('id-ID', { maximumFractionDigits: 8 })} ${to}`;
  } catch {
    return 'Not a valid rate';
  }
}

/** Rejects a manual rate more than 10× away from the nearest known rate — almost always a decimal separator slip. */
export async function checkManualRate(database: Database, from: string, to: string, onDate: string, rate: number): Promise<void> {
  const reference = (await findRate(database, from, to, onDate)) ?? (await findRate(database, from, to, '9999-12-31'));
  if (!reference) return;
  const ratio = rate / reference.rate;
  if (ratio > 10 || ratio < 0.1) {
    const how = ratio > 1 ? `${Math.round(ratio)}× higher` : `${Math.round(1 / ratio)}× lower`;
    throw new Error(
      `${rate.toLocaleString('id-ID')} is ${how} than the last known ${from}→${to} rate (${reference.rate.toLocaleString('id-ID')}). Check the decimal separator.`,
    );
  }
}

/**
 * The rates a payment is posted at, for a form whose money may be in another currency.
 *
 * The ledger values every line in the base currency, so a US$100 loan — or a payment on a dollar loan — cannot be
 * written without the dollar's rate for its day. The forms used to pass none, and the ledger refused them with
 * "No USD→IDR rate" and no way to give one. This goes through `openingRateFor`, the one reader every form that
 * moves money in a currency uses: a typed rate is checked and stored for the day, a blank one is resolved, and a
 * missing one tells the screen which pair to ask for before it says so.
 */
export async function ratesForSave({
  database,
  ws,
  currency,
  occurredOn,
  amountMinor,
  typed,
  resolveRates,
  onMissing,
}: {
  database: Database;
  ws: WorkspaceContext;
  currency: string;
  occurredOn: string;
  amountMinor: number;
  /** The rate the user typed, or '' to use the one stored or fetched for the day. */
  typed: string;
  resolveRates: (currencies: string[], onDate: string) => Promise<{ rates: Record<string, number> }>;
  onMissing: (currency: string) => void;
}): Promise<Record<string, number>> {
  if (currency === ws.baseCurrency) return {};
  // Stored under the day it happened, never later than today — exactly as `resolveRates` resolves it.
  const today = isoDate();
  const onDate = occurredOn > today ? today : occurredOn;
  try {
    const rate = await openingRateFor({ database, ws, currency, openedOn: onDate, openingBalanceMinor: amountMinor, typed, resolveRates });
    return rate === undefined ? {} : { [currency]: rate };
  } catch (e) {
    if (!typed.trim()) {
      onMissing(currency);
      throw new Error(`No ${currency}→${ws.baseCurrency} rate for ${onDate}. Enter it under “Rate: ${ws.baseCurrency} per 1 ${currency}”.`);
    }
    throw e;
  }
}

/**
 * The rate an opening balance is posted at: typed (checked, stored as a manual rate for the opening date) or, left
 * blank, resolved for the opening date — stopping, with the currency named, only when none can be found. Nothing
 * for the base currency or an empty balance. One implementation for every form that opens money.
 *
 * A typed rate is stored here, as soon as it is checked — before, and outside, the caller's write of the account.
 * If that write then fails, the rate stays stored for that day; it is the rate the owner typed, so it is kept.
 */
export async function openingRateFor({
  database,
  ws,
  currency,
  openedOn,
  openingBalanceMinor,
  typed,
  resolveRates,
}: {
  database: Database;
  ws: WorkspaceContext;
  currency: string;
  openedOn: string;
  openingBalanceMinor: number;
  typed: string;
  resolveRates: (currencies: string[], onDate: string) => Promise<{ rates: Record<string, number> }>;
}): Promise<number | undefined> {
  if (currency === ws.baseCurrency || openingBalanceMinor === 0) return undefined;
  if (typed.trim()) {
    const rate = parseRate(typed);
    await checkManualRate(database, currency, ws.baseCurrency, openedOn, rate);
    await upsertRate(database, { fromCurrency: currency, toCurrency: ws.baseCurrency, onDate: openedOn, rate, source: 'manual', sourceDate: openedOn });
    return rate;
  }
  const rate = (await resolveRates([currency], openedOn)).rates[currency];
  if (rate === undefined) throw new Error(`No ${currency}→${ws.baseCurrency} rate available. Enter it manually.`);
  return rate;
}
