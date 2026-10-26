import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';

/*
 * `card_terms.annual_fee_on` and `card_terms.annual_fee_waived_year` (0093): when a card's annual fee is charged, and
 * the year of the charge that was waived. Not declared on the drizzle table, for the reason `day_order` is not (see
 * day-order-column.ts): a drizzle insert names every declared column, so a database stopped before 0093 could no
 * longer save card terms at all. Read and written by name, only where the column is.
 */

export interface FeeFields {
  annualFeeOn: string | null;
  annualFeeWaivedYear: number | null;
}

export const NO_FEE_FIELDS: FeeFields = { annualFeeOn: null, annualFeeWaivedYear: null };
const seen = new WeakSet<object>();

/** Whether this database has the columns. Once seen it is remembered: a column is never taken away. */
export async function feeColumnsExist(db: Db): Promise<boolean> {
  if (seen.has(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM pragma_table_info('card_terms') WHERE name = 'annual_fee_on'`);
  if (rows.length === 0) return false;
  seen.add(db);
  return true;
}

/** The fee fields of every card's terms in the workspace, by account id. */
export async function feeFieldsByCard(db: Db, ws: WorkspaceContext): Promise<Map<string, FeeFields>> {
  if (!(await feeColumnsExist(db))) return new Map();
  const rows = await db.values<[string, string | null, number | null]>(
    sql`SELECT account_id, annual_fee_on, annual_fee_waived_year FROM card_terms WHERE workspace_id = ${ws.workspaceId}`,
  );
  return new Map(rows.map(([id, on, year]) => [id, { annualFeeOn: on, annualFeeWaivedYear: year }]));
}

/** Writes the fields given; nothing on a database without the columns. */
export async function writeFeeFields(db: Db, ws: WorkspaceContext, accountId: string, fields: Partial<FeeFields>): Promise<void> {
  if (!(await feeColumnsExist(db))) return;
  if (fields.annualFeeOn !== undefined) {
    await db.run(sql`UPDATE card_terms SET annual_fee_on = ${fields.annualFeeOn} WHERE account_id = ${accountId} AND workspace_id = ${ws.workspaceId}`);
  }
  if (fields.annualFeeWaivedYear !== undefined) {
    await db.run(sql`UPDATE card_terms SET annual_fee_waived_year = ${fields.annualFeeWaivedYear} WHERE account_id = ${accountId} AND workspace_id = ${ws.workspaceId}`);
  }
}
