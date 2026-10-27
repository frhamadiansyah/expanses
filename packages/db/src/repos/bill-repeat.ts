import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';

/*
 * `expense_templates.repeat_every` (0102) is the same kind of column: the gap in months of a bill that repeats every few months
 * (repeat = 'months', repeat_month = the month of its first occurrence). Old builds read an unknown repeat as monthly.
 *
 * `expense_templates.repeat` and `.repeat_month` (0099): a bill that comes out once a year, in that month. Null while it
 * repeats every month, which is every bill made before. Not declared on the drizzle table, for the reason `currency` is
 * not (see bill-currency.ts): a drizzle insert names every declared column, so a database stopped before 0099 could no
 * longer save a bill at all. Read and written by name, and only where the columns are.
 */

const seen = new WeakSet<object>();
const everySeen = new WeakSet<object>();

/** Whether this database has the columns. Once seen it is remembered: a column is never taken away. */
export async function billRepeatExists(db: Db): Promise<boolean> {
  if (seen.has(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM pragma_table_info('expense_templates') WHERE name = 'repeat_month'`);
  if (rows.length === 0) return false;
  seen.add(db);
  return true;
}

/** Whether this database has `repeat_every` (0102). A database stopped at 0099-0101 still saves yearly bills. */
async function billRepeatEveryExists(db: Db): Promise<boolean> {
  if (everySeen.has(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM pragma_table_info('expense_templates') WHERE name = 'repeat_every'`);
  if (rows.length === 0) return false;
  everySeen.add(db);
  return true;
}

export interface BillRepeatFacts {
  /** 'yearly' or 'months'; a monthly bill is not in the map. */
  repeat: 'yearly' | 'months';
  /** 1-12: a yearly bill's month, or the month an every-few-months bill's first occurrence falls in. */
  month: number;
  /** The gap in months for 'months'; null for yearly. */
  every: number | null;
}

/** Each non-monthly bill's repeat by id; a monthly bill is not in the map. */
export async function billRepeats(db: Db, ws: WorkspaceContext): Promise<Map<string, BillRepeatFacts>> {
  if (!(await billRepeatExists(db))) return new Map();
  const hasEvery = await billRepeatEveryExists(db);
  const rows = await db.values<[string, string, number, number | null]>(
    hasEvery
      ? sql`SELECT id, repeat, repeat_month, repeat_every FROM expense_templates WHERE workspace_id = ${ws.workspaceId} AND repeat IN ('yearly', 'months') AND repeat_month BETWEEN 1 AND 12`
      : sql`SELECT id, repeat, repeat_month, NULL FROM expense_templates WHERE workspace_id = ${ws.workspaceId} AND repeat = 'yearly' AND repeat_month BETWEEN 1 AND 12`,
  );
  const map = new Map<string, BillRepeatFacts>();
  for (const [id, repeat, month, every] of rows) {
    // A 'months' bill without a usable gap reads as monthly rather than guessing one.
    if (repeat === 'months' && !(every != null && Number(every) >= 2 && Number(every) <= 11)) continue;
    map.set(id, { repeat: repeat === 'months' ? 'months' : 'yearly', month: Number(month), every: repeat === 'months' ? Number(every) : null });
  }
  return map;
}

/** Sets how a bill repeats; null for every month. Nothing on a database without the columns. */
export async function writeBillRepeat(db: Db, ws: WorkspaceContext, id: string, facts: BillRepeatFacts | null): Promise<void> {
  if (!(await billRepeatExists(db))) return;
  await db.run(
    sql`UPDATE expense_templates SET repeat = ${facts?.repeat ?? null}, repeat_month = ${facts?.month ?? null} WHERE id = ${id} AND workspace_id = ${ws.workspaceId}`,
  );
  if (await billRepeatEveryExists(db)) {
    await db.run(sql`UPDATE expense_templates SET repeat_every = ${facts?.every ?? null} WHERE id = ${id} AND workspace_id = ${ws.workspaceId}`);
  }
}
