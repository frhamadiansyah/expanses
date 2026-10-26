import { uuidv7 } from '@expanses/core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, auditLog, settings } from '../schema';
import { bookBudgetSettings, bookCategories, bookIncomeOverrides, books, bookTransactions } from '../schema-books';
import { budgetOverrides, budgets, budgetShares } from '../schema-budget';
import { BookError, personalBookIdTx, type BookRow } from './books';
import { archiveAccountTx } from './accounts';
import { bookSplitsExist } from './book-splits';
import { categoryUsesTx } from './category-delete';
import { healthTablesExist } from './health-tables';
import { LedgerError, voidTransactionTx } from './ledger';

/*
 * Deleting a workspace for good, as opposed to archiving it (which keeps everything and can be undone).
 *
 * What goes, in one database transaction (all or nothing):
 *   - every posted transaction filed in the workspace is VOIDED, not erased — the ledger keeps its record, as it does
 *     for an account opened by mistake (`deleteUnusedAccount`) — so balances and net worth read as if the money had
 *     never been entered;
 *   - its budgets (caps, their month overrides and units), expected income and bonus months;
 *   - its categories are ARCHIVED (voided entries still point at them), taken out of the workspace, along with any
 *     category set filed in it;
 *   - the filing rows of the workspace and the workspace itself, so it is in no list, the archived one included.
 *
 * What refuses it, with nothing changed: the Personal workspace; one that is shared or was (a `shared_books` row, in any
 * state); a posted purchase with a part in another workspace as well; and live things that name its categories and
 * would be left pointing at nothing (recurring bills, event plans, drafts waiting for review).
 */

export interface BookDeletePlan {
  /** Posted transactions filed in the workspace (a split purchase counts once). */
  transactions: number;
  /** Open categories in the workspace. */
  categories: number;
  /** Budget caps on those categories. */
  budgets: number;
  /** Nothing was ever filed, set or tied to it: deleting needs one confirmation, not a typed name. */
  empty: boolean;
  /** Why it cannot be deleted, in words the screen shows as they are; null when it can. */
  refusal: string | null;
  /** The refusal's code (the `BookError` code `deleteBook` throws it with); null when it can be deleted. */
  refusalCode: 'PERSONAL_BOOK' | 'SHARED' | 'LAST_BOOK' | 'SPLIT' | 'IN_USE' | null;
}

export const PERSONAL_MESSAGE = 'Personal is where categories and expected income fall back to, so it cannot be deleted.';
export const SHARED_MESSAGE = 'This workspace is shared with other people. Stop sharing it first, then delete it.';
export const SHARED_BEFORE_MESSAGE = 'This workspace was shared before. Use Stop sharing on this device first, then delete it.';
export const JOINED_MESSAGE = 'This workspace belongs to someone else’s share. Leave it first, then delete it.';
export const SPLIT_MESSAGE =
  'A purchase is split between this workspace and another. Edit it and file every part in one workspace, then delete this one.';

async function tableExists(tx: Db, name: string): Promise<boolean> {
  const rows = await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`);
  return rows.length > 0;
}

/** The posted transactions filed in the book: by its row, as a part of a split, or by an entry on one of its categories. */
function filedSql(bookId: string, splits: boolean) {
  const own = sql`SELECT category_account_id FROM book_categories WHERE book_id = ${bookId}`;
  const parts = splits ? sql` OR t.id IN (SELECT transaction_id FROM book_transaction_splits WHERE book_id = ${bookId})` : sql``;
  return sql`SELECT t.id FROM transactions t WHERE t.status = 'posted' AND (
    t.id IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId})${parts}
    OR t.id IN (SELECT e.transaction_id FROM entries e WHERE e.account_id IN (${own}) OR e.spend_category_id IN (${own})))`;
}

async function shareRefusal(tx: Db, book: BookRow): Promise<string | null> {
  if (book.kind === 'shared') return JOINED_MESSAGE;
  if (!(await tableExists(tx, 'shared_books'))) return null;
  const rows = await tx.values<[string]>(sql`SELECT state FROM shared_books WHERE book_id = ${book.id}`);
  if (rows.length === 0) return null;
  return rows[0]![0] === 'unshared' ? SHARED_BEFORE_MESSAGE : SHARED_MESSAGE;
}

/** What deleting the workspace would take, and whether it may. Reads only. */
async function planTx(tx: Db, ws: WorkspaceContext, book: BookRow): Promise<BookDeletePlan> {
  const splits = await bookSplitsExist(tx);
  const bookId = book.id;
  const categoryRows = await tx
    .select({ id: accounts.id, archivedAt: accounts.archivedAt })
    .from(bookCategories)
    .innerJoin(accounts, eq(accounts.id, bookCategories.categoryAccountId))
    .where(and(eq(bookCategories.bookId, bookId), eq(accounts.workspaceId, ws.workspaceId)));
  const ids = categoryRows.map((row) => row.id);
  const categories = categoryRows.filter((row) => row.archivedAt === null).length;
  const cap = ids.length ? await tx.select({ id: budgets.id }).from(budgets).where(and(eq(budgets.workspaceId, ws.workspaceId), inArray(budgets.categoryAccountId, ids))) : [];
  const [settingsRow] = await tx.select({ id: bookBudgetSettings.bookId }).from(bookBudgetSettings).where(eq(bookBudgetSettings.bookId, bookId));
  const [bonus] = await tx.select({ month: bookIncomeOverrides.month }).from(bookIncomeOverrides).where(eq(bookIncomeOverrides.bookId, bookId)).limit(1);
  const [{ n }] = (await tx.values<[number]>(sql`SELECT count(*) FROM (${filedSql(bookId, splits)})`)).map(([n]) => ({ n: Number(n) })) as [{ n: number }];

  const plan = (refusalCode: BookDeletePlan['refusalCode'], refusal: string | null, uses = 0): BookDeletePlan => ({
    transactions: n,
    categories,
    budgets: cap.length,
    empty: n === 0 && cap.length === 0 && !settingsRow && !bonus && uses === 0,
    refusal,
    refusalCode,
  });

  if (book.kind === 'personal') return plan('PERSONAL_BOOK', PERSONAL_MESSAGE);
  const shared = await shareRefusal(tx, book);
  if (shared) return plan('SHARED', shared);
  const [{ open }] = (await tx.values<[number]>(sql`SELECT count(*) FROM books WHERE workspace_id = ${ws.workspaceId} AND archived_at IS NULL`)).map(([open]) => ({ open: Number(open) })) as [{ open: number }];
  if (!book.archivedAt && open <= 1) return plan('LAST_BOOK', 'The last workspace cannot be deleted.');

  // A purchase with a part here and a part elsewhere (or any posted transaction whose lines touch two workspaces) would
  // be half deleted: refused before anything is written.
  if (n > 0) {
    const straddling = await tx.values<[string]>(sql`
      SELECT 1 FROM transactions t WHERE t.id IN (${filedSql(bookId, splits)}) AND (
        ${splits ? sql`EXISTS (SELECT 1 FROM book_transaction_splits s WHERE s.transaction_id = t.id AND s.book_id <> ${bookId}) OR` : sql``}
        EXISTS (SELECT 1 FROM book_transactions b WHERE b.transaction_id = t.id AND b.book_id <> ${bookId})
        OR EXISTS (SELECT 1 FROM entries e JOIN book_categories c ON c.category_account_id = e.account_id
                   WHERE e.transaction_id = t.id AND c.book_id <> ${bookId}))
      LIMIT 1`);
    if (straddling.length > 0) return plan('SPLIT', SPLIT_MESSAGE);
  }

  // Live things that name one of its categories would be left pointing at an archived one.
  let uses = 0;
  const leftBehind: string[] = [];
  for (const id of ids) {
    for (const use of await categoryUsesTx(tx, id)) {
      if (use.use === 'bills' || use.use === 'event plans' || use.use === 'drafts') {
        uses += use.count;
        if (!leftBehind.includes(use.use)) leftBehind.push(use.use);
      }
    }
  }
  if (uses > 0) {
    return plan('IN_USE', `${leftBehind.join(', ')} still use categories in this workspace. Move or remove them first, then delete it.`, uses);
  }
  return plan(null, null);
}

/** What deleting the workspace would take and whether it may, for the page to show before anything is asked. */
export async function planBookDelete(database: Database, ws: WorkspaceContext, bookId: string): Promise<BookDeletePlan> {
  const [row] = await database.db.select().from(books).where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, bookId)));
  if (!row) throw new BookError('NOT_FOUND', 'That workspace is not here');
  return planTx(database.db, ws, {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseCurrency: row.baseCurrency,
    countEventsInBudget: row.countEventsInBudget === 1,
    archivedAt: row.archivedAt,
  });
}

/**
 * Deletes the workspace, everything filed in it voided (see the top of this file). One transaction: a refusal, or
 * anything failing along the way (a sale or a fund switch among the transactions, which have their own way back),
 * leaves every figure as it was. If it was the open workspace, the app falls back to Personal.
 *
 * The caller takes a safety copy first where the platform keeps them (the screen does, before calling this).
 */
export async function deleteBook(database: Database, ws: WorkspaceContext, bookId: string): Promise<{ transactions: number; categories: number; budgets: number }> {
  return database.transaction(async (tx) => {
    const [row] = await tx.select().from(books).where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, bookId)));
    if (!row) throw new BookError('NOT_FOUND', 'That workspace is not here');
    const book: BookRow = {
      id: row.id,
      name: row.name,
      kind: row.kind,
      baseCurrency: row.baseCurrency,
      countEventsInBudget: row.countEventsInBudget === 1,
      archivedAt: row.archivedAt,
    };
    const plan = await planTx(tx, ws, book);
    if (plan.refusal && plan.refusalCode) throw new BookError(plan.refusalCode, plan.refusal);
    const splits = await bookSplitsExist(tx);

    // 1. The money: every posted transaction filed here is voided, so the ledger keeps its record. Voiding one can void
    // others with it (a settlement, a deposit event), so each is read again before it is voided.
    const filed = await tx.values<[string]>(sql`${filedSql(bookId, splits)} ORDER BY t.occurred_on DESC, t.created_at DESC`);
    for (const [id] of filed) {
      const [status] = await tx.values<[string]>(sql`SELECT status FROM transactions WHERE id = ${id}`);
      if (status?.[0] !== 'posted') continue;
      try {
        await voidTransactionTx(tx, ws, id);
      } catch (failure) {
        if (failure instanceof LedgerError) throw new BookError('CANNOT_VOID', `${failure.message} Nothing was deleted.`);
        throw failure;
      }
    }

    // 2. The plan: caps (with their month overrides and units), expected income and bonus months.
    const categoryIds = (await tx.select({ id: bookCategories.categoryAccountId }).from(bookCategories).where(eq(bookCategories.bookId, bookId))).map((r) => r.id);
    if (categoryIds.length) {
      const capIds = (await tx.select({ id: budgets.id }).from(budgets).where(and(eq(budgets.workspaceId, ws.workspaceId), inArray(budgets.categoryAccountId, categoryIds)))).map((r) => r.id);
      if (capIds.length) {
        await tx.delete(budgetOverrides).where(inArray(budgetOverrides.budgetId, capIds));
        await tx.delete(budgetShares).where(inArray(budgetShares.budgetId, capIds));
        if (await healthTablesExist(tx)) await tx.run(sql`DELETE FROM budget_frequencies WHERE budget_id IN ${capIds}`);
        await tx.delete(budgets).where(inArray(budgets.id, capIds));
      }
    }
    await tx.delete(bookBudgetSettings).where(eq(bookBudgetSettings.bookId, bookId));
    await tx.delete(bookIncomeOverrides).where(eq(bookIncomeOverrides.bookId, bookId));

    // 3. The categories are archived, not erased: the voided entries still name them. They leave the workspace.
    const toArchive = categoryIds.length
      ? await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.workspaceId, ws.workspaceId), inArray(accounts.id, categoryIds), isNull(accounts.archivedAt)))
      : [];
    for (const { id } of toArchive) await archiveAccountTx(tx, ws, id);
    await tx.delete(bookCategories).where(eq(bookCategories.bookId, bookId));
    if (await tableExists(tx, 'book_category_sets')) {
      await tx.run(
        sql`UPDATE category_sets SET archived_at = ${new Date().toISOString()} WHERE archived_at IS NULL AND id IN (SELECT set_id FROM book_category_sets WHERE book_id = ${bookId})`,
      );
      await tx.run(sql`DELETE FROM book_category_sets WHERE book_id = ${bookId}`);
    }

    // 4. The filing rows (the transactions are void now), then the workspace.
    await tx.delete(bookTransactions).where(eq(bookTransactions.bookId, bookId));
    if (splits) await tx.run(sql`DELETE FROM book_transaction_splits WHERE book_id = ${bookId}`);

    // If it was the open workspace, the app falls back to Personal rather than to whichever is first.
    const key = `active_book:${ws.workspaceId}`;
    const [remembered] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
    if (remembered?.value === bookId) {
      const personal = await personalBookIdTx(tx, ws.workspaceId);
      if (personal && personal !== bookId) await tx.update(settings).set({ value: personal }).where(eq(settings.key, key));
      else await tx.delete(settings).where(eq(settings.key, key));
    }

    await tx.delete(books).where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, bookId)));
    await tx.insert(auditLog).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      action: 'delete',
      entity: 'book',
      entityId: bookId,
      payloadJson: JSON.stringify({ name: book.name, kind: book.kind, transactions: filed.length, categories: plan.categories, budgets: plan.budgets }),
      createdAt: new Date().toISOString(),
    });
    return { transactions: filed.length, categories: plan.categories, budgets: plan.budgets };
  });
}
