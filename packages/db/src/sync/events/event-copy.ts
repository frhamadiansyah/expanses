import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../context';
import type { Database, Tx } from '../../database';
import { pauseCapture } from '../capture';
import { SharingError } from '../seed';
import { DELETED_COPY_MEMBER_KEY, dropEventLogTx } from './event-log';

/*
 * Delete this copy (owner report, 2026-11-12): a shared event this phone's person is no longer in (left, removed, the
 * share ended, waiting for an invite) is kept here read-only, and had no way off the Events list. This takes it off,
 * on this phone alone. Nothing is sent: the relay, and every other phone, never hear of it.
 *
 * What goes is the event's own log as this phone holds it — the event, its people, categories, expenses and their
 * details, settle-ups, plan items and currency lock — with the book's sync state (outbox, cursor, clocks, tombstones,
 * skipped ops, authority view, used invites, epoch keys, devices, members, the log-row bookkeeping, the share row). The
 * local `events` row is archived, as Remove archives an event that is not shared (`deleteEvent`).
 *
 * What stays is everything of this person's own money, so no balance and no workspace list changes:
 *   - every transaction the event put in this phone's books (`event_postings`): none is voided, erased or re-filed.
 *     They are in no workspace (§5.1) and stay so: `event_postings` is what keeps them out of every workspace list,
 *     Cashflow and budget — taking it away would put them in all of them — and what makes a later pull of the same
 *     records follow them rather than post them again;
 *   - the trip balance and this phone's copies of the event categories (`event_category_accounts`), which those
 *     transactions' lines are on;
 *   - this phone's hold on the event (`event_books`: its workspace, its local event, its trip balance), so an invite to
 *     this event again joins only as the person its invite names (`joinEvent`'s held path) and follows the kept
 *     transactions, never posting this person's share twice nor voiding what was kept.
 *
 * Refused while the share is active here (that is Leave) and for a book that is not a shared event's.
 */

/** The words of the refusal for a live copy: it is left, not deleted. */
export const ACTIVE_COPY_MESSAGE = 'This event is still shared here. Leave it instead.';

/** Settings keys that hold this phone's bookkeeping of one book, by prefix. */
const BOOK_SETTINGS = (bookId: string) => [
  `sharing.member.${bookId}`,
  `sharing.seen.${bookId}`,
  `sharing.arriving.${bookId}`,
  `sharing.replay.${bookId}`,
  `sync.seen.${bookId}`,
  `sync.received.${bookId}`,
  `shared-events.replay.${bookId}`,
];

async function tableExists(tx: Tx, name: string): Promise<boolean> {
  return (await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`)).length > 0;
}

/**
 * Deletes the read-only copy of a shared event on this phone (see the top of this file). One db transaction: a refusal
 * or a failure changes nothing. The caller takes a safety copy first (the screen does, as for a workspace's Delete).
 * Returns the local event id and how many of this person's own transactions were kept.
 */
export async function deleteEventCopy(database: Database, ws: WorkspaceContext, bookId: string): Promise<{ eventId: string; kept: number }> {
  return database.transaction(async (tx) => {
    // Nothing here is a captured write; capture is switched off all the same, so not one op can reach an outbox.
    pauseCapture(tx);
    const [held] = await tx.values<[string, string, string | null, string | null]>(sql`
      SELECT e.event_id, e.workspace_id, s.state, s.member_id FROM event_books e LEFT JOIN shared_books s ON s.book_id = e.book_id WHERE e.book_id = ${bookId}`);
    if (!held || held[1] !== ws.workspaceId) throw new SharingError('NOT_FOUND', 'That event is not on this phone');
    const [eventId, , state, member] = held;
    if (state === 'active') throw new SharingError('STILL_SHARED', ACTIVE_COPY_MESSAGE);
    // Who this phone's person was in the event outlives the share row, so an invite back is taken only as them.
    if (member) {
      await tx.run(sql`INSERT INTO settings (key, value) VALUES (${DELETED_COPY_MEMBER_KEY(bookId)}, ${member}) ON CONFLICT (key) DO NOTHING`);
    }

    await dropEventLogTx(tx, bookId);
    for (const table of ['sync_kept_clocks', 'shared_books']) {
      if (await tableExists(tx, table)) await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${bookId}`);
    }
    for (const key of BOOK_SETTINGS(bookId)) await tx.run(sql`DELETE FROM settings WHERE key = ${key}`);
    await tx.run(sql`UPDATE events SET archived_at = ${new Date().toISOString()} WHERE id = ${eventId} AND workspace_id = ${ws.workspaceId} AND archived_at IS NULL`);

    const [[kept]] = (await tx.values<[number]>(sql`
      SELECT count(*) FROM event_postings p JOIN transactions t ON t.id = p.transaction_id WHERE p.book_id = ${bookId} AND t.status = 'posted'`)) as [[number]];
    return { eventId, kept: Number(kept) };
  });
}
