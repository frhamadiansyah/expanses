import { BUDGET_FREQUENCIES, type BudgetFrequency, perMonthMinor, uuidv7 } from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { budgetOverrides, budgets } from '../schema-budget';
import { budgetFrequencies } from '../schema-health';
import { bookOfCategory, hasBooks } from './books';
import { healthTablesExist } from './health-tables';

export class BudgetError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BudgetError';
  }
}

export interface SaveBudgetInput {
  categoryAccountId: string;
  /** The amount as typed, in the unit `frequency` names. Monthly when no unit is given. */
  amountMinor: number;
  frequency?: BudgetFrequency;
}

export interface SetOverrideInput {
  categoryAccountId: string;
  month: string;
  amountMinor: number;
}

export interface BudgetRow {
  id: string;
  categoryAccountId: string;
  /** What the plan says, as a monthly figure. */
  planMinor: number;
  /** What this month asks for: the override when there is one, otherwise the plan. */
  amountMinor: number;
  overridden: boolean;
  /** The unit the plan was typed in, and the amount as typed. Monthly, and the plan itself, when set monthly. */
  frequency: BudgetFrequency;
  amountAsSetMinor: number;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertMonth(month: string): void {
  if (!MONTH.test(month)) throw new BudgetError('BAD_MONTH', `"${month}" is not a month; write it as YYYY-MM`);
}

function assertWholeMinor(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) throw new BudgetError('NOT_WHOLE', 'An amount must be a whole number of minor units');
}

/**
 * Why a category cannot carry a budget or a need mark, or null when it can: a spending category of this workspace,
 * filed in the open book. One reader for both entry points (`saveBudget`, `saveCategoryNeed`).
 */
export async function spendingCategoryRefusal(db: Db, ws: WorkspaceContext, categoryAccountId: string): Promise<'NOT_FOUND' | 'NOT_A_CATEGORY' | 'OTHER_BOOK' | null> {
  const [account] = await db
    .select({ kind: accounts.kind, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, categoryAccountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) return 'NOT_FOUND';
  if (account.subtype !== 'category' || account.kind !== 'expense') return 'NOT_A_CATEGORY';
  return (await otherBook(db, ws, categoryAccountId)) ? 'OTHER_BOOK' : null;
}

/**
 * A cap is read back by the workspace that set it, so it may only be set on a category that workspace holds:
 * one filed elsewhere would be saved and then never shown again. False when no workspace is open (the whole
 * workspace is being read) and on a database from before books existed.
 */
async function otherBook(db: Db, ws: WorkspaceContext, categoryAccountId: string): Promise<boolean> {
  if (!ws.bookId || !(await hasBooks(db))) return false;
  const owner = await bookOfCategory(db, categoryAccountId);
  return owner !== null && owner !== ws.bookId;
}

const OTHER_BOOK_MESSAGE = 'That category belongs to another workspace';

async function assertInOpenBook(database: Database, ws: WorkspaceContext, categoryAccountId: string): Promise<void> {
  if (await otherBook(database.db, ws, categoryAccountId)) throw new BudgetError('OTHER_BOOK', OTHER_BOOK_MESSAGE);
}

const REFUSED: Record<'NOT_FOUND' | 'NOT_A_CATEGORY' | 'OTHER_BOOK', string> = {
  NOT_FOUND: 'That category does not exist in this workspace',
  NOT_A_CATEGORY: 'A budget belongs on a spending category',
  OTHER_BOOK: OTHER_BOOK_MESSAGE,
};

/** A budget belongs on a spending category, never on an account money sits in. */
async function assertCategory(database: Database, ws: WorkspaceContext, accountId: string): Promise<void> {
  const refusal = await spendingCategoryRefusal(database.db, ws, accountId);
  if (refusal) throw new BudgetError(refusal, REFUSED[refusal]);
}

export async function saveBudget(database: Database, ws: WorkspaceContext, input: SaveBudgetInput): Promise<string> {
  assertWholeMinor(input.amountMinor);
  if (input.amountMinor <= 0) throw new BudgetError('AMOUNT_RANGE', 'A budget must be above zero; remove it instead');
  const frequency = input.frequency ?? 'monthly';
  if (!BUDGET_FREQUENCIES.includes(frequency)) throw new BudgetError('BAD_FREQUENCY', `${String(frequency)} is not a unit a budget can be set in`);
  // Converted once, here. Every reader of budgets.amount_minor goes on reading a month.
  const monthlyMinor = perMonthMinor(input.amountMinor, frequency);
  if (monthlyMinor <= 0) throw new BudgetError('AMOUNT_RANGE', 'That comes to nothing a month; set it higher or choose a shorter period');
  await assertCategory(database, ws, input.categoryAccountId);

  const now = new Date().toISOString();
  return database.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, input.categoryAccountId)));
    const id = existing?.id ?? uuidv7();
    if (existing) {
      await tx.update(budgets).set({ amountMinor: monthlyMinor, updatedAt: now }).where(eq(budgets.id, id));
    } else {
      await tx.insert(budgets).values({
        id,
        workspaceId: ws.workspaceId,
        categoryAccountId: input.categoryAccountId,
        amountMinor: monthlyMinor,
        createdAt: now,
        updatedAt: now,
      });
    }
    // Monthly is the absence of a row. Without 0053 the monthly figure is all that is kept, which is still the right money.
    if (await healthTablesExist(tx)) {
      await tx.delete(budgetFrequencies).where(eq(budgetFrequencies.budgetId, id));
      if (frequency !== 'monthly') {
        await tx.insert(budgetFrequencies).values({ budgetId: id, workspaceId: ws.workspaceId, frequency, amountAsSetMinor: input.amountMinor });
      }
    }
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
    if (await healthTablesExist(tx)) await tx.delete(budgetFrequencies).where(eq(budgetFrequencies.budgetId, existing.id));
    await tx.delete(budgetOverrides).where(eq(budgetOverrides.budgetId, existing.id));
    await tx.delete(budgets).where(eq(budgets.id, existing.id));
  });
}

export async function setBudgetOverride(database: Database, ws: WorkspaceContext, input: SetOverrideInput): Promise<void> {
  assertMonth(input.month);
  assertWholeMinor(input.amountMinor);
  if (input.amountMinor < 0) throw new BudgetError('AMOUNT_RANGE', 'A month cannot ask for less than nothing');
  await assertInOpenBook(database, ws, input.categoryAccountId);

  await database.transaction(async (tx) => {
    const [budget] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, input.categoryAccountId)));
    if (!budget) throw new BudgetError('NO_BUDGET', 'That category carries no budget to override');

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
  const units = (await healthTablesExist(database.db))
    ? await database.db
        .select({ budgetId: budgetFrequencies.budgetId, frequency: budgetFrequencies.frequency, amountAsSetMinor: budgetFrequencies.amountAsSetMinor })
        .from(budgetFrequencies)
        .where(eq(budgetFrequencies.workspaceId, ws.workspaceId))
    : [];
  const unitOf = new Map(units.map((row) => [row.budgetId, row]));

  return rows.map((row) => {
    const override = overrideOf.get(row.id);
    return {
      id: row.id,
      categoryAccountId: row.categoryAccountId,
      planMinor: row.amountMinor,
      amountMinor: override ?? row.amountMinor,
      overridden: override !== undefined,
      frequency: unitOf.get(row.id)?.frequency ?? 'monthly',
      amountAsSetMinor: unitOf.get(row.id)?.amountAsSetMinor ?? row.amountMinor,
    };
  });
}
