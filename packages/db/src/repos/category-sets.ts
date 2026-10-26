import { uuidv7 } from '@expanses/core';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { books } from '../schema-books';
import { categoryNeeds } from '../schema-health';
import { categoryMccs } from '../schema-points';
import { healthTablesExist } from './health-tables';
import { isBookShared } from '../sync/placeholder';
import { bookCategories, bookCategorySets } from '../schema-books';
import { DEFAULT_CATEGORY_SETS, RETIRED_SET_CATEGORIES, SET_CATEGORY_ICONS } from '../seed';
import { CategoryDeleteError, deleteCategory } from './category-delete';
import { categorySetMembers, categorySets } from '../schema-category-sets';
import { hasBooks, isJoinedBookTx, personalBookIdTx } from './books';
import { withCapture } from '../sync/capture';
import { bookSplitsExist } from './book-splits';

export class CategorySetError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CategorySetError';
  }
}

export interface CategorySetRow {
  id: string;
  name: string;
}

/**
 * The sets a workspace can draw on. The monthly tree is not one of them: it is every category no set
 * has claimed, which is why nothing here can hide it.
 */
export async function listCategorySets(database: Database, ws: WorkspaceContext): Promise<CategorySetRow[]> {
  return database.db
    .select({ id: categorySets.id, name: categorySets.name })
    .from(categorySets)
    .where(
      and(
        eq(categorySets.workspaceId, ws.workspaceId),
        isNull(categorySets.archivedAt),
        // One book's sets when the context names a book; every set in the workspace otherwise.
        ...(ws.bookId ? [sql`${categorySets.id} IN (SELECT set_id FROM book_category_sets WHERE book_id = ${ws.bookId})`] : []),
      ),
    )
    .orderBy(asc(categorySets.name));
}

/**
 * Files a new set into a book: the one the context names, or Personal. Skipped on a database stopped before
 * migration 0042, which has no books to file into.
 */
async function fileSetTx(tx: Db, ws: WorkspaceContext, setId: string): Promise<void> {
  if (!(await hasBooks(tx))) return;
  const bookId = ws.bookId ?? (await personalBookIdTx(tx, ws.workspaceId));
  if (bookId) await tx.insert(bookCategorySets).values({ setId, workspaceId: ws.workspaceId, bookId });
}

/**
 * Files a set's new category into the set's book, so a set category is read and posted like any other: every income
 * and expense category has a book_categories row. A set with no book row (made before it could have one) files into
 * Personal. Skipped on a database stopped before migration 0042.
 */
async function fileSetCategoryTx(tx: Db, workspaceId: string, setId: string, categoryAccountId: string): Promise<void> {
  if (!(await hasBooks(tx))) return;
  const [row] = await tx.select({ bookId: bookCategorySets.bookId }).from(bookCategorySets).where(eq(bookCategorySets.setId, setId));
  const bookId = row?.bookId ?? (await personalBookIdTx(tx, workspaceId));
  if (bookId) await tx.insert(bookCategories).values({ categoryAccountId, workspaceId, bookId });
}

export async function createCategorySet(database: Database, ws: WorkspaceContext, name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new CategorySetError('NAME_REQUIRED', 'A set needs a name');
  const id = uuidv7();
  await database.transaction(async (tx) => {
    await tx.insert(categorySets).values({
      id,
      workspaceId: ws.workspaceId,
      name: trimmed,
      archivedAt: null,
      createdAt: new Date().toISOString(),
    });
    await fileSetTx(tx, ws, id);
  });
  return id;
}

export async function deleteCategorySet(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.db
    .update(categorySets)
    .set({ archivedAt: new Date().toISOString() })
    .where(and(eq(categorySets.workspaceId, ws.workspaceId), eq(categorySets.id, id)));
}

export async function renameCategorySet(database: Database, ws: WorkspaceContext, id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new CategorySetError('NAME_REQUIRED', 'A set needs a name');
  await database.db
    .update(categorySets)
    .set({ name: trimmed })
    .where(and(eq(categorySets.workspaceId, ws.workspaceId), eq(categorySets.id, id)));
}

/** Which set each category belongs to, for the one query every category picker needs. */
export async function categorySetMembership(database: Database, ws: WorkspaceContext): Promise<Record<string, string>> {
  const rows = await database.db
    .select({ categoryAccountId: categorySetMembers.categoryAccountId, setId: categorySetMembers.setId })
    .from(categorySetMembers)
    .where(eq(categorySetMembers.workspaceId, ws.workspaceId));
  return Object.fromEntries(rows.map((row) => [row.categoryAccountId, row.setId]));
}

/** The categories belonging to one set, in the order the set lists them. */
export async function listSetCategories(database: Database, ws: WorkspaceContext, setId: string) {
  return database.db
    .select({
      id: accounts.id,
      name: accounts.name,
      sortOrder: accounts.sortOrder,
    })
    .from(accounts)
    .innerJoin(categorySetMembers, eq(categorySetMembers.categoryAccountId, accounts.id))
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(categorySetMembers.setId, setId), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));
}

/** Adds a category to a set. Set categories are flat: a set is a list, not a second tree. */
export async function addSetCategory(database: Database, ws: WorkspaceContext, setId: string, name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new CategorySetError('NAME_REQUIRED', 'A category needs a name');
  const [set] = await database.db
    .select({ id: categorySets.id })
    .from(categorySets)
    .where(and(eq(categorySets.workspaceId, ws.workspaceId), eq(categorySets.id, setId)));
  if (!set) throw new CategorySetError('NOT_FOUND', 'That set is not in this workspace');

  const siblings = await listSetCategories(database, ws, setId);
  const id = uuidv7();
  return database.transaction((tx) => withCapture(tx, { entity: 'category', id }, async () => {
    await tx.insert(accounts).values({
      id,
      workspaceId: ws.workspaceId,
      parentId: null,
      kind: 'expense',
      subtype: 'category',
      name: trimmed,
      icon: null,
      currency: null,
      valuationMode: 'derived',
      systemKey: null,
      sortOrder: Math.max(-1, ...siblings.map((row) => row.sortOrder)) + 1,
      archivedAt: null,
      createdAt: new Date().toISOString(),
    });
    await tx.insert(categorySetMembers).values({ categoryAccountId: id, workspaceId: ws.workspaceId, setId });
    await fileSetCategoryTx(tx, ws.workspaceId, setId, id);
    return id;
  }));
}

/**
 * Gives a workspace the default sets it does not have yet. Idempotent; runs on app open.
 *
 * A set already there is left exactly as it is, renamed categories included: the defaults are a
 * starting point, not something to keep restoring.
 */
export async function ensureDefaultCategorySets(database: Database, ws: WorkspaceContext): Promise<string[]> {
  // Checked across the whole workspace, and a missing default filed into Personal: the defaults arrive with the
  // feature, not with whichever book happens to be open.
  const owner = ownerScope(ws);
  const existing = new Set((await listCategorySets(database, owner)).map((set) => set.name));
  const missing = DEFAULT_CATEGORY_SETS.filter((set) => !existing.has(set.name));
  if (missing.length === 0) return [];
  // A book joined from someone else's share gets its categories by sync (household sharing); set membership never
  // syncs, so filing the defaults there would only make duplicates under fresh ids.
  const target = await database.transaction(async (tx) => ((await hasBooks(tx)) ? await personalBookIdTx(tx, ws.workspaceId) : null));
  if (target && (await database.transaction((tx) => isJoinedBookTx(tx, target)))) return [];

  const now = new Date().toISOString();
  await database.transaction((tx) => withCapture(tx, { entity: 'category' }, async () => {
    for (const set of missing) {
      const setId = uuidv7();
      await tx.insert(categorySets).values({ id: setId, workspaceId: ws.workspaceId, name: set.name, archivedAt: null, createdAt: now });
      await fileSetTx(tx, owner, setId);
      for (const [index, name] of set.categories.entries()) {
        const accountId = uuidv7();
        await tx.insert(accounts).values({
          id: accountId,
          workspaceId: ws.workspaceId,
          parentId: null,
          kind: 'expense',
          subtype: 'category',
          name,
          icon: SET_CATEGORY_ICONS[name] ?? null,
          currency: null,
          valuationMode: 'derived',
          systemKey: null,
          sortOrder: index,
          archivedAt: null,
          createdAt: now,
        });
        await tx.insert(categorySetMembers).values({ categoryAccountId: accountId, workspaceId: ws.workspaceId, setId });
        await fileSetCategoryTx(tx, ws.workspaceId, setId, accountId);
      }
    }
  }));
  return missing.map((set) => set.name);
}

/**
 * Takes a retired default (`RETIRED_SET_CATEGORIES`) out of the sets it was given to, where nothing uses it. One in use
 * stays: `deleteCategory` refuses it, and that refusal is the answer, not an error. Answers how many were removed.
 */
export async function retireDefaultSetCategories(database: Database, ws: WorkspaceContext): Promise<number> {
  let removed = 0;
  for (const retired of RETIRED_SET_CATEGORIES) {
    const rows = await database.db
      .select({ id: accounts.id })
      .from(accounts)
      .innerJoin(categorySetMembers, eq(categorySetMembers.categoryAccountId, accounts.id))
      .innerJoin(categorySets, eq(categorySets.id, categorySetMembers.setId))
      .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.name, retired.name), eq(categorySets.name, retired.set), isNull(accounts.archivedAt)));
    for (const row of rows) {
      try {
        await deleteCategory(database, ownerScope(ws), row.id);
        removed += 1;
      } catch (error) {
        if (!(error instanceof CategoryDeleteError)) throw error;
      }
    }
  }
  return removed;
}

/**
 * Copies a set into another workspace (book) of the same owner: a new set of the same name (' 2', ' 3' on a clash)
 * holding new copies of its live categories, each filed into the destination book. Parents, kind, icon, the
 * typed MCC and essential/lifestyle travel; archived categories, transactions, budgets and events do not.
 *
 * A shared workspace is refused: set membership never syncs, so categories copied there would reach the other members
 * as ordinary tree categories while the set stayed on this device alone.
 */
export async function copyCategorySet(
  database: Database,
  ws: WorkspaceContext,
  input: { setId: string; toBookId: string },
): Promise<{ id: string; name: string }> {
  if (await isBookShared(database, input.toBookId)) {
    throw new CategorySetError('SHARED_BOOK', 'A category set cannot be copied into a shared workspace, because sets are not shared');
  }
  return database.transaction((tx) => withCapture(tx, { entity: 'category' }, async () => {
    if (!(await hasBooks(tx))) throw new CategorySetError('NO_BOOK', 'This database has no workspaces to copy into');
    const [dest] = await tx
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.id, input.toBookId), eq(books.workspaceId, ws.workspaceId), isNull(books.archivedAt)));
    if (!dest) throw new CategorySetError('NO_DESTINATION', 'That workspace is not here, or is archived');
    if (await isJoinedBookTx(tx, input.toBookId)) {
      throw new CategorySetError('SHARED_BOOK', 'A category set cannot be copied into a shared workspace, because sets are not shared');
    }
    const [set] = await tx
      .select({ id: categorySets.id, name: categorySets.name })
      .from(categorySets)
      .where(and(eq(categorySets.workspaceId, ws.workspaceId), eq(categorySets.id, input.setId), isNull(categorySets.archivedAt)));
    if (!set) throw new CategorySetError('NOT_FOUND', 'That set is not in this workspace');
    const [from] = await tx.select({ bookId: bookCategorySets.bookId }).from(bookCategorySets).where(eq(bookCategorySets.setId, set.id));
    const fromBookId = from?.bookId ?? (await personalBookIdTx(tx, ws.workspaceId));
    if (fromBookId === input.toBookId) throw new CategorySetError('SAME_BOOK', 'That set is already in this workspace');

    // A free name in the destination: "Trip", then "Trip 2", "Trip 3".
    const taken = new Set(
      (
        await tx
          .select({ name: categorySets.name })
          .from(categorySets)
          .innerJoin(bookCategorySets, eq(bookCategorySets.setId, categorySets.id))
          .where(and(eq(bookCategorySets.bookId, input.toBookId), isNull(categorySets.archivedAt)))
      ).map((row) => row.name.toLowerCase()),
    );
    let name = set.name;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${set.name} ${n}`;

    const now = new Date().toISOString();
    const newSetId = uuidv7();
    await tx.insert(categorySets).values({ id: newSetId, workspaceId: ws.workspaceId, name, archivedAt: null, createdAt: now });
    await tx.insert(bookCategorySets).values({ setId: newSetId, workspaceId: ws.workspaceId, bookId: input.toBookId });

    const source = await tx
      .select({ a: accounts })
      .from(accounts)
      .innerJoin(categorySetMembers, eq(categorySetMembers.categoryAccountId, accounts.id))
      .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(categorySetMembers.setId, set.id), isNull(accounts.archivedAt)))
      .orderBy(asc(accounts.sortOrder), asc(accounts.name));
    const rows = source.map((r) => r.a);
    const ids = new Set(rows.map((a) => a.id));
    const newIds = new Map(rows.map((a) => [a.id, uuidv7()]));
    // Parents first; a parent that is not copied (archived) leaves its child at the top level.
    const remaining = [...rows];
    const done = new Set<string>();
    while (remaining.length) {
      const index = remaining.findIndex((a) => !a.parentId || done.has(a.parentId) || !ids.has(a.parentId));
      if (index === -1) throw new CategorySetError('CYCLE', 'The set has a category tree it cannot copy');
      const a = remaining.splice(index, 1)[0]!;
      const id = newIds.get(a.id)!;
      await tx.insert(accounts).values({ ...a, id, workspaceId: ws.workspaceId, parentId: a.parentId ? (newIds.get(a.parentId) ?? null) : null, createdAt: now });
      await tx.insert(categorySetMembers).values({ categoryAccountId: id, workspaceId: ws.workspaceId, setId: newSetId });
      await tx.insert(bookCategories).values({ categoryAccountId: id, workspaceId: ws.workspaceId, bookId: input.toBookId });
      done.add(a.id);
    }
    if (ids.size === 0) return { id: newSetId, name };
    const oldIds = [...ids];

    const typed = await tx
      .select({ categoryId: categoryMccs.categoryId, mcc: categoryMccs.mcc })
      .from(categoryMccs)
      .where(and(eq(categoryMccs.workspaceId, ws.workspaceId), inArray(categoryMccs.categoryId, oldIds)));
    for (const row of typed) {
      await tx.insert(categoryMccs).values({ categoryId: newIds.get(row.categoryId)!, workspaceId: ws.workspaceId, mcc: row.mcc });
    }
    if (await healthTablesExist(tx)) {
      const marks = await tx
        .select({ categoryId: categoryNeeds.categoryAccountId, need: categoryNeeds.need })
        .from(categoryNeeds)
        .where(and(eq(categoryNeeds.workspaceId, ws.workspaceId), inArray(categoryNeeds.categoryAccountId, oldIds)));
      for (const row of marks) {
        await tx.insert(categoryNeeds).values({ categoryAccountId: newIds.get(row.categoryId)!, workspaceId: ws.workspaceId, need: row.need });
      }
    }
    return { id: newSetId, name };
  }));
}

/**
 * Moves a set to another workspace (book) of the same owner, keeping every id: the set and each of its categories are
 * re-filed (`book_category_sets`, `book_categories`), so the events and plans that name the set, the budgets, the typed
 * codes and essential marks, and every transaction filed under those categories stay linked. One transaction: all of it
 * or none.
 *
 * What is book-scoped for a set category is exactly those two rows: budgets, bills and event plans reach a book through
 * their category's `book_categories` row, and events are owner-level, so nothing else needs to travel. A transaction
 * already in the destination that uses these categories (the state left by moving transactions to a workspace while the
 * set stayed behind) is healed by the move itself: its categories are now that workspace's.
 *
 * A posted transaction still filed in any other workspace under these categories is refused: it would be left reading a
 * category of a workspace it is not in, which an edit refuses and reports leave out. Move those transactions first.
 * Refused too: the same workspace, an archived or missing one, and a shared one at either end (sets never sync).
 */
export async function moveCategorySet(
  database: Database,
  ws: WorkspaceContext,
  input: { setId: string; toBookId: string },
): Promise<{ id: string; name: string; moved: number }> {
  const SHARED = 'A category set cannot be moved into or out of a shared workspace, because sets are not shared';
  if (await isBookShared(database, input.toBookId)) throw new CategorySetError('SHARED_BOOK', SHARED);
  return database.transaction((tx) => withCapture(tx, { entity: 'category' }, async () => {
    if (!(await hasBooks(tx))) throw new CategorySetError('NO_BOOK', 'This database has no workspaces to move into');
    const [dest] = await tx
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.id, input.toBookId), eq(books.workspaceId, ws.workspaceId), isNull(books.archivedAt)));
    if (!dest) throw new CategorySetError('NO_DESTINATION', 'That workspace is not here, or is archived');
    if (await isJoinedBookTx(tx, input.toBookId)) throw new CategorySetError('SHARED_BOOK', SHARED);
    const [set] = await tx
      .select({ id: categorySets.id, name: categorySets.name })
      .from(categorySets)
      .where(and(eq(categorySets.workspaceId, ws.workspaceId), eq(categorySets.id, input.setId), isNull(categorySets.archivedAt)));
    if (!set) throw new CategorySetError('NOT_FOUND', 'That set is not in this workspace');
    const [from] = await tx.select({ bookId: bookCategorySets.bookId }).from(bookCategorySets).where(eq(bookCategorySets.setId, set.id));
    const fromBookId = from?.bookId ?? (await personalBookIdTx(tx, ws.workspaceId));
    if (fromBookId === input.toBookId) throw new CategorySetError('SAME_BOOK', 'That set is already in this workspace');
    if (fromBookId && (await isJoinedBookTx(tx, fromBookId))) throw new CategorySetError('SHARED_BOOK', SHARED);

    // Every category of the set, archived ones too: they keep their history, and a half-moved set would split it.
    const members = (
      await tx
        .select({ id: categorySetMembers.categoryAccountId })
        .from(categorySetMembers)
        .where(and(eq(categorySetMembers.setId, set.id), eq(categorySetMembers.workspaceId, ws.workspaceId)))
    ).map((row) => row.id);

    if (members.length > 0) {
      const inSplits = (await bookSplitsExist(tx))
        ? sql`OR t.id IN (SELECT transaction_id FROM book_transaction_splits WHERE book_id <> ${input.toBookId})`
        : sql``;
      const strays = await tx.values<[string]>(sql`
        SELECT DISTINCT t.id FROM transactions t
        JOIN entries e ON e.transaction_id = t.id
        WHERE t.workspace_id = ${ws.workspaceId} AND t.status <> 'void'
          AND (e.account_id IN ${members} OR e.spend_category_id IN ${members})
          AND (t.id IN (SELECT transaction_id FROM book_transactions WHERE book_id <> ${input.toBookId}) ${inSplits})`);
      if (strays.length > 0) {
        const n = strays.length;
        throw new CategorySetError(
          'HAS_TRANSACTIONS',
          `${n} transaction${n === 1 ? '' : 's'} in another workspace still use${n === 1 ? 's' : ''} this set’s categories. Move ${n === 1 ? 'it' : 'them'} to the new workspace first.`,
        );
      }
      await tx
        .update(bookCategories)
        .set({ bookId: input.toBookId })
        .where(and(eq(bookCategories.workspaceId, ws.workspaceId), inArray(bookCategories.categoryAccountId, members)));
      // A set category made before it could be filed has no row yet: it is filed now.
      const filed = new Set(
        (await tx.select({ id: bookCategories.categoryAccountId }).from(bookCategories).where(inArray(bookCategories.categoryAccountId, members))).map((row) => row.id),
      );
      for (const id of members) {
        if (!filed.has(id)) await tx.insert(bookCategories).values({ categoryAccountId: id, workspaceId: ws.workspaceId, bookId: input.toBookId });
      }
    }
    const refiled = await tx.update(bookCategorySets).set({ bookId: input.toBookId }).where(eq(bookCategorySets.setId, set.id)).returning({ id: bookCategorySets.setId });
    if (refiled.length === 0) await tx.insert(bookCategorySets).values({ setId: set.id, workspaceId: ws.workspaceId, bookId: input.toBookId });
    return { id: set.id, name: set.name, moved: members.length };
  }));
}
