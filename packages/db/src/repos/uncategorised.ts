import { UNCATEGORISED } from '@expanses/core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { withCapture } from '../sync/capture';
import { namespaceOf, uuidv5 } from '../sync/uuidv5';
import { hasBooks, personalBookIdTx } from './books';

/** Where an Uncategorised row is drawn: last of its kind's top level. */
const UNCATEGORISED_SORT = 999;

/**
 * The id Uncategorised has in a book (or, before books, a workspace): the same on every device without any device
 * telling the others. The expense one is household sync's rule-4 category, `uuidv5(bookId, 'uncategorised')`, so the
 * two are one row; income has a name of its own. A book id that is not a uuid (0042's `'book-' + workspace id`) is
 * named through `namespaceOf`, so a Personal book from before books has one too.
 */
export async function uncategorisedIdOf(bookOrWorkspaceId: string, kind: 'expense' | 'income'): Promise<string> {
  return uuidv5(await namespaceOf(bookOrWorkspaceId), kind === 'expense' ? 'uncategorised' : 'uncategorised:income');
}

/**
 * Uncategorised of one kind in one book, inserted if absent and keyed if a row made before keys (rule 4 had none)
 * lacks its key. Capture is the caller's: apply runs with it off, a form's save with it on. The one way the row is
 * made, so the rule-4 path and "Choose later" can never make two.
 */
export async function ensureUncategorisedRowTx(tx: Db, workspaceId: string, bookId: string | null, kind: 'expense' | 'income'): Promise<string> {
  const id = await uncategorisedIdOf(bookId ?? workspaceId, kind);
  const { key, name } = UNCATEGORISED[kind];
  const [found] = await tx.values<[string | null]>(sql`SELECT system_key FROM accounts WHERE id = ${id}`);
  if (!found) {
    await tx.run(sql`
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, system_key, sort_order, archived_at, created_at)
      VALUES (${id}, ${workspaceId}, NULL, ${kind}, 'category', ${name}, NULL, NULL, ${key}, ${UNCATEGORISED_SORT}, NULL, ${new Date().toISOString()})`);
    if (bookId) await tx.run(sql`INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES (${id}, ${workspaceId}, ${bookId})`);
  } else if (found[0] === null) {
    await tx.run(sql`UPDATE accounts SET system_key = ${key} WHERE id = ${id}`);
  }
  return id;
}

/** The book a write files into: the open one, else Personal; null on a database from before books. */
async function bookOf(tx: Db, ws: WorkspaceContext): Promise<string | null> {
  if (!(await hasBooks(tx))) return null;
  return ws.bookId ?? (await personalBookIdTx(tx, ws.workspaceId));
}

/**
 * Where an expense or an income saved without a category is filed (`UNCATEGORISED`): the open book's own, made the
 * first time one is needed and reused after. It sits at the top of its kind's tree, so no parent's budget counts it.
 */
export async function uncategorisedCategory(database: Database, ws: WorkspaceContext, kind: 'expense' | 'income'): Promise<string> {
  return database.transaction(async (tx) => {
    const bookId = await bookOf(tx, ws);
    const id = await uncategorisedIdOf(bookId ?? ws.workspaceId, kind);
    return withCapture(tx, { entity: 'category', id }, () => ensureUncategorisedRowTx(tx, ws.workspaceId, bookId, kind));
  });
}

/**
 * Every posted transaction still filed under Uncategorised in the open book, whatever its date — what "N need a
 * category" counts and what tapping it lists.
 */
export async function uncategorisedTransactionIds(database: Database, ws: WorkspaceContext): Promise<string[]> {
  const rows = await database.db
    .selectDistinct({ id: transactions.id, occurredOn: transactions.occurredOn })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        inArray(accounts.systemKey, [UNCATEGORISED.expense.key, UNCATEGORISED.income.key]),
        ...(ws.bookId ? [sql`${entries.accountId} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`] : []),
      ),
    )
    .orderBy(desc(transactions.occurredOn));
  return rows.map((row) => row.id);
}
