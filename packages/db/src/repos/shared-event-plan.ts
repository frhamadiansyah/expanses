import { type EventPlan, eventPlan, expenseInEvent, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { withCapture } from '../sync/capture';
import { tidyLink } from './event-items';
import { eventBookOfEventTx, eventRecordsTx, expenseReadIssue } from './shared-event-records';
import { type SharedItemPart, sharedItemState, itemRowTx, writeItemStateTx } from './shared-item-state';
import { openSharedEventTx, SharedEventDbError } from './shared-event-writes';

export { type SharedItemPart, type SharedItemState, sharedItemState } from './shared-item-state';

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

/** Adds a payment towards an item — or, for an expense it already has a part of, puts that part right. */
export async function addSharedItemPurchase(database: Database, ws: WorkspaceContext, eventId: string, itemId: string, part: SharedItemPart): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const expense = (await eventRecordsTx(tx, book.bookId)).expenses.find((e) => e.id === part.expenseId && !e.voided);
    if (!expense) throw invalid('That expense was deleted');
    const { paidMinor } = expenseInEvent(expense, book.currency);
    if (!Number.isSafeInteger(part.shareMinor) || part.shareMinor <= 0 || part.shareMinor > paidMinor) throw invalid('The share is above nought and no more than the expense');
    const state = sharedItemState(await itemRowTx(tx, book.bookId, itemId));
    const purchases = [...state.purchases.filter((p) => p.expenseId !== part.expenseId), { expenseId: part.expenseId, shareMinor: part.shareMinor }];
    await writeItemStateTx(tx, book.bookId, itemId, { ...state, purchases });
  });
}

/** Takes one payment off an item, or every one when none is named. Whether it is done stays as it was. */
export async function removeSharedItemPurchase(database: Database, ws: WorkspaceContext, eventId: string, itemId: string, expenseId?: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const state = sharedItemState(await itemRowTx(tx, book.bookId, itemId));
    await writeItemStateTx(tx, book.bookId, itemId, { ...state, purchases: expenseId ? state.purchases.filter((p) => p.expenseId !== expenseId) : [] });
  });
}

/** Marks an item done — nothing more is to be bought for it — or puts it back on the list. Its payments stay. */
export async function setSharedItemDone(database: Database, ws: WorkspaceContext, eventId: string, itemId: string, done: boolean): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const state = sharedItemState(await itemRowTx(tx, book.bookId, itemId));
    await writeItemStateTx(tx, book.bookId, itemId, { ...state, done });
  });
}

/**
 * The one-payment tick, as it was before an item could be paid for in parts: bought by that expense at that share, and
 * done; null takes every payment off and puts it back on the list.
 */
export async function linkSharedItem(database: Database, ws: WorkspaceContext, eventId: string, itemId: string, link: SharedItemPart | null): Promise<void> {
  if (link === null) {
    await removeSharedItemPurchase(database, ws, eventId, itemId);
    await setSharedItemDone(database, ws, eventId, itemId, false);
    return;
  }
  await addSharedItemPurchase(database, ws, eventId, itemId, link);
  await setSharedItemDone(database, ws, eventId, itemId, true);
}

/** The plan against what was spent, through `eventPlan`, in the event currency. Null for an event that is not shared. */
export async function sharedEventPlan(database: Database, ws: WorkspaceContext, eventId: string): Promise<EventPlan | null> {
  const book = await eventBookOfEventTx(database.db, eventId).catch(() => null);
  if (!book || book.workspaceId !== ws.workspaceId) return null;
  const { expenses } = await eventRecordsTx(database.db, book.bookId);
  const categories = await database.db.values<[string, string]>(sql`SELECT id, name FROM event_categories WHERE book_id = ${book.bookId}`);
  const items = await database.db.values<
    [string, string, number, number, string | null, string | null, string | null, string | null, number | null, string | null, string | null]
  >(sql`
    SELECT id, name, quantity, unit_price_minor, category_id, link, note, expense_id, share_minor, purchases_json, done_at
    FROM event_items_shared WHERE book_id = ${book.bookId} ORDER BY sort_order, id`);
  return eventPlan({
    items: items.map(([id, name, quantity, unitPriceMinor, categoryId, link, note, expenseId, shareMinor, purchasesJson, doneAt]) => {
      const state = sharedItemState({ purchasesJson, doneAt, expenseId, shareMinor: shareMinor === null ? null : Number(shareMinor) });
      return {
        id,
        name,
        quantity: Number(quantity),
        unitPriceMinor: Number(unitPriceMinor),
        categoryId,
        link,
        note,
        purchases: state.purchases.map((part) => ({ transactionId: part.expenseId, shareMinor: part.shareMinor })),
        done: state.done,
      };
    }),
    // One that cannot be added up (I2) is in no figure here either, as on the event page.
    actuals: expenses
      .filter((e) => !e.voided && expenseReadIssue(e, book.currency) === null)
      .map((e) => ({ transactionId: e.id, occurredOn: e.occurredOn, description: e.note ?? 'Shared spending', categoryId: e.categoryId ?? '', amountBaseMinor: expenseInEvent(e, book.currency).paidMinor })),
    categoryNames: Object.fromEntries(categories),
  });
}
