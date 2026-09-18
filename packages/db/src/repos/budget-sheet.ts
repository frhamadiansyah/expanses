import { type BudgetSheet, budgetSheet, monthRange } from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { NOT_IN_A_SET } from '../schema-category-sets';
import { bookMoneyFor, type Unconverted } from './book-currency';
import { hasBooks } from './books';
import { getBudgetIncome } from './budget-settings';
import { goalContributionsFor } from './goal-contributions';
import { listBudgets } from './budgets';
import { committedByCategory } from './expense-templates';
import { periodFlows } from './flows';
import { goalPlansFor } from './goal-funding';
import { categoryTotalsIn, eventSpendingBetween } from './reports';

export interface BudgetSheetResult extends BudgetSheet {
  /** True when this month's income is a bonus-month figure rather than the plan. */
  incomeOverridden: boolean;
  /** The currency the sheet reads in: the open workspace's own. */
  currency: string;
  /** Amounts left out of the figures above: no rate reaches `currency` for that date or earlier. */
  unconverted: Unconverted[];
}

/** One list of currencies, each with the earliest day a rate was wanted for and not found. */
function mergeMissing(...lists: readonly Unconverted[][]): Unconverted[] {
  const earliest = new Map<string, string>();
  for (const list of lists) {
    for (const row of list) {
      const held = earliest.get(row.currency);
      if (!held || row.onDate < held) earliest.set(row.currency, row.onDate);
    }
  }
  return [...earliest].map(([currency, onDate]) => ({ currency, onDate })).sort((a, b) => a.currency.localeCompare(b.currency));
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

  // A database stopped before migration 0042 has no book_categories to narrow by, and read the whole workspace
  // before workspaces existed — which is what it must keep doing.
  const narrowToBook = ws.bookId !== undefined && (await hasBooks(database.db));
  const categories = await database.db
    .select({ id: accounts.id, parentId: accounts.parentId, name: accounts.name })
    .from(accounts)
    // The monthly sheet speaks for the monthly tree: a set's categories are an event's business, not a cap's.
    .where(
      and(
        eq(accounts.workspaceId, ws.workspaceId),
        eq(accounts.kind, 'expense'),
        NOT_IN_A_SET,
        // …and for one workspace's tree when one is open: a Business sheet is about Business categories.
        ...(narrowToBook ? [sql`${accounts.id} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`] : []),
      ),
    );

  const [amounts, budgets, income, flows, goals, contributions, eventSpending, committed] = await Promise.all([
    // Events are held out of the caps; they get their own line and are still taken off what is left.
    categoryTotalsIn(database, ws, 'expense', from, to, { excludeEvents: true, billMonths: true }),
    listBudgets(database, ws, month),
    getBudgetIncome(database, ws, month),
    periodFlows(database, ws, { from, to }),
    // As the month ends, so a goal due inside it still says what it asked for.
    goalPlansFor(database, ws, to),
    goalContributionsFor(database, ws, month),
    eventSpendingBetween(database, ws, from, to),
    // Only for what it could not convert: the per-category figures are the budget page's own read. A bill left out
    // of "… of it is bills" is a gap in what this page shows, so the sheet's own banner has to name it.
    committedByCategory(database, ws),
  ]);

  // A goal is kept in the owner's currency, and what it asks for every month is a plan rather than a payment: the
  // month's last day is the one rate that speaks for the whole of it.
  const money = await bookMoneyFor(database, ws);
  const asOfMonthEnd = (amountMinor: number) => (money.converts ? (money.convert(amountMinor, ws.baseCurrency, to) ?? 0) : amountMinor);

  const sheet = budgetSheet({
    month,
    categories,
    amounts: amounts.rows,
    caps: budgets.map((row) => ({ categoryId: row.categoryAccountId, amountMinor: row.amountMinor })),
    incomePlanMinor: income.amountMinor,
    incomeActualMinor: flows.incomeMinor,
    debtPaymentsPlanMinor: flows.debtPaymentsMinor,
    debtPaymentsActualMinor: flows.debtPaymentsMinor,
    savings: goals.plans.map((plan) => ({
      goalId: plan.goalId,
      name: plan.goal.name,
      planMinor: asOfMonthEnd(plan.requiredMonthlyMinor),
      actualMinor: asOfMonthEnd(contributions[plan.goalId] ?? 0),
    })),
    eventSpendingMinor: eventSpending.amountMinor,
  });

  return {
    ...sheet,
    incomeOverridden: income.overridden,
    currency: amounts.currency,
    unconverted: mergeMissing(amounts.missing, eventSpending.missing, flows.missing, committed.missing, money.missing()),
  };
}
