import { balances, formatMinor } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../context';
import type { Database, Db, Tx } from '../../database';
import { eventBookTx, eventRecordsTx, expenseReadIssue } from '../../repos/shared-event-records';
import { personRefusalTx } from '../../repos/shared-event-writes';
import { pauseCapture } from '../capture';
import { SharingError } from '../seed';
import { DELETED_COPY_MEMBER_KEY, dropEventLogTx } from './event-log';

/*
 * Delete this copy (owner report, 2026-11-12): a shared event this phone's person is no longer in (left, removed, or
 * the share stopped) is kept here read-only, and had no way off the Events list. This takes it off,
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
 * Refused (fix round 1) while the share is active here (that is Leave); while it waits for an invite (`needs_invite`:
 * the person is still in the event, and an invite brings the copy back to life); while this person's balance in the
 * copy is not zero — the trip balance keeps that figure in net worth, and the copy's records are the only account
 * here of who owes whom, so the copy stays until the balance is settled (review I1); and for a book that is not a
 * shared event's.
 */

/** The words of the refusal for a live copy: it is left, not deleted. */
export const ACTIVE_COPY_MESSAGE = 'This event is still shared here. Leave it instead.';

/** The words of the refusal for a copy waiting for an invite: its person is still in the event. */
export const WAITING_COPY_MESSAGE = 'This event waits for a new invite here: its person is still in it, so this copy is kept.';

export interface EventCopyPlan {
  /** Why the copy cannot be deleted, in words the screen shows as they are; null when it can. */
  refusal: string | null;
  refusalCode: 'NOT_FOUND' | 'STILL_SHARED' | 'NOT_SETTLED' | null;
  /** This person's balance in the copy's records, in the event currency (positive: the others owe this person). */
  balanceMinor: number;
  currency: string;
  /**
   * Records made on this phone that never reached the event's log (recorded offline before the share ended): after the
   * delete only the safety copy holds them. 0 when every record here is one the log took.
   */
  unsentHere: number;
}

const signed = (minor: number, currency: string) => `${minor > 0 ? '+' : '−'}${formatMinor(Math.abs(minor), currency)}`;

/** Expenses (either half), settle-ups and plan items, by the entity name the log keeps them under. */
const RECORD_TABLES: readonly [table: string, entity: string][] = [
  ['event_expenses', 'event_expense'],
  ['event_expense_details', 'event_expense_detail'],
  ['event_settlements', 'event_settlement'],
  ['event_items_shared', 'event_item'],
];

/**
 * The records here the log never took: a row with no account of it among the log's rows (`log-rows.ts`, which keeps
 * every op the log takes, this phone's own included), or one still waiting in the outbox. A book followed before the
 * log's rows were kept has none at all, and then only the outbox can tell.
 */
async function unsentHereTx(tx: Db, bookId: string): Promise<number> {
  const prefix = `shared-events.log.${bookId}|`;
  const [kept] = await tx.values(sql`SELECT 1 FROM settings WHERE substr(key, 1, ${prefix.length}) = ${prefix} LIMIT 1`);
  const ids = new Set<string>();
  if (kept) {
    for (const [table, entity] of RECORD_TABLES) {
      const rows = await tx.values<[string]>(sql`
        SELECT id FROM ${sql.raw(table)} WHERE book_id = ${bookId} AND NOT EXISTS (SELECT 1 FROM settings WHERE key = ${prefix} || ${entity} || '|' || id)`);
      for (const [id] of rows) ids.add(id);
    }
  }
  for (const [json] of await tx.values<[string]>(sql`SELECT entry_json FROM sync_outbox WHERE book_id = ${bookId}`)) {
    for (const op of (JSON.parse(json) as { ops: { entity: string; id: string }[] }).ops) if (RECORD_TABLES.some(([, entity]) => entity === op.entity)) ids.add(op.id);
  }
  return ids.size;
}

async function planTx(tx: Db, ws: WorkspaceContext, bookId: string): Promise<EventCopyPlan & { eventId: string | null; member: string | null }> {
  const [held] = await tx.values<[string, string, string | null, string | null]>(sql`
    SELECT e.event_id, e.workspace_id, s.state, s.member_id FROM event_books e LEFT JOIN shared_books s ON s.book_id = e.book_id WHERE e.book_id = ${bookId}`);
  const plan = (refusalCode: EventCopyPlan['refusalCode'], refusal: string | null, extra: Partial<EventCopyPlan> = {}) => ({
    refusal,
    refusalCode,
    balanceMinor: 0,
    currency: '',
    unsentHere: 0,
    eventId: held?.[0] ?? null,
    member: held?.[3] ?? null,
    ...extra,
  });
  if (!held || held[1] !== ws.workspaceId) return plan('NOT_FOUND', 'That event is not on this phone');
  const state = held[2];
  if (state === 'active') return plan('STILL_SHARED', ACTIVE_COPY_MESSAGE);
  if (state === 'needs_invite') return plan('STILL_SHARED', WAITING_COPY_MESSAGE);
  const unsentHere = await unsentHereTx(tx, bookId);
  // Before the event's own row arrived there is nothing of it here to owe anything by.
  const book = await eventBookTx(tx, bookId);
  if (!book) return plan(null, null, { unsentHere });
  const { expenses, settlements, people } = await eventRecordsTx(tx, bookId);
  const counted = expenses.filter((e) => !e.voided && expenseReadIssue(e, book.currency) === null);
  const balanceMinor = balances(counted, settlements, book.currency, [book.me])[book.me] ?? 0;
  const figures = { balanceMinor, currency: book.currency, unsentHere };
  // The same test Leave makes (D9), its balance part alone: being named in a record never keeps a copy.
  const refusal = await personRefusalTx(tx, book, book.me);
  if (refusal?.code === 'NOT_SETTLED' || balanceMinor !== 0) {
    const name = people.find((p) => p.personId === book.me)?.name ?? 'This person';
    const words =
      balanceMinor !== 0
        ? `${name}'s balance in ${book.name} is ${signed(balanceMinor, book.currency)}, not zero: this copy is kept as the record of who owes whom.`
        : `${refusal!.message.replace(/: settle up first$/, '')}, so this copy is kept.`;
    return plan('NOT_SETTLED', words, figures);
  }
  return plan(null, null, figures);
}

/** Whether the copy may be deleted, and what the confirm should say first. Reads only. */
export async function planEventCopyDelete(database: Database, ws: WorkspaceContext, bookId: string): Promise<EventCopyPlan> {
  const { eventId: _e, member: _m, ...plan } = await planTx(database.db, ws, bookId);
  void _e;
  void _m;
  return plan;
}

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
    const plan = await planTx(tx, ws, bookId);
    if (plan.refusalCode) throw new SharingError(plan.refusalCode, plan.refusal!);
    const eventId = plan.eventId!;
    const member = plan.member;
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
