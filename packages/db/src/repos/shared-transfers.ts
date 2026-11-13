import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { lineageOfTransaction, withCapture } from '../sync/capture';

/*
 * A transfer recorded in a household-shared workspace (0094). A transfer between the recorder's own accounts has no
 * category, so it cannot travel as a purchase (that would send account ids the partner does not have). It travels as a
 * redacted row instead: date, amount, currency, a label and who recorded it, never an account. The recorder's own phone
 * keeps the real transaction and shows that; the partner's phone shows this row, read only, and it touches no balance.
 */

const KEY = 'book_transfer';

async function tableExists(db: Db): Promise<boolean> {
  return (await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_transfers'`)).length > 0;
}

/** This device's member in a shared workspace; null when the book is not shared here. */
async function memberOfTx(tx: Db, bookId: string): Promise<string | null> {
  if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_books'`)).length === 0) return null;
  const [row] = await tx.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`);
  return row?.[0] ?? null;
}

/** The figure a bare transfer moved: its positive leg. Null when it has a category line (that is a purchase) or no leg. */
async function figureOfTx(tx: Db, transactionId: string): Promise<{ occurredOn: string; description: string; amountMinor: number; currency: string; fromName: string | null; toName: string | null; fromItem: string | null; toItem: string | null } | null> {
  const [head] = await tx.values<[string, string, string]>(sql`SELECT occurred_on, description, status FROM transactions WHERE id = ${transactionId}`);
  if (!head || head[2] !== 'posted') return null;
  const lines = await tx.values<[number, string, string, string, string]>(sql`
    SELECT e.amount_minor, e.currency, a.kind, a.id, a.name FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${transactionId}`);
  if (lines.some(([, , kind]) => kind === 'income' || kind === 'expense')) return null;
  const leg = lines.filter(([amount]) => Number(amount) > 0).sort((a, b) => Number(b[0]) - Number(a[0]))[0];
  if (!leg) return null;
  const out = lines.filter(([amount]) => Number(amount) < 0).sort((a, b) => Number(a[0]) - Number(b[0]))[0];
  return {
    occurredOn: head[0],
    description: head[1].trim(),
    amountMinor: Number(leg[0]),
    currency: leg[1],
    fromName: out ? await sharedNameTx(tx, out[3], out[4]) : null,
    toName: await sharedNameTx(tx, leg[3], leg[4]),
    fromItem: out ? await jointItemTx(tx, out[3]) : null,
    toItem: await jointItemTx(tx, leg[3]),
  };
}

/**
 * The item id of an account the holder made joint (0097), or null: a joint account is named on its transfers by the id
 * its item goes by, so both phones can list the transfer on it. Any other account carries no id.
 */
async function jointItemTx(tx: Db, accountId: string): Promise<string | null> {
  if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nw_joint_accounts'`)).length === 0) return null;
  const [row] = await tx.values<[string]>(sql`
    SELECT m.item_id FROM nw_joint_accounts j
    JOIN nw_share_settings s ON s.account_id = j.account_id AND s.setting = 'total'
    JOIN nw_item_map m ON m.account_id = j.account_id
    WHERE j.account_id = ${accountId}`);
  return row?.[0] ?? null;
}

/**
 * An account's name, only when its owner shares it with the household (net-worth setting 'total'): the partner already
 * sees it as "<Name>, shared" in Paid with and on Assets, so naming it tells nothing new. A private account, another
 * member's placeholder or a category is null.
 */
async function sharedNameTx(tx: Db, accountId: string, name: string): Promise<string | null> {
  if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nw_share_settings'`)).length === 0) return null;
  const [row] = await tx.values<[string]>(sql`SELECT setting FROM nw_share_settings WHERE account_id = ${accountId}`);
  return row?.[0] === 'total' ? name : null;
}

/** Files a bare transfer in a shared workspace: writes (or revives) its redacted row. False when it cannot be shown. */
export async function fileSharedTransferTx(tx: Db, ws: WorkspaceContext, transactionId: string, bookId: string): Promise<boolean> {
  if (!(await tableExists(tx))) return false;
  const member = await memberOfTx(tx, bookId);
  const figure = member ? await figureOfTx(tx, transactionId) : null;
  if (!member || !figure) return false;
  void ws;
  const transferId = await lineageOfTransaction(tx, transactionId);
  await withCapture(tx, { entity: KEY, id: transferId, bookId }, () =>
    tx.run(sql`
      INSERT INTO shared_transfers (book_id, transfer_id, occurred_on, amount_minor, currency, description, recorded_by, void, transaction_id, from_name, to_name, from_item, to_item)
      VALUES (${bookId}, ${transferId}, ${figure.occurredOn}, ${figure.amountMinor}, ${figure.currency}, ${figure.description}, ${member}, 0, ${transactionId}, ${figure.fromName}, ${figure.toName}, ${figure.fromItem}, ${figure.toItem})
      ON CONFLICT (book_id, transfer_id) DO UPDATE SET occurred_on = excluded.occurred_on, amount_minor = excluded.amount_minor,
        currency = excluded.currency, description = excluded.description, void = 0, transaction_id = excluded.transaction_id,
        from_name = excluded.from_name, to_name = excluded.to_name, from_item = excluded.from_item, to_item = excluded.to_item`),
  );
  return true;
}

/** The shared rows this recorder's live transaction stands behind. */
async function rowsOfTx(tx: Db, transactionId: string): Promise<{ bookId: string; transferId: string }[]> {
  if (!(await tableExists(tx))) return [];
  const rows = await tx.values<[string, string]>(sql`SELECT book_id, transfer_id FROM shared_transfers WHERE transaction_id = ${transactionId} AND void = 0`);
  return rows.map(([bookId, transferId]) => ({ bookId, transferId }));
}

/**
 * A transfer voided: its redacted row is void for the partner too. A void row is on no shared event either (0114), so a
 * transfer filed in the workspace again later (moved back in) comes back to its list, not to the event it was on.
 */
export async function voidSharedTransferTx(tx: Db, transactionId: string): Promise<void> {
  for (const { bookId, transferId } of await rowsOfTx(tx, transactionId)) {
    await withCapture(tx, { entity: KEY, id: transferId, bookId }, () =>
      tx.run(sql`UPDATE shared_transfers SET void = 1, event_book_id = NULL WHERE book_id = ${bookId} AND transfer_id = ${transferId}`),
    );
  }
}

/** The books a live transfer has a redacted row in, read before an edit voids it. */
export async function sharedTransferBooksTx(tx: Db, transactionId: string): Promise<string[]> {
  return (await rowsOfTx(tx, transactionId)).map((row) => row.bookId);
}

/**
 * An edited transfer: its redacted row follows the replacement (new figure, new transaction), in the books it was in.
 * An edit that is no bare transfer any more (a fee or a category line added: a purchase now, which travels as one) has
 * no row to follow it: the old row is voided, on every phone, so nothing is left standing for a transaction that is
 * gone — neither a stale transfer in the partner's list nor one on a shared event (fix round 1, I1).
 */
export async function carrySharedTransferTx(tx: Db, ws: WorkspaceContext, books: readonly string[], replacementId: string, originalId: string): Promise<void> {
  for (const bookId of books) {
    if (await fileSharedTransferTx(tx, ws, replacementId, bookId)) continue;
    const rows = await tx.values<[string]>(sql`SELECT transfer_id FROM shared_transfers WHERE book_id = ${bookId} AND transaction_id = ${originalId} AND void = 0`);
    for (const [transferId] of rows) {
      await withCapture(tx, { entity: KEY, id: transferId, bookId }, () =>
        tx.run(sql`UPDATE shared_transfers SET void = 1, event_book_id = NULL WHERE book_id = ${bookId} AND transfer_id = ${transferId}`),
      );
    }
  }
}

/** One redacted transfer as the partner's list shows it. */
export interface SharedTransferRow {
  transferId: string;
  bookId: string;
  occurredOn: string;
  amountMinor: number;
  currency: string;
  description: string;
  recordedBy: string;
  /** The recorder's shared account the money left / reached; null for a private account, which is never named. */
  fromName: string | null;
  toName: string | null;
}

/**
 * The transfers other members recorded in a shared workspace, newest first: what the partner's list shows beside its
 * own rows. The recorder's own phone never lists them (it has the real transfer). One listed on a shared event this
 * phone still holds (0114) is the event's to show, not the workspace's; one on an event this phone left, or whose copy
 * it deleted, is listed here again.
 */
export async function listSharedTransfers(database: Database, bookId: string, opts: { from?: string; to?: string } = {}): Promise<SharedTransferRow[]> {
  if (!(await tableExists(database.db))) return [];
  const member = await memberOfTx(database.db, bookId);
  if (!member) return [];
  const rows = await database.db.values<[string, string, string, number, string, string, string, string | null, string | null]>(sql`
    SELECT transfer_id, book_id, occurred_on, amount_minor, currency, description, recorded_by, from_name, to_name FROM shared_transfers
    WHERE book_id = ${bookId} AND void = 0 AND recorded_by <> ${member}
      AND (event_book_id IS NULL OR event_book_id NOT IN (SELECT book_id FROM shared_books WHERE state <> 'unshared'))
      AND occurred_on >= ${opts.from ?? '0000-00-00'} AND occurred_on <= ${opts.to ?? '9999-99-99'}
    ORDER BY occurred_on DESC, transfer_id DESC`);
  return rows.map(([transferId, book, occurredOn, amountMinor, currency, description, recordedBy, fromName, toName]) => ({
    transferId,
    bookId: book,
    occurredOn,
    amountMinor: Number(amountMinor),
    currency,
    description,
    recordedBy,
    fromName,
    toName,
  }));
}
