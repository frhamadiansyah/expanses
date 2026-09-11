import { MERCHANTS } from '@expanses/catalog';
import { categoryDefaultMcc, containsKeyword, isMcc, type MccSources, uuidv7 } from '@expanses/core';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { categoryMccs, merchantMccs } from '../schema-points';

export class MccError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MccError';
  }
}

export interface MerchantMccRow {
  id: string;
  pattern: string;
  mcc: string | null;
  createdAt: string;
}

const normalisePattern = (pattern: string) => pattern.trim().toLowerCase().replace(/\s+/g, ' ');

export async function listMerchantMccs(database: Database, ws: WorkspaceContext): Promise<MerchantMccRow[]> {
  return database.db
    .select({ id: merchantMccs.id, pattern: merchantMccs.pattern, mcc: merchantMccs.mcc, createdAt: merchantMccs.createdAt })
    .from(merchantMccs)
    .where(and(eq(merchantMccs.workspaceId, ws.workspaceId), isNull(merchantMccs.archivedAt)))
    .orderBy(asc(merchantMccs.pattern));
}

/**
 * Remembers the MCC for purchases whose description contains the pattern; a null MCC ignores the bundled merchant with
 * that pattern. Another active entry with the same pattern is replaced. Applies to past purchases too.
 */
export async function saveMerchantMcc(database: Database, ws: WorkspaceContext, input: { id?: string; pattern: string; mcc: string | null }): Promise<string> {
  const pattern = normalisePattern(input.pattern);
  if (!pattern) throw new MccError('Enter the merchant text to match');
  if (input.mcc !== null && !isMcc(input.mcc)) throw new MccError('An MCC is four digits, like 5814');
  return database.transaction(async (tx) => {
    const now = new Date().toISOString();
    await tx
      .update(merchantMccs)
      .set({ archivedAt: now })
      .where(and(eq(merchantMccs.workspaceId, ws.workspaceId), eq(merchantMccs.pattern, pattern), isNull(merchantMccs.archivedAt), input.id ? ne(merchantMccs.id, input.id) : undefined));
    if (input.id) {
      await tx
        .update(merchantMccs)
        .set({ pattern, mcc: input.mcc })
        .where(and(eq(merchantMccs.id, input.id), eq(merchantMccs.workspaceId, ws.workspaceId)));
      return input.id;
    }
    const id = uuidv7();
    await tx.insert(merchantMccs).values({ id, workspaceId: ws.workspaceId, pattern, mcc: input.mcc, createdAt: now, archivedAt: null });
    return id;
  });
}

export async function archiveMerchantMcc(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.db
    .update(merchantMccs)
    .set({ archivedAt: new Date().toISOString() })
    .where(and(eq(merchantMccs.id, id), eq(merchantMccs.workspaceId, ws.workspaceId)));
}

/** Category MCC overrides by category id. */
export async function listCategoryMccs(database: Database, ws: WorkspaceContext): Promise<Record<string, string>> {
  const rows = await database.db.select({ categoryId: categoryMccs.categoryId, mcc: categoryMccs.mcc }).from(categoryMccs).where(eq(categoryMccs.workspaceId, ws.workspaceId));
  return Object.fromEntries(rows.map((row) => [row.categoryId, row.mcc]));
}

export async function saveCategoryMcc(database: Database, ws: WorkspaceContext, categoryId: string, mcc: string): Promise<void> {
  if (!isMcc(mcc)) throw new MccError('An MCC is four digits, like 5812');
  await database.transaction(async (tx) => {
    const [category] = await tx
      .select({ subtype: accounts.subtype })
      .from(accounts)
      .where(and(eq(accounts.id, categoryId), eq(accounts.workspaceId, ws.workspaceId)));
    if (category?.subtype !== 'category') throw new MccError('Only categories have a card MCC');
    await tx
      .insert(categoryMccs)
      .values({ categoryId, workspaceId: ws.workspaceId, mcc })
      .onConflictDoUpdate({ target: categoryMccs.categoryId, set: { mcc } });
  });
}

export async function clearCategoryMcc(database: Database, ws: WorkspaceContext, categoryId: string): Promise<void> {
  await database.db.delete(categoryMccs).where(and(eq(categoryMccs.categoryId, categoryId), eq(categoryMccs.workspaceId, ws.workspaceId)));
}

/** Merchant memory, the bundled merchant list, and category defaults for resolving purchase MCCs in this workspace. */
export async function mccSourcesFor(db: Db, ws: WorkspaceContext): Promise<Omit<MccSources, 'typed'>> {
  const memory = await db
    .select({ pattern: merchantMccs.pattern, mcc: merchantMccs.mcc })
    .from(merchantMccs)
    .where(and(eq(merchantMccs.workspaceId, ws.workspaceId), isNull(merchantMccs.archivedAt)))
    .orderBy(asc(merchantMccs.createdAt));
  const categories = await db
    .select({ id: accounts.id, parentId: accounts.parentId, systemKey: accounts.systemKey })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.subtype, 'category')));
  const overrideRows = await db.select({ categoryId: categoryMccs.categoryId, mcc: categoryMccs.mcc }).from(categoryMccs).where(eq(categoryMccs.workspaceId, ws.workspaceId));
  const overrides = Object.fromEntries(overrideRows.map((row) => [row.categoryId, row.mcc]));
  const defaults = new Map<string, string | null>();
  return {
    memory,
    bundled: MERCHANTS.merchants.map(({ pattern, mcc }) => ({ pattern, mcc })),
    categoryDefault: (categoryId) => {
      if (!defaults.has(categoryId)) defaults.set(categoryId, categoryDefaultMcc(categoryId, categories, overrides));
      return defaults.get(categoryId) ?? null;
    },
  };
}

/** How many posted purchases a merchant pattern would cover, for confirming a memory change. */
export async function countMatchingPurchases(database: Database, ws: WorkspaceContext, pattern: string): Promise<number> {
  const normalised = normalisePattern(pattern);
  if (!normalised) return 0;
  const rows = await database.db
    .selectDistinct({ id: transactions.id, description: transactions.description })
    .from(transactions)
    .innerJoin(entries, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), eq(accounts.kind, 'expense')));
  return rows.filter((row) => containsKeyword(row.description, normalised)).length;
}
