import { sql } from 'drizzle-orm';
import type { Db } from '../database';

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
