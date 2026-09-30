import { sql } from 'drizzle-orm';
import type { Database } from '../database';

/*
 * The Household purchases of a period, as this phone holds them (joint-net-worth §8.3 "Lines you can see"): the shared
 * workspace's own purchases, which every member of the workspace already sees, with the item their money side is on.
 * Nothing private is read: only purchases filed in the shared book, and only what its list already shows.
 */

export interface HouseholdPurchase {
  lineageId: string;
  transactionId: string;
  occurredOn: string;
  /** The day this phone recorded or received the purchase (YYYY-MM-DD). */
  recordedOn: string;
  description: string;
  /** What was spent on its categories, in `currency`; a refund is negative. */
  amountMinor: number;
  currency: string;
  /**
   * The shared item the money side is on (`money.paidFrom.itemId`, kept on `sync_lineage.paid_from_item` by Task 7):
   * the partner's item a member paid with, or the owner's own shared item; null = an account that is not shared.
   */
  paidFromItemId: string | null;
  /** Whose item that is (`money.paidFrom.owner`); null with `paidFromItemId`. */
  paidFromOwner: string | null;
  /** The member who paid (`money.paidBy`): whose purchase it is, which decides whether the item's owner has it yet. */
  paidBy: string;
}

/** Every posted Household purchase of `bookId` dated within `period`, oldest first. */
export async function householdPurchases(database: Database, bookId: string, period: { start: string; end: string }): Promise<HouseholdPurchase[]> {
  const [table] = await database.db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_lineage'`);
  if (!table) return [];
  const rows = await database.db.values<[string, string, string, string, string, number, string, string, string | null, string | null]>(sql`
    SELECT l.lineage_id, t.id, t.occurred_on, t.created_at, t.description,
           COALESCE((SELECT sum(e.amount_minor) FROM entries e JOIN accounts a ON a.id = e.account_id
                     WHERE e.transaction_id = t.id AND a.kind IN ('expense', 'income')), 0),
           COALESCE((SELECT e.currency FROM entries e JOIN accounts a ON a.id = e.account_id
                     WHERE e.transaction_id = t.id AND a.kind IN ('expense', 'income') LIMIT 1), ''),
           l.paid_by, l.paid_from_item, l.paid_from_owner
    FROM sync_lineage l JOIN transactions t ON t.id = l.head_transaction_id
    WHERE l.book_id = ${bookId} AND t.status = 'posted' AND t.occurred_on >= ${period.start} AND t.occurred_on <= ${period.end}
    ORDER BY t.occurred_on, l.lineage_id`);
  return rows.map(([lineageId, transactionId, occurredOn, createdAt, description, amountMinor, currency, paidBy, item, owner]) => ({
    lineageId,
    transactionId,
    occurredOn,
    recordedOn: localDay(createdAt),
    description,
    amountMinor: Number(amountMinor),
    currency,
    // Both or neither: a half-written pair names no item.
    paidFromItemId: item && owner ? item : null,
    paidFromOwner: item && owner ? owner : null,
    paidBy,
  }));
}

/** A stored timestamp as the device's own day, the way a summary's `asOf` is its owner's day. */
function localDay(stamp: string): string {
  const ms = Date.parse(stamp);
  if (Number.isNaN(ms)) return stamp.slice(0, 10);
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
