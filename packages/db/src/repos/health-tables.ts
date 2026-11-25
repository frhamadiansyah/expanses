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

const repeatColumns = new WeakMap<Db, boolean>();

/**
 * Whether migration 0129 has run: budget_frequencies' every_weeks and starts_on (Budget C). Without them every week is
 * every week, and a budget cannot be set every few weeks. A positive answer is remembered per handle, as above.
 */
export async function budgetRepeatColumnsExist(db: Db): Promise<boolean> {
  if (repeatColumns.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM pragma_table_info('budget_frequencies') WHERE name = 'every_weeks'`);
  const exists = rows.length > 0;
  if (exists) repeatColumns.set(db, true);
  return exists;
}
