import { convertMinor, type DatedRate, pickRate } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { fxRates } from '../schema';
import { books } from '../schema-books';
import { hasBooks } from './books';

/** One currency no rate reached, with the earliest date it was asked for: what a screen names to the user. */
export interface Unconverted {
  currency: string;
  onDate: string;
}

export interface BookMoney {
  /** False when the workspace reads in the owner's own currency: every figure then takes today's path, unchanged. */
  converts: boolean;
  /** The currency the figures are in. */
  currency: string;
  /** Null when no rate exists for that currency on or before that date; the caller leaves the amount out. */
  convert(amountMinor: number, currency: string, onDate: string): number | null;
  /** What could not be converted, for the screen to say: one entry per currency, with its earliest date. */
  missing(): Unconverted[];
}

/** The base currency of one book of this workspace, or nothing when the id is not this workspace's. */
async function bookCurrencyOf(database: Database, ws: WorkspaceContext, bookId: string): Promise<string | undefined> {
  const [row] = await database.db
    .select({ baseCurrency: books.baseCurrency })
    .from(books)
    .where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, bookId)));
  return row?.baseCurrency;
}

/**
 * A workspace reads its own Cashflow, budgets and bills in its own base currency: each amount converted from the
 * currency it was paid in, at the rate on the transaction's date.
 *
 * Display only. Nothing is written back, `entries.amount_base_minor` keeps meaning the owner's currency, and a
 * workspace whose currency is the owner's converts nothing — so a one-currency owner's figures are the same
 * numbers, down to the rupiah, that they were before workspaces existed.
 */
export async function bookMoneyFor(database: Database, ws: WorkspaceContext): Promise<BookMoney> {
  const currency = (ws.bookId && (await hasBooks(database.db)) ? await bookCurrencyOf(database, ws, ws.bookId) : undefined) ?? ws.baseCurrency;
  const missed = new Map<string, string>();
  if (currency === ws.baseCurrency) {
    return { converts: false, currency, convert: (amountMinor) => amountMinor, missing: () => [] };
  }
  // One snapshot: fx_rates holds a handful of rows per pair, and a month's list would otherwise be a query an
  // amount. Rows are picked in memory with the same "exact day, else the latest earlier" rule findRate uses.
  const rows = await database.db
    .select({ from: fxRates.fromCurrency, onDate: fxRates.onDate, rate: fxRates.rate })
    .from(fxRates)
    .where(eq(fxRates.toCurrency, currency));
  const byCurrency = new Map<string, DatedRate[]>();
  for (const row of rows) {
    const held = byCurrency.get(row.from);
    if (held) held.push({ onDate: row.onDate, rate: row.rate });
    else byCurrency.set(row.from, [{ onDate: row.onDate, rate: row.rate }]);
  }

  return {
    converts: true,
    currency,
    convert(amountMinor, from, onDate) {
      if (from === currency) return amountMinor;
      const found = pickRate(byCurrency.get(from) ?? [], onDate);
      if (!found) {
        const earliest = missed.get(from);
        if (!earliest || onDate < earliest) missed.set(from, onDate);
        return null;
      }
      return convertMinor(amountMinor, from, currency, found.rate);
    },
    missing: () => [...missed].map(([currency, onDate]) => ({ currency, onDate })).sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}
