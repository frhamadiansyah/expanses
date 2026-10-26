import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';

/*
 * `expense_templates.currency` (0098): the currency a bill is written in, null while it follows the account that pays
 * it. Not declared on the drizzle table, for the reason `day_order` is not (see day-order-column.ts): a drizzle insert
 * names every declared column, so a database stopped before 0098 could no longer save a bill at all. Read and written
 * by name, and only where the column is.
 */

const seen = new WeakSet<object>();

/** Whether this database has the column. Once seen it is remembered: a column is never taken away. */
export async function billCurrencyExists(db: Db): Promise<boolean> {
  if (seen.has(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM pragma_table_info('expense_templates') WHERE name = 'currency'`);
  if (rows.length === 0) return false;
  seen.add(db);
  return true;
}

/** Each bill's own currency by id; a bill that follows its payer is not in the map. */
export async function billCurrencies(db: Db, ws: WorkspaceContext): Promise<Map<string, string>> {
  if (!(await billCurrencyExists(db))) return new Map();
  const rows = await db.values<[string, string]>(
    sql`SELECT id, currency FROM expense_templates WHERE workspace_id = ${ws.workspaceId} AND currency IS NOT NULL`,
  );
  return new Map(rows.map(([id, currency]) => [id, currency]));
}

/** Sets a bill's currency (null: follow the payer). Nothing on a database without the column. */
export async function writeBillCurrency(db: Db, ws: WorkspaceContext, id: string, currency: string | null): Promise<void> {
  if (!(await billCurrencyExists(db))) return;
  await db.run(sql`UPDATE expense_templates SET currency = ${currency} WHERE id = ${id} AND workspace_id = ${ws.workspaceId}`);
}
