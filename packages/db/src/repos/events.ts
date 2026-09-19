import { type EventSheet, eventSheet, uuidv7 } from '@expanses/core';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { eventBudgets, events } from '../schema-events';
import { EventError, type EventRow, eventOf, ofBook, toEventRow as toRow } from './event-scope';

// The error, the row and the two scoping helpers live in event-scope so the item repository can share them
// without a cycle. Re-exported here so every path that already imported them from events.ts keeps working.
export { EventError } from './event-scope';
export type { EventRow } from './event-scope';

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
