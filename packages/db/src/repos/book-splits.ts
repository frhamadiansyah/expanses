import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { Db } from '../database';

/*
 * One purchase split across workspaces (0084): one transaction, one card line, its category lines filed in two or more
 * workspaces. It has no `book_transactions` row — that row is the one workspace a transaction is in, and net worth and
 * every reader of a single workspace go by it — and a `book_transaction_splits` row for each workspace with a part. Read
 * and written by name: a database stopped before 0084 has no such table, and nothing split.
 *
 * Household sharing: at most one of a split's workspaces may be shared (or have been, with its share still here). The
 * purchase travels in that workspace as its part there alone — its category lines in that workspace, paid from the
 * same card — and the other parts, their categories and the whole charge never leave the phone (sync/capture.ts,
 * `projectPurchase`; sync/apply.ts keeps them when a partner's edit or delete of the part comes back).
 */

const present = new WeakMap<object, true>();

/** Whether this copy has the table (0084). Asked once per handle; only a yes is kept. */
export async function bookSplitsExist(db: Db): Promise<boolean> {
  if (present.get(db)) return true;
  const rows = await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'book_transaction_splits'`);
  if (rows.length > 0) present.set(db, true);
  return rows.length > 0;
}

/** The workspaces a split purchase has a part in, in the order they were written; empty for any other transaction. */
export async function splitBooksOfTx(db: Db, transactionId: string): Promise<string[]> {
  if (!(await bookSplitsExist(db))) return [];
  const rows = await db.values<[string]>(sql`SELECT book_id FROM book_transaction_splits WHERE transaction_id = ${transactionId} ORDER BY rowid`);
  return rows.map(([bookId]) => bookId);
}

/** Every split purchase among these, by transaction id, with the workspaces it has a part in. */
export async function splitBooksOfMany(db: Db, transactionIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (transactionIds.length === 0 || !(await bookSplitsExist(db))) return out;
  const rows = await db.values<[string, string]>(
    sql`SELECT transaction_id, book_id FROM book_transaction_splits WHERE transaction_id IN ${[...transactionIds]} ORDER BY rowid`,
  );
  for (const [transactionId, bookId] of rows) out.set(transactionId, [...(out.get(transactionId) ?? []), bookId]);
  return out;
}

/** Files a split purchase in each workspace it has a part in. */
export async function writeSplitBooksTx(db: Db, workspaceId: string, transactionId: string, bookIds: readonly string[]): Promise<void> {
  for (const bookId of bookIds) {
    await db.run(sql`INSERT INTO book_transaction_splits (transaction_id, workspace_id, book_id) VALUES (${transactionId}, ${workspaceId}, ${bookId})`);
  }
}

/**
 * Over a transaction id, for a list narrowed to one workspace: false only for a split purchase with no part in it. A
 * transaction filed nowhere otherwise shows in every workspace (moving money between accounts), and a split is filed
 * nowhere in `book_transactions`, so without this it would show in a third workspace too.
 */
export function splitHasPartIn(transactionId: SQLWrapper, bookId: string): SQL {
  return sql`(${transactionId} NOT IN (SELECT transaction_id FROM book_transaction_splits)
    OR ${transactionId} IN (SELECT transaction_id FROM book_transaction_splits WHERE book_id = ${bookId}))`;
}

/**
 * Over a transaction id: whether it is filed in this book, by its one `book_transactions` row or as a part of a purchase
 * split across workspaces (0084). What household sharing goes by: a split travels in the one shared workspace it has a
 * part in, as that part. `splits` false (a database stopped before 0084) reads `book_transactions` alone.
 */
export function filedInBook(transactionId: SQLWrapper, bookId: string, splits: boolean): SQL {
  return splits
    ? sql`(${transactionId} IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId})
        OR ${transactionId} IN (SELECT transaction_id FROM book_transaction_splits WHERE book_id = ${bookId}))`
    : sql`${transactionId} IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId})`;
}
