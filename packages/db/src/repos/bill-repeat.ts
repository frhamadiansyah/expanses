import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';

/*
 * `expense_templates.repeat` and `.repeat_month` (0099): a bill that comes out once a year, in that month. Null while it
 * repeats every month, which is every bill made before. Not declared on the drizzle table, for the reason `currency` is
 * not (see bill-currency.ts): a drizzle insert names every declared column, so a database stopped before 0099 could no
 * longer save a bill at all. Read and written by name, and only where the columns are.
 */

const seen = new WeakSet<object>();

/** Whether this database has the columns. Once seen it is remembered: a column is never taken away. */
export async function billRepeatExists(db: Db): Promise<boolean> {
  if (seen.has(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM pragma_table_info('expense_templates') WHERE name = 'repeat_month'`);
  if (rows.length === 0) return false;
  seen.add(db);
  return true;
}

/** Each yearly bill's month of the year by id; a monthly bill is not in the map. */
export async function billYearlyMonths(db: Db, ws: WorkspaceContext): Promise<Map<string, number>> {
  if (!(await billRepeatExists(db))) return new Map();
  const rows = await db.values<[string, number]>(
    sql`SELECT id, repeat_month FROM expense_templates WHERE workspace_id = ${ws.workspaceId} AND repeat = 'yearly' AND repeat_month BETWEEN 1 AND 12`,
  );
  return new Map(rows.map(([id, month]) => [id, Number(month)]));
}

/** Sets how a bill repeats: a month of the year, or null for every month. Nothing on a database without the columns. */
export async function writeBillRepeat(db: Db, ws: WorkspaceContext, id: string, yearlyMonth: number | null): Promise<void> {
  if (!(await billRepeatExists(db))) return;
  await db.run(
    sql`UPDATE expense_templates SET repeat = ${yearlyMonth === null ? null : 'yearly'}, repeat_month = ${yearlyMonth} WHERE id = ${id} AND workspace_id = ${ws.workspaceId}`,
  );
}
