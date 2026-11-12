import { sql } from 'drizzle-orm';
import type { Db } from '../database';
import { bookOfTransaction, lineageOfTransaction, projectPurchase } from '../sync/capture';

/*
 * What one phone may do to a shared workspace's purchase about events (sync gaps, owner decisions D1 and D3).
 *
 * D1: a shared workspace's spending never carries an event tag. A tag stays on the phone that set it (`event_id` never
 * travels), so the purchase would leave that phone's workspace totals and stay in the partner's: the two phones would
 * disagree. It may only be truly moved into a shared event, which takes it out of the workspace on both phones.
 *
 * D3: only the payer's own phone moves, tags or untags a shared workspace's purchase. Moving it voids it in the
 * workspace, and on the payer's phone that void is their own transaction: their account would lose the charge on the
 * word of the other phone. The same for a purchase paid with another member's money (their item, §5.3).
 *
 * Every message names things and never says "you" (the owner's rule).
 */

export interface SharedRow {
  bookId: string;
  bookName: string;
  /** This device's member in the book. */
  me: string;
}

/**
 * The shared workspace a transaction travels in, when it is one shared with members here: a `shared_books` row in any
 * state (a share that ended keeps its book read-only) and the book's members known. Null for anything else.
 */
export async function sharedRowTx(tx: Db, transactionId: string): Promise<SharedRow | null> {
  if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_books'`)).length === 0) return null;
  const bookId = await bookOfTransaction(tx, transactionId);
  if (!bookId) return null;
  const [row] = await tx.values<[string, string | null]>(sql`
    SELECT s.member_id, (SELECT name FROM books WHERE id = s.book_id) FROM shared_books s
    WHERE s.book_id = ${bookId} AND EXISTS (SELECT 1 FROM book_members m WHERE m.book_id = s.book_id)`);
  if (!row) return null;
  return { bookId, me: row[0], bookName: row[1] ?? 'The shared workspace' };
}

/** The name of the first of these books that is shared with members here (as `sharedRowTx` reads it), or null. */
export async function sharedBookNameTx(tx: Db, bookIds: readonly string[]): Promise<string | null> {
  if (bookIds.length === 0) return null;
  if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_books'`)).length === 0) return null;
  for (const bookId of bookIds) {
    const [row] = await tx.values<[string | null]>(sql`
      SELECT (SELECT name FROM books WHERE id = s.book_id) FROM shared_books s
      WHERE s.book_id = ${bookId} AND EXISTS (SELECT 1 FROM book_members m WHERE m.book_id = s.book_id)`);
    if (row) return row[0] ?? 'The shared workspace';
  }
  return null;
}

async function memberNameTx(tx: Db, bookId: string, memberId: string): Promise<string> {
  const [row] = await tx.values<[string]>(sql`SELECT name FROM book_members WHERE book_id = ${bookId} AND member_id = ${memberId}`);
  return row?.[0] || 'Another member';
}

/**
 * Why this phone may not move, tag or untag a shared workspace's purchase (D3), or null when it may: it was paid by
 * another member, or paid with another member's money. Null for a transaction in no shared workspace.
 */
export async function partnerPurchaseRefusalTx(tx: Db, transactionId: string, shared?: SharedRow | null): Promise<string | null> {
  const row = shared === undefined ? await sharedRowTx(tx, transactionId) : shared;
  if (!row) return null;
  const lineageId = await lineageOfTransaction(tx, transactionId);
  const [known] = await tx.values<[string, string, string | null, string | null]>(sql`
    SELECT paid_by, paid_label, paid_from_owner, paid_from_item FROM sync_lineage
    WHERE lineage_id = ${lineageId} AND book_id = ${row.bookId} AND head_transaction_id IS NOT NULL`);
  let paidBy: string;
  let fromOwner: string | null;
  if (known) {
    paidBy = known[0];
    fromOwner = known[2] && known[3] ? known[2] : null;
  } else {
    // Not sent yet (a lineage is written at the end of the db transaction that filed it): read off the row itself.
    const projected = await projectPurchase(tx, transactionId, row.me, null);
    paidBy = projected?.money.paidBy ?? row.me;
    fromOwner = projected?.money.paidFrom?.owner ?? null;
  }
  if (paidBy !== row.me) {
    const name = await memberNameTx(tx, row.bookId, paidBy);
    return `Paid by ${name}: moved from ${name}’s phone`;
  }
  if (fromOwner && fromOwner !== row.me) {
    const name = await memberNameTx(tx, row.bookId, fromOwner);
    return `Paid with ${name}’s money: it stays in ${row.bookName}`;
  }
  return null;
}

/** D1's refusal of an event tag on a shared workspace's purchase, in words a screen shows. */
export function sharedTagRefusal(bookName: string): string {
  return `${bookName} is shared, so its spending is never tagged to an event. Move it into a shared event instead, or record it in another workspace.`;
}

/**
 * Why this transaction may not be given this event tag (or, `eventId` null, have its tag taken off), or null when it
 * may. Only a shared workspace's purchase is ever refused: a tag (D1), or an untag of the partner's purchase (D3).
 */
export async function eventTagRefusalTx(tx: Db, transactionId: string, eventId: string | null): Promise<string | null> {
  const row = await sharedRowTx(tx, transactionId);
  if (!row) return null;
  if (eventId !== null) return sharedTagRefusal(row.bookName);
  const [tagged] = await tx.values<[string | null]>(sql`SELECT event_id FROM transactions WHERE id = ${transactionId}`);
  if (!tagged || tagged[0] === null) return null; // nothing to take off
  return partnerPurchaseRefusalTx(tx, transactionId, row);
}
