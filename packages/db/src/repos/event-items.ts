import { uuidv7 } from '@expanses/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
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

/**
 * The purchase that answered an item and how much of it that item is: one fact, in two columns.
 *
 * 0049 says "both NULL, or both set" in a comment and nothing enforces it, so the rule is kept here instead — every
 * write of the pair goes through `writeCover`, which takes the two together or neither, so a row settled by a purchase
 * with no figure, or carrying a figure against no purchase, is not a value this module can even express. SQLite cannot
 * be given a CHECK after the fact without rebuilding the table, and amending 0049 in place would leave the constraint
 * present on a fresh database and absent on one that already ran it — an invariant true in some copies and not others
 * is worse than one upheld in the single module that writes the table.
 */
type Cover = { transactionId: string; shareMinor: number } | null;

function writeCover(tx: Db, ws: WorkspaceContext, itemId: string, cover: Cover): Promise<unknown> {
  return tx
    .update(eventItems)
    .set({ transactionId: cover?.transactionId ?? null, shareMinor: cover?.shareMinor ?? null })
    .where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.id, itemId)));
}

/** A share is whole minor units above nought. Nought is not a share — it is the absence of one, which is unlinking. */
function checkShare(share: number): void {
  if (!Number.isInteger(share) || share <= 0) throw new EventError('SHARE_RANGE', 'A share is a whole figure above nought');
}

/** Takes the tick off. The payment is untouched, and the other items on the same receipt keep their shares. */
export async function unlinkEventItem(database: Database, ws: WorkspaceContext, itemId: string): Promise<void> {
  if (!(await eventItemsExist(database.db))) return;
  await writeCover(database.db, ws, itemId, null);
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
    eventId !== null && (await eventItemsExist(tx))
      ? (
          await tx
            .select({ itemId: eventItems.id, shareMinor: eventItems.shareMinor })
            .from(eventItems)
            .where(
              and(
                eq(eventItems.workspaceId, ws.workspaceId),
                eq(eventItems.transactionId, transactionId),
                eq(eventItems.eventId, eventId),
              ),
            )
        )
        // A share of null answers for nothing. The pair is kept whole above, so this only guards a row some other
        // hand left half set: it reads as unsettled, which cannot make the leftover smaller than it truly is.
          .map((cover) => ({ itemId: cover.itemId, shareMinor: cover.shareMinor ?? 0 }))
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
  if (!(await eventItemsExist(database.db))) return;
  await database.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(eventItems)
      .where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.id, itemId)));
    if (!item) throw new EventError('ITEM_NOT_FOUND', 'That item is not on this event');
    await purchaseFor(tx, ws, item.eventId, transactionId);

    const cover = await coverOf(tx, ws, transactionId);
    // Re-linking the same item does not have to fit twice over: its own share is what it is replacing.
    const left = cover.leftMinor + (item.transactionId === transactionId ? (item.shareMinor ?? 0) : 0);
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

    await writeCover(tx, ws, itemId, { transactionId, shareMinor: share });
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
 */
export async function setPurchaseCover(
  database: Database,
  ws: WorkspaceContext,
  transactionId: string,
  covers: readonly { itemId: string; shareMinor: number }[],
): Promise<void> {
  if (!(await eventItemsExist(database.db))) return;
  for (const cover of covers) checkShare(cover.shareMinor);
  // Keyed by item, so an item named twice is one share and not two — the figure checked is the figure written.
  const wanted = new Map(covers.map((cover) => [cover.itemId, cover.shareMinor]));

  await database.transaction(async (tx) => {
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

    const rows = await tx
      .select({ id: eventItems.id })
      .from(eventItems)
      .where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.transactionId, transactionId)));
    for (const row of rows) if (!wanted.has(row.id)) await writeCover(tx, ws, row.id, null);
    for (const [itemId, shareMinor] of wanted) await writeCover(tx, ws, itemId, { transactionId, shareMinor });
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
export async function carryEventItemTx(tx: Db, ws: WorkspaceContext, from: string, to: string): Promise<void> {
  if (!(await eventItemsExist(tx))) return;
  const rows = await tx
    .select({ id: eventItems.id, shareMinor: eventItems.shareMinor })
    .from(eventItems)
    .where(and(eq(eventItems.workspaceId, ws.workspaceId), eq(eventItems.transactionId, from)));
  if (rows.length === 0) return;

  // Read as nought below nought, the same defensiveness `coverOf` shows a half-set row. Nothing here can write a
  // negative share, but the schema permits one, and the cut in proportion only adds back to the corrected figure
  // exactly while every share is non-negative: BigInt division truncates toward nought rather than flooring, so one
  // negative row would leave the shares written adding to more than the receipt.
  const shares = rows.map((row) => {
    const was = Math.max(0, row.shareMinor ?? 0);
    return { id: row.id, was, share: was };
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
    await writeCover(tx, ws, row.id, row.share > 0 ? { transactionId: to, shareMinor: row.share } : null);
  }
}
