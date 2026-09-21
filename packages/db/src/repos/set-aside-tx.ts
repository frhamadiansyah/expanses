// packages/db/src/repos/set-aside-tx.ts
import { sql } from 'drizzle-orm';
import type { Db } from '../database';

/**
 * Whether migration 0050 has run on this database. Every read and write of goal_draws asks first, so a database stopped
 * at an older version behaves exactly as it does today: no answer is written, nothing is reversed, no draw is read. A
 * positive answer is remembered per handle; a negative one is not, since migrate() may run later on the same handle.
 */
const drawTables = new WeakMap<Db, boolean>();

export async function setAsideTablesExist(db: Db): Promise<boolean> {
  if (drawTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'goal_draws'`);
  const exists = rows.length > 0;
  if (exists) drawTables.set(db, true);
  return exists;
}
