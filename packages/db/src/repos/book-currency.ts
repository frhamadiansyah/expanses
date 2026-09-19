import { convertMinor, type DatedRate, pickRate } from '@expanses/core';
import { and, eq, or } from 'drizzle-orm';
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
  //
  // Both directions are taken: a rate is stored one way round, and what the user's own data holds is whatever a
  // purchase needed at the time — foreign→rupiah rows, mostly. A workspace in another currency reading only
  // <from>→<its own> would find nothing for almost every amount it has.
  const rows = await database.db
    .select({ from: fxRates.fromCurrency, to: fxRates.toCurrency, onDate: fxRates.onDate, rate: fxRates.rate })
    .from(fxRates)
    .where(or(eq(fxRates.toCurrency, currency), eq(fxRates.fromCurrency, currency)));
  const into = new Map<string, DatedRate[]>();
  const outOf = new Map<string, DatedRate[]>();
  for (const row of rows) {
    // A row both ways round (currency→currency) would say nothing; `convert` answers that case before asking.
    const side = row.to === currency ? into : outOf;
    const key = row.to === currency ? row.from : row.to;
    const held = side.get(key);
    if (held) held.push({ onDate: row.onDate, rate: row.rate });
    else side.set(key, [{ onDate: row.onDate, rate: row.rate }]);
  }

  return {
    converts: true,
    currency,
    convert(amountMinor, from, onDate) {
      if (from === currency) return amountMinor;
      // The rate stored the way it is asked for first; the other direction, turned over, only when there is none.
      const found = pickRate(into.get(from) ?? [], onDate);
      const back = found ? null : pickRate(outOf.get(from) ?? [], onDate);
      if (!found && !back) {
        const earliest = missed.get(from);
        if (!earliest || onDate < earliest) missed.set(from, onDate);
        return null;
      }
      return convertMinor(amountMinor, from, currency, found ? found.rate : 1 / back!.rate);
    },
    missing: () => [...missed].map(([currency, onDate]) => ({ currency, onDate })).sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}
