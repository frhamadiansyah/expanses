import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { fxRates } from '../schema';
import { upsertRate } from './fx';
import { coretaxInputsFor } from './tax-inputs';

const BPS = 10_000;

/** The report values a year as it stood on its last day, so that is the date a KMK rate belongs to. */
const endOf = (taxYear: number) => `${taxYear}-12-31`;

export interface KmkRateRow {
  currency: string;
  /** Units of base per one unit of the currency, as entered. */
  rate: number;
  /** Which decree it came from, so a filed figure can be traced back. */
  note: string | null;
}

/**
 * Every currency the year's report actually needs a rate for.
 *
 * Read from what the year holds rather than from a fixed list: a currency matters only while
 * something is denominated in it, and the owner should not be asked for rates they cannot use.
 */
export async function foreignCurrenciesFor(database: Database, ws: WorkspaceContext, taxYear: number): Promise<string[]> {
  const inputs = await coretaxInputsFor(database, ws, taxYear);
  const currencies = [
    ...inputs.cash.map((row) => row.currency),
    ...inputs.holdings.map((row) => row.currency),
    ...inputs.estimated.map((row) => row.currency),
    ...inputs.receivables.map((row) => row.currency),
    ...inputs.debts.map((row) => row.currency),
  ];
  return [...new Set(currencies)].filter((currency) => currency !== ws.baseCurrency).sort();
}

/** The rates entered for a year, as the row builders want them: rate times ten thousand. */
export async function kmkRatesFor(database: Database, ws: WorkspaceContext, taxYear: number): Promise<Record<string, number>> {
  const rows = await database.db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.toCurrency, ws.baseCurrency), eq(fxRates.onDate, endOf(taxYear)), eq(fxRates.source, 'kmk')));
  return Object.fromEntries(rows.map((row) => [row.fromCurrency, Math.round(row.rate * BPS)]));
}

/** The same rates with their provenance, for the screen that asks for them. */
export async function kmkRateRowsFor(database: Database, ws: WorkspaceContext, taxYear: number): Promise<KmkRateRow[]> {
  const rows = await database.db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.toCurrency, ws.baseCurrency), eq(fxRates.onDate, endOf(taxYear)), eq(fxRates.source, 'kmk')));
  return rows.map((row) => ({ currency: row.fromCurrency, rate: row.rate, note: row.note })).sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface SetKmkRateInput {
  currency: string;
  /** Units of base per one unit of the currency, exactly as the decree states it. */
  rate: number;
  /** The decree the figure came from, such as 'KMK 42/MK/EF.2/2026'. */
  note?: string | null;
}

/**
 * Records the Menteri Keuangan rate for a year. Typed by hand on purpose: the published figure sits
 * behind an API that needs a token, and a rate that quietly failed to fetch would be worse than one
 * the owner can see they have not entered.
 */
export async function setKmkRate(database: Database, ws: WorkspaceContext, taxYear: number, input: SetKmkRateInput): Promise<void> {
  const currency = input.currency.trim().toUpperCase();
  if (currency === ws.baseCurrency) throw new Error(`${currency} is the report's own currency, so it needs no rate`);
  await upsertRate(database, {
    fromCurrency: currency,
    toCurrency: ws.baseCurrency,
    onDate: endOf(taxYear),
    rate: input.rate,
    source: 'kmk',
    sourceDate: endOf(taxYear),
    note: input.note?.trim() || null,
  });
}
