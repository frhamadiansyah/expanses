import { CATEGORY_NEEDS, type CategoryNeed, readNeed, resolveNeeds } from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { categoryNeeds } from '../schema-health';
import { spendingCategoryRefusal } from './budgets';
import { healthTablesExist } from './health-tables';
import { localDeviceId, withCapture } from '../sync/capture';
import { meetsVersion, NEEDS_THIRD_MARK_MIN_APP_VERSION } from '../sync/events/version';

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
  return marksOf(rows);
}

/** Stored marks by category; a value this build does not know is no mark. */
const marksOf = (rows: readonly { id: string; need: string }[]): Record<string, CategoryNeed> =>
  Object.fromEntries(rows.flatMap((row) => {
    const need = readNeed(row.need);
    return need ? [[row.id, need]] : [];
  }));

/**
 * Every spending category of the workspace, each with the need it counts under: its own, an ancestor's, the built-in
 * default for its system key (or an ancestor's key), or essential.
 */
export async function resolvedCategoryNeeds(db: Db, ws: WorkspaceContext): Promise<Record<string, CategoryNeed>> {
  const nodes = await db
    .select({ id: accounts.id, parentId: accounts.parentId, systemKey: accounts.systemKey })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.subtype, 'category'), eq(accounts.kind, 'expense')));
  if (!(await healthTablesExist(db))) return resolveNeeds(nodes, {});
  const rows = await db
    .select({ id: categoryNeeds.categoryAccountId, need: categoryNeeds.need })
    .from(categoryNeeds)
    .where(eq(categoryNeeds.workspaceId, ws.workspaceId));
  return resolveNeeds(nodes, marksOf(rows));
}

const REFUSED: Record<'NOT_FOUND' | 'NOT_A_CATEGORY' | 'OTHER_BOOK', string> = {
  NOT_FOUND: 'That category does not exist in this workspace',
  NOT_A_CATEGORY: 'Only a spending category is essential, lifestyle or debts & savings',
  OTHER_BOOK: 'That category belongs to another workspace',
};

/** The refusals `saveBudget` applies — asked of the very function `saveBudget` asks, never a copy of it. */
async function assertSpendingCategory(tx: Db, ws: WorkspaceContext, categoryAccountId: string): Promise<void> {
  const refusal = await spendingCategoryRefusal(tx, ws, categoryAccountId);
  if (refusal) throw new CategoryNeedError(refusal, REFUSED[refusal]);
}

export async function saveCategoryNeed(database: Database, ws: WorkspaceContext, categoryAccountId: string, need: CategoryNeed): Promise<void> {
  if (!CATEGORY_NEEDS.includes(need)) throw new CategoryNeedError('BAD_NEED', 'A category is essential, lifestyle or debts & savings');
  await database.transaction(async (tx) => {
    if (!(await healthTablesExist(tx))) throw new CategoryNeedError('NO_TABLES', 'This database is too old to mark categories; reopen the app to update it');
    await assertSpendingCategory(tx, ws, categoryAccountId);
    await withCapture(tx, { entity: 'category_need', id: categoryAccountId }, () =>
      tx
        .insert(categoryNeeds)
        .values({ categoryAccountId, workspaceId: ws.workspaceId, need })
        .onConflictDoUpdate({ target: categoryNeeds.categoryAccountId, set: { need } }),
    );
  });
}

/** Takes the category's own mark away, so it follows its parent again. */
export async function clearCategoryNeed(database: Database, ws: WorkspaceContext, categoryAccountId: string): Promise<void> {
  await database.transaction(async (tx) => {
    if (!(await healthTablesExist(tx))) return;
    await assertSpendingCategory(tx, ws, categoryAccountId);
    await withCapture(tx, { entity: 'category_need', id: categoryAccountId }, () =>
      tx.delete(categoryNeeds).where(and(eq(categoryNeeds.categoryAccountId, categoryAccountId), eq(categoryNeeds.workspaceId, ws.workspaceId))),
    );
  });
}

/**
 * The other phones of the open workspace's shared book that cannot take a Debts & savings mark yet, by name: on a build
 * before `NEEDS_THIRD_MARK_MIN_APP_VERSION`, or never said which. A mark set here waits for them (`thirdMarkWaitsTx`).
 * Empty for a workspace that is not shared, or when every other phone can take it.
 */
export async function phonesBehindThirdMark(database: Database, ws: WorkspaceContext): Promise<string[]> {
  if (!ws.bookId) return [];
  const bookId = ws.bookId;
  return database.transaction(async (tx) => {
    const shared = await tx.values(sql`SELECT 1 FROM shared_books WHERE book_id = ${bookId} AND state = 'active'`).catch(() => []);
    if (shared.length === 0) return [];
    const self = await localDeviceId(tx).catch(() => null);
    const rows = await tx.values<[string, string, string | null]>(sql`
      SELECT device_id, name, app_version FROM book_devices WHERE book_id = ${bookId} AND removed_at IS NULL ORDER BY name, device_id`);
    return rows.filter(([id, , version]) => id !== self && !meetsVersion(version, NEEDS_THIRD_MARK_MIN_APP_VERSION)).map(([, name]) => name || 'another phone');
  });
}
