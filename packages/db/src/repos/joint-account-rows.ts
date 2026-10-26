import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { postTransactionTx } from './ledger';
import { householdPurchases } from './household-purchases';

/*
 * A joint account's rows (0097). When the holder makes a shared account joint, the household records into it: the
 * account's page, on both phones, lists the rows recorded in the SHARED workspace against it — purchases (the shared
 * book's lineage whose money side is on the item) and transfers (the shared book's redacted transfer rows that name the
 * item on a side, and the transfers between partners that name it) — each with who recorded it. A row recorded in any other workspace is not in the shared book, so it is
 * not in any table this reads, on either phone.
 *
 * Equal rights: either person may edit, void or delete any of these rows, on both phones; `recordedBy` only says who
 * recorded it.
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
  /** The member who last changed the row when that is not its recorder; null for a row nobody else changed. */
  editedBy: string | null;
  /** A deleted row: still listed, with who deleted it, until it is restored. Only purchases are kept this way. */
  deleted: boolean;
  deletedBy: string | null;
}

/** Whether `db` has the tables of a joint account (0097). */
async function jointTablesExist(db: Db): Promise<boolean> {
  return (await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nw_joint_accounts'`)).length > 0;
}

function sideOf(json: string): { owner: string; itemId: string } | null {
  try {
    const side = JSON.parse(json) as { owner?: unknown; itemId?: unknown } | null;
    return side && typeof side.owner === 'string' && typeof side.itemId === 'string' ? { owner: side.owner, itemId: side.itemId } : null;
  } catch {
    return null;
  }
}

async function memberOfBookTx(db: Db, bookId: string): Promise<string | null> {
  const [row] = await db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`);
  return row?.[0] ?? null;
}

/**
 * The member a transaction's audit entry names as its author: the sync author when a change from the other phone made
 * it, else this phone's own member (a local change).
 */
async function authorOfTx(db: Db, transactionId: string, action: 'post' | 'void', me: string): Promise<{ by: string; at: string } | null> {
  const [row] = await db.values<[string, string]>(sql`
    SELECT payload_json, created_at FROM audit_log WHERE entity = 'transaction' AND entity_id = ${transactionId} AND action = ${action}
    ORDER BY created_at DESC, rowid DESC LIMIT 1`);
  if (!row) return null;
  try {
    const by = (JSON.parse(row[0]) as { syncAuthor?: unknown } | null)?.syncAuthor;
    return { by: typeof by === 'string' && by ? by : me, at: row[1] };
  } catch {
    return { by: me, at: row[1] };
  }
}

/** Who corrected this row last when that is not the member who recorded it (the row replaces an earlier one). */
async function editorOfTx(db: Db, transactionId: string, recordedBy: string, me: string): Promise<string | null> {
  const [replaced] = await db.values<[string | null]>(sql`SELECT replaces_transaction_id FROM transactions WHERE id = ${transactionId}`);
  if (!replaced?.[0]) return null;
  const posted = await authorOfTx(db, transactionId, 'post', me);
  return posted && posted.by !== recordedBy ? posted.by : null;
}

/**
 * The deleted purchases of the joint account: lineages voided on this phone whose money side was on the item. A row put
 * back (restored, or recorded again identical after it was deleted) is no longer listed as deleted.
 */
async function deletedRowsTx(
  db: Db,
  bookId: string,
  itemId: string,
  owner: string,
  me: string,
  live: readonly { occurredOn: string; description: string; amountMinor: number; currency: string; createdAt: string }[],
): Promise<JointRow[]> {
  if ((await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_lineage_last'`)).length === 0) return [];
  const gone = await db.values<[string, string, string, string, string, number, string]>(sql`
    SELECT l.lineage_id, l.paid_by, t.id, t.occurred_on, t.description,
           COALESCE((SELECT sum(e.amount_minor) FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = t.id AND a.kind IN ('expense', 'income')), 0),
           COALESCE((SELECT e.currency FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = t.id AND a.kind IN ('expense', 'income') LIMIT 1), '')
    FROM sync_lineage l JOIN sync_lineage_last x ON x.lineage_id = l.lineage_id JOIN transactions t ON t.id = x.transaction_id
    WHERE l.book_id = ${bookId} AND l.head_transaction_id IS NULL AND l.paid_by <> '' AND l.paid_from_item = ${itemId} AND l.paid_from_owner = ${owner}
      AND t.status = 'void'`);
  const taken = new Set<number>();
  const out: JointRow[] = [];
  for (const [lineageId, paidBy, transactionId, occurredOn, description, spent, currency] of gone) {
    const voided = await authorOfTx(db, transactionId, 'void', me);
    const amountMinor = -Number(spent);
    // A live row of the same words, day and figure made after this one was deleted puts it back.
    const back = live.findIndex((row, i) => !taken.has(i) && row.occurredOn === occurredOn && row.description === description && row.amountMinor === amountMinor && row.currency === currency && row.createdAt >= (voided?.at ?? ''));
    if (back >= 0) {
      taken.add(back);
      continue;
    }
    out.push({ key: lineageId, kind: 'purchase', occurredOn, description, amountMinor, currency, recordedBy: paidBy, transactionId: null, editedBy: null, deleted: true, deletedBy: voided?.by ?? null });
  }
  return out;
}

/**
 * Puts a deleted row of a joint account back, for either person: a void is never undone in the shared book (void wins for
 * ever), so the same purchase is posted again as a new row — the same day, words, lines and payer account — which the
 * other phone receives as an ordinary purchase. Both lists then stop showing the deleted one. Returns the new row's id.
 * `ws` is the shared workspace's context.
 */
export async function restoreJointRow(database: Database, ws: WorkspaceContext, lineageId: string): Promise<string> {
  const bookId = ws.bookId ?? '';
  return database.transaction(async (tx) => {
    const [row] = await tx.values<[string, string | null, string | null, string]>(sql`
      SELECT x.transaction_id, l.paid_from_owner, l.paid_from_item, l.paid_by FROM sync_lineage l JOIN sync_lineage_last x ON x.lineage_id = l.lineage_id
      WHERE l.lineage_id = ${lineageId} AND l.book_id = ${bookId} AND l.head_transaction_id IS NULL`);
    if (!row || !row[1] || !row[2]) throw new Error('That row is not a deleted row of a joint account');
    if (!(await isJointItemTx(tx, row[1], row[2]))) throw new Error('That account is no longer joint');
    const [head] = await tx.values<[string, string, string | null, string | null, number | null, string | null, string]>(sql`
      SELECT occurred_on, description, original_currency, mcc, original_amount_minor, card_id, status FROM transactions WHERE id = ${row[0]}`);
    if (!head || head[6] !== 'void') throw new Error('That row is not deleted');
    const lines = await tx.values<[string, number, string, number, number, string | null, string | null]>(sql`
      SELECT account_id, amount_minor, currency, fx_rate_to_base, amount_base_minor, memo, spend_category_id FROM entries WHERE transaction_id = ${row[0]} ORDER BY rowid`);
    const ratesToBase: Record<string, number> = {};
    for (const line of lines) ratesToBase[line[2]] = Number(line[3]);
    return postTransactionTx(tx, ws, {
      occurredOn: head[0],
      description: head[1],
      lines: lines.map(([accountId, amountMinor, currency, , amountBaseMinor, memo, spendCategoryId]) => ({
        accountId,
        amountMinor: Number(amountMinor),
        currency,
        amountBaseMinor: Number(amountBaseMinor),
        ...(memo ? { memo } : {}),
        ...(spendCategoryId ? { spendCategoryId } : {}),
      })),
      ratesToBase,
      originalCurrency: head[2],
      originalAmountMinor: head[4] === null ? null : Number(head[4]),
      mcc: head[3],
      cardId: head[5],
      paidFrom: { owner: row[1], itemId: row[2] },
    });
  });
}

/**
 * What the receipt says under a row of a joint account: who recorded it and who changed it. Null for a transaction that
 * is no row of a joint account.
 */
export async function jointRowNote(database: Database, transactionId: string): Promise<{ recordedBy: string; editedBy: string | null } | null> {
  if (!(await jointTablesExist(database.db))) return null;
  const [lineage] = await database.db.values<[string, string | null, string | null, string]>(sql`
    SELECT paid_by, paid_from_owner, paid_from_item, book_id FROM sync_lineage WHERE head_transaction_id = ${transactionId}`);
  if (!lineage?.[1] || !lineage[2] || !(await isJointItemTx(database.db, lineage[1], lineage[2]))) return null;
  const me = (await memberOfBookTx(database.db, lineage[3])) ?? '';
  return { recordedBy: lineage[0], editedBy: await editorOfTx(database.db, transactionId, lineage[0], me) };
}

/**
 * The rows of the joint account `itemId` (held by `owner`) in the shared workspace `bookId`, newest first. The same
 * rows, by the same rule, on the holder's phone and the partner's.
 */
export async function jointAccountRows(database: Database, bookId: string, itemId: string, owner: string): Promise<JointRow[]> {
  if (!(await jointTablesExist(database.db))) return [];
  const rows: JointRow[] = [];
  const me = (await memberOfBookTx(database.db, bookId)) ?? '';
  const liveAt: { occurredOn: string; description: string; amountMinor: number; currency: string; createdAt: string }[] = [];
  for (const purchase of await householdPurchases(database, bookId, { start: '0000-01-01', end: '9999-12-31' })) {
    if (purchase.paidFromItemId !== itemId || purchase.paidFromOwner !== owner) continue;
    const [made] = await database.db.values<[string]>(sql`SELECT created_at FROM transactions WHERE id = ${purchase.transactionId}`);
    liveAt.push({ occurredOn: purchase.occurredOn, description: purchase.description, amountMinor: -purchase.amountMinor, currency: purchase.currency, createdAt: made?.[0] ?? '' });
    rows.push({
      key: purchase.lineageId,
      kind: 'purchase',
      occurredOn: purchase.occurredOn,
      description: purchase.description,
      amountMinor: -purchase.amountMinor,
      currency: purchase.currency,
      recordedBy: purchase.paidBy,
      transactionId: purchase.transactionId,
      editedBy: await editorOfTx(database.db, purchase.transactionId, purchase.paidBy, me),
      deleted: false,
      deletedBy: null,
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
      editedBy: null,
      deleted: false,
      deletedBy: null,
    });
  }
  // Transfers between partners (the group log's): a partner moving money out of or into the joint account. Both phones
  // hold the row; each lists its own posting for it (the holder's on the account, the partner's on their own side).
  const moved = await database.db.values<[string, string, number, string, string | null, string, string, string, string | null, string | null]>(sql`
    SELECT m.transfer_id, m.occurred_on, m.amount_minor, m.currency, m.description, m.recorded_by, m.from_json, m.to_json, p.transaction_id, t.description
    FROM member_transfers m
    JOIN nw_group_books g ON g.group_book_id = m.book_id AND g.book_id = ${bookId}
    LEFT JOIN member_transfer_postings p ON p.book_id = m.book_id AND p.transfer_id = m.transfer_id
    LEFT JOIN transactions t ON t.id = p.transaction_id AND t.status = 'posted'
    WHERE m.void = 0`);
  for (const [transferId, occurredOn, amountMinor, currency, note, recordedBy, fromJson, toJson, transactionId, posted] of moved) {
    const from = sideOf(fromJson);
    const to = sideOf(toJson);
    const out = from?.owner === owner && from.itemId === itemId;
    if (!out && !(to?.owner === owner && to.itemId === itemId)) continue;
    rows.push({
      key: transferId,
      kind: 'transfer',
      occurredOn,
      description: posted ?? note ?? '',
      amountMinor: out ? -Number(amountMinor) : Number(amountMinor),
      currency,
      recordedBy,
      transactionId: posted ? transactionId : null,
      editedBy: null,
      deleted: false,
      deletedBy: null,
    });
  }
  rows.push(...(await deletedRowsTx(database.db, bookId, itemId, owner, me, liveAt)));
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
