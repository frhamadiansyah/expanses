import { and, eq, type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { events } from '../schema-events';
import { hasBooks } from './books';

/*
 * What an event and the things it plans agree on: the error they refuse with, the row shape, and the two
 * scoping helpers. It lives apart from `events.ts` so `event-items.ts` can refuse with the same error class
 * without importing the repository that imports it.
 */

export class EventError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EventError';
  }
}

export interface EventRow {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  // `events.planned_minor` is not here on purpose: a plan is a list of things to buy, and its total is those items'
  // sum. The column stays in the table for the databases that already carry a figure in it, and nothing reads it.
  goalId: string | null;
  /** The category set the event draws on, when it draws on one rather than the monthly categories. */
  setId: string | null;
  /** When the owner called it done. Null while it is still running. */
  finishedAt: string | null;
}

/**
 * Narrows a category column to the workspace the context names, or to nothing at all when it names none.
 *
 * An event is owner-level — a trip touches Personal and Business alike — so its screen reads whole by default.
 * A tab on that screen asks for one workspace at a time, and this is what one tab means: the plan filed there
 * and the spending filed there, nothing of the other's. Same subquery every other book-scoped read uses.
 */
export async function ofBook(database: Database, ws: WorkspaceContext, column: SQLWrapper): Promise<SQL[]> {
  if (!ws.bookId || !(await hasBooks(database.db))) return [];
  return [sql`${column} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`];
}

const toRow = (row: typeof events.$inferSelect): EventRow => ({
  id: row.id,
  name: row.name,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  goalId: row.goalId,
  setId: row.setId,
  finishedAt: row.finishedAt,
});

export async function eventOf(database: Database, ws: WorkspaceContext, id: string): Promise<EventRow> {
  const [row] = await database.db
    .select()
    .from(events)
    .where(and(eq(events.workspaceId, ws.workspaceId), eq(events.id, id)));
  if (!row) throw new EventError('NOT_FOUND', 'That event is not in this workspace');
  return toRow(row);
}

export { toRow as toEventRow };
