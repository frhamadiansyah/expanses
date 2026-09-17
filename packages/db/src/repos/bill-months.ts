import { type SQL, sql } from 'drizzle-orm';
import type { Db } from '../database';
import { transactions } from '../schema';

/**
 * Whether migration 0044 has run on this database. Every read and write of bill_windows and bill_payments asks
 * first, so a database stopped at an older version keeps today's calendar-month behaviour. A positive answer is
 * remembered per handle; a negative one is not, since migrate() may run later on the same handle.
 */
const billTables = new WeakMap<Db, boolean>();

export async function billTablesExist(db: Db): Promise<boolean> {
  if (billTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bill_payments'`);
  const exists = rows.length > 0;
  if (exists) billTables.set(db, true);
  return exists;
}

export const BILL_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The day a transaction counts on in a monthly spending figure. A bill payment made outside the month whose bill it
 * settles counts on that bill's out day in that month (clamped to the month's end); everything else, including a
 * bill paid inside its own month, counts on the day it happened. bill_payments is keyed by transaction, so this is
 * one row at most and never multiplies the entries it is asked about.
 */
export const attributedOn = (): SQL => sql`COALESCE((
  SELECT CASE WHEN bp.bill_month = substr(${transactions.occurredOn}, 1, 7) THEN NULL
    ELSE min(date(bp.bill_month || '-01', '+' || (et.day_of_month - 1) || ' days'), date(bp.bill_month || '-01', '+1 month', '-1 day')) END
  FROM bill_payments bp JOIN expense_templates et ON et.id = bp.template_id
  WHERE bp.transaction_id = ${transactions.id}
), ${transactions.occurredOn})`;
