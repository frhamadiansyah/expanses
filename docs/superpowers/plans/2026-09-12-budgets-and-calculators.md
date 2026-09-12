# Budgets and goal calculators — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** A monthly sheet where spending caps, debt payments and goal savings share one arithmetic, and
calculators that derive a goal's target and monthly amount.

**Spec:** `docs/superpowers/specs/2026-09-12-budget-and-calculators-design.md`

**Branch:** `feat/budget-core`, all three slices, one gate at the end of each.

## Global constraints

- Integer minor units everywhere; no floats in stored values.
- Posting convention unchanged: purchases count on purchase day.
- Gate: `npm test`, `npm run typecheck`, `npm run e2e` at the repo root.
- Migrations continue from `0015`.
- `budgetSheet` keeps **every** expense category: `categoryTree` prunes zero-total branches, so the
  budget module builds its own tree.

---

## Slice 1 — Budget core

### Task 1: the sheet, in core

**Files:** create `packages/core/src/budget/sheet.ts`, `packages/core/test/budget-sheet.test.ts`;
modify `packages/core/src/index.ts`.

**Produces:** `budgetSheet(input: BudgetSheetInput): BudgetSheet`, types per spec §5.

- [ ] Tests first: a cap on a parent covers its children; `capsTotalMinor` ignores a budget with a
      budgeted ancestor; every category appears even with no spending and no cap; over and under;
      `overCount`; both bottom lines.
- [ ] Implement; `npx vitest run --root packages/core budget-sheet`.
- [ ] Commit `feat(core): the budget sheet`.

### Task 2: storage

**Files:** create `packages/db/migrations/0015_budgets.sql`, `packages/db/src/schema-budget.ts`,
`packages/db/src/repos/budgets.ts`, `packages/db/test/budgets.test.ts`; modify
`packages/db/src/migrations.ts`, `packages/db/src/index.ts`, `packages/db/test/database.test.ts`.

**Produces:** `saveBudget`, `removeBudget`, `setBudgetOverride`, `clearBudgetOverride`,
`listBudgets(database, ws, month)` returning caps with the month's override applied.

- [ ] Tests first: one budget per category; a second save replaces it; an override applies to its month
      and not the next; clearing an override returns the plan; a cap must be above zero.
- [ ] Implement; run the db suite.
- [ ] Commit `feat(db): budgets and their monthly overrides`.

### Task 3: the screen

**Files:** create `apps/web/src/features/budget/BudgetPage.tsx`,
`apps/web/src/features/budget/queries.ts`, `apps/web/e2e/budget.spec.ts`; modify
`apps/web/src/app/router.tsx`, `apps/web/src/app/Layout.tsx`.

- [ ] E2E first: set a cap and see the month go over; an override changes one month only.
- [ ] Implement `/budget`, month navigation as on the Spending page.
- [ ] Full gate; commit `feat(web): the monthly budget sheet`.

---

## Slice 2 — The whole sheet

### Task 4: income, debt payments, savings

**Files:** modify `packages/core/src/budget/sheet.ts` and its test; create
`packages/db/src/repos/budget-sheet.ts`; modify `apps/web/src/features/budget/BudgetPage.tsx`.

- [ ] Tests first: both bottom lines; a goal's `requiredMonthlyMinor` becomes a savings row; debt
      payments come from the period flows.
- [ ] Implement, reading `flows` and `goalSummary` as the Goals page does.
- [ ] Commit `feat: income, debt payments and goal savings on the sheet`.

### Task 5: what was actually saved

**Files:** modify `packages/db/migrations/0015_budgets.sql` is closed — create
`packages/db/migrations/0016_goal_contributions.sql`; modify `packages/db/src/repos/goal-transfers.ts`
(earmark writes), `packages/db/src/schema-budget.ts`; create `packages/db/test/goal-contributions.test.ts`.

- [ ] Tests first: changing a set-aside writes a dated contribution; an unchanged amount writes nothing;
      the month's contributions sum into the savings row's actual.
- [ ] Implement; full gate; commit `feat: dated goal contributions, so saving can be measured`.

---

## Slice 3 — Calculators

### Task 6: the formulas

**Files:** create `packages/core/src/budget/calculators.ts`, `packages/core/test/calculators.test.ts`.

- [ ] Tests first: emergency months; education inflates each study year to its own year; retirement
      drawdown, including the zero real-return case; a negative or zero input is refused.
- [ ] Implement per spec §5; commit `feat(core): emergency, education and retirement calculators`.

### Task 7: derived targets

**Files:** create `packages/db/migrations/0017_goal_calculators.sql`,
`packages/db/src/repos/goal-calculators.ts`, `packages/db/test/goal-calculators.test.ts`; modify
`packages/db/src/schema-budget.ts`, `packages/db/src/migrations.ts`.

- [ ] Tests first: saving inputs derives the stage targets; typing an amount by hand deletes the
      calculator row; re-running updates the stages.
- [ ] Implement; commit `feat(db): goals whose target is derived from a calculator`.

### Task 8: the calculator screens

**Files:** create `apps/web/src/features/goals/Calculator.tsx`; modify `GoalForm.tsx`, `GoalsPage.tsx`,
`apps/web/e2e/goals.spec.ts`.

- [ ] E2E first: a retirement calculator sets the target and the goal's monthly figure appears on the
      budget sheet; editing the amount by hand says the link is broken.
- [ ] Implement; full gate; commit `feat(web): work out the amount`.
- [ ] Record execution notes; commit `docs: record budget and calculator execution status`.
