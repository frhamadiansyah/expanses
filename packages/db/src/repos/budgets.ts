import { uuidv7 } from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { budgetOverrides, budgets } from '../schema-budget';

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

export interface SaveBudgetInput {
  categoryAccountId: string;
  amountMinor: number;
}

export interface SetOverrideInput {
  categoryAccountId: string;
  month: string;
  amountMinor: number;
}

export interface BudgetRow {
  id: string;
  categoryAccountId: string;
  /** What the plan says. */
  planMinor: number;
  /** What this month asks for: the override when there is one, otherwise the plan. */
  amountMinor: number;
  overridden: boolean;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertMonth(month: string): void {
  if (!MONTH.test(month)) throw new BudgetError(`"${month}" is not a month; write it as YYYY-MM`);
}

function assertWholeMinor(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) throw new BudgetError('An amount must be a whole number of minor units');
}

/** A budget belongs on a spending category, never on an account money sits in. */
async function assertCategory(database: Database, ws: WorkspaceContext, accountId: string): Promise<void> {
  const [account] = await database.db
    .select({ kind: accounts.kind, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) throw new BudgetError('That category does not exist in this workspace');
  if (account.subtype !== 'category' || account.kind !== 'expense') {
    throw new BudgetError('A budget belongs on a spending category');
  }
}

export async function saveBudget(database: Database, ws: WorkspaceContext, input: SaveBudgetInput): Promise<string> {
  assertWholeMinor(input.amountMinor);
  if (input.amountMinor <= 0) throw new BudgetError('A budget must be above zero; remove it instead');
  await assertCategory(database, ws, input.categoryAccountId);

  const now = new Date().toISOString();
  return database.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, input.categoryAccountId)));
    if (existing) {
      await tx.update(budgets).set({ amountMinor: input.amountMinor, updatedAt: now }).where(eq(budgets.id, existing.id));
      return existing.id;
    }
    const id = uuidv7();
    await tx.insert(budgets).values({
      id,
      workspaceId: ws.workspaceId,
      categoryAccountId: input.categoryAccountId,
      amountMinor: input.amountMinor,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
}

/** Removes the budget and every override that only made sense against it. */
export async function removeBudget(database: Database, ws: WorkspaceContext, categoryAccountId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, categoryAccountId)));
    if (!existing) return;
    await tx.delete(budgetOverrides).where(eq(budgetOverrides.budgetId, existing.id));
    await tx.delete(budgets).where(eq(budgets.id, existing.id));
  });
}

export async function setBudgetOverride(database: Database, ws: WorkspaceContext, input: SetOverrideInput): Promise<void> {
  assertMonth(input.month);
  assertWholeMinor(input.amountMinor);
  if (input.amountMinor < 0) throw new BudgetError('A month cannot ask for less than nothing');

  await database.transaction(async (tx) => {
    const [budget] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, input.categoryAccountId)));
    if (!budget) throw new BudgetError('That category carries no budget to override');

    const [existing] = await tx
      .select({ id: budgetOverrides.id })
      .from(budgetOverrides)
      .where(and(eq(budgetOverrides.budgetId, budget.id), eq(budgetOverrides.month, input.month)));
    if (existing) {
      await tx.update(budgetOverrides).set({ amountMinor: input.amountMinor }).where(eq(budgetOverrides.id, existing.id));
      return;
    }
    await tx.insert(budgetOverrides).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      budgetId: budget.id,
      month: input.month,
      amountMinor: input.amountMinor,
    });
  });
}

export async function clearBudgetOverride(database: Database, ws: WorkspaceContext, categoryAccountId: string, month: string): Promise<void> {
  assertMonth(month);
  await database.transaction(async (tx) => {
    const [budget] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, categoryAccountId)));
    if (!budget) return;
    await tx.delete(budgetOverrides).where(and(eq(budgetOverrides.budgetId, budget.id), eq(budgetOverrides.month, month)));
  });
}

/** The plan for one month, with that month's overrides already applied. */
export async function listBudgets(database: Database, ws: WorkspaceContext, month: string): Promise<BudgetRow[]> {
  assertMonth(month);
  const rows = await database.db
    .select({ id: budgets.id, categoryAccountId: budgets.categoryAccountId, amountMinor: budgets.amountMinor })
    .from(budgets)
    .where(
      and(
        eq(budgets.workspaceId, ws.workspaceId),
        // One book's caps when the context names one; every cap in the workspace otherwise.
        ...(ws.bookId ? [sql`${budgets.categoryAccountId} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`] : []),
      ),
    );

  const overrides = await database.db
    .select({ budgetId: budgetOverrides.budgetId, amountMinor: budgetOverrides.amountMinor })
    .from(budgetOverrides)
    .where(and(eq(budgetOverrides.workspaceId, ws.workspaceId), eq(budgetOverrides.month, month)));
  const overrideOf = new Map(overrides.map((row) => [row.budgetId, row.amountMinor]));

  return rows.map((row) => {
    const override = overrideOf.get(row.id);
    return {
      id: row.id,
      categoryAccountId: row.categoryAccountId,
      planMinor: row.amountMinor,
      amountMinor: override ?? row.amountMinor,
      overridden: override !== undefined,
    };
  });
}
