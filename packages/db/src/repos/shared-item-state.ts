import { sql } from 'drizzle-orm';
import type { Db } from '../database';
import { withCapture } from '../sync/capture';

/*
 * A shared plan item's payments and done mark (0079), read and written in one place so the plan, the item's own
 * screens and an expense being deleted all agree on how the row holds them.
 */

/** One payment towards a shared item: an expense, and the item's part of it in the event currency. */
export interface SharedItemPart {
  expenseId: string;
  shareMinor: number;
}

/** An item's payments and done mark, as they are stored: the JSON array (0079), or before it the one expense pair. */
export interface SharedItemState {
  purchases: SharedItemPart[];
  done: boolean;
}

/** The payment the old pair carries for a phone a version behind: the largest while done, none while open. */
function mirrorOf(state: SharedItemState): SharedItemPart | null {
  if (!state.done) return null;
  return [...state.purchases].sort((a, b) => b.shareMinor - a.shareMinor || a.expenseId.localeCompare(b.expenseId))[0] ?? null;
}

/**
 * Read off the row. A row with no `purchases_json` was written before 0079 (or by a phone a version behind): its one
 * expense pair is its only payment, and linked was bought then, so it reads as done.
 *
 * A row whose old pair no longer says what its payments would put there was ticked or unticked since by a phone a
 * version behind, which writes only the pair. That phone's answer is the last word: the row reads as its pair, exactly
 * as that phone reads it, so every phone agrees — the next write from this version puts both halves right again.
 *
 * Payments travel as one field, so two phones adding a payment to the same item at the same moment keep only the
 * later one's list (last writer wins on the field). Rare on one item, and the expense itself is never lost.
 */
export function sharedItemState(row: { purchasesJson: string | null; doneAt: string | null; expenseId: string | null; shareMinor: number | null }): SharedItemState {
  if (row.purchasesJson !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.purchasesJson);
    } catch {
      parsed = [];
    }
    const purchases = (Array.isArray(parsed) ? parsed : [])
      .filter((part): part is SharedItemPart => typeof part?.expenseId === 'string' && Number.isSafeInteger(part?.shareMinor) && part.shareMinor > 0)
      .map((part) => ({ expenseId: part.expenseId, shareMinor: part.shareMinor }));
    const state = { purchases, done: row.doneAt !== null };
    const mirror = mirrorOf(state);
    const pair = row.expenseId !== null && row.shareMinor !== null ? { expenseId: row.expenseId, shareMinor: Number(row.shareMinor) } : null;
    if ((mirror?.expenseId ?? null) === (pair?.expenseId ?? null) && (mirror?.shareMinor ?? null) === (pair?.shareMinor ?? null)) return state;
    return { purchases: pair && pair.shareMinor > 0 ? [pair] : [], done: pair !== null && pair.shareMinor > 0 };
  }
  const linked = row.expenseId !== null && row.shareMinor !== null && Number(row.shareMinor) > 0;
  return { purchases: linked ? [{ expenseId: row.expenseId!, shareMinor: Number(row.shareMinor) }] : [], done: linked || row.doneAt !== null };
}

export async function itemRowTx(tx: Db, bookId: string, itemId: string) {
  const [row] = await tx.values<[string | null, string | null, string | null, number | null]>(
    sql`SELECT purchases_json, done_at, expense_id, share_minor FROM event_items_shared WHERE book_id = ${bookId} AND id = ${itemId}`,
  );
  if (!row) throw new Error('That item is no longer on the plan');
  return { purchasesJson: row[0], doneAt: row[1], expenseId: row[2], shareMinor: row[3] === null ? null : Number(row[3]) };
}

/**
 * Writes an item's payments and mark, and keeps the old pair for a phone a version behind: the largest payment while
 * the item is done, nothing while it is open — so there it reads bought exactly when it is done here.
 */
export async function writeItemStateTx(tx: Db, bookId: string, itemId: string, state: SharedItemState): Promise<void> {
  const was = await itemRowTx(tx, bookId, itemId);
  // A done item with nothing paid has no pair to carry, so a phone a version behind reads it as open.
  const largest = mirrorOf(state);
  const doneAt = state.done ? (was.doneAt ?? new Date().toISOString()) : null;
  await withCapture(tx, { entity: 'event_item', id: itemId, bookId }, () =>
    tx.run(sql`
      UPDATE event_items_shared
      SET purchases_json = ${JSON.stringify(state.purchases)}, done_at = ${doneAt}, expense_id = ${largest?.expenseId ?? null}, share_minor = ${largest?.shareMinor ?? null}
      WHERE book_id = ${bookId} AND id = ${itemId}`),
  );
}

/** Takes one expense off every item of a book that was paid with it — an expense deleted pays for nothing. */
export async function takeExpenseOffItemsTx(tx: Db, bookId: string, expenseId: string): Promise<void> {
  const rows = await tx.values<[string]>(
    sql`SELECT id FROM event_items_shared WHERE book_id = ${bookId} AND (expense_id = ${expenseId} OR purchases_json LIKE ${`%${expenseId}%`})`,
  );
  for (const [itemId] of rows) {
    const state = sharedItemState(await itemRowTx(tx, bookId, itemId));
    if (!state.purchases.some((part) => part.expenseId === expenseId)) continue;
    const purchases = state.purchases.filter((part) => part.expenseId !== expenseId);
    // Its only payment gone, an item is back on the list; paid in parts, it keeps its mark and its other payments.
    await writeItemStateTx(tx, bookId, itemId, { purchases, done: purchases.length > 0 && state.done });
  }
}
