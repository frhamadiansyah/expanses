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

const flagged = new WeakMap<object, true>();

/** Whether this copy has the part's own Exclude from report (0090). Asked once per handle; only a yes is kept. */
export async function splitExclusionExists(db: Db): Promise<boolean> {
  if (flagged.get(db)) return true;
  if (!(await bookSplitsExist(db))) return false;
  const rows = await db.values<[string]>(sql`SELECT name FROM pragma_table_info('book_transaction_splits') WHERE name = 'excluded'`);
  if (rows.length > 0) flagged.set(db, true);
  return rows.length > 0;
}

/** A split purchase's part: the workspace it is in, and whether it is left out of that workspace's reports (0090). */
export interface SplitPartFlag {
  bookId: string;
  excluded: boolean;
}

/** Every split purchase among these, by transaction id, with each of its parts and whether that part is left out. */
export async function splitPartsOfMany(db: Db, transactionIds: readonly string[]): Promise<Map<string, SplitPartFlag[]>> {
  const out = new Map<string, SplitPartFlag[]>();
  if (transactionIds.length === 0 || !(await bookSplitsExist(db))) return out;
  const flag = (await splitExclusionExists(db)) ? sql`excluded` : sql`0`;
  const rows = await db.values<[string, string, number]>(
    sql`SELECT transaction_id, book_id, ${flag} FROM book_transaction_splits WHERE transaction_id IN ${[...transactionIds]} ORDER BY rowid`,
  );
  for (const [transactionId, bookId, excluded] of rows) out.set(transactionId, [...(out.get(transactionId) ?? []), { bookId, excluded: Number(excluded) === 1 }]);
  return out;
}

/** The workspaces whose part of this split purchase is left out of their reports; empty for anything else. */
export async function excludedSplitBooksTx(db: Db, transactionId: string): Promise<Set<string>> {
  if (!(await splitExclusionExists(db))) return new Set();
  const rows = await db.values<[string]>(sql`SELECT book_id FROM book_transaction_splits WHERE transaction_id = ${transactionId} AND excluded = 1`);
  return new Set(rows.map(([bookId]) => bookId));
}

/**
 * Files a split purchase in each workspace it has a part in, each part left out of its workspace's reports when its
 * workspace is in `excluded` (0090; a database stopped before it keeps every part counted).
 */
export async function writeSplitBooksTx(
  db: Db,
  workspaceId: string,
  transactionId: string,
  bookIds: readonly string[],
  excluded: ReadonlySet<string> = new Set(),
): Promise<void> {
  const flags = await splitExclusionExists(db);
  for (const bookId of bookIds) {
    if (flags) {
      await db.run(sql`INSERT INTO book_transaction_splits (transaction_id, workspace_id, book_id, excluded)
        VALUES (${transactionId}, ${workspaceId}, ${bookId}, ${excluded.has(bookId) ? 1 : 0})`);
    } else {
      await db.run(sql`INSERT INTO book_transaction_splits (transaction_id, workspace_id, book_id) VALUES (${transactionId}, ${workspaceId}, ${bookId})`);
    }
  }
}

const lined = new WeakMap<object, true>();

/** Whether this copy has the per-line Exclude from report (0096). Asked once per handle; only a yes is kept. */
export async function lineExclusionExists(db: Db): Promise<boolean> {
  if (lined.get(db)) return true;
  const rows = await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transaction_line_excluded'`);
  if (rows.length > 0) lined.set(db, true);
  return rows.length > 0;
}

/**
 * The categories of this purchase's lines left out of their workspace's reports, by whatever says it (0090, 0096): a line
 * left out on its own, or a line in a workspace whose whole part is. A purchase excluded whole (its transaction_flags
 * row) is not read here. Empty on a database stopped before both.
 */
export async function excludedLinesTx(db: Db, transactionId: string): Promise<Set<string>> {
  const out = new Set<string>();
  if (await lineExclusionExists(db)) {
    const rows = await db.values<[string]>(sql`SELECT account_id FROM transaction_line_excluded WHERE transaction_id = ${transactionId}`);
    for (const [accountId] of rows) out.add(accountId);
  }
  if (await splitExclusionExists(db)) {
    const rows = await db.values<[string]>(sql`SELECT c.category_account_id FROM book_transaction_splits s
      JOIN book_categories c ON c.book_id = s.book_id WHERE s.transaction_id = ${transactionId} AND s.excluded = 1`);
    for (const [accountId] of rows) out.add(accountId);
  }
  return out;
}

/** Every purchase among these, by transaction id, with the categories of the lines left out on their own (0096). */
export async function lineExclusionsOfMany(db: Db, transactionIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (transactionIds.length === 0 || !(await lineExclusionExists(db))) return out;
  const rows = await db.values<[string, string]>(sql`SELECT transaction_id, account_id FROM transaction_line_excluded WHERE transaction_id IN ${[...transactionIds]}`);
  for (const [transactionId, accountId] of rows) (out.get(transactionId) ?? out.set(transactionId, new Set()).get(transactionId)!).add(accountId);
  return out;
}

/** Files the lines left out on their own (0096), one row per category; nothing on a database stopped before it. */
export async function writeLineExclusionsTx(db: Db, workspaceId: string, transactionId: string, accountIds: Iterable<string>): Promise<void> {
  if (!(await lineExclusionExists(db))) return;
  for (const accountId of new Set(accountIds)) {
    await db.run(sql`INSERT OR IGNORE INTO transaction_line_excluded (transaction_id, workspace_id, account_id) VALUES (${transactionId}, ${workspaceId}, ${accountId})`);
  }
}

/**
 * Over an entry's transaction and account: false for a category line left out of its workspace's reports on its own
 * (0096), or of a split purchase's part that is left out whole (0090). Every reader that adds spending up takes it
 * beside `notExcluded`, which leaves out a purchase excluded whole: the part's workspace is the one its category is
 * filed in.
 */
export function partCounted(transactionId: SQLWrapper, accountId: SQLWrapper): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM book_transaction_splits xs JOIN book_categories xc ON xc.book_id = xs.book_id
    WHERE xs.transaction_id = ${transactionId} AND xs.excluded = 1 AND xc.category_account_id = ${accountId})`;
}

/** `partCounted` for a line left out on its own (0096). */
export function lineCounted(transactionId: SQLWrapper, accountId: SQLWrapper): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM transaction_line_excluded xl WHERE xl.transaction_id = ${transactionId} AND xl.account_id = ${accountId})`;
}

/** `partCounted` and `lineCounted` where their tables and columns are there; nothing to add on a database stopped before them. */
export async function partCountedWhere(db: Db, transactionId: SQLWrapper, accountId: SQLWrapper): Promise<SQL[]> {
  const out: SQL[] = [];
  if (await splitExclusionExists(db)) out.push(partCounted(transactionId, accountId));
  if (await lineExclusionExists(db)) out.push(lineCounted(transactionId, accountId));
  return out;
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
