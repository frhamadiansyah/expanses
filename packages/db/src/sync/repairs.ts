import { isoDate } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { resolveRates, type RateFetcher } from '../repos/fx';
import { eventBookOfEventTx } from '../repos/shared-event-records';
import { moveIntoSharedEvent, refundMatchedByName } from '../repos/shared-event-moves';
import { partnerPurchaseRefusalTx, sharedRowTx, untagSharedRowsTx } from '../repos/shared-workspace-rows';
import { captureConfigOf, lineageOfTransaction, projectPurchase, type SharedBook, writeChangeSetsTx } from './capture';
import { BILL_LINK_LEVEL, bookAtLevelTx } from './level';
import type { Op } from './types';
import { uuidv5 } from './uuidv5';

/** Where a repair move's expense id is named from. Fixed for ever: an id worked out under it may already be on a phone. */
const REPAIR_NAMESPACE = '5f0c9e3a-2b7d-4e61-9a48-c1d2e3f4a5b6';

/**
 * The expense a repair move makes (fix round 1, #7): named by the purchase (its lineage, the same on every phone) and
 * the event, so the same person's two phones moving it make one expense, not two.
 */
export function repairExpenseId(lineageId: string, eventId: string): Promise<string> {
  return uuidv5(REPAIR_NAMESPACE, `move:${lineageId}:${eventId}`);
}

/*
 * One-time repairs of a shared book (sync gaps phase 2), run on this phone once the book has pulled to the relay's
 * latest — so a partner's newer write is already here to be respected. Each repair is idempotent and keeps a done
 * marker in `settings` (`repair.<name>.v1.<bookId>`), written in the same db transaction as the ops it sends. A repair
 * that fails is reported and tried again on the next sync; it never stops a sync, and writes nothing it did not finish.
 *
 * R1 bill links: a purchase linked to a bill's month by an older build never sent the link (in a shared workspace the
 * link was refused; one made before sharing went as no bill). Once every device in the book reads links (`level.ts`),
 * each link here is sent, through the outbox with its clock — after a full pull it is this phone's merged value —
 * unless another payment settles the same month (it would read as paid twice). While a device is below, it waits.
 *
 * R2 event tags: a shared workspace's purchase tagged to an event but never moved there (owner decision D2, revised):
 * the payer's own phone moves it into the shared event when that event is active here, after fetching a missing rate;
 * anything else — the partner's purchase, a private event, a move refused — is untagged (the tag never travelled, so
 * nothing is sent), and listed for a one-time notice.
 */

const BILL_LINKS = 'bill-links';
const EVENT_TAGS = 'event-tags';
const NOTICE_PREFIX = 'repair.notice.v1.';

const markerKey = (name: string, bookId: string) => `repair.${name}.v1.${bookId}`;

async function doneTx(tx: Db, name: string, bookId: string): Promise<boolean> {
  return (await tx.values(sql`SELECT 1 FROM settings WHERE key = ${markerKey(name, bookId)}`)).length > 0;
}

async function markDoneTx(tx: Db, name: string, bookId: string): Promise<void> {
  await tx.run(sql`INSERT INTO settings (key, value) VALUES (${markerKey(name, bookId)}, ${new Date().toISOString()}) ON CONFLICT (key) DO NOTHING`);
}

/** One row of the notice: a shared workspace's purchase that was tagged to an event without being moved there. */
export interface RepairNoticeRow {
  transactionId: string;
  description: string;
  occurredOn: string;
  eventName: string;
  /** Moved into the shared event, or untagged (it shows in the workspace again). */
  outcome: 'moved' | 'untagged';
  /** Why it could not be moved, for an untagged row of a shared event; null otherwise. */
  why: string | null;
}

export interface RepairNotice {
  bookId: string;
  bookName: string;
  rows: RepairNoticeRow[];
}

export interface RepairReport {
  /** R1: links sent; null when it had run already, or is waiting (`billLinksWaiting`). */
  billLinks: number | null;
  /** R1 waits for every device in the book to read links (fix round 1, #1): it runs on a later sync. */
  billLinksWaiting: boolean;
  /** R2: rows moved and untagged; null when it had run already. */
  eventTags: { moved: number; untagged: number } | null;
}

/** The shared book here, active and with its members known; null for anything else. */
async function activeBookTx(tx: Db, bookId: string): Promise<(SharedBook & { workspaceId: string; baseCurrency: string; name: string }) | null> {
  const [row] = await tx.values<[string, number, string, string, string]>(sql`
    SELECT s.member_id, s.epoch, b.workspace_id, w.base_currency, b.name FROM shared_books s
    JOIN books b ON b.id = s.book_id JOIN workspaces w ON w.id = b.workspace_id
    WHERE s.book_id = ${bookId} AND s.state = 'active' AND EXISTS (SELECT 1 FROM book_members m WHERE m.book_id = s.book_id)`);
  if (!row) return null;
  return { bookId, memberId: row[0], epoch: Number(row[1]), workspaceId: row[2], baseCurrency: row[3], name: row[4] };
}

/**
 * R1: each purchase in the book linked to a bill's month (a `bill_payments` row, no `template_id`) goes out as
 * `{ bill: { templateId, billMonth, linked: true } }`. Returns how many.
 */
async function repairBillLinksTx(tx: Tx, database: Database, book: SharedBook): Promise<number> {
  const rows = await tx.values<[string, string, string, string, string, string]>(sql`
    SELECT l.lineage_id, l.head_transaction_id, l.paid_by, l.paid_label, p.template_id, p.bill_month
    FROM sync_lineage l
    JOIN transactions t ON t.id = l.head_transaction_id
    JOIN bill_payments p ON p.transaction_id = t.id
    WHERE l.book_id = ${book.bookId} AND t.status = 'posted' AND t.template_id IS NULL
    ORDER BY l.lineage_id`);
  const ops: Op[] = [];
  for (const [lineageId, head, paidBy, paidLabel, templateId, billMonth] of rows) {
    // No clock is asked (fix round 1, #2): after a full pull the link here is this phone's merged value — a partner's
    // newer link or unlink has already been applied over it — and a creation op naming no bill is no word on a link.
    // Another payment settles the same month here (the partner paid it meanwhile): sending the link would pay it twice.
    const other = await tx.values(sql`
      SELECT 1 FROM bill_payments p JOIN transactions t ON t.id = p.transaction_id
      WHERE p.template_id = ${templateId} AND p.bill_month = ${billMonth} AND p.transaction_id <> ${head} AND t.status = 'posted' LIMIT 1`);
    if (other.length > 0) continue;
    const fields = await projectPurchase(tx, head, book.memberId, { paidBy, paidLabel });
    if (!fields?.bill?.linked) continue; // a part of a split names no bill
    ops.push({ entity: 'purchase', id: lineageId, op: 'upsert', fields: { bill: fields.bill } });
  }
  await writeChangeSetsTx(tx, captureConfigOf(database), book, ops);
  return ops.length;
}

async function addNoticeRowTx(tx: Db, bookId: string, row: RepairNoticeRow): Promise<void> {
  const key = NOTICE_PREFIX + bookId;
  const [held] = await tx.values<[string]>(sql`SELECT value FROM settings WHERE key = ${key}`);
  let rows: RepairNoticeRow[] = [];
  try {
    rows = held ? (JSON.parse(held[0]) as RepairNoticeRow[]) : [];
  } catch {
    rows = [];
  }
  if (!rows.some((r) => r.transactionId === row.transactionId)) rows.push(row);
  await tx.run(sql`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(rows)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
}

/**
 * R2: every posted purchase of the book tagged to an event. The payer's own phone moves one tagged to a shared event
 * active here; everything else is untagged. Each row in its own db transactions (a move is one of its own), so a crash
 * part-way leaves the rest for the next run: a moved row is no longer the workspace's, an untagged one no longer tagged.
 */
async function repairEventTags(
  database: Database,
  book: SharedBook & { workspaceId: string; baseCurrency: string },
  options: { fetcher?: RateFetcher; today: string },
): Promise<{ moved: number; untagged: number }> {
  const ws: WorkspaceContext = { workspaceId: book.workspaceId, baseCurrency: book.baseCurrency };
  const tagged = await database.db.values<[string, string, string, string]>(sql`
    SELECT t.id, t.event_id, t.description, t.occurred_on FROM transactions t
    JOIN book_transactions bt ON bt.transaction_id = t.id
    WHERE bt.book_id = ${book.bookId} AND t.status = 'posted' AND t.event_id IS NOT NULL
    ORDER BY t.occurred_on, t.id`);
  let moved = 0;
  let untagged = 0;
  for (const [transactionId, eventId, description, occurredOn] of tagged) {
    const [event] = await database.db.values<[string]>(sql`SELECT name FROM events WHERE id = ${eventId}`);
    const eventName = event?.[0] ?? 'an event';
    const sharedEvent = await eventBookOfEventTx(database.db, eventId).catch(() => null);
    let why: string | null = null;
    if (sharedEvent && sharedEvent.workspaceId === ws.workspaceId) {
      why = await database.transaction((tx) => partnerPurchaseRefusalTx(tx, transactionId));
      if (why === null) {
        why = await tryMove(database, ws, eventId, transactionId, occurredOn, options);
        if (why === null) {
          await database.transaction((tx) => addNoticeRowTx(tx, book.bookId, { transactionId, description, occurredOn, eventName, outcome: 'moved', why: null }));
          moved += 1;
          continue;
        }
      }
    }
    await database.transaction(async (tx) => {
      // Read again: a sync in between may have voided it, or moved it from the payer's phone.
      if (!(await sharedRowTx(tx, transactionId))) return;
      const done = await untagSharedRowsTx(tx, [transactionId]);
      if (done.length > 0) {
        await addNoticeRowTx(tx, book.bookId, { transactionId, description, occurredOn, eventName, outcome: 'untagged', why });
        untagged += 1;
      }
    });
  }
  return { moved, untagged };
}

/** Moves one purchase into its shared event, fetching the day's rates first; null when it moved, else why not. */
async function tryMove(database: Database, ws: WorkspaceContext, eventId: string, transactionId: string, occurredOn: string, options: { fetcher?: RateFetcher; today: string }): Promise<string | null> {
  try {
    const book = await eventBookOfEventTx(database.db, eventId);
    if (options.fetcher && book) {
      const currencies = await database.db.values<[string]>(sql`
        SELECT currency FROM entries WHERE transaction_id = ${transactionId}
        UNION SELECT original_currency FROM transactions WHERE id = ${transactionId} AND original_currency IS NOT NULL`);
      await resolveRates(database, {
        currencies: [book.currency, ...currencies.map(([c]) => c)],
        baseCurrency: ws.baseCurrency,
        onDate: occurredOn,
        today: options.today,
        fetcher: options.fetcher,
      }).catch(() => undefined);
    }
    // A refund moves only when its expense in the event is found by name: matched by size alone, the split it shares
    // back could be another expense's (fix round 1, #4).
    if (book && !(await refundMatchedByName(database, ownerScope(ws), eventId, transactionId))) return `It could not be matched to an expense in ${book.name}`;
    // Named by the purchase and the event's book (the same on every phone; a local event id is not).
    const eventKey = book?.bookId ?? eventId;
    const { moved, kept } = await moveIntoSharedEvent(database, ownerScope(ws), eventId, [transactionId], {}, {
      expenseIdFor: async (tx, id) => repairExpenseId(await lineageOfTransaction(tx, id), eventKey),
    });
    if (moved.length > 0) return null;
    return kept[0]?.why ?? 'It could not be moved';
  } catch (error) {
    // The event is not open for writing here (no longer shared, Done): said in the event's own words.
    return error instanceof Error ? error.message : 'It could not be moved';
  }
}

/**
 * Runs the one-time repairs of a shared book on this phone, each once. Called after a sync that pulled the book to the
 * relay's latest. A repair that throws leaves its marker unwritten (it runs again next time) and is rethrown after the
 * others have had their turn, for the caller to log; nothing it wrote half-way stays (each step is one db transaction).
 */
export async function runSharedBookRepairs(database: Database, bookId: string, options: { fetcher?: RateFetcher; today?: string } = {}): Promise<RepairReport> {
  const report: RepairReport = { billLinks: null, billLinksWaiting: false, eventTags: null };
  const today = options.today ?? isoDate();
  const failures: unknown[] = [];
  try {
    report.billLinks = await database.transaction(async (tx) => {
      const book = await activeBookTx(tx, bookId);
      if (!book) return null;
      if (!(await bookAtLevelTx(tx, bookId, BILL_LINK_LEVEL))) {
        // A device below the level (an older build, or one that joined since): links stay here, and the repair runs
        // again once it has updated — for the links made meanwhile too.
        report.billLinksWaiting = true;
        await tx.run(sql`DELETE FROM settings WHERE key = ${markerKey(BILL_LINKS, bookId)}`);
        return null;
      }
      if (await doneTx(tx, BILL_LINKS, bookId)) return null;
      if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bill_payments'`)).length === 0) return null;
      const sent = await repairBillLinksTx(tx, database, book);
      await markDoneTx(tx, BILL_LINKS, bookId);
      return sent;
    });
  } catch (error) {
    failures.push(error);
  }
  try {
    const book = await database.transaction((tx) => activeBookTx(tx, bookId));
    if (book && !(await database.transaction((tx) => doneTx(tx, EVENT_TAGS, bookId)))) {
      report.eventTags = await repairEventTags(database, book, { ...(options.fetcher ? { fetcher: options.fetcher } : {}), today });
      await database.transaction((tx) => markDoneTx(tx, EVENT_TAGS, bookId));
    }
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw failures[0];
  return report;
}

/** The notices the repairs left on this phone, one per shared book, each until it is dismissed. */
export async function repairNotices(database: Database): Promise<RepairNotice[]> {
  const rows = await database.db.values<[string, string]>(sql`SELECT key, value FROM settings WHERE key LIKE ${NOTICE_PREFIX + '%'} ORDER BY key`);
  const out: RepairNotice[] = [];
  for (const [key, value] of rows) {
    const bookId = key.slice(NOTICE_PREFIX.length);
    let list: RepairNoticeRow[] = [];
    try {
      list = JSON.parse(value) as RepairNoticeRow[];
    } catch {
      continue;
    }
    if (list.length === 0) continue;
    const [book] = await database.db.values<[string]>(sql`SELECT name FROM books WHERE id = ${bookId}`);
    out.push({ bookId, bookName: book?.[0] ?? 'The shared workspace', rows: list });
  }
  return out;
}

/** The notice has been read: it is not shown again. */
export async function dismissRepairNotice(database: Database, bookId: string): Promise<void> {
  await database.db.run(sql`DELETE FROM settings WHERE key = ${NOTICE_PREFIX + bookId}`);
}
