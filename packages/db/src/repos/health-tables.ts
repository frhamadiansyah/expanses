import { sql } from 'drizzle-orm';
import type { Db } from '../database';

/**
 * Whether migration 0053 has run on this database. Every read and write of category_needs, budget_frequencies,
 * goal_stage_terms and calculator_inputs asks first, so a database stopped at an older version behaves exactly as it
 * does today: nothing marked, every budget monthly, no stage terms, no remembered calculator figures. A positive
 * answer is remembered per handle; a negative one is not, since migrate() may run later on the same handle. The four
 * tables arrive in one migration, so one name answers.
 */
const healthTables = new WeakMap<Db, boolean>();

export async function healthTablesExist(db: Db): Promise<boolean> {
  if (healthTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'category_needs'`);
  const exists = rows.length > 0;
  if (exists) healthTables.set(db, true);
  return exists;
}
