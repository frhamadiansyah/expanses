import { uuidv7 } from '@expanses/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { bookCategories, bookCategorySets } from '../schema-books';
import { DEFAULT_CATEGORY_SETS } from '../seed';
import { categorySetMembers, categorySets } from '../schema-category-sets';
import { hasBooks, personalBookIdTx } from './books';

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
  return database.transaction(async (tx) => {
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
  });
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

  const now = new Date().toISOString();
  await database.transaction(async (tx) => {
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
          icon: null,
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
  });
  return missing.map((set) => set.name);
}
