import { DEFAULT_CATEGORIES, uuidv7 } from '@expanses/core';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
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

/** Active categories that carry a default key, for mapping catalogue category keys to account ids. */
export function categoryIdsByKey(database: Database, ws: WorkspaceContext): Promise<Record<string, string>> {
  return categoryIdsByKeyTx(database.db, ws);
}

export async function categoryIdsByKeyTx(db: Db, ws: WorkspaceContext): Promise<Record<string, string>> {
  const rows = await db
    .select({ id: accounts.id, key: accounts.systemKey })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.subtype, 'category'), isNotNull(accounts.systemKey), isNull(accounts.archivedAt)));
  return Object.fromEntries(rows.map((row) => [row.key as string, row.id]));
}
