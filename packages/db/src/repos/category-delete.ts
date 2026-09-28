import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { withCapture, type CaptureTarget } from '../sync/capture';
import { writeAccountAuditTx } from './accounts';

/*
 * Deleting a category for good — only one that nothing uses. Everything that can hold a category's id was checked
 * against the schema and the migrations, and falls into one of two kinds:
 *
 * USES, which keep the category (each is a refusal, in plain words):
 *   - transactions: any entry posted to it (`entries.account_id`), or naming it as a card purchase's spend category
 *     (`entries.spend_category_id`) — voided transactions included, since a voided transaction still points at it;
 *   - drafts waiting in the review queue (`draft_transactions.category_account_id`, status pending);
 *   - subcategories: any child (`accounts.parent_id`), archived ones included;
 *   - budgets (`budgets.category_account_id`; a budget's overrides and frequency hang off the budget);
 *   - recurring bills (`expense_templates.category_account_id`), archived ones included;
 *   - event plans (`event_items.category_account_id`);
 *   - card earning rules and cycle bonuses whose match names it (`earn_rules` / `cycle_bonuses`.match_json,
 *     `categoryIds` or `excludeCategoryIds`), live ones only: an archived rule is never read again.
 *
 * SETTINGS of the category itself, which go with it in the same transaction:
 *   - its need-or-choice mark (`category_needs`), its colour (`category_colours`), its MCC override (`category_mccs`),
 *     its set membership (`category_set_members`) and its book tag (`book_categories`);
 *   - the suggestion on a draft already confirmed or dismissed (`draft_transactions.category_account_id`, cleared):
 *     a confirmed one's transaction is a use on its own, and a dismissed one is never shown again.
 *
 * A category with a system key is never deleted: `ensureCategoryKeys` makes a keyed category again on the next start,
 * so a delete would quietly undo itself. Such a category is archived instead.
 */

export class CategoryDeleteError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NOT_A_CATEGORY' | 'BUILT_IN' | 'IN_USE',
    message: string,
  ) {
    super(message);
    this.name = 'CategoryDeleteError';
  }
}

/** One kind of thing that keeps a category: what it is, and how many there are. */
export type CategoryUse = 'transactions' | 'drafts' | 'subcategories' | 'budgets' | 'bills' | 'event plans' | 'card rules';

export interface CategoryUsage {
  /** Every use found, by kind, with its count. Empty: nothing uses the category. */
  uses: { use: CategoryUse; count: number }[];
  /** A built-in category (one with a system key), which comes back by itself and so is never deleted. */
  builtIn: boolean;
  /** Whether `deleteCategory` would go ahead. */
  canDelete: boolean;
}

async function tablesOf(db: Db): Promise<Set<string>> {
  const rows = await db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`);
  return new Set(rows.map((r) => r[0]));
}

async function count(db: Db, query: ReturnType<typeof sql>): Promise<number> {
  const [row] = await db.values<[number]>(query);
  return Number(row?.[0] ?? 0);
}

/** Whether a match JSON names the category, as a category to earn on or one excluded. */
function matchNames(json: string, id: string): boolean {
  try {
    const match = JSON.parse(json) as { categoryIds?: unknown; excludeCategoryIds?: unknown };
    return [match.categoryIds, match.excludeCategoryIds].some((list) => Array.isArray(list) && list.includes(id));
  } catch {
    return json.includes(`"${id}"`);
  }
}

/**
 * The uses of a category, by the list above. The one place that decides whether a category can go: the page asks it
 * to offer Delete, `deleteCategory` asks it again before writing, and a shared book's apply asks it before taking in
 * another device's delete. Reads only; `id` must already be known to be a category.
 */
export async function categoryUsesTx(db: Db, id: string): Promise<{ use: CategoryUse; count: number }[]> {
  const tables = await tablesOf(db);
  const uses: { use: CategoryUse; count: number }[] = [];
  const add = (use: CategoryUse, n: number) => {
    if (n > 0) uses.push({ use, count: n });
  };
  add('transactions', await count(db, sql`SELECT count(DISTINCT transaction_id) FROM entries WHERE account_id = ${id} OR spend_category_id = ${id}`));
  if (tables.has('draft_transactions')) {
    add('drafts', await count(db, sql`SELECT count(*) FROM draft_transactions WHERE category_account_id = ${id} AND status = 'pending'`));
  }
  add('subcategories', await count(db, sql`SELECT count(*) FROM accounts WHERE parent_id = ${id}`));
  if (tables.has('budgets')) add('budgets', await count(db, sql`SELECT count(*) FROM budgets WHERE category_account_id = ${id}`));
  if (tables.has('expense_templates')) add('bills', await count(db, sql`SELECT count(*) FROM expense_templates WHERE category_account_id = ${id}`));
  if (tables.has('event_items')) add('event plans', await count(db, sql`SELECT count(DISTINCT event_id) FROM event_items WHERE category_account_id = ${id}`));
  let rules = 0;
  for (const table of ['earn_rules', 'cycle_bonuses']) {
    if (!tables.has(table)) continue;
    const rows = await db.values<[string]>(sql`SELECT match_json FROM ${sql.raw(table)} WHERE archived_at IS NULL AND match_json LIKE ${`%${id}%`}`);
    rules += rows.filter((r) => matchNames(r[0], id)).length;
  }
  add('card rules', rules);
  return uses;
}

async function categoryRow(db: Db, ws: WorkspaceContext, id: string) {
  const [row] = await db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row) throw new CategoryDeleteError('NOT_FOUND', 'That category is not in this workspace');
  if (row.subtype !== 'category' || (row.kind !== 'expense' && row.kind !== 'income')) throw new CategoryDeleteError('NOT_A_CATEGORY', `${row.name} is not a category`);
  return row;
}

/** What uses a category, and whether it can be deleted. */
export async function categoryUsage(database: Database, ws: WorkspaceContext, id: string): Promise<CategoryUsage> {
  const row = await categoryRow(database.db, ws, id);
  const uses = await categoryUsesTx(database.db, id);
  const builtIn = row.systemKey !== null;
  return { uses, builtIn, canDelete: !builtIn && uses.length === 0 };
}

const USE_WORDS: Record<CategoryUse, [string, string]> = {
  transactions: ['a transaction', 'transactions'],
  drafts: ['a draft waiting for review', 'drafts waiting for review'],
  subcategories: ['a subcategory', 'subcategories'],
  budgets: ['a budget', 'budgets'],
  bills: ['a recurring bill', 'recurring bills'],
  'event plans': ['an event plan', 'event plans'],
  'card rules': ['a card earning rule', 'card earning rules'],
};

/** "Groceries is used by 3 transactions and a budget." */
export function categoryInUseMessage(name: string, uses: readonly { use: CategoryUse; count: number }[]): string {
  const parts = uses.map(({ use, count: n }) => (n === 1 ? USE_WORDS[use][0] : `${n} ${USE_WORDS[use][1]}`));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `${name} is used by ${list}.`;
}

/**
 * Removes the category's own settings (the second list above), before the category row itself goes. Local writes
 * only: the caller captures what syncs. Shared by `deleteCategory` and a shared book's apply of a category delete.
 */
export async function removeCategorySettingsTx(db: Db, id: string): Promise<void> {
  const tables = await tablesOf(db);
  for (const [table, column] of [
    ['category_needs', 'category_account_id'],
    ['category_colours', 'category_account_id'],
    ['category_mccs', 'category_id'],
    ['category_set_members', 'category_account_id'],
    ['book_categories', 'category_account_id'],
  ] as const) {
    if (tables.has(table)) await db.run(sql`DELETE FROM ${sql.raw(table)} WHERE ${sql.raw(column)} = ${id}`);
  }
  if (tables.has('draft_transactions')) {
    await db.run(sql`UPDATE draft_transactions SET category_account_id = NULL WHERE category_account_id = ${id} AND status <> 'pending'`);
  }
}

/**
 * Deletes a category nothing uses, with its settings, for good. Refuses a built-in category and one in use, saying
 * what uses it. In a shared book the delete travels: the category, its need mark and its colour are captured as
 * deletes, and the other device drops them too (or, if it has used the category meanwhile, keeps it: see apply).
 */
export async function deleteCategory(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const row = await categoryRow(tx, ws, id);
    if (row.systemKey !== null) throw new CategoryDeleteError('BUILT_IN', `${row.name} is built in and comes back by itself. Archive it instead.`);
    const uses = await categoryUsesTx(tx, id);
    if (uses.length > 0) throw new CategoryDeleteError('IN_USE', `${categoryInUseMessage(row.name, uses)} Archive it instead.`);

    const tables = await tablesOf(tx);
    // The category first, so a receiver meets its delete before those of its settings (apply decides them together).
    const targets: CaptureTarget[] = [{ entity: 'category', id }, { entity: 'category_need', id }];
    if (tables.has('category_colours')) targets.push({ entity: 'category_colour', id });
    await withCapture(tx, targets, async () => {
      await removeCategorySettingsTx(tx, id);
      await tx.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
    });
    await writeAccountAuditTx(tx, ws, 'delete', id, { name: row.name });
  });
}
