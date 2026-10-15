import { sql } from 'drizzle-orm';
import type { Db } from '../database';

/**
 * Whether migration 0069 has run here. Every read and write of budget_shares asks first, so a database stopped at an
 * older version behaves as before: every budget an amount. A yes is remembered per handle; a no is not, since
 * migrate() may still run on the same handle.
 */
const known = new WeakMap<Db, boolean>();

export async function budgetSharesExist(db: Db): Promise<boolean> {
  if (known.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'budget_shares'`);
  const exists = rows.length > 0;
  if (exists) known.set(db, true);
  return exists;
}
