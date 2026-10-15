import { type EventPlan, eventPlan, expenseInEvent, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { withCapture } from '../sync/capture';
import { tidyLink } from './event-items';
import { eventBookOfEventTx, eventRecordsTx } from './shared-event-records';
import { openSharedEventTx, SharedEventDbError } from './shared-event-writes';

/*
 * The shared plan (shared events D7): the same list of things to buy an event has always had — a name, how many, a
 * price each, a category — but in the event currency and in the event's book, so everyone sees it, ticks it and buys
 * from it. An item is answered by an expense (not a transaction) and its share of it, so `eventPlan` reads it exactly as
 * it reads a local plan, with expense ids where transaction ids were.
 */

export interface SharedItemInput {
  id?: string;
  name: string;
  quantity: number;
  /** In the event currency. */
  unitPriceMinor: number;
  categoryId: string | null;
  link: string | null;
  note: string | null;
}

const invalid = (message: string) => new SharedEventDbError('INVALID', message);

export async function saveSharedItem(database: Database, ws: WorkspaceContext, eventId: string, input: SharedItemInput): Promise<string> {
  const id = input.id ?? uuidv7();
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const name = input.name.trim();
    if (!name) throw invalid('Name the thing to buy');
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) throw invalid('How many is a whole number above nought');
    if (!Number.isSafeInteger(input.unitPriceMinor) || input.unitPriceMinor <= 0) throw invalid('Enter a price above nought');
    const link = tidyLink(input.link);
    await withCapture(tx, { entity: 'event_item', id, bookId: book.bookId }, () =>
      tx.run(sql`
        INSERT INTO event_items_shared (book_id, id, name, quantity, unit_price_minor, category_id, link, note, expense_id, share_minor, sort_order)
        VALUES (${book.bookId}, ${id}, ${name}, ${input.quantity}, ${input.unitPriceMinor}, ${input.categoryId}, ${link}, ${input.note?.trim() || null}, NULL, NULL,
                (SELECT coalesce(max(sort_order), 0) + 1 FROM event_items_shared WHERE book_id = ${book.bookId}))
        ON CONFLICT (book_id, id) DO UPDATE SET name = excluded.name, quantity = excluded.quantity, unit_price_minor = excluded.unit_price_minor,
          category_id = excluded.category_id, link = excluded.link, note = excluded.note`),
    );
  });
  return id;
}

export async function removeSharedItem(database: Database, ws: WorkspaceContext, eventId: string, itemId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    await withCapture(tx, { entity: 'event_item', id: itemId, bookId: book.bookId }, () => tx.run(sql`DELETE FROM event_items_shared WHERE book_id = ${book.bookId} AND id = ${itemId}`));
  });
}

/** The tick: this item was bought by that expense, at this share of it (event currency); null takes it back off. */
export async function linkSharedItem(database: Database, ws: WorkspaceContext, eventId: string, itemId: string, link: { expenseId: string; shareMinor: number } | null): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    if (link) {
      const expense = (await eventRecordsTx(tx, book.bookId)).expenses.find((e) => e.id === link.expenseId && !e.voided);
      if (!expense) throw invalid('That expense was deleted');
      const { paidMinor } = expenseInEvent(expense, book.currency);
      if (!Number.isSafeInteger(link.shareMinor) || link.shareMinor <= 0 || link.shareMinor > paidMinor) throw invalid('The share is above nought and no more than the expense');
    }
    await withCapture(tx, { entity: 'event_item', id: itemId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_items_shared SET expense_id = ${link?.expenseId ?? null}, share_minor = ${link?.shareMinor ?? null} WHERE book_id = ${book.bookId} AND id = ${itemId}`),
    );
  });
}

/** The plan against what was spent, through `eventPlan`, in the event currency. Null for an event that is not shared. */
export async function sharedEventPlan(database: Database, ws: WorkspaceContext, eventId: string): Promise<EventPlan | null> {
  const book = await eventBookOfEventTx(database.db, eventId).catch(() => null);
  if (!book || book.workspaceId !== ws.workspaceId) return null;
  const { expenses } = await eventRecordsTx(database.db, book.bookId);
  const categories = await database.db.values<[string, string]>(sql`SELECT id, name FROM event_categories WHERE book_id = ${book.bookId}`);
  const items = await database.db.values<[string, string, number, number, string | null, string | null, string | null, string | null, number | null]>(sql`
    SELECT id, name, quantity, unit_price_minor, category_id, link, note, expense_id, share_minor FROM event_items_shared WHERE book_id = ${book.bookId} ORDER BY sort_order, id`);
  return eventPlan({
    items: items.map(([id, name, quantity, unitPriceMinor, categoryId, link, note, expenseId, shareMinor]) => ({
      id,
      name,
      quantity: Number(quantity),
      unitPriceMinor: Number(unitPriceMinor),
      categoryId,
      link,
      note,
      purchase: expenseId && shareMinor !== null ? { transactionId: expenseId, shareMinor: Number(shareMinor) } : null,
    })),
    actuals: expenses
      .filter((e) => !e.voided)
      .map((e) => ({ transactionId: e.id, occurredOn: e.occurredOn, description: e.note ?? 'Shared spending', categoryId: e.categoryId ?? '', amountBaseMinor: expenseInEvent(e, book.currency).paidMinor })),
    categoryNames: Object.fromEntries(categories),
  });
}
