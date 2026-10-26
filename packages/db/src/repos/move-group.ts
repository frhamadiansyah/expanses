import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { bookTransactions } from '../schema-books';
import { fileSharedTransferTx } from './shared-transfers';

/*
 * A top-up or a withdrawal is one thing to the owner and, from a bank account or cash, two rows in the ledger: the
 * transfer (no category, so filed in no workspace and shown by every one) and the fee beside it (spending, filed in the
 * workspace of its category). `moveMoneyIn` posts them as a pair with no link between them, so moving "the transaction"
 * left the other half behind. These helpers find the pair again and file a category-less transfer in one workspace, so
 * a move can carry the whole group in one database transaction (see `replaceTransactionTx`'s `toBookId`).
 */

/** The words `moveMoneyIn` is called with from the Withdraw and Top up forms: a transfer's description and its fee's. */
const PAIRS: readonly { transfer: string; fee: string }[] = [
  { transfer: 'Cash withdrawal', fee: 'ATM fee' },
  { transfer: 'Top up', fee: 'Top-up fee' },
];

interface Leg {
  id: string;
  description: string;
  occurredOn: string;
  createdAt: string;
  cardId: string | null;
  /** The account the money left: the asset or card line with a negative amount. */
  fromId: string | null;
  /** True for a row whose only non-money line is a category (the fee); false for a bare transfer. */
  hasCategory: boolean;
  lineCount: number;
}

async function legsOn(tx: Db, ws: WorkspaceContext, occurredOn: string, description: string): Promise<Leg[]> {
  const rows = await tx.values<[string, string, string, string, string | null]>(sql`
    SELECT id, description, occurred_on, created_at, card_id FROM transactions
    WHERE workspace_id = ${ws.workspaceId} AND status = 'posted' AND occurred_on = ${occurredOn} AND description = ${description}`);
  const legs: Leg[] = [];
  for (const [id, desc, on, createdAt, cardId] of rows) {
    const lines = await tx.values<[number, string]>(sql`
      SELECT e.amount_minor, a.kind FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${id}`);
    const from = await tx.values<[string]>(sql`
      SELECT e.account_id FROM entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = ${id} AND e.amount_minor < 0 AND a.kind IN ('asset', 'liability') LIMIT 1`);
    legs.push({
      id,
      description: desc,
      occurredOn: on,
      createdAt,
      cardId,
      fromId: from[0]?.[0] ?? null,
      hasCategory: lines.some(([, kind]) => kind === 'expense' || kind === 'income'),
      lineCount: lines.length,
    });
  }
  return legs;
}

/**
 * The other half of a withdrawal or a top-up from a bank: for a transfer its fee, for a fee its transfer, or none.
 * Matched by the words the form wrote, the day, the account the money left and the card, the nearest in time winning,
 * so two top-ups on one day pair off in the order they were made. Only a pair of two-line rows counts.
 */
export async function moneyInPartnerTx(tx: Db, ws: WorkspaceContext, id: string): Promise<string | null> {
  const [row] = await tx.values<[string, string]>(sql`
    SELECT description, occurred_on FROM transactions WHERE id = ${id} AND workspace_id = ${ws.workspaceId} AND status = 'posted'`);
  if (!row) return null;
  const [description, occurredOn] = row;
  const pair = PAIRS.find((each) => each.transfer === description || each.fee === description);
  if (!pair) return null;
  const mineIsTransfer = pair.transfer === description;
  const [mine] = (await legsOn(tx, ws, occurredOn, description)).filter((leg) => leg.id === id);
  if (!mine || mine.lineCount !== 2 || mine.fromId === null || mine.hasCategory === mineIsTransfer) return null;
  const others = (await legsOn(tx, ws, occurredOn, mineIsTransfer ? pair.fee : pair.transfer)).filter(
    (leg) => leg.lineCount === 2 && leg.hasCategory === mineIsTransfer && leg.fromId === mine.fromId && leg.cardId === mine.cardId,
  );
  if (others.length === 0) return null;
  const gap = (leg: Leg) => Math.abs(Date.parse(leg.createdAt) - Date.parse(mine.createdAt));
  others.sort((a, b) => gap(a) - gap(b));
  return others[0]!.id;
}

/** Whether a workspace is shared with a household: a bare transfer is never filed in one, or it would travel to it. */
export async function bookIsSharedTx(tx: Db, bookId: string): Promise<boolean> {
  if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_books'`)).length === 0) return false;
  return (await tx.values(sql`SELECT 1 FROM shared_books WHERE book_id = ${bookId} LIMIT 1`)).length > 0;
}

/**
 * Files a category-less transfer in one workspace, so it shows there and in no other. In a shared workspace it is not
 * filed as a purchase (that would send account ids the partner does not have): it travels as a redacted row beside
 * the real transfer (`fileSharedTransferTx`), and the real one is listed by that workspace alone. Returns whether it was filed.
 */
export async function fileTransferTx(tx: Db, ws: WorkspaceContext, transactionId: string, bookId: string): Promise<boolean> {
  await tx.delete(bookTransactions).where(and(eq(bookTransactions.transactionId, transactionId), eq(bookTransactions.workspaceId, ws.workspaceId)));
  if (await bookIsSharedTx(tx, bookId)) return fileSharedTransferTx(tx, ws, transactionId, bookId);
  await tx.insert(bookTransactions).values({ transactionId, workspaceId: ws.workspaceId, bookId });
  return true;
}

/**
 * The copy of a category in another workspace: the one with the same key (a built-in category keeps it in every copy),
 * else the same name under a parent of the same name, else the same name. The category itself when it is already there.
 * Null when that workspace has none.
 */
export async function categoryInBookTx(tx: Db, ws: WorkspaceContext, categoryId: string, toBookId: string): Promise<string | null> {
  const [from] = await tx.values<[string, string | null, string, string | null, string]>(sql`
    SELECT a.kind, a.system_key, a.name, p.name, a.id FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id
    WHERE a.id = ${categoryId} AND a.workspace_id = ${ws.workspaceId}`);
  if (!from) return null;
  const [kind, systemKey, name, parentName] = from;
  const there = await tx.values<[string, string | null, string, string | null]>(sql`
    SELECT a.id, a.system_key, a.name, p.name FROM accounts a
    JOIN book_categories b ON b.category_account_id = a.id
    LEFT JOIN accounts p ON p.id = a.parent_id
    WHERE b.book_id = ${toBookId} AND a.workspace_id = ${ws.workspaceId} AND a.kind = ${kind} AND a.archived_at IS NULL`);
  if (there.some(([id]) => id === categoryId)) return categoryId;
  if (systemKey) {
    const keyed = there.find(([, key]) => key === systemKey);
    if (keyed) return keyed[0];
  }
  const lower = (text: string | null) => (text ?? '').trim().toLowerCase();
  const named = there.filter(([, , each]) => lower(each) === lower(name));
  return (named.find(([, , , parent]) => lower(parent) === lower(parentName)) ?? named[0])?.[0] ?? null;
}
