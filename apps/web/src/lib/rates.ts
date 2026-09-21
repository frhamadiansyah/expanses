import { parseRate } from '@expanses/core';
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
 * The rate an opening balance is posted at: typed (checked, stored as a manual rate for the opening date) or, left
 * blank, resolved for the opening date — stopping, with the currency named, only when none can be found. Nothing
 * for the base currency or an empty balance. One implementation for every form that opens money.
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
