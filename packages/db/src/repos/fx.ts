import { and, desc, eq, lte, sql } from 'drizzle-orm';
import type { Database } from '../database';
import { fxRates } from '../schema';

export type FxSource = 'frankfurter' | 'manual';

export interface FoundRate {
  rate: number;
  onDate: string;
  source: FxSource;
  /** True when the rate comes from an earlier date than requested. */
  stale: boolean;
}

/** Stores a rate for a date. A manual rate is never overwritten by a fetched one. */
export async function upsertRate(
  database: Database,
  row: { fromCurrency: string; toCurrency: string; onDate: string; rate: number; source: FxSource; sourceDate: string },
): Promise<void> {
  if (!(row.rate > 0) || !Number.isFinite(row.rate)) throw new Error(`Invalid rate ${row.rate}`);
  await database.db.run(sql`
    INSERT INTO fx_rates (from_currency, to_currency, on_date, rate, source, source_date, fetched_at)
    VALUES (${row.fromCurrency}, ${row.toCurrency}, ${row.onDate}, ${row.rate}, ${row.source}, ${row.sourceDate}, ${new Date().toISOString()})
    ON CONFLICT (from_currency, to_currency, on_date) DO UPDATE SET
      rate = excluded.rate, source = excluded.source, source_date = excluded.source_date, fetched_at = excluded.fetched_at
    WHERE excluded.source = 'manual' OR fx_rates.source = 'frankfurter'
  `);
}

/** Exact date if stored, otherwise the latest earlier date flagged stale. */
export async function findRate(
  database: Database,
  fromCurrency: string,
  toCurrency: string,
  onDate: string,
): Promise<FoundRate | undefined> {
  const [row] = await database.db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.fromCurrency, fromCurrency), eq(fxRates.toCurrency, toCurrency), lte(fxRates.onDate, onDate)))
    .orderBy(desc(fxRates.onDate))
    .limit(1);
  if (!row) return undefined;
  return { rate: row.rate, onDate: row.onDate, source: row.source, stale: row.onDate !== onDate };
}

export type RateFetcher = (fromCurrency: string, toCurrency: string, onDate: string) => Promise<{ rate: number; sourceDate: string }>;

export interface ResolvedRates {
  /** currency -> units of base per 1 major unit */
  rates: Record<string, number>;
  stale: string[];
  missing: string[];
}

/**
 * Resolves rates to base for a date: stored exact rate, else fetch and store, else last known (stale), else missing.
 * Dates after `today` are resolved as `today`.
 */
export async function resolveRates(
  database: Database,
  p: { currencies: string[]; baseCurrency: string; onDate: string; today: string; fetcher?: RateFetcher },
): Promise<ResolvedRates> {
  const onDate = p.onDate > p.today ? p.today : p.onDate;
  const result: ResolvedRates = { rates: {}, stale: [], missing: [] };
  for (const currency of [...new Set(p.currencies)].sort()) {
    if (currency === p.baseCurrency) continue;
    const stored = await findRate(database, currency, p.baseCurrency, onDate);
    if (stored && !stored.stale) {
      result.rates[currency] = stored.rate;
      continue;
    }
    if (p.fetcher) {
      try {
        const fetched = await p.fetcher(currency, p.baseCurrency, onDate);
        await upsertRate(database, { fromCurrency: currency, toCurrency: p.baseCurrency, onDate, rate: fetched.rate, source: 'frankfurter', sourceDate: fetched.sourceDate });
        const fresh = await findRate(database, currency, p.baseCurrency, onDate);
        result.rates[currency] = fresh!.rate;
        continue;
      } catch {
        // fall through to stale or missing
      }
    }
    if (stored) {
      result.rates[currency] = stored.rate;
      result.stale.push(currency);
    } else {
      result.missing.push(currency);
    }
  }
  return result;
}
