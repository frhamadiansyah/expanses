import { monthStartOf, type MonthStartDay } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';

/*
 * month_start_day (0118) is read and written by name, never through the books table: a database stopped before 0118
 * has no such column, and every select and insert the schema writes would name it. There, and for any value this
 * build does not offer, a workspace's months are calendar months — what they were before the setting.
 */
const monthStartColumn = new WeakMap<Db, boolean>();

export async function monthStartColumnExists(db: Db): Promise<boolean> {
  if (monthStartColumn.get(db)) return true;
  const rows = await db.values(sql`SELECT 1 FROM pragma_table_info('books') WHERE name = 'month_start_day'`);
  if (rows.length > 0) monthStartColumn.set(db, true);
  return rows.length > 0;
}

/** Each of the owner's workspaces' start days, by book id; empty before 0118. */
export async function monthStartsOf(db: Db, workspaceId: string): Promise<Map<string, MonthStartDay>> {
  if (!(await monthStartColumnExists(db))) return new Map();
  const rows = await db.values<[string, unknown]>(sql`SELECT id, month_start_day FROM books WHERE workspace_id = ${workspaceId}`);
  return new Map(rows.map(([id, day]) => [id, monthStartOf(Number(day))]));
}

/**
 * The day the open workspace's months start on: 1 when none is open (an owner-wide read), before books or 0118, or for
 * any value this build does not offer.
 */
export async function monthStartFor(database: Database, ws: WorkspaceContext): Promise<MonthStartDay> {
  if (!ws.bookId || !(await monthStartColumnExists(database.db))) return 1;
  const [row] = await database.db.values<[unknown]>(sql`SELECT month_start_day FROM books WHERE id = ${ws.bookId} AND workspace_id = ${ws.workspaceId}`);
  return row ? monthStartOf(Number(row[0])) : 1;
}
