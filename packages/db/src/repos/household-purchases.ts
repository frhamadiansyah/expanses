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
  /** The shared item the money side is on (`money.paidFrom.itemId`); null = the payer's own account. */
  paidFromItemId: string | null;
}

/**
 * Where a purchase's `paidFrom.itemId` is read from. `paidFrom` arrives with Task 7 (spec §5.3), built in parallel with
 * this read; until the merge wires it to where Task 7 keeps the field, no purchase names an item, so "Lines you can
 * see" is empty. The ONE place to wire: everything downstream filters on `paidFromItemId`.
 */
async function paidFromItemIds(_database: Database, _lineageIds: readonly string[]): Promise<Map<string, string>> {
  return new Map();
}

/** Every posted Household purchase of `bookId` dated within `period`, oldest first. */
export async function householdPurchases(database: Database, bookId: string, period: { start: string; end: string }): Promise<HouseholdPurchase[]> {
  const [table] = await database.db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_lineage'`);
  if (!table) return [];
  const rows = await database.db.values<[string, string, string, string, string, number, string]>(sql`
    SELECT l.lineage_id, t.id, t.occurred_on, t.created_at, t.description,
           COALESCE((SELECT sum(e.amount_minor) FROM entries e JOIN accounts a ON a.id = e.account_id
                     WHERE e.transaction_id = t.id AND a.kind IN ('expense', 'income')), 0),
           COALESCE((SELECT e.currency FROM entries e JOIN accounts a ON a.id = e.account_id
                     WHERE e.transaction_id = t.id AND a.kind IN ('expense', 'income') LIMIT 1), '')
    FROM sync_lineage l JOIN transactions t ON t.id = l.head_transaction_id
    WHERE l.book_id = ${bookId} AND t.status = 'posted' AND t.occurred_on >= ${period.start} AND t.occurred_on <= ${period.end}
    ORDER BY t.occurred_on, l.lineage_id`);
  const paidFrom = await paidFromItemIds(database, rows.map((row) => row[0]));
  return rows.map(([lineageId, transactionId, occurredOn, createdAt, description, amountMinor, currency]) => ({
    lineageId,
    transactionId,
    occurredOn,
    recordedOn: localDay(createdAt),
    description,
    amountMinor: Number(amountMinor),
    currency,
    paidFromItemId: paidFrom.get(lineageId) ?? null,
  }));
}

/** A stored timestamp as the device's own day, the way a summary's `asOf` is its owner's day. */
function localDay(stamp: string): string {
  const ms = Date.parse(stamp);
  if (Number.isNaN(ms)) return stamp.slice(0, 10);
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
