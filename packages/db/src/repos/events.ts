import { type EventPlan, eventPlan, uuidv7 } from '@expanses/core';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { events } from '../schema-events';
import { categoryIdsOfBook, hasBooks } from './books';
import { listSetCategories } from './category-sets';
import { type EventItemRow, listEventItems } from './event-items';
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
  const categoryIds = await eventCategories(database, ws, eventId);
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

/**
 * The categories an event draws on: the ones its items name, and the ones in its category set when it has one.
 *
 * The set half is what lets an event with no plan still offer suggestions — a holiday planned as a set of categories
 * suggests inside them from the first day, before a single item exists.
 */
export async function eventCategories(database: Database, ws: WorkspaceContext, eventId: string): Promise<string[]> {
  const event = await eventOf(database, ws, eventId);
  const items = await listEventItems(database, ws, eventId);
  const fromItems = items.map((item) => item.categoryAccountId).filter((id): id is string => id !== null);
  const fromSet = event.setId ? (await listSetCategories(database, ws, event.setId)).map((row) => row.id) : [];
  return [...new Set([...fromItems, ...fromSet])];
}

/** What the event meant to buy, against what it actually bought. */
export async function eventPlanFor(database: Database, ws: WorkspaceContext, eventId: string): Promise<EventPlan> {
  await eventOf(database, ws, eventId);
  const items = await listEventItems(database, ws, eventId);
  // A tab narrows the plan the same way it narrows the money: by the category the item is filed under. An item filed
  // nowhere belongs to no workspace, so it is read under every tab.
  const mine = ws.bookId && (await hasBooks(database.db)) ? await keepInBook(database, ws, items) : items;

  // One row per expense entry, not one per category: a purchase split across two categories has to be readable as
  // both the item that holds it and the money in each of them.
  //
  // Posted only. Voiding a purchase deliberately leaves the item's link where it is, so that correcting a receipt
  // does not untick everything it answered; the reading is where a void has to count for nothing, or the event
  // would show money that was never spent and an item ticked off by a payment that no longer exists.
  const actualRows = await database.db
    .select({
      transactionId: transactions.id,
      occurredOn: transactions.occurredOn,
      description: transactions.description,
      categoryId: entries.accountId,
      amountBaseMinor: entries.amountBaseMinor,
    })
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
    );

  const names = await database.db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'expense')));

  return eventPlan({
    items: mine.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      categoryId: item.categoryAccountId,
      link: item.link,
      note: item.note,
      purchase: item.transactionId && item.shareMinor !== null ? { transactionId: item.transactionId, shareMinor: item.shareMinor } : null,
    })),
    actuals: actualRows.map((row) => ({ ...row, amountBaseMinor: Math.abs(row.amountBaseMinor) })),
    categoryNames: Object.fromEntries(names.map((row) => [row.id, row.name])),
  });
}

/** The items whose category is filed in the open workspace, plus the ones filed in no category at all. */
async function keepInBook(database: Database, ws: WorkspaceContext, items: EventItemRow[]): Promise<EventItemRow[]> {
  const ids = new Set(await categoryIdsOfBook(database, ws.bookId!));
  return items.filter((item) => item.categoryAccountId === null || ids.has(item.categoryAccountId));
}
