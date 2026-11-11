import { uuidv7 } from '@expanses/core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, auditLog, settings } from '../schema';
import { bookBudgetSettings, bookCategories, bookIncomeOverrides, books, bookTransactions } from '../schema-books';
import { budgets } from '../schema-budget';
import { viewActiveDevices, viewOwnerDevices } from '../sync/authority';
import { BookError, personalBookIdTx, type BookRow } from './books';
import { archiveAccountTx } from './accounts';
import {
  deleteBookPlanTx,
  eraseBookTx,
  keepInPersonalTx,
  keptByRecordsTx,
  ownPurchasesTx,
  ownRecordsMessage,
  readOnlyCopyTx,
  recordsMessage,
  wasEverSharedTx,
} from './book-erase';
import { bookSplitsExist } from './book-splits';
import { categoryUsesTx } from './category-delete';
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
 * A workspace that is or was shared (`wasEverSharedTx`: a joined copy, a share in any state, a remembered member, a
 * purchase lineage) is ERASED instead (`book-erase.ts`, sharing resilience §5): its ids live on in the partners' copies
 * and the relay's log, and voided rows left here would stand in the way of sharing it to this phone again. In a joined
 * copy, the purchases paid from this member's own accounts are first moved into Personal unless the caller says not
 * to (`keepOwnInPersonal`), so deleting the copy never quietly changes an own balance.
 *
 * What refuses it, with nothing changed: the Personal workspace; one shared and active here (not frozen) — stop
 * sharing it, or leave it; a posted purchase with a part in another workspace as well; and live things that name its
 * categories and would be left pointing at nothing (recurring bills, event plans, drafts waiting for review). A joined
 * copy's own bills are erased with it rather than refusing.
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
  refusalCode: 'PERSONAL_BOOK' | 'SHARED' | 'LAST_BOOK' | 'SPLIT' | 'RECORDS' | 'IN_USE' | null;
  /** It is or was shared: deleting erases every row only it holds, rather than voiding them (spec §5). */
  erases: boolean;
  /**
   * A joined copy's purchases paid from this member's own accounts (not a placeholder, not a joint account), which
   * `deleteBook` keeps in Personal unless told not to. 0 for any other workspace.
   */
  ownPurchases: number;
  /**
   * Transactions the erase would take that a record it cannot take still names (a trade, a sale, a transfer between
   * partners): any refuses the delete (`RECORDS`). 0 when the workspace voids.
   */
  kept: number;
  /**
   * In a read-only joined copy (left, stopped, removed): the trades and sales of this phone's own among `kept`, which
   * the delete keeps in Personal in place and cannot erase — so it needs `keepOwnInPersonal` on. 0 for anything else.
   */
  ownRecords: number;
}

export interface DeleteBookOptions {
  /** A joined copy's own purchases (`BookDeletePlan.ownPurchases`) move into Personal first. Default true. */
  keepOwnInPersonal?: boolean;
}

export const PERSONAL_MESSAGE = 'Personal is where categories and expected income fall back to, so it cannot be deleted.';
export const SHARED_MESSAGE = 'This workspace is shared with other people. Stop sharing it first, then delete it.';
export const ACTIVE_JOINED_MESSAGE = 'This workspace is shared and active here. Leave and delete it, or leave it first.';
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

/**
 * Refused only while the share is live here: `active` and not frozen (§8.5, the test `SyncEngine.isFrozen` makes: devices
 * in the view, no owner device among them). A share that ended, waits for an invite, or is frozen is deleted, erasing.
 */
async function shareRefusal(tx: Db, book: BookRow): Promise<string | null> {
  if (!(await tableExists(tx, 'shared_books'))) return null;
  const rows = await tx.values<[string]>(sql`SELECT state FROM shared_books WHERE book_id = ${book.id}`);
  if (rows.length === 0 || rows[0]![0] !== 'active') return null;
  const frozen = (await viewActiveDevices(tx, book.id)).length > 0 && (await viewOwnerDevices(tx, book.id)).length === 0;
  if (frozen) return null;
  return book.kind === 'shared' ? ACTIVE_JOINED_MESSAGE : SHARED_MESSAGE;
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
  const erases = await wasEverSharedTx(tx, bookId, book.kind);
  const ownPurchases = erases && book.kind === 'shared' ? (await ownPurchasesTx(tx, ws, bookId)).length : 0;
  const records = erases ? await keptByRecordsTx(tx, ws, bookId) : { own: [], other: [] };
  const kept = records.own.length + records.other.length;
  // A read-only joined copy cannot have them undone or moved first (fix round 2, N1): its own trades and sales are kept
  // in Personal by the delete itself; only the rest refuse, in words that ask for nothing the app would refuse.
  const readOnly = erases && (await readOnlyCopyTx(tx, bookId, book.kind));
  const ownRecords = readOnly ? records.own.length : 0;
  const refusedRecords = kept - ownRecords;

  const plan = (refusalCode: BookDeletePlan['refusalCode'], refusal: string | null, uses = 0): BookDeletePlan => ({
    transactions: n,
    categories,
    budgets: cap.length,
    empty: n === 0 && cap.length === 0 && !settingsRow && !bonus && uses === 0,
    refusal,
    refusalCode,
    erases,
    ownPurchases,
    kept,
    ownRecords,
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
        OR EXISTS (SELECT 1 FROM entries e JOIN book_categories c ON c.category_account_id IN (e.account_id, e.spend_category_id)
                   WHERE e.transaction_id = t.id AND c.book_id <> ${bookId}))
      LIMIT 1`);
    if (straddling.length > 0) return plan('SPLIT', SPLIT_MESSAGE);
  }
  // Erasing would leave a trade, a sale or a partner transfer naming a transaction that is gone (fix round 1, I3).
  if (refusedRecords > 0) return plan('RECORDS', recordsMessage(refusedRecords, readOnly));

  // Live things that name one of its categories would be left pointing at an archived one. A joined copy's bills are
  // the share's, and are erased with it (§5.3); this phone's own drafts and event plans still refuse.
  const billsGo = erases && book.kind === 'shared';
  let uses = 0;
  const leftBehind: string[] = [];
  for (const id of ids) {
    for (const use of await categoryUsesTx(tx, id)) {
      if ((use.use === 'bills' && !billsGo) || use.use === 'event plans' || use.use === 'drafts') {
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
 * Deletes the workspace: everything filed in it voided, or — one that is or was shared — erased, its own purchases kept
 * in Personal first unless `keepOwnInPersonal` is false (see the top of this file). One transaction: a refusal, or
 * anything failing along the way (a sale or a fund switch among the transactions, which have their own way back),
 * leaves every figure as it was. If it was the open workspace, the app falls back to Personal.
 *
 * The caller takes a safety copy first where the platform keeps them (the screen does, before calling this).
 */
export async function deleteBook(
  database: Database,
  ws: WorkspaceContext,
  bookId: string,
  options: DeleteBookOptions = {},
): Promise<{ transactions: number; categories: number; budgets: number; erased: boolean; keptInPersonal: number }> {
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
    const audit = async (payload: Record<string, unknown>) =>
      tx.insert(auditLog).values({
        id: uuidv7(),
        workspaceId: ws.workspaceId,
        action: 'delete',
        entity: 'book',
        entityId: bookId,
        payloadJson: JSON.stringify({ name: book.name, kind: book.kind, ...payload }),
        createdAt: new Date().toISOString(),
      });

    if (plan.erases) {
      const keepOn = options.keepOwnInPersonal ?? true;
      // A trade or a sale names its transaction by id: it can only be kept, in place, never erased with the copy.
      if (plan.ownRecords > 0 && !keepOn) throw new BookError('RECORDS', ownRecordsMessage(plan.ownRecords));
      const kept = (
        await keepInPersonalTx(tx, ws, bookId, {
          purchases: keepOn && plan.ownPurchases > 0 ? await ownPurchasesTx(tx, ws, bookId) : [],
          records: plan.ownRecords > 0 ? (await keptByRecordsTx(tx, ws, bookId)).own : [],
        })
      ).length;
      const erased = await eraseBookTx(tx, ws, bookId);
      await audit({ erased: true, transactions: erased.transactions, categories: erased.categories, budgets: erased.budgets, keptInPersonal: kept });
      return { ...erased, erased: true, keptInPersonal: kept };
    }
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
    await deleteBookPlanTx(tx, ws, bookId);

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
    await audit({ transactions: filed.length, categories: plan.categories, budgets: plan.budgets });
    return { transactions: filed.length, categories: plan.categories, budgets: plan.budgets, erased: false, keptInPersonal: 0 };
  });
}
