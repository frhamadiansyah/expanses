import { transferName } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { localDeviceId, withCapture } from '../sync/capture';
import { meetsVersion } from '../sync/events/version';
import type { EventBookRow } from './shared-event-records';

/*
 * A household-shared workspace's transfer listed on a shared event (trip withdrawal, owner, 13 Nov 2026): an ATM
 * withdrawal for the trip leaves the workspace's list on every phone and shows on the trip's day list, grey, not
 * counted — no share, no total, no balance, no settle-up. Nothing on the event's own book changes, so the event's other
 * people never see it: the row is the workspace's redacted transfer (`shared_transfers`, 0094), naming the event by its
 * book id (`event_book_id`, 0114), which the household's phones alone hold. The ledger transaction is never touched:
 * the accounts' history and balances stay exactly as they were.
 *
 * Only the phone that recorded the transfer lists it or takes it off (the row is its recorder's to write, as a purchase
 * is its payer's to move). Every message names things and never says "you" (the owner's rule).
 */

/**
 * The first app version that reads `event_book_id` (0114). An older build applies the row's other fields and passes this
 * one over, keeping its clock: it would list the transfer in the workspace for ever, even once updated. So a transfer is
 * listed on an event only while every other device in the workspace says it runs this version or later.
 */
export const TRIP_TRANSFERS_MIN_APP_VERSION = '0.5.2';

const KEY = 'book_transfer';

/** One transfer listed on a shared event, as the event page shows it. */
export interface SharedEventTransferView {
  /** The workspace's row id: the root of the transfer's replaces chain, the same on every phone. */
  transferId: string;
  occurredOn: string;
  amountMinor: number;
  currency: string;
  description: string;
  /** Who recorded it, by the name the workspace knows them by. */
  recordedByName: string;
  /**
   * The account the money left and the one it reached. On the recorder's phone, its own accounts' names; on the
   * partner's, only an account its owner shares with the household (a private side is null).
   */
  fromName: string | null;
  toName: string | null;
  /**
   * What the two accounts make the transfer ("Cash withdrawal"), known only where their kinds are: the recorder's own
   * phone. The partner's copy carries names alone, so it reads null there and the row keeps its note as its title.
   */
  name?: string | null;
  /** The recorder's own transaction, on the recorder's phone: what a tap opens. Null on the partner's phone. */
  transactionId: string | null;
}

interface LiveRow {
  bookId: string;
  transferId: string;
  eventBookId: string | null;
}

/** The workspace row a live transfer recorded on this phone stands behind, or null. */
async function liveRowTx(tx: Db, transactionId: string): Promise<LiveRow | null> {
  if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_transfers'`)).length === 0) return null;
  const [row] = await tx.values<[string, string, string | null]>(sql`
    SELECT book_id, transfer_id, event_book_id FROM shared_transfers WHERE transaction_id = ${transactionId} AND void = 0 ORDER BY book_id LIMIT 1`);
  return row ? { bookId: row[0], transferId: row[1], eventBookId: row[2] } : null;
}

/** The other devices in the workspace on a build that would keep the transfer in it, by name. */
async function devicesBelowTx(tx: Db, bookId: string): Promise<string[]> {
  const self = await localDeviceId(tx);
  const rows = await tx.values<[string, string, string | null]>(sql`
    SELECT device_id, name, app_version FROM book_devices WHERE book_id = ${bookId} AND removed_at IS NULL ORDER BY name, device_id`);
  return rows.filter(([id, , version]) => id !== self && !meetsVersion(version, TRIP_TRANSFERS_MIN_APP_VERSION)).map(([, name]) => name || 'another phone');
}

/**
 * The other devices in the workspace that are not in the event (`book_devices` of each book; a device's id is the same in
 * every book it is in), by name. On one of them the transfer would leave the workspace's list and be on no trip page.
 */
async function devicesNotInEventTx(tx: Db, bookId: string, eventBookId: string): Promise<string[]> {
  const self = await localDeviceId(tx);
  const rows = await tx.values<[string, string]>(sql`
    SELECT device_id, name FROM book_devices
    WHERE book_id = ${bookId} AND removed_at IS NULL
      AND device_id NOT IN (SELECT device_id FROM book_devices WHERE book_id = ${eventBookId} AND removed_at IS NULL)
    ORDER BY name, device_id`);
  return rows.filter(([id]) => id !== self).map(([, name]) => name || 'another phone');
}

/**
 * Why a transfer with no workspace row stays (review fix round 1, M8): filed in a shared workspace before that workspace
 * sent its transfers to the household (the partner never had it); filed in no workspace, so it shows in every one; or
 * filed in a workspace no one shares.
 */
async function bareTransferRefusalTx(tx: Db, transactionId: string): Promise<string> {
  const filed = await tx.values<[string, string | null, number]>(sql`
    SELECT bt.book_id, b.name, EXISTS (SELECT 1 FROM shared_books s WHERE s.book_id = bt.book_id) FROM book_transactions bt
    LEFT JOIN books b ON b.id = bt.book_id WHERE bt.transaction_id = ${transactionId} ORDER BY bt.book_id`);
  const shared = filed.find(([, , isShared]) => Number(isShared) === 1);
  if (shared) {
    const name = shared[1] || 'the shared workspace';
    return `Recorded before ${name} sent its transfers to the household, so the other phones never had it: it stays in ${name}`;
  }
  if (filed.length === 0) return 'A transfer filed in no workspace shows in every one: only one in a workspace shared with a household moves into a shared event';
  return 'Only a transfer in a workspace shared with a household moves into a shared event';
}

/**
 * What moving a transaction into a shared event does when it is a transfer: 'listed' once its workspace row names the
 * event, the reason it stays when it cannot be listed, or null when it is no transfer (a purchase or a refund, which
 * move as expenses) — or no transaction here at all, which the purchase path reports.
 */
export async function transferIntoEventTx(tx: Db, ws: WorkspaceContext, transactionId: string, book: EventBookRow): Promise<'listed' | string | null> {
  const [head] = await tx.values<[string]>(sql`SELECT status FROM transactions WHERE id = ${transactionId} AND workspace_id = ${ws.workspaceId}`);
  if (!head || head[0] !== 'posted') return null;
  // A shared event's own posting (a settle-up, a share): the purchase path says so in its own words.
  if ((await tx.values(sql`SELECT 1 FROM event_postings WHERE transaction_id = ${transactionId}`)).length > 0) return null;
  const row = await liveRowTx(tx, transactionId);
  if (!row) {
    const lines = await tx.values<[number, string, string]>(sql`
      SELECT e.amount_minor, a.kind, a.subtype FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${transactionId}`);
    const categories = lines.filter(([, kind]) => kind === 'income' || kind === 'expense');
    if (lines.length === 0) return null;
    // A transfer with no workspace row: nothing would take it off another phone's list. Why it has none, in its words.
    if (categories.length === 0) return bareTransferRefusalTx(tx, transactionId);
    // Money leaving one account and reaching another, with a fee spent beside it: a transfer and a purchase in one row.
    const money = lines.filter(([, kind, subtype]) => (kind === 'asset' || kind === 'liability') && !['receivable', 'payable', 'event_balance'].includes(subtype));
    const fee = categories.length === 1 && categories[0]![1] === 'expense' && money.some(([amount]) => Number(amount) > 0) && money.some(([amount]) => Number(amount) < 0);
    return fee ? 'A transfer with a fee on the same row stays: take the fee off first' : null;
  }
  if (row.eventBookId !== null) return 'Already in a shared event';
  const below = await devicesBelowTx(tx, row.bookId);
  if (below.length > 0) {
    const [named] = await tx.values<[string]>(sql`SELECT name FROM books WHERE id = ${row.bookId}`);
    return `Update cicis on ${below.join(' and ')} first: until then it would stay in ${named?.[0] || 'the shared workspace'} there`;
  }
  // Every phone in the workspace must have the trip, or the transfer would vanish there (review fix round 1, M3).
  const outside = await devicesNotInEventTx(tx, row.bookId, book.bookId);
  if (outside.length > 0) return `${outside.join(' and ')} ${outside.length === 1 ? 'is' : 'are'} not in ${book.name}, so there it would show in neither place`;
  await withCapture(tx, { entity: KEY, id: row.transferId, bookId: row.bookId }, () =>
    tx.run(sql`UPDATE shared_transfers SET event_book_id = ${book.bookId} WHERE book_id = ${row.bookId} AND transfer_id = ${row.transferId}`),
  );
  // An event tag an older build left on it never travelled: listed, it is on the event by the row alone, on every phone.
  await tx.run(sql`UPDATE transactions SET event_id = NULL WHERE id = ${transactionId} AND event_id IS NOT NULL`);
  return 'listed';
}

/**
 * Remove from event for a listed transfer: it is back in its workspace's list on every phone, and off the event. Allowed
 * whatever became of the event here (done, left, its copy deleted), so a transfer is never stranded off every list.
 * False when the transfer is on no event (nothing to do).
 */
export async function removeTransferFromSharedEvent(database: Database, ws: WorkspaceContext, transactionId: string): Promise<boolean> {
  return database.transaction(async (tx) => {
    const [head] = await tx.values(sql`SELECT 1 FROM transactions WHERE id = ${transactionId} AND workspace_id = ${ws.workspaceId}`);
    if (!head) return false;
    const row = await liveRowTx(tx, transactionId);
    if (!row || row.eventBookId === null) return false;
    await withCapture(tx, { entity: KEY, id: row.transferId, bookId: row.bookId }, () =>
      tx.run(sql`UPDATE shared_transfers SET event_book_id = NULL WHERE book_id = ${row.bookId} AND transfer_id = ${row.transferId}`),
    );
    return true;
  });
}

/** The event a transfer recorded here is listed on, for its receipt: the event's local id and name, or null when none. */
export async function eventTransferOf(database: Database, transactionId: string): Promise<{ eventId: string | null; eventName: string | null } | null> {
  const row = await liveRowTx(database.db, transactionId);
  if (!row || row.eventBookId === null) return null;
  const [event] = await database.db.values<[string, string | null]>(sql`
    SELECT e.event_id, s.name FROM event_books e LEFT JOIN shared_events s ON s.book_id = e.book_id WHERE e.book_id = ${row.eventBookId}`);
  return { eventId: event?.[0] ?? null, eventName: event?.[1] ?? null };
}

/** The account names of a transfer recorded here: the largest line out and the largest line in. */
async function ownNamesTx(db: Db, transactionId: string): Promise<{ fromName: string | null; toName: string | null; name: string | null }> {
  const lines = await db.values<[number, string, string, string]>(sql`
    SELECT e.amount_minor, a.name, a.subtype, e.currency FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${transactionId} AND a.kind IN ('asset', 'liability')`);
  const out = lines.filter(([amount]) => Number(amount) < 0).sort((a, b) => Number(a[0]) - Number(b[0]))[0];
  const into = lines.filter(([amount]) => Number(amount) > 0).sort((a, b) => Number(b[0]) - Number(a[0]))[0];
  // Named only by a plain two-sided transfer; a fee line beside it is not a money account.
  const name = lines.length === 2 && out && into ? transferName({ subtype: out[2], currency: out[3] }, { subtype: into[2], currency: into[3] }) : null;
  return { fromName: out?.[1] ?? null, toName: into?.[1] ?? null, name };
}

/** The household's transfers listed on an event book, oldest first. Only a phone in that household holds any. */
export async function eventTransfersTx(db: Db, eventBookId: string): Promise<SharedEventTransferView[]> {
  if ((await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_transfers'`)).length === 0) return [];
  const rows = await db.values<[string, string, string, number, string, string, string, string | null, string | null, string | null, string | null]>(sql`
    SELECT t.transfer_id, t.book_id, t.occurred_on, t.amount_minor, t.currency, t.description, t.recorded_by, t.from_name, t.to_name, t.transaction_id,
           (SELECT m.name FROM book_members m WHERE m.book_id = t.book_id AND m.member_id = t.recorded_by)
    FROM shared_transfers t WHERE t.event_book_id = ${eventBookId} AND t.void = 0
    ORDER BY t.occurred_on, t.transfer_id`);
  const out: SharedEventTransferView[] = [];
  for (const [transferId, , occurredOn, amountMinor, currency, description, , fromName, toName, transactionId, recordedByName] of rows) {
    // The recorder's own live transaction names its own accounts; a stale pointer (not posted here) names none of them.
    const [live] = transactionId ? await db.values(sql`SELECT 1 FROM transactions WHERE id = ${transactionId} AND status = 'posted'`) : [];
    const names = live ? await ownNamesTx(db, transactionId!) : { fromName, toName };
    out.push({
      transferId,
      occurredOn,
      amountMinor: Number(amountMinor),
      currency,
      description,
      recordedByName: recordedByName || 'Someone',
      ...names,
      transactionId: live ? transactionId : null,
    });
  }
  return out;
}
