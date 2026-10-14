import { sql } from 'drizzle-orm';
import type { Db } from '../database';

/*
 * `transactions.day_order` (0067): a transaction's place within its day, when moved there by hand. Not declared on the
 * drizzle table — every select and insert of `transactions` would then name it, and a database stopped before 0067
 * (a migration test, a half-applied upgrade) could no longer post or list at all. It is read and written by name,
 * only where it is there.
 */

const known = new WeakMap<object, true>();

/** Whether this database has `transactions.day_order`. Once seen it is remembered: a column is never taken away. */
export async function dayOrderExists(db: Db): Promise<boolean> {
  if (known.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM pragma_table_info('transactions') WHERE name = 'day_order'`);
  if (rows.length === 0) return false;
  known.set(db, true);
  return true;
}
