import { isoDate } from '@expanses/core';
import type { Database, WorkspaceContext } from '@expanses/db';
import { openingRateFor } from '../../lib/rates';

/**
 * The rates a loan between people is posted at — lent, borrowed or repaid.
 *
 * The ledger values every line in the base currency, so a US$100 loan cannot be written without the dollar's rate
 * for its day. The form used to pass none, and the ledger refused it with "No USD→IDR rate" and no way to give
 * one. This goes through `openingRateFor`, the one reader every form that moves money in a currency uses: a typed
 * rate is checked and stored for the day, a blank one is resolved, and a missing one tells the screen which pair
 * to ask for before it says so.
 */
export async function debtRatesForSave({
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
