import type { BudgetLine } from '@expanses/core';

export interface BudgetProgress {
  /** Everything budgeted this month, counting only the outermost cap in each branch. */
  capsMinor: number;
  /** What was spent inside those branches. Spending with no cap over it is not measured here. */
  spentMinor: number;
  /** Budgets this month's spending has passed, at any depth. */
  overCount: number;
  /** Whether there is a budget to measure at all. */
  any: boolean;
}

/**
 * The month against its budgets: what was set aside, what of it is gone, and how many caps were passed.
 *
 * A budget inside a budgeted branch is a tighter cap rather than another pocket of money, so only the
 * outermost one counts towards the totals — otherwise a child's spending would be counted twice.
 */
export function budgetProgress(lines: readonly BudgetLine[]): BudgetProgress {
  let capsMinor = 0;
  let spentMinor = 0;
  let overCount = 0;

  const walk = (rows: readonly BudgetLine[], insideBudget: boolean) => {
    for (const row of rows) {
      if (row.overMinor > 0) overCount += 1;
      const cap = row.capMinor;
      const budgeted = cap !== null;
      if (cap !== null && !insideBudget) {
        capsMinor += cap;
        spentMinor += row.totalMinor;
      }
      walk(row.children, insideBudget || budgeted);
    }
  };
  walk(lines, false);

  return { capsMinor, spentMinor, overCount, any: capsMinor > 0 };
}
