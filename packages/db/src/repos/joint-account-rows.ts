import { sql } from 'drizzle-orm';
import type { Database, Db } from '../database';
import { householdPurchases } from './household-purchases';

/*
 * A joint account's rows (0097). When the holder makes a shared account joint, the household records into it: the
 * account's page, on both phones, lists the rows recorded in the SHARED workspace against it — purchases (the shared
 * book's lineage whose money side is on the item) and transfers (the shared book's redacted transfer rows that name the
 * item on a side) — each with who recorded it. A row recorded in any other workspace is not in the shared book, so it is
 * not in any table this reads, on either phone.
 *
 * Only the person who recorded a row may edit, void or delete it, on both phones (`jointRowRefusalTx`).
 */

export interface JointRow {
  /** The purchase's lineage id or the transfer's id: unique within the list. */
  key: string;
  kind: 'purchase' | 'transfer';
  occurredOn: string;
  description: string;
  /** In the account's sense on the holder's side: money out is negative, money in positive. */
  amountMinor: number;
  currency: string;
  /** The member who recorded it. */
  recordedBy: string;
  /** This phone's own transaction for it, when it has one (a purchase always; a transfer only on its recorder's phone). */
  transactionId: string | null;
}

/** Whether `db` has the tables of a joint account (0097). */
async function jointTablesExist(db: Db): Promise<boolean> {
  return (await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nw_joint_accounts'`)).length > 0;
}

/**
 * The rows of the joint account `itemId` (held by `owner`) in the shared workspace `bookId`, newest first. The same
 * rows, by the same rule, on the holder's phone and the partner's.
 */
export async function jointAccountRows(database: Database, bookId: string, itemId: string, owner: string): Promise<JointRow[]> {
  if (!(await jointTablesExist(database.db))) return [];
  const rows: JointRow[] = [];
  for (const purchase of await householdPurchases(database, bookId, { start: '0000-01-01', end: '9999-12-31' })) {
    if (purchase.paidFromItemId !== itemId || purchase.paidFromOwner !== owner) continue;
    rows.push({
      key: purchase.lineageId,
      kind: 'purchase',
      occurredOn: purchase.occurredOn,
      description: purchase.description,
      amountMinor: -purchase.amountMinor,
      currency: purchase.currency,
      recordedBy: purchase.paidBy,
      transactionId: purchase.transactionId,
    });
  }
  const transfers = await database.db.values<[string, string, string, number, string, string, string | null, string | null, string | null]>(sql`
    SELECT transfer_id, occurred_on, description, amount_minor, currency, recorded_by, from_item, to_item, transaction_id FROM shared_transfers
    WHERE book_id = ${bookId} AND void = 0 AND (from_item = ${itemId} OR to_item = ${itemId})`);
  for (const [transferId, occurredOn, description, amountMinor, currency, recordedBy, fromItem, , transactionId] of transfers) {
    rows.push({
      key: transferId,
      kind: 'transfer',
      occurredOn,
      description,
      amountMinor: fromItem === itemId ? -Number(amountMinor) : Number(amountMinor),
      currency,
      recordedBy,
      transactionId,
    });
  }
  return rows.sort((a, b) => (a.occurredOn === b.occurredOn ? a.key.localeCompare(b.key) : a.occurredOn < b.occurredOn ? 1 : -1));
}

/**
 * Whether the item `itemId` of `owner` is a joint account, as the group log has it on this phone: the item's summary
 * carries `joint: true`. The same on both phones once the summary has arrived.
 */
export async function isJointItemTx(tx: Db, owner: string, itemId: string): Promise<boolean> {
  let found: [string][];
  try {
    found = await tx.values<[string]>(sql`SELECT summary_json FROM nw_items WHERE item_id = ${itemId} AND owner = ${owner} AND removed = 0`);
  } catch {
    return false; // a database from before migration 0057
  }
  if (!found[0]) return false;
  try {
    return (JSON.parse(found[0][0]) as { joint?: unknown } | null)?.joint === true;
  } catch {
    return false;
  }
}

export const JOINT_ROW_MESSAGE = 'Only the person who recorded this row can change it.';

/**
 * Local door (a person editing or voiding a row on this phone): refuses a row on a joint account recorded by another
 * member. A row is on a joint account when its lineage's money side names a joint item; it was recorded by the lineage's
 * `paid_by` (the member who paid from the account is the one who recorded the row). Nothing else is refused.
 */
export async function jointRowRefusalTx(tx: Db, transactionId: string): Promise<string | null> {
  let lineage: [string, string | null, string | null, string][];
  try {
    lineage = await tx.values<[string, string | null, string | null, string]>(
      sql`SELECT paid_by, paid_from_owner, paid_from_item, book_id FROM sync_lineage WHERE head_transaction_id = ${transactionId}`,
    );
  } catch {
    return null;
  }
  const row = lineage[0];
  if (!row || !row[1] || !row[2]) return null;
  if (!(await isJointItemTx(tx, row[1], row[2]))) return null;
  const [me] = await tx.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${row[3]}`);
  if (!me || me[0] === row[0]) return null;
  return JOINT_ROW_MESSAGE;
}

/** Whether a person on this phone may not change this transaction: it is a row of a joint account another member recorded. */
export async function jointRowLocked(database: Database, transactionId: string): Promise<boolean> {
  return (await jointRowRefusalTx(database.db, transactionId)) !== null;
}
