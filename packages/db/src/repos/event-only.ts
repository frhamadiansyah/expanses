import { type SQL, sql, type SQLWrapper } from 'drizzle-orm';
import type { Db } from '../database';

/*
 * Shared events §5.1. A transaction a shared event put in this phone's own books — the share, the payment, the
 * settle-up — belongs to no workspace: its expense line is on a local copy of the event's category, filed in no book,
 * so it has no `book_transactions` row. A row with none used to mean "moving your own money" and showed in every
 * workspace; this one must show in none. `event_postings` is what tells the two apart: every reader that narrows by
 * book, and every spending report, adds `notEventOnly`. The account's own history (read owner-wide), the card's
 * statement and points, net worth and the event page never narrow by book, so they keep it.
 */

const present = new WeakMap<object, true>();

/** Whether this copy has the shared-event tables (migration 0069). A copy stopped before it has nothing to leave out. */
export async function eventOnlyExists(db: Db): Promise<boolean> {
  if (present.get(db)) return true;
  const rows = await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_postings'`);
  if (rows.length > 0) present.set(db, true);
  return rows.length > 0;
}

/** Over a transaction id: true when it is not one of a shared event's derived transactions. */
export function notEventOnly(transactionId: SQLWrapper): SQL {
  return sql`${transactionId} NOT IN (SELECT transaction_id FROM event_postings WHERE transaction_id IS NOT NULL)`;
}

/**
 * Over an account id: true when it is not a shared event's local copy of one of its categories (`event_category_accounts`,
 * an expense account in no book). A reader that narrows to a workspace's categories leaves them out already; one that
 * cannot narrow (no workspace open, a copy before books) adds this so a share category is never guessed or budgeted (M7).
 */
export function notShareCategory(accountId: SQLWrapper): SQL {
  return sql`${accountId} NOT IN (SELECT account_id FROM event_category_accounts)`;
}

/** The shared-event record a derived transaction follows, or null for any other transaction. */
export async function eventPostingOfTx(db: Db, transactionId: string): Promise<{ bookId: string; recordId: string; kind: 'expense' | 'settlement' } | null> {
  if (!(await eventOnlyExists(db))) return null;
  const [row] = await db.values<[string, string, string]>(sql`SELECT book_id, record_id, kind FROM event_postings WHERE transaction_id = ${transactionId}`);
  return row ? { bookId: row[0], recordId: row[1], kind: row[2] as 'expense' | 'settlement' } : null;
}
