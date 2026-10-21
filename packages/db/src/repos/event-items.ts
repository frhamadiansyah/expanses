import { uuidv7 } from '@expanses/core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { eventItemPurchases, eventItems } from '../schema-events';
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
  /** The purchases that paid for it, posted or since voided, each with this item's share of it. Oldest first. */
  purchases: { transactionId: string; shareMinor: number }[];
  /** Marked done: nothing more is to be bought for it. */
  done: boolean;
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

/* The same question of 0078's table: a database stopped between 0049 and 0078 reads as one whose items were never paid. */
const purchasesTable = new WeakMap<Db, boolean>();

async function purchasesExist(tx: Db): Promise<boolean> {
  if (purchasesTable.get(tx)) return true;
  const rows = await tx.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_item_purchases'`);
  const exists = rows.length > 0;
  if (exists) purchasesTable.set(tx, true);
  return exists;
}

/** Each item's purchases, by item id, oldest first. */
async function purchasesOf(tx: Db, ws: WorkspaceContext, itemIds: readonly string[]): Promise<Map<string, { transactionId: string; shareMinor: number }[]>> {
  const out = new Map<string, { transactionId: string; shareMinor: number }[]>();
  if (itemIds.length === 0 || !(await purchasesExist(tx))) return out;
  const rows = await tx
    .select()
    .from(eventItemPurchases)
    .where(and(eq(eventItemPurchases.workspaceId, ws.workspaceId), inArray(eventItemPurchases.itemId, [...itemIds])))
    .orderBy(asc(eventItemPurchases.createdAt), asc(eventItemPurchases.transactionId));
  for (const row of rows) out.set(row.itemId, [...(out.get(row.itemId) ?? []), { transactionId: row.transactionId, shareMinor: row.shareMinor }]);
  return out;
}

const toItem = (row: typeof eventItems.$inferSelect, purchases: { transactionId: string; shareMinor: number }[] = []): EventItemRow => ({
  id: row.id,
  eventId: row.eventId,
  name: row.name,
  quantity: row.quantity,
  unitPriceMinor: row.unitPriceMinor,
  categoryAccountId: row.categoryAccountId,
  link: row.link,
  note: row.note,
  purchases,
  done: row.doneAt !== null && row.doneAt !== undefined,
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
  const purchases = await purchasesOf(database.db, ws, rows.map((row) => row.id));
  return rows.map((row) => toItem(row, purchases.get(row.id) ?? []));
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
  await database.transaction(async (tx) => {
    if (await purchasesExist(tx)) {
      await tx.delete(eventItemPurchases).where(and(eq(eventItemPurchases.workspaceId, ws.workspaceId), eq(eventItemPurchases.itemId, itemId)));
    }
    await tx.delete(eventItems).where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.id, itemId)));
  });
}

/**
 * One item's share of one purchase: written, replaced, or — with null — taken off. A replaced share keeps the day it
 * was first given (or `since`, carried from the purchase it corrects), so an item's payments keep their order.
 */
async function writeShare(tx: Db, ws: WorkspaceContext, itemId: string, transactionId: string, shareMinor: number | null, since?: string): Promise<void> {
  const [was] = await tx
    .select({ createdAt: eventItemPurchases.createdAt })
    .from(eventItemPurchases)
    .where(and(eq(eventItemPurchases.workspaceId, ws.workspaceId), eq(eventItemPurchases.itemId, itemId), eq(eventItemPurchases.transactionId, transactionId)));
  await tx
    .delete(eventItemPurchases)
    .where(and(eq(eventItemPurchases.workspaceId, ws.workspaceId), eq(eventItemPurchases.itemId, itemId), eq(eventItemPurchases.transactionId, transactionId)));
  if (shareMinor !== null) {
    await tx.insert(eventItemPurchases).values({ itemId, workspaceId: ws.workspaceId, transactionId, shareMinor, createdAt: since ?? was?.createdAt ?? new Date().toISOString() });
  }
}

/** A share is whole minor units above nought. Nought is not a share — it is the absence of one, which is unlinking. */
function checkShare(share: number): void {
  if (!Number.isInteger(share) || share <= 0) throw new EventError('SHARE_RANGE', 'A share is a whole figure above nought');
}

/**
 * Takes a purchase off an item — the one named, or every one when none is. The payment is untouched, and the other
 * items on the same receipt keep their shares. Whether the item is done is its own mark, and stays as it was.
 */
export async function unlinkEventItem(database: Database, ws: WorkspaceContext, itemId: string, transactionId?: string): Promise<void> {
  if (!(await eventItemsExist(database.db)) || !(await purchasesExist(database.db))) return;
  await database.db
    .delete(eventItemPurchases)
    .where(
      and(
        eq(eventItemPurchases.workspaceId, ws.workspaceId),
        eq(eventItemPurchases.itemId, itemId),
        ...(transactionId ? [eq(eventItemPurchases.transactionId, transactionId)] : []),
      ),
    );
}

/** Marks an item done — nothing more is to be bought for it — or puts it back on the list. Its purchases stay. */
export async function setEventItemDone(database: Database, ws: WorkspaceContext, itemId: string, done: boolean): Promise<void> {
  if (!(await eventItemsExist(database.db))) return;
  const [item] = await database.db.select({ id: eventItems.id }).from(eventItems).where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.id, itemId)));
  if (!item) throw new EventError('ITEM_NOT_FOUND', 'That item is not on this event');
  await database.db
    .update(eventItems)
    .set({ doneAt: done ? new Date().toISOString() : null })
    .where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.id, itemId)));
}

/**
 * What a purchase's expense side comes to, in base minor units. The shares can never add to more than this.
 *
 * Summed first and clamped after, never absolved line by line: a receipt carrying a discount, a partial refund or a
 * price correction booked back to a spending category spends the *net*, and taking each line's size would report a
 * ceiling larger than the money that ever left the account — rupiah invented on the one axis this module exists to
 * protect. A receipt that is a refund on balance comes to nought and can answer nothing, which is the honest reading:
 * `Math.max(0, …)` rather than the total's own size, so nothing is settled by money that came back.
 */
async function expenseTotalOf(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<number> {
  const rows = await tx
    .select({ amount: entries.amountBaseMinor })
    .from(entries)
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(and(eq(entries.workspaceId, ws.workspaceId), eq(entries.transactionId, transactionId), eq(accounts.kind, 'expense')));
  return Math.max(
    0,
    rows.reduce((total, row) => total + row.amount, 0),
  );
}

export interface PurchaseCover {
  transactionId: string;
  occurredOn: string;
  description: string;
  totalMinor: number;
  givenMinor: number;
  leftMinor: number;
  covers: { itemId: string; shareMinor: number }[];
}

/**
 * Read against the event the payment is tagged to *now*, never against every item that ever named it.
 *
 * Retagging a receipt from one occasion to another leaves the first occasion's item still pointing at it — the link
 * is deliberately not torn down, so that tagging it back puts the tick straight back where it was. Counted here,
 * that ghost would go on claiming its share of a receipt that has moved: a Rp30.000 receipt retagged with Rp10.000
 * already given to the old event's item defaults the new event's tick to Rp20.000, and the plan then shows an
 * unexplainable Rp10.000 under with nothing on screen able to say where the rest went.
 *
 * Scoping the reading rather than clearing the cover on retag is the same rule `eventPlan` already follows — it
 * counts what each purchase has answered from the items of the event being read, and nothing else — so this is the
 * two sides agreeing rather than a new rule. It also destroys nothing: a receipt tagged back reads exactly as it
 * did before, where clearing the shares would lose a cover screen's worth of typing to a mis-tap. A payment tagged
 * to no event answers no items at all, which is what `purchaseFor` already refuses to let anyone write.
 */
async function coverOf(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<PurchaseCover> {
  const [found] = await tx
    .select({ occurredOn: transactions.occurredOn, description: transactions.description, eventId: transactions.eventId })
    .from(transactions)
    .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.id, transactionId)));
  if (!found) throw new EventError('NOT_FOUND', 'That payment is not in this workspace');
  const { eventId, ...row } = found;
  const totalMinor = await expenseTotalOf(tx, ws, transactionId);
  const covers =
    eventId !== null && (await eventItemsExist(tx)) && (await purchasesExist(tx))
      ? await tx
          .select({ itemId: eventItemPurchases.itemId, shareMinor: eventItemPurchases.shareMinor })
          .from(eventItemPurchases)
          .innerJoin(eventItems, eq(eventItems.id, eventItemPurchases.itemId))
          .where(
            and(
              eq(eventItemPurchases.workspaceId, ws.workspaceId),
              eq(eventItemPurchases.transactionId, transactionId),
              eq(eventItems.eventId, eventId),
            ),
          )
      : [];
  const givenMinor = covers.reduce((total, cover) => total + cover.shareMinor, 0);
  return { transactionId, ...row, totalMinor, givenMinor, leftMinor: totalMinor - givenMinor, covers };
}

/** The receipt, what of it already answers items, and what is left — the three figures the cover screen shows. */
export function purchaseCover(database: Database, ws: WorkspaceContext, transactionId: string): Promise<PurchaseCover> {
  return coverOf(database.db, ws, transactionId);
}

/** A payment can only answer items on the event it is tagged to, and only while it is still posted. */
async function purchaseFor(tx: Db, ws: WorkspaceContext, eventId: string, transactionId: string): Promise<void> {
  const [purchase] = await tx
    .select({ eventId: transactions.eventId, status: transactions.status })
    .from(transactions)
    .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.id, transactionId)));
  if (!purchase || purchase.status !== 'posted' || purchase.eventId !== eventId) {
    throw new EventError('NOT_TAGGED', 'Only a payment already tagged to this event can answer an item');
  }
}

/** The occasion a payment is tagged to right now, or null. The one scope a cover screen may read or write. */
async function taggedEventOf(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<string | null> {
  const [purchase] = await tx
    .select({ eventId: transactions.eventId })
    .from(transactions)
    .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.id, transactionId)));
  if (!purchase) throw new EventError('NOT_FOUND', 'That payment is not in this workspace');
  return purchase.eventId;
}

/**
 * Says a purchase answered this item, and how much of it this item is.
 *
 * The share defaults to **what is left of the receipt** — the whole of it when this is the first item ticked off
 * against it, which is the ordinary case of one receipt buying one thing. Defaulting to the estimate instead was
 * tried and is wrong: the estimate is what was *planned* and the receipt is what was *spent*, and the difference
 * between the two is the only thing "Difference so far" exists to say. Clamping to the estimate reports every under
 * (the clamp lets a cheaper receipt through whole) and no over (the surplus is trimmed away), so an occasion that
 * went over on every single purchase would read as exactly on plan while the overspend piled up silently under
 * "Not planned for" — money the plan would be disowning, item by item, with nowhere on screen saying why.
 *
 * The cost of this choice is that a receipt answering several items has its whole amount taken by the first tick,
 * and the second is then refused with nothing left. That is the honest state of affairs — the app cannot know a
 * receipt is shared until it is told — and it is what "What it covers" is for: one screen, every share typed
 * together, checked against the receipt in one write. A tick is for the receipt that is the item.
 *
 * An explicit share bigger than what is left is refused rather than quietly trimmed: a figure someone typed is
 * a claim about the receipt, and trimming it would put a number on screen that nobody chose.
 */
export async function linkEventItem(
  database: Database,
  ws: WorkspaceContext,
  itemId: string,
  transactionId: string,
  shareMinor?: number,
): Promise<void> {
  if (!(await eventItemsExist(database.db)) || !(await purchasesExist(database.db))) return;
  await database.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(eventItems)
      .where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.id, itemId)));
    if (!item) throw new EventError('ITEM_NOT_FOUND', 'That item is not on this event');
    await purchaseFor(tx, ws, item.eventId, transactionId);

    const cover = await coverOf(tx, ws, transactionId);
    // Re-linking the same item does not have to fit twice over: its own share is what it is replacing.
    const left = cover.leftMinor + (cover.covers.find((row) => row.itemId === itemId)?.shareMinor ?? 0);
    // What is left is always a figure this receipt can answer, so the default needs no clamping of its own. Nought
    // left is not a share but the absence of one, and `checkShare` refuses it: a receipt already spoken for cannot
    // also buy this, and saying so is better than writing a share nobody could read.
    /*
     * Nothing left is its own refusal, not a bad figure. `checkShare` would call this `SHARE_RANGE` — "a share is a
     * whole figure above nought" — at somebody who typed no figure at all and only ticked a box, which is nonsense
     * as a message and useless as a code: a screen cannot tell it apart from a genuinely malformed share, so it
     * cannot route the one case that has somewhere to go. A receipt already spoken for is answered on "What it
     * covers", where every share is typed together against the one payment.
     */
    if (shareMinor === undefined && left <= 0 && cover.totalMinor > 0) {
      throw new EventError('NOTHING_LEFT', 'That payment already answers other items. Say what the receipt covers to split it between them.');
    }
    const share = shareMinor ?? left;
    checkShare(share);
    if (share > left) throw new EventError('OVER_ALLOCATED', `Only ${left} of this payment is still unaccounted for`);

    await writeShare(tx, ws, itemId, transactionId, share);
  });
}

/**
 * What one receipt covers, in one write: every item named is linked with its share, and every item that named this
 * receipt and is no longer in the list is unlinked.
 *
 * Refused as a whole — inside one database transaction, so nothing at all is written — when a share is not a whole
 * figure above nought, when an item is not there, when the payment is not tagged to the item's event, or when the
 * shares add to more than the payment. The last is the one the plan depends on: the leftover it shows as "not planned
 * for" is the receipt less its shares, so shares adding to more than the receipt would drive that below nought and
 * quietly lose the row. A share is a reading of a purchase, never an edit of one; nothing here posts, moves or splits
 * an entry.
 *
 * The sweep that unlinks is narrowed to the occasion the payment is tagged to now, exactly as `coverOf` reads it.
 * Unscoped, it destroyed typing: a receipt retagged from one occasion to another leaves the first occasion's item
 * still pointing at it — on purpose, so tagging it back puts the tick back — and that item is invisible to the new
 * occasion's cover screen, so it can never be in `wanted`. An unscoped sweep therefore set it to (null, null) on the
 * first save made on the new occasion, and tagging back no longer brought it home. A screen may only unpick what it
 * could show. A payment tagged to no occasion is the same rule at its limit: it shows nothing, so it unpicks nothing.
 */
export async function setPurchaseCover(
  database: Database,
  ws: WorkspaceContext,
  transactionId: string,
  covers: readonly { itemId: string; shareMinor: number }[],
): Promise<void> {
  if (!(await eventItemsExist(database.db)) || !(await purchasesExist(database.db))) return;
  for (const cover of covers) checkShare(cover.shareMinor);
  // Keyed by item, so an item named twice is one share and not two — the figure checked is the figure written.
  const wanted = new Map(covers.map((cover) => [cover.itemId, cover.shareMinor]));

  await database.transaction(async (tx) => {
    const taggedTo = await taggedEventOf(tx, ws, transactionId);
    const totalMinor = await expenseTotalOf(tx, ws, transactionId);
    let given = 0;
    for (const share of wanted.values()) given += share;
    if (given > totalMinor) throw new EventError('OVER_ALLOCATED', `Those shares come to ${given}, and the payment is only ${totalMinor}`);

    for (const itemId of wanted.keys()) {
      const [item] = await tx
        .select({ eventId: eventItems.eventId })
        .from(eventItems)
        .where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.id, itemId)));
      if (!item) throw new EventError('ITEM_NOT_FOUND', 'That item is not on this event');
      await purchaseFor(tx, ws, item.eventId, transactionId);
    }

    const rows =
      taggedTo === null
        ? []
        : await tx
            .select({ id: eventItemPurchases.itemId })
            .from(eventItemPurchases)
            .innerJoin(eventItems, eq(eventItems.id, eventItemPurchases.itemId))
            .where(
              and(
                eq(eventItemPurchases.workspaceId, ws.workspaceId),
                eq(eventItemPurchases.transactionId, transactionId),
                eq(eventItems.eventId, taggedTo),
              ),
            );
    for (const row of rows) if (!wanted.has(row.id)) await writeShare(tx, ws, row.id, transactionId, null);
    for (const [itemId, shareMinor] of wanted) await writeShare(tx, ws, itemId, transactionId, shareMinor);
  });
}

/**
 * Moves every share onto a corrected purchase. A correction voids and reposts under a new id, so without this every
 * edit of a receipt would quietly untick everything it answered.
 *
 * When the correction is smaller than the shares add to, they are cut in proportion. Refusing the correction instead
 * would leave someone unable to fix a wrong amount because the amount is wrong.
 *
 * Whole minor units cannot divide in proportion, so each share is floored and the rupiah left over go to the largest
 * share — largest because that is where a rupiah is least visible, and one place because the shares of one purchase
 * must add back to that purchase exactly or the leftover the plan reads is a lie. The arithmetic is done in BigInt:
 * an Indonesian share times an Indonesian total passes what a double can count in whole numbers long before either
 * figure looks large on screen, and money here is never a float.
 */
/**
 * Cuts the plan's covers of one purchase back to what it now spent, when they add to more (withdrawal rate, final
 * review M1). Covers are stored base figures; the withdrawal rate's recalculation rewrites a purchase's figures in place
 * — a cheaper withdrawal recorded late lowers what it spent — and nothing else would bring its covers along, so the
 * next cover edit on it would be refused as OVER_ALLOCATED. The same cut in proportion as an edit's (`carryEventItemTx`);
 * covers that still fit are left exactly as they are.
 */
export async function clampEventItemsTx(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<void> {
  if (!(await eventItemsExist(tx)) || !(await purchasesExist(tx))) return;
  const [row] = await tx.values<[number | null]>(sql`
    SELECT sum(max(0, share_minor)) FROM event_item_purchases WHERE workspace_id = ${ws.workspaceId} AND transaction_id = ${transactionId}`);
  const given = Number(row?.[0] ?? 0);
  if (given > 0 && given > (await expenseTotalOf(tx, ws, transactionId))) await carryEventItemTx(tx, ws, transactionId, transactionId);
}

export async function carryEventItemTx(tx: Db, ws: WorkspaceContext, from: string, to: string): Promise<void> {
  if (!(await eventItemsExist(tx)) || !(await purchasesExist(tx))) return;
  const rows = await tx
    .select({ id: eventItemPurchases.itemId, shareMinor: eventItemPurchases.shareMinor, createdAt: eventItemPurchases.createdAt })
    .from(eventItemPurchases)
    .where(and(eq(eventItemPurchases.workspaceId, ws.workspaceId), eq(eventItemPurchases.transactionId, from)));
  if (rows.length === 0) return;

  // Read as nought below nought, the same defensiveness `coverOf` shows a half-set row. Nothing here can write a
  // negative share, but the schema permits one, and the cut in proportion only adds back to the corrected figure
  // exactly while every share is non-negative: BigInt division truncates toward nought rather than flooring, so one
  // negative row would leave the shares written adding to more than the receipt.
  const shares = rows.map((row) => {
    const was = Math.max(0, row.shareMinor ?? 0);
    return { id: row.id, was, share: was, since: row.createdAt };
  });
  const old = shares.reduce((total, row) => total + row.was, 0);
  const now = await expenseTotalOf(tx, ws, to);
  if (old > now && old > 0) {
    const [big, size] = [BigInt(now), BigInt(old)];
    for (const row of shares) row.share = Number((BigInt(row.was) * big) / size);
    const largest = shares.reduce((best, row) => (row.was > best.was ? row : best), shares[0]!);
    largest.share += now - shares.reduce((total, row) => total + row.share, 0);
  }
  for (const row of shares) {
    // A share rounded down to nothing is not a share: that item simply stops being answered by this receipt.
    if (from !== to) await writeShare(tx, ws, row.id, from, null);
    await writeShare(tx, ws, row.id, to, row.share > 0 ? row.share : null, row.since);
  }
}
