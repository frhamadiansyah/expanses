import { type BudgetSheet, budgetSheet, monthRange } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { getBudgetIncome } from './budget-settings';
import { goalContributionsFor } from './goal-contributions';
import { listBudgets } from './budgets';
import { periodFlows } from './flows';
import { goalPlansFor } from './goal-funding';
import { categoryTotalsBetween } from './reports';

export interface BudgetSheetResult extends BudgetSheet {
  /** True when this month's income is a bonus-month figure rather than the plan. */
  incomeOverridden: boolean;
}

/**
 * One month's sheet, assembled from what already exists: the ledger's category totals, the budget
 * plan with its overrides, the period's flows, and what each goal needs every month.
 *
 * Debt payments are shown as plan and actual alike. What a loan contractually asks for lives in the
 * loan schedules, and reading it back belongs to its own slice; until then no variance is invented.
 */
export async function budgetSheetFor(database: Database, ws: WorkspaceContext, month: string): Promise<BudgetSheetResult> {
  const { from, to } = monthRange(month);

  const categories = await database.db
    .select({ id: accounts.id, parentId: accounts.parentId, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'expense')));

  const [amounts, budgets, income, flows, goals, contributions] = await Promise.all([
    categoryTotalsBetween(database, ws, 'expense', from, to),
    listBudgets(database, ws, month),
    getBudgetIncome(database, ws, month),
    periodFlows(database, ws, { from, to }),
    // As the month ends, so a goal due inside it still says what it asked for.
    goalPlansFor(database, ws, to),
    goalContributionsFor(database, ws, month),
  ]);

  const sheet = budgetSheet({
    month,
    categories,
    amounts,
    caps: budgets.map((row) => ({ categoryId: row.categoryAccountId, amountMinor: row.amountMinor })),
    incomePlanMinor: income.amountMinor,
    incomeActualMinor: flows.incomeMinor,
    debtPaymentsPlanMinor: flows.debtPaymentsMinor,
    debtPaymentsActualMinor: flows.debtPaymentsMinor,
    savings: goals.plans.map((plan) => ({
      goalId: plan.goalId,
      name: plan.goal.name,
      planMinor: plan.requiredMonthlyMinor,
      actualMinor: contributions[plan.goalId] ?? 0,
    })),
  });

  return { ...sheet, incomeOverridden: income.overridden };
}
