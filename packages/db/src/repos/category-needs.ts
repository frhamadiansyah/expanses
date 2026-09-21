import { CATEGORY_NEEDS, type CategoryNeed, resolveNeeds } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { categoryNeeds } from '../schema-health';
import { spendingCategoryRefusal } from './budgets';
import { healthTablesExist } from './health-tables';

export class CategoryNeedError extends Error {
  constructor(
    readonly code: 'BAD_NEED' | 'NOT_FOUND' | 'NOT_A_CATEGORY' | 'OTHER_BOOK' | 'NO_TABLES',
    message: string,
  ) {
    super(message);
    this.name = 'CategoryNeedError';
  }
}

/** The marks set on categories themselves. Inherited marks are worked out by `needOf` / `resolvedCategoryNeeds`. */
export async function listCategoryNeeds(database: Database, ws: WorkspaceContext): Promise<Record<string, CategoryNeed>> {
  if (!(await healthTablesExist(database.db))) return {};
  const rows = await database.db
    .select({ id: categoryNeeds.categoryAccountId, need: categoryNeeds.need })
    .from(categoryNeeds)
    .where(eq(categoryNeeds.workspaceId, ws.workspaceId));
  return Object.fromEntries(rows.map((row) => [row.id, row.need]));
}

/** Every spending category of the workspace, each with the need it counts under: its own, an ancestor's, or essential. */
export async function resolvedCategoryNeeds(db: Db, ws: WorkspaceContext): Promise<Record<string, CategoryNeed>> {
  const nodes = await db
    .select({ id: accounts.id, parentId: accounts.parentId })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.subtype, 'category'), eq(accounts.kind, 'expense')));
  if (!(await healthTablesExist(db))) return Object.fromEntries(nodes.map((node) => [node.id, 'essential' as const]));
  const rows = await db
    .select({ id: categoryNeeds.categoryAccountId, need: categoryNeeds.need })
    .from(categoryNeeds)
    .where(eq(categoryNeeds.workspaceId, ws.workspaceId));
  return resolveNeeds(nodes, Object.fromEntries(rows.map((row) => [row.id, row.need])));
}

const REFUSED: Record<'NOT_FOUND' | 'NOT_A_CATEGORY' | 'OTHER_BOOK', string> = {
  NOT_FOUND: 'That category does not exist in this workspace',
  NOT_A_CATEGORY: 'Only a spending category is essential or lifestyle',
  OTHER_BOOK: 'That category belongs to another workspace',
};

/** The refusals `saveBudget` applies — asked of the very function `saveBudget` asks, never a copy of it. */
async function assertSpendingCategory(tx: Db, ws: WorkspaceContext, categoryAccountId: string): Promise<void> {
  const refusal = await spendingCategoryRefusal(tx, ws, categoryAccountId);
  if (refusal) throw new CategoryNeedError(refusal, REFUSED[refusal]);
}

export async function saveCategoryNeed(database: Database, ws: WorkspaceContext, categoryAccountId: string, need: CategoryNeed): Promise<void> {
  if (!CATEGORY_NEEDS.includes(need)) throw new CategoryNeedError('BAD_NEED', 'A category is essential or lifestyle');
  await database.transaction(async (tx) => {
    if (!(await healthTablesExist(tx))) throw new CategoryNeedError('NO_TABLES', 'This database is too old to mark categories; reopen the app to update it');
    await assertSpendingCategory(tx, ws, categoryAccountId);
    await tx
      .insert(categoryNeeds)
      .values({ categoryAccountId, workspaceId: ws.workspaceId, need })
      .onConflictDoUpdate({ target: categoryNeeds.categoryAccountId, set: { need } });
  });
}

/** Takes the category's own mark away, so it follows its parent again. */
export async function clearCategoryNeed(database: Database, ws: WorkspaceContext, categoryAccountId: string): Promise<void> {
  await database.transaction(async (tx) => {
    if (!(await healthTablesExist(tx))) return;
    await assertSpendingCategory(tx, ws, categoryAccountId);
    await tx.delete(categoryNeeds).where(and(eq(categoryNeeds.categoryAccountId, categoryAccountId), eq(categoryNeeds.workspaceId, ws.workspaceId)));
  });
}
