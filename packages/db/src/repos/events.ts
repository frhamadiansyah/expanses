import { type EventSheet, eventSheet, uuidv7 } from '@expanses/core';
import { and, asc, eq, gte, inArray, isNull, lte, type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { eventBudgets, events } from '../schema-events';
import { hasBooks } from './books';

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
  /** A figure for the whole event, instead of planning category by category. */
  plannedMinor: number | null;
  goalId: string | null;
  /** The category set the event draws on, when it draws on one rather than the monthly categories. */
  setId: string | null;
  /** When the owner called it done. Null while it is still running. */
  finishedAt: string | null;
}

export interface SaveEventInput {
  id?: string;
  name: string;
  startsOn: string;
  endsOn: string;
  plannedMinor?: number | null;
  goalId?: string | null;
  setId?: string | null;
}

export interface EventBudgetRow {
  categoryAccountId: string;
  plannedMinor: number | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Narrows a category column to the workspace the context names, or to nothing at all when it names none.
 *
 * An event is owner-level — a trip touches Personal and Business alike — so its screen reads whole by default.
 * A tab on that screen asks for one workspace at a time, and this is what one tab means: the plan filed there
 * and the spending filed there, nothing of the other's. Same subquery every other book-scoped read uses.
 */
async function ofBook(database: Database, ws: WorkspaceContext, column: SQLWrapper): Promise<SQL[]> {
  if (!ws.bookId || !(await hasBooks(database.db))) return [];
  return [sql`${column} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`];
}

const toRow = (row: typeof events.$inferSelect): EventRow => ({
  id: row.id,
  name: row.name,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  plannedMinor: row.plannedMinor,
  goalId: row.goalId,
  setId: row.setId,
  finishedAt: row.finishedAt,
});

async function eventOf(database: Database, ws: WorkspaceContext, id: string): Promise<EventRow> {
  const [row] = await database.db
    .select()
    .from(events)
    .where(and(eq(events.workspaceId, ws.workspaceId), eq(events.id, id)));
  if (!row) throw new EventError('NOT_FOUND', 'That event is not in this workspace');
  return toRow(row);
}

/** Adds or edits an event. */
export async function saveEvent(database: Database, ws: WorkspaceContext, input: SaveEventInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new EventError('NAME_REQUIRED', 'An event needs a name');
  if (!DATE.test(input.startsOn) || !DATE.test(input.endsOn)) throw new EventError('INVALID_DATE', 'An event needs a start and an end');
  if (input.endsOn < input.startsOn) throw new EventError('BACKWARDS', 'An event cannot end before it starts');
  const plannedMinor = input.plannedMinor ?? null;
  if (plannedMinor !== null && !(plannedMinor > 0)) throw new EventError('AMOUNT_RANGE', 'Leave the figure empty, or give one above nought');

  const id = input.id ?? uuidv7();
  await database.db
    .insert(events)
    .values({
      id,
      workspaceId: ws.workspaceId,
      name,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      plannedMinor,
      goalId: input.goalId ?? null,
      setId: input.setId ?? null,
      finishedAt: null,
      archivedAt: null,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: events.id,
      set: { name, startsOn: input.startsOn, endsOn: input.endsOn, plannedMinor, goalId: input.goalId ?? null, setId: input.setId ?? null },
    });
  return id;
}

export async function listEvents(database: Database, ws: WorkspaceContext): Promise<EventRow[]> {
  const rows = await database.db
    .select()
    .from(events)
    .where(and(eq(events.workspaceId, ws.workspaceId), sql`${events.archivedAt} IS NULL`))
    .orderBy(asc(events.startsOn));
  return rows.map(toRow);
}

/**
 * Calls an event done, or puts it back.
 *
 * Finishing is kept apart from deleting: the spending stays, the sheet stays readable, and the event
 * simply stops being one of the things still asking for attention.
 */
export async function finishEvent(database: Database, ws: WorkspaceContext, id: string, finished: boolean): Promise<void> {
  await eventOf(database, ws, id);
  await database.db
    .update(events)
    .set({ finishedAt: finished ? new Date().toISOString() : null })
    .where(and(eq(events.workspaceId, ws.workspaceId), eq(events.id, id)));
}

export async function deleteEvent(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.db
    .update(events)
    .set({ archivedAt: new Date().toISOString() })
    .where(and(eq(events.workspaceId, ws.workspaceId), eq(events.id, id)));
}

/**
 * What a category is expected to cost for this event. A row here also says the category is one the
 * event draws on, which is what makes its suggestions precise rather than the whole month.
 */
export async function setEventBudget(
  database: Database,
  ws: WorkspaceContext,
  eventId: string,
  input: { categoryAccountId: string; plannedMinor?: number | null },
): Promise<void> {
  await eventOf(database, ws, eventId);
  const plannedMinor = input.plannedMinor ?? null;
  if (plannedMinor !== null && !(plannedMinor > 0)) throw new EventError('AMOUNT_RANGE', 'Leave the figure empty, or give one above nought');

  const [category] = await database.db
    .select({ kind: accounts.kind })
    .from(accounts)
    .where(and(eq(accounts.id, input.categoryAccountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (category?.kind !== 'expense') throw new EventError('NOT_A_CATEGORY', 'An event is planned against spending categories');

  await database.db
    .insert(eventBudgets)
    .values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      eventId,
      categoryAccountId: input.categoryAccountId,
      plannedMinor,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [eventBudgets.workspaceId, eventBudgets.eventId, eventBudgets.categoryAccountId],
      set: { plannedMinor },
    });
}

export async function removeEventBudget(database: Database, ws: WorkspaceContext, eventId: string, categoryAccountId: string): Promise<void> {
  await database.db
    .delete(eventBudgets)
    .where(
      and(
        eq(eventBudgets.workspaceId, ws.workspaceId),
        eq(eventBudgets.eventId, eventId),
        eq(eventBudgets.categoryAccountId, categoryAccountId),
      ),
    );
}

export async function listEventBudgets(database: Database, ws: WorkspaceContext, eventId: string): Promise<EventBudgetRow[]> {
  const rows = await database.db
    .select()
    .from(eventBudgets)
    .where(
      and(
        eq(eventBudgets.workspaceId, ws.workspaceId),
        eq(eventBudgets.eventId, eventId),
        ...(await ofBook(database, ws, eventBudgets.categoryAccountId)),
      ),
    );
  return rows.map((row) => ({ categoryAccountId: row.categoryAccountId, plannedMinor: row.plannedMinor }));
}

/** Says a payment belongs to an event, or no longer does. */
export async function tagTransaction(database: Database, ws: WorkspaceContext, transactionId: string, eventId: string | null): Promise<void> {
  if (eventId !== null) await eventOf(database, ws, eventId);
  await database.db
    .update(transactions)
    .set({ eventId })
    .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.id, transactionId)));
}

export interface EventCandidate {
  transactionId: string;
  occurredOn: string;
  description: string;
  categoryAccountId: string;
  amountBaseMinor: number;
}

/**
 * Payments that fall inside the event, in a category it draws on, and are not tagged to anything.
 *
 * This is what makes the feature usable: tagging forty purchases one at a time is the sort of chore
 * nobody finishes, so the window and the categories narrow it to a list worth reading through once.
 */
export async function suggestForEvent(database: Database, ws: WorkspaceContext, eventId: string): Promise<EventCandidate[]> {
  const event = await eventOf(database, ws, eventId);
  const budgets = await listEventBudgets(database, ws, eventId);
  const categoryIds = budgets.map((row) => row.categoryAccountId);
  if (categoryIds.length === 0) return [];

  const rows = await database.db
    .select({
      transactionId: transactions.id,
      occurredOn: transactions.occurredOn,
      description: transactions.description,
      categoryAccountId: entries.accountId,
      amountBaseMinor: entries.amountBaseMinor,
    })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        isNull(transactions.eventId),
        gte(transactions.occurredOn, event.startsOn),
        lte(transactions.occurredOn, event.endsOn),
        inArray(entries.accountId, categoryIds),
      ),
    )
    .orderBy(asc(transactions.occurredOn));

  return rows.map((row) => ({ ...row, amountBaseMinor: Math.abs(row.amountBaseMinor) }));
}

/** What the event was expected to cost, against what it did. */
export async function eventSheetFor(database: Database, ws: WorkspaceContext, eventId: string): Promise<EventSheet> {
  const event = await eventOf(database, ws, eventId);
  const planned = await listEventBudgets(database, ws, eventId);

  const actualRows = await database.db
    .select({ categoryId: entries.accountId, total: sql<number>`sum(${entries.amountBaseMinor})` })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        eq(transactions.eventId, eventId),
        eq(accounts.kind, 'expense'),
        ...(await ofBook(database, ws, entries.accountId)),
      ),
    )
    .groupBy(entries.accountId);

  const names = await database.db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'expense'), ...(await ofBook(database, ws, accounts.id))));

  return eventSheet({
    planned: planned.map((row) => ({ categoryId: row.categoryAccountId, plannedMinor: row.plannedMinor })),
    actuals: actualRows.map((row) => ({ categoryId: row.categoryId, amountBaseMinor: Number(row.total) })),
    categoryNames: Object.fromEntries(names.map((row) => [row.id, row.name])),
    // One figure for the whole event is exactly that — the whole event's. Measuring one workspace's share
    // against the trip's own figure would read as wildly under plan on every tab, so a tab is measured
    // against the part of the plan filed in it instead.
    totalPlannedMinor: ws.bookId ? null : event.plannedMinor,
  });
}
