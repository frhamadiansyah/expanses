import { sql } from 'drizzle-orm';
import type { Db } from '../database';

/*
 * Migration 0071's five local tables (withdrawal rate, ruling R1). Every reader and writer asks first: a database stopped
 * before 0071 — a migration test, a half-applied upgrade — posts, lists and syncs exactly as it did, with every foreign
 * entry at the day's rate.
 */

const known = new WeakMap<object, true>();

/** Whether this database has the withdrawal-rate tables. Once seen it is remembered: a table is never taken away. */
export async function fxTablesExist(db: Db): Promise<boolean> {
  if (known.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fx_recalc_pending'`);
  if (rows.length === 0) return false;
  known.set(db, true);
  return true;
}

/** Where the first-run notice waits (R18): 'due' until shown, then 'shown'. A local setting, never synced. */
export const WITHDRAWAL_RATE_NOTICE_KEY = 'fx.withdrawal_rate_notice';

/**
 * Puts an account in the queue to be recalculated later (rulings R9, R10), from the earliest date asked for; `null`,
 * from its first entry, wins over any date. In the caller's transaction, so a write that rolls back queues nothing.
 */
export async function queueForeignRecalcTx(db: Db, accountId: string, fromDate: string | null): Promise<void> {
  await db.run(sql`
    INSERT INTO fx_recalc_pending (account_id, from_date) VALUES (${accountId}, ${fromDate})
    ON CONFLICT (account_id) DO UPDATE SET from_date = CASE
      WHEN fx_recalc_pending.from_date IS NULL OR excluded.from_date IS NULL THEN NULL
      WHEN excluded.from_date < fx_recalc_pending.from_date THEN excluded.from_date
      ELSE fx_recalc_pending.from_date
    END`);
}
