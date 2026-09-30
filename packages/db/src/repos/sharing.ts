import { sql } from 'drizzle-orm';
import type { Database } from '../database';
import { sharingTablesExist } from '../sync/placeholder';

/*
 * What the sharing screens read (household sharing spec §11). Reads only, plus one bookkeeping write — when each
 * device of a shared book was last heard from — which lives in `settings`, never in a synced table.
 *
 * Every reader answers "nothing is shared" on a database one version behind, where migration 0056 has not run.
 */

export type SharedBookState = 'active' | 'needs_invite' | 'unshared';
export type MemberRole = 'owner' | 'member';

export interface SharedBookMember {
  memberId: string;
  name: string;
  role: MemberRole;
}

/** One shared book as the switcher and the status line need it. */
export interface SharedBookSummary {
  bookId: string;
  /** The book's id on the relay. */
  relayBookId: string;
  state: SharedBookState;
  /** This device's member. */
  memberId: string;
  members: SharedBookMember[];
  /** For an `unshared` book, the member who ended it here: whoever stopped sharing, or this device's own on a leave. */
  unsharedBy: string | null;
  /** For an `unshared` book, how: its owner stopped it, this member left, or this device was removed (final review, I2). */
  unsharedReason: 'stopped' | 'left' | 'removed' | null;
}

export interface SharedDevice {
  deviceId: string;
  name: string;
  /** This device. */
  mine: boolean;
  /** When this device was last heard from — a sync of its own, or the newest change it wrote — in ms, or null. */
  seenAt: number | null;
}

export interface SharedMemberDetail extends SharedBookMember {
  /** This device's own member. */
  me: boolean;
  /** Its devices that are still in the book. */
  devices: SharedDevice[];
}

export interface SharingDetail {
  bookId: string;
  state: SharedBookState;
  memberId: string;
  /** This device's member is an owner. */
  owner: boolean;
  members: SharedMemberDetail[];
  /** Change-sets written here that the relay has not taken yet. */
  waiting: number;
}

const SEEN_KEY = (bookId: string) => `sync.seen.${bookId}`;

async function membersOf(database: Database, bookId: string): Promise<SharedBookMember[]> {
  const rows = await database.db.values<[string, string, string]>(
    sql`SELECT member_id, name, role FROM book_members WHERE book_id = ${bookId} ORDER BY joined_at, member_id`,
  );
  return rows.map(([memberId, name, role]) => ({ memberId, name, role: role as MemberRole }));
}

/**
 * Every book this device holds a `shared_books` row for, whatever its state, with its members. A net-worth group log
 * (joint-net-worth §4) is a `shared_books` row too, but no workspace: it is left out, and its workspace's sync syncs it.
 */
export async function listSharedBooks(database: Database): Promise<SharedBookSummary[]> {
  if (!(await sharingTablesExist(database.db))) return [];
  const groups = (await database.db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nw_group_books'`)).length > 0;
  const rows = await database.db.values<[string, string, string, string, string | null, SharedBookSummary['unsharedReason']]>(
    groups
      ? sql`SELECT book_id, relay_book_id, state, member_id, unshared_by, unshared_reason FROM shared_books
            WHERE book_id NOT IN (SELECT group_book_id FROM nw_group_books) ORDER BY shared_at, book_id`
      : sql`SELECT book_id, relay_book_id, state, member_id, unshared_by, unshared_reason FROM shared_books ORDER BY shared_at, book_id`,
  );
  const out: SharedBookSummary[] = [];
  for (const [bookId, relayBookId, state, memberId, unsharedBy, unsharedReason] of rows) {
    out.push({ bookId, relayBookId, state: state as SharedBookState, memberId, members: await membersOf(database, bookId), unsharedBy, unsharedReason });
  }
  return out;
}

/** When each device of the book was last heard from, in ms. Kept in `settings`, which never syncs. */
export async function devicesSeen(database: Database, bookId: string): Promise<Record<string, number>> {
  const [row] = await database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${SEEN_KEY(bookId)}`);
  if (!row) return {};
  try {
    const parsed = JSON.parse(row[0]) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Raises each device's last-heard time to what it is given; a time never goes backwards. */
export async function recordDevicesSeen(database: Database, bookId: string, seen: Record<string, number>): Promise<void> {
  if (Object.keys(seen).length === 0) return;
  const was = await devicesSeen(database, bookId);
  let changed = false;
  for (const [deviceId, ms] of Object.entries(seen)) {
    if (!(ms <= (was[deviceId] ?? -Infinity))) {
      was[deviceId] = ms;
      changed = true;
    }
  }
  if (!changed) return;
  await database.db.run(
    sql`INSERT INTO settings (key, value) VALUES (${SEEN_KEY(bookId)}, ${JSON.stringify(was)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  );
}

/** Everything the workspace's sharing section shows (§11): its state, its members and their devices, what waits. */
export async function sharingDetail(database: Database, bookId: string, deviceId: string | null): Promise<SharingDetail | null> {
  if (!(await sharingTablesExist(database.db))) return null;
  const [row] = await database.db.values<[string, string]>(sql`SELECT state, member_id FROM shared_books WHERE book_id = ${bookId}`);
  if (!row) return null;
  const [state, memberId] = row;
  const seen = await devicesSeen(database, bookId);
  const deviceRows = await database.db.values<[string, string, string]>(
    sql`SELECT device_id, member_id, name FROM book_devices WHERE book_id = ${bookId} AND removed_at IS NULL ORDER BY added_at, device_id`,
  );
  const members = (await membersOf(database, bookId)).map((member) => ({
    ...member,
    me: member.memberId === memberId,
    devices: deviceRows
      .filter(([, owner]) => owner === member.memberId)
      .map(([id, , name]) => ({ deviceId: id, name, mine: id === deviceId, seenAt: seen[id] ?? null })),
  }));
  const [waiting] = await database.db.values<[number]>(sql`SELECT count(*) FROM sync_outbox WHERE book_id = ${bookId}`);
  return {
    bookId,
    state: state as SharedBookState,
    memberId,
    owner: members.some((member) => member.me && member.role === 'owner'),
    members,
    waiting: Number(waiting?.[0] ?? 0),
  };
}

/**
 * How much of the book's outbox is left, counted in ops (rows and purchases) — what "Preparing N of M" counts while a
 * newly shared book's history goes up (§6.5 step 4).
 */
export async function outboxOps(database: Database, bookId: string): Promise<number> {
  if (!(await sharingTablesExist(database.db))) return 0;
  const [row] = await database.db.values<[number | null]>(
    sql`SELECT sum(json_array_length(entry_json, '$.ops')) FROM sync_outbox WHERE book_id = ${bookId}`,
  );
  return Number(row?.[0] ?? 0);
}

/** Who paid for a purchase in a shared book, and from what (§4.3): what a list row and a receipt say about it. */
export interface PurchasePayer {
  paidBy: string;
  /** "BCA ···· 1467", as the payer's own device named it. */
  paidLabel: string;
  /** The payer's name in the book; null when the member is not known here. */
  payerName: string | null;
  /** The payer is this device's own member. */
  mine: boolean;
  /** Joint net worth §5.3: whose shared item the money side is on (the payer's own included), or null. */
  paidFrom: { owner: string; itemId: string } | null;
}

/** The payer of each of these transactions that heads a purchase in a shared book; others are left out. */
export async function purchasePayers(database: Database, transactionIds: readonly string[]): Promise<Record<string, PurchasePayer>> {
  if (transactionIds.length === 0 || !(await sharingTablesExist(database.db))) return {};
  const out: Record<string, PurchasePayer> = {};
  // Bound parameters are capped per statement; a month's list stays well inside one chunk, a year's in a few.
  for (let i = 0; i < transactionIds.length; i += 400) {
    const chunk = transactionIds.slice(i, i + 400);
    const rows = await database.db.values<[string, string, string, string | null, string, string | null, string | null]>(sql`
      SELECT l.head_transaction_id, l.paid_by, l.paid_label, m.name, s.member_id, l.paid_from_owner, l.paid_from_item
      FROM sync_lineage l
      JOIN shared_books s ON s.book_id = l.book_id
      LEFT JOIN book_members m ON m.book_id = l.book_id AND m.member_id = l.paid_by
      WHERE l.head_transaction_id IN (${sql.join(
        chunk.map((id) => sql`${id}`),
        sql`, `,
      )})`);
    for (const [transactionId, paidBy, paidLabel, payerName, self, fromOwner, fromItem] of rows) {
      out[transactionId] = { paidBy, paidLabel, payerName, mine: paidBy === self, paidFrom: fromOwner && fromItem ? { owner: fromOwner, itemId: fromItem } : null };
    }
  }
  return out;
}
