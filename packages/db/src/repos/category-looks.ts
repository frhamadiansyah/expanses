import { isPaletteColour } from '@expanses/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { categoryColours } from '../schema-category-colours';
import { categorySetMembers } from '../schema-category-sets';
import { writeAccountAuditTx, type AccountRow } from './accounts';
import { bookOfCategory, hasBooks } from './books';
import { withCapture } from '../sync/capture';

/*
 * A category's place and look, as its own page changes them: which top-level category it sits under, the icon it
 * draws, and — for a top-level one — the colour it and its subcategories are drawn in.
 *
 * Moving is safe for everything that points at a category: budgets, recurring bills and event plans hold its id,
 * never its place in the tree. What a move may not do is make the tree deeper than two levels, cross into another
 * workspace (book) or out of a set, or mix spending with income.
 */

export class CategoryLookError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'NOT_A_CATEGORY'
      | 'ARCHIVED'
      | 'IN_A_SET'
      | 'OTHER_BOOK'
      | 'SELF'
      | 'PARENT_NOT_FOUND'
      | 'PARENT_KIND'
      | 'PARENT_NOT_TOP'
      | 'PARENT_ARCHIVED'
      | 'PARENT_IN_A_SET'
      | 'PARENT_OTHER_BOOK'
      | 'HAS_SUBCATEGORIES'
      | 'BAD_ICON'
      | 'BAD_COLOUR'
      | 'NOT_TOP_LEVEL'
      | 'NO_TABLES',
    message: string,
  ) {
    super(message);
    this.name = 'CategoryLookError';
  }
}

/**
 * Whether migration 0060 has run. Asked before every read and write of category_colours, so a database stopped at an
 * older version reads as "no colour picked" and refuses to save one, rather than failing on a missing table.
 */
const colourTables = new WeakMap<Db, boolean>();
export async function categoryColoursExist(db: Db): Promise<boolean> {
  if (colourTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'category_colours'`);
  const exists = rows.length > 0;
  if (exists) colourTables.set(db, true);
  return exists;
}

async function inASet(db: Db, categoryId: string): Promise<boolean> {
  const rows = await db.select({ id: categorySetMembers.categoryAccountId }).from(categorySetMembers).where(eq(categorySetMembers.categoryAccountId, categoryId));
  return rows.length > 0;
}

/** A live income or expense category of this workspace, filed in the open book (when one is open). */
async function liveCategory(db: Db, ws: WorkspaceContext, categoryId: string): Promise<AccountRow> {
  const [row] = await db.select().from(accounts).where(and(eq(accounts.id, categoryId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row) throw new CategoryLookError('NOT_FOUND', 'That category is not in this workspace');
  if (row.subtype !== 'category' || (row.kind !== 'expense' && row.kind !== 'income')) throw new CategoryLookError('NOT_A_CATEGORY', `${row.name} is not a category`);
  if (row.archivedAt !== null) throw new CategoryLookError('ARCHIVED', `${row.name} is archived`);
  if (ws.bookId && (await hasBooks(db))) {
    const book = await bookOfCategory(db, categoryId);
    if (book !== null && book !== ws.bookId) throw new CategoryLookError('OTHER_BOOK', 'That category belongs to another workspace');
  }
  return row;
}

/**
 * Files a category under another top-level category of the same kind, or makes it top-level again (`parentId` null).
 * Refused, in plain words, for anything that would break the two-level tree: a parent that is itself a subcategory,
 * a category that still has subcategories of its own, a set's category on either side, another kind, another book.
 * A category that gains a parent loses its own colour: a subcategory is drawn in shades of its parent's.
 */
export async function moveCategory(database: Database, ws: WorkspaceContext, categoryId: string, parentId: string | null): Promise<void> {
  await database.transaction(async (tx) => {
    const category = await liveCategory(tx, ws, categoryId);
    if (await inASet(tx, categoryId)) throw new CategoryLookError('IN_A_SET', `${category.name} belongs to a set, and a set's categories have no parent`);
    if ((category.parentId ?? null) === parentId) return;

    if (parentId !== null) {
      if (parentId === categoryId) throw new CategoryLookError('SELF', 'A category cannot be filed under itself');
      const [parent] = await tx.select().from(accounts).where(and(eq(accounts.id, parentId), eq(accounts.workspaceId, ws.workspaceId)));
      if (!parent || parent.subtype !== 'category') throw new CategoryLookError('PARENT_NOT_FOUND', 'That parent is not a category in this workspace');
      if (parent.kind !== category.kind) {
        throw new CategoryLookError('PARENT_KIND', `${category.name} is ${category.kind === 'income' ? 'income' : 'spending'}, and ${parent.name} is not`);
      }
      if (parent.parentId !== null) throw new CategoryLookError('PARENT_NOT_TOP', `${parent.name} is a subcategory; a category can only be filed under a top-level one`);
      if (parent.archivedAt !== null) throw new CategoryLookError('PARENT_ARCHIVED', `${parent.name} is archived`);
      if (await inASet(tx, parentId)) throw new CategoryLookError('PARENT_IN_A_SET', `${parent.name} belongs to a set, and a set's categories have no subcategories`);
      if (await hasBooks(tx)) {
        const [mine, theirs] = [await bookOfCategory(tx, categoryId), await bookOfCategory(tx, parentId)];
        if (mine !== theirs) throw new CategoryLookError('PARENT_OTHER_BOOK', `${parent.name} belongs to another workspace`);
      }
      const children = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, categoryId), isNull(accounts.archivedAt)));
      if (children.length > 0) {
        throw new CategoryLookError('HAS_SUBCATEGORIES', `${category.name} has subcategories of its own. Move or archive its subcategories first.`);
      }
    }

    await withCapture(tx, { entity: 'category', id: categoryId }, () =>
      tx.update(accounts).set({ parentId }).where(and(eq(accounts.id, categoryId), eq(accounts.workspaceId, ws.workspaceId))),
    );
    if (parentId !== null && (await categoryColoursExist(tx))) {
      await withCapture(tx, { entity: 'category_colour', id: categoryId }, () =>
        tx.delete(categoryColours).where(and(eq(categoryColours.categoryAccountId, categoryId), eq(categoryColours.workspaceId, ws.workspaceId))),
      );
    }
    await writeAccountAuditTx(tx, ws, 'move', categoryId, { parentId });
  });
}

/** An icon is a name the app draws (`coffee`, `shopping-bag`), never a drawing: lowercase words joined by hyphens. */
const ICON_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Gives a category an icon of its own, or (`null`) takes it away so it draws its parent's, or its default. */
export async function setCategoryIcon(database: Database, ws: WorkspaceContext, categoryId: string, icon: string | null): Promise<void> {
  if (icon !== null && (!ICON_NAME.test(icon) || icon.length > 40)) throw new CategoryLookError('BAD_ICON', `${icon} is not an icon this app draws`);
  await database.transaction(async (tx) => {
    const category = await liveCategory(tx, ws, categoryId);
    if ((category.icon ?? null) === icon) return;
    await withCapture(tx, { entity: 'category', id: categoryId }, () =>
      tx.update(accounts).set({ icon }).where(and(eq(accounts.id, categoryId), eq(accounts.workspaceId, ws.workspaceId))),
    );
    await writeAccountAuditTx(tx, ws, 'icon', categoryId, { icon });
  });
}

/**
 * Picks the colour a top-level category, and its subcategories in shades of it, are drawn in — one of the palette's.
 * `null` goes back to the colour the app works out. A subcategory, and a set's category, take no colour of their own.
 */
export async function setCategoryColour(database: Database, ws: WorkspaceContext, categoryId: string, colour: string | null): Promise<void> {
  if (colour !== null && !isPaletteColour(colour)) throw new CategoryLookError('BAD_COLOUR', `${colour} is not one of the colours a category can have`);
  await database.transaction(async (tx) => {
    const category = await liveCategory(tx, ws, categoryId);
    if (category.parentId !== null) throw new CategoryLookError('NOT_TOP_LEVEL', `${category.name} is a subcategory, and takes its colour from its parent`);
    if (await inASet(tx, categoryId)) throw new CategoryLookError('IN_A_SET', `${category.name} belongs to a set, and a set's categories take the app's colours`);
    if (!(await categoryColoursExist(tx))) throw new CategoryLookError('NO_TABLES', 'This database is too old to colour categories; reopen the app to update it');
    await withCapture(tx, { entity: 'category_colour', id: categoryId }, () =>
      colour === null
        ? tx.delete(categoryColours).where(and(eq(categoryColours.categoryAccountId, categoryId), eq(categoryColours.workspaceId, ws.workspaceId)))
        : tx
            .insert(categoryColours)
            .values({ categoryAccountId: categoryId, workspaceId: ws.workspaceId, colour })
            .onConflictDoUpdate({ target: categoryColours.categoryAccountId, set: { colour } }),
    );
    await writeAccountAuditTx(tx, ws, 'colour', categoryId, { colour });
  });
}

/** The colours picked by hand, by category id. Only top-level categories appear. */
export async function listCategoryColours(database: Database, ws: WorkspaceContext): Promise<Record<string, string>> {
  if (!(await categoryColoursExist(database.db))) return {};
  const rows = await database.db
    .select({ id: categoryColours.categoryAccountId, colour: categoryColours.colour })
    .from(categoryColours)
    .where(eq(categoryColours.workspaceId, ws.workspaceId));
  return Object.fromEntries(rows.map((row) => [row.id, row.colour]));
}
