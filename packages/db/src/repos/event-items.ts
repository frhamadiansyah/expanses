import { uuidv7 } from '@expanses/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { eventItems } from '../schema-events';
import { EventError, eventOf } from './event-scope';

export interface EventItemRow {
  id: string;
  eventId: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  categoryAccountId: string | null;
  link: string | null;
  note: string | null;
  /** The purchase that answered it, posted or since voided. */
  transactionId: string | null;
  shareMinor: number | null;
  sortOrder: number;
}

export interface SaveEventItemInput {
  id?: string;
  name: string;
  /** One when absent: one of something is the ordinary case. */
  quantity?: number;
  unitPriceMinor: number;
  categoryAccountId?: string | null;
  link?: string | null;
  note?: string | null;
}

/*
 * A database stopped before migration 0049 has no event_items table. Every read and write below asks first, so such a
 * database reads as an event with no plan — a real state of the feature, not a broken one. A positive answer is
 * memoised per handle; a negative one is not, since migrate() may run later on the same handle.
 */
const itemsTable = new WeakMap<Db, boolean>();

export async function eventItemsExist(tx: Db): Promise<boolean> {
  if (itemsTable.get(tx)) return true;
  const rows = await tx.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_items'`);
  const exists = rows.length > 0;
  if (exists) itemsTable.set(tx, true);
  return exists;
}

const toItem = (row: typeof eventItems.$inferSelect): EventItemRow => ({
  id: row.id,
  eventId: row.eventId,
  name: row.name,
  quantity: row.quantity,
  unitPriceMinor: row.unitPriceMinor,
  categoryAccountId: row.categoryAccountId,
  link: row.link,
  note: row.note,
  transactionId: row.transactionId,
  shareMinor: row.shareMinor,
  sortOrder: row.sortOrder,
});

/**
 * A shop link, loosely: trimmed, given https:// when it has no scheme, and refused only when it could not be a URL or
 * carries a scheme that is not http(s) — `javascript:` in an href being the one real hazard. Nothing ever fetches it.
 */
export function tidyLink(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? '';
  if (!raw) return null;
  if (/\s/.test(raw)) throw new EventError('BAD_LINK', 'A link cannot contain spaces');
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') throw new EventError('BAD_LINK', 'A link must start with http:// or https://');
  const url = scheme ? raw : `https://${raw}`;
  try {
    new URL(url);
  } catch {
    throw new EventError('BAD_LINK', 'That does not look like a web address');
  }
  return url;
}

/** Every item of an event, in the order they were added. Narrowing to a workspace is `eventPlanFor`'s job. */
export async function listEventItems(database: Database, ws: WorkspaceContext, eventId: string): Promise<EventItemRow[]> {
  if (!(await eventItemsExist(database.db))) return [];
  const rows = await database.db
    .select()
    .from(eventItems)
    .where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.eventId, eventId)))
    .orderBy(asc(eventItems.sortOrder), asc(eventItems.createdAt));
  return rows.map(toItem);
}

/** Adds a thing to buy, or edits one. An edit never moves it and never touches the purchase behind it. */
export async function saveEventItem(database: Database, ws: WorkspaceContext, eventId: string, input: SaveEventItemInput): Promise<string> {
  await eventOf(database, ws, eventId);
  const name = input.name.trim();
  if (!name) throw new EventError('NAME_REQUIRED', 'An item needs a name');
  // A whole number, not merely one above nought: a decimal quantity would make the estimate — quantity times the
  // price each — a float, and money in this app is integer minor units and never a float.
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity <= 0) throw new EventError('QUANTITY_RANGE', 'How many must be a whole number above nought');
  if (!Number.isInteger(input.unitPriceMinor) || input.unitPriceMinor <= 0) throw new EventError('PRICE_RANGE', 'A price each is a figure above nought');
  const categoryAccountId = input.categoryAccountId ?? null;
  if (categoryAccountId !== null) {
    const [category] = await database.db
      .select({ kind: accounts.kind })
      .from(accounts)
      .where(and(eq(accounts.id, categoryAccountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (category?.kind !== 'expense') throw new EventError('NOT_A_CATEGORY', 'An item is filed under a spending category');
  }
  const link = tidyLink(input.link);
  const note = input.note?.trim() ? input.note.trim() : null;
  if (!(await eventItemsExist(database.db))) return input.id ?? uuidv7();

  if (input.id) {
    const [existing] = await database.db
      .select({ id: eventItems.id })
      .from(eventItems)
      .where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.id, input.id)));
    if (!existing) throw new EventError('ITEM_NOT_FOUND', 'That item is not on this event');
    await database.db
      .update(eventItems)
      .set({ name, quantity, unitPriceMinor: input.unitPriceMinor, categoryAccountId, link, note })
      .where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.id, input.id)));
    return input.id;
  }

  // Appended, so the list keeps the order things were thought of in. There is no date to sort by and never will be.
  const [last] = (await database.db
    .select({ next: sql<number>`coalesce(max(${eventItems.sortOrder}), -1) + 1` })
    .from(eventItems)
    .where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.eventId, eventId)))) as [{ next: number }];
  const id = uuidv7();
  await database.db.insert(eventItems).values({
    id,
    workspaceId: ws.workspaceId,
    eventId,
    name,
    quantity,
    unitPriceMinor: input.unitPriceMinor,
    categoryAccountId,
    link,
    note,
    transactionId: null,
    shareMinor: null,
    sortOrder: Number(last.next),
    createdAt: new Date().toISOString(),
  });
  return id;
}

/** Drops an item. Whatever bought it stays where it is; its share returns to that receipt's leftover. */
export async function removeEventItem(database: Database, ws: WorkspaceContext, itemId: string): Promise<void> {
  if (!(await eventItemsExist(database.db))) return;
  await database.db.delete(eventItems).where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.id, itemId)));
}

/** Takes the tick off. The payment is untouched, and the other items on the same receipt keep their shares. */
export async function unlinkEventItem(database: Database, ws: WorkspaceContext, itemId: string): Promise<void> {
  if (!(await eventItemsExist(database.db))) return;
  await database.db
    .update(eventItems)
    .set({ transactionId: null, shareMinor: null })
    .where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.id, itemId)));
}
