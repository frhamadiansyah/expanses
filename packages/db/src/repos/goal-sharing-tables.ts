import { sql } from 'drizzle-orm';
import type { Db } from '../database';

/**
 * Whether migration 0109 has run on this database. Every read and write of the shared-goal tables asks first, so a
 * database stopped at an older version behaves as before: no goal shared. A positive answer is remembered per handle;
 * a negative one is not, since migrate() may run later on the same handle. The five tables arrive in one migration,
 * so one name answers.
 */
const goalSharingTables = new WeakMap<Db, boolean>();

export async function goalSharingTablesExist(db: Db): Promise<boolean> {
  if (goalSharingTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'goal_shares'`);
  const exists = rows.length > 0;
  if (exists) goalSharingTables.set(db, true);
  return exists;
}
