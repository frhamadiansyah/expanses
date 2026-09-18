import { DEFAULT_CATEGORIES, uuidv7 } from '@expanses/core';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { bookCategories } from '../schema-books';
import { NOT_IN_A_SET } from '../schema-category-sets';
import { hasBooks, personalBookIdTx } from './books';

type AccountRow = typeof accounts.$inferSelect;

/** Defaults added with the card catalogue. Any other default missing from a workspace was renamed or deleted by the user. */
/** Defaults added with the card catalogue. Any other default missing from a workspace was renamed or deleted by the user. */
const ADDED_WITH_CATALOGUE = new Set(['personal_care.sports_fitness', 'utilities.gas_energy', 'property.real_estate', 'gift_giving', 'donation.charity', 'donation.obligation', 'government_taxes', 'business']);

/** Defaults added with the asset and trade work: investment gains and the tax they are taxed under. */
const ADDED_WITH_ASSETS = new Set(['income.realized_gains', 'government_taxes.estimated_tax']);
/**
 * Gives default categories their stable keys in workspaces created before keys existed, and creates the defaults added
 * with the catalogue. Idempotent; runs on app open. A default is keyed only when its seed name sits under its keyed
 * parent, so renamed categories stay unkeyed and are never recreated. Archived rows count as existing.
 */
export async function ensureCategoryKeys(database: Database, ws: WorkspaceContext): Promise<{ keyed: string[]; created: string[] }> {
  return database.transaction(async (tx) => {
    const rows: AccountRow[] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.subtype, 'category'), NOT_IN_A_SET));
    const byKey = new Map(rows.flatMap((row) => (row.systemKey ? [[row.systemKey, row] as const] : [])));
    const keyed: string[] = [];
    const created: string[] = [];
    const now = new Date().toISOString();

    const ensure = async (key: string, name: string, kind: 'expense' | 'income', parentId: string | null, canCreate: boolean) => {
      const existing = byKey.get(key);
      if (existing) return existing;
      const seeded = rows.find((row) => row.systemKey === null && row.name === name && row.parentId === parentId && row.kind === kind);
      if (seeded) {
        await tx.update(accounts).set({ systemKey: key }).where(eq(accounts.id, seeded.id));
        seeded.systemKey = key;
        byKey.set(key, seeded);
        keyed.push(key);
        return seeded;
      }
      if (!canCreate || !(ADDED_WITH_CATALOGUE.has(key) || ADDED_WITH_ASSETS.has(key))) return null;
      const siblings = rows.filter((row) => row.parentId === parentId);
      const row: AccountRow = {
        id: uuidv7(),
        workspaceId: ws.workspaceId,
        parentId,
        kind,
        subtype: 'category',
        name,
        icon: null,
        currency: null,
        valuationMode: 'derived',
        systemKey: key,
        sortOrder: Math.max(-1, ...siblings.map((sibling) => sibling.sortOrder)) + 1,
        archivedAt: null,
        createdAt: now,
      };
      await tx.insert(accounts).values(row);
      // A default recreated on open joins the Personal book, where the rest of the default tree lives.
      if (await hasBooks(tx)) {
        const bookId = await personalBookIdTx(tx, ws.workspaceId);
        if (bookId) await tx.insert(bookCategories).values({ categoryAccountId: row.id, workspaceId: ws.workspaceId, bookId });
      }
      rows.push(row);
      byKey.set(key, row);
      created.push(key);
      return row;
    };

    for (const category of DEFAULT_CATEGORIES) {
      const parent = await ensure(category.key, category.name, category.kind, null, true);
      if (!parent) continue;
      for (const child of category.children ?? []) {
        await ensure(child.key, child.name, category.kind, parent.id, parent.archivedAt === null);
      }
    }
    return { keyed, created };
  });
}

/**
 * The keys a repository posts into on its own, without anybody choosing a category: the interest and the fees on
 * a loan payment, interest received on money lent, a forgiven debt, a realised gain and the tax on it.
 *
 * Every book needs its own, because `categoryIdsByKeyTx` falls back to the oldest copy anywhere when the open book
 * has none — which would file a new workspace's loan interest into Personal, quietly and for good.
 */
export const POSTED_INTO_KEYS: readonly string[] = [
  'gift_giving',
  'government_taxes.estimated_tax',
  'income.investment',
  'income.other',
  'income.realized_gains',
  'miscellaneous.fees_charges',
  'miscellaneous.interest',
];

/** Each default key's name, kind and parent key, for recreating one where a book is missing it. */
const DEFAULT_BY_KEY = new Map<string, { name: string; kind: 'expense' | 'income'; parentKey: string | null }>(
  DEFAULT_CATEGORIES.flatMap((category) => [
    [category.key, { name: category.name, kind: category.kind, parentKey: null }] as const,
    ...(category.children ?? []).map((child) => [child.key, { name: child.name, kind: category.kind, parentKey: category.key }] as const),
  ]),
);

/**
 * Gives one book its own category for every key in `POSTED_INTO_KEYS`, creating what it has not got — the same
 * ensure-by-key path as `ensureCategoryKeys`, narrowed to a single book rather than the whole workspace.
 *
 * Runs for a book just created, copied or empty: a copy already carries the source's keys, so only what the
 * source itself was missing is made. A parent is made first when its child needs one, so the tree keeps its shape.
 */
export async function ensureBookCategoryKeysTx(tx: Db, ws: WorkspaceContext, bookId: string, createdAt: string): Promise<string[]> {
  const rows = await tx
    .select({ id: accounts.id, systemKey: accounts.systemKey, parentId: accounts.parentId, sortOrder: accounts.sortOrder })
    .from(accounts)
    .innerJoin(bookCategories, eq(bookCategories.categoryAccountId, accounts.id))
    .where(and(eq(bookCategories.bookId, bookId), eq(accounts.workspaceId, ws.workspaceId), isNull(accounts.archivedAt)));
  const byKey = new Map(rows.flatMap((row) => (row.systemKey ? [[row.systemKey, row.id] as const] : [])));
  const created: string[] = [];

  const ensure = async (key: string): Promise<string> => {
    const existing = byKey.get(key);
    if (existing) return existing;
    const spec = DEFAULT_BY_KEY.get(key);
    // Only default keys are ever ensured, and POSTED_INTO_KEYS is checked against DEFAULT_CATEGORIES by a test.
    if (!spec) throw new Error(`${key} is not a default category`);
    const parentId = spec.parentKey ? await ensure(spec.parentKey) : null;
    const id = uuidv7();
    const sortOrder = Math.max(-1, ...rows.filter((row) => row.parentId === parentId).map((row) => row.sortOrder)) + 1;
    await tx.insert(accounts).values({
      id,
      workspaceId: ws.workspaceId,
      parentId,
      kind: spec.kind,
      subtype: 'category',
      name: spec.name,
      icon: null,
      currency: null,
      valuationMode: 'derived',
      systemKey: key,
      sortOrder,
      archivedAt: null,
      createdAt,
    });
    await tx.insert(bookCategories).values({ categoryAccountId: id, workspaceId: ws.workspaceId, bookId });
    rows.push({ id, systemKey: key, parentId, sortOrder });
    byKey.set(key, id);
    created.push(key);
    return id;
  };

  for (const key of POSTED_INTO_KEYS) await ensure(key);
  return created;
}

/**
 * Categories that carry a default key, one per key, in the book the context names — else the Personal book.
 *
 * Once a workspace copies another's categories, two rows in one workspace share a key (migration 0043 narrowed the
 * unique index to allow it), so "the" category for a key only means anything inside one book. Owner-level figures
 * and card earning rules must not use this: they want every copy — `categoryIdsByKeyAllTx`.
 */
export async function categoryIdsByKeyTx(db: Db, ws: WorkspaceContext): Promise<Record<string, string>> {
  const all = await categoryIdsByKeyAllTx(db, ws);
  if (!(await hasBooks(db))) return Object.fromEntries(Object.entries(all).map(([key, ids]) => [key, ids[0]!]));
  const bookId = ws.bookId ?? (await personalBookIdTx(db, ws.workspaceId));
  const inBookId = new Set(
    (await db.select({ id: bookCategories.categoryAccountId }).from(bookCategories).where(eq(bookCategories.bookId, bookId ?? ''))).map((row) => row.id),
  );
  // The book's own copy when it has one; otherwise the oldest copy anywhere, so a workspace with no categories of
  // its own still records rather than failing.
  return Object.fromEntries(Object.entries(all).map(([key, ids]) => [key, ids.find((id) => inBookId.has(id)) ?? ids[0]!]));
}

/** Every id that carries each key, oldest first, across every book. */
export async function categoryIdsByKeyAllTx(db: Db, ws: WorkspaceContext): Promise<Record<string, string[]>> {
  const rows = await db
    .select({ id: accounts.id, key: accounts.systemKey })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.subtype, 'category'), isNotNull(accounts.systemKey), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.createdAt), asc(accounts.id));
  const byKey: Record<string, string[]> = {};
  for (const row of rows) (byKey[row.key as string] ??= []).push(row.id);
  return byKey;
}

/** Active categories that carry a default key, for mapping catalogue category keys to account ids. */
export const categoryIdsByKey = (database: Database, ws: WorkspaceContext) => categoryIdsByKeyTx(database.db, ws);
export const categoryIdsByKeyAll = (database: Database, ws: WorkspaceContext) => categoryIdsByKeyAllTx(database.db, ws);
