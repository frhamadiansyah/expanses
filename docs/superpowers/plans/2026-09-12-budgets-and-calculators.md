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

- [x] Tests first: a cap on a parent covers its children; `capsTotalMinor` ignores a budget with a
      budgeted ancestor; every category appears even with no spending and no cap; over and under;
      `overCount`; both bottom lines.
- [x] Implement; `npx vitest run --root packages/core budget-sheet`.
- [x] Commit `feat(core): the budget sheet`.

### Task 2: storage

**Files:** create `packages/db/migrations/0015_budgets.sql`, `packages/db/src/schema-budget.ts`,
`packages/db/src/repos/budgets.ts`, `packages/db/test/budgets.test.ts`; modify
`packages/db/src/migrations.ts`, `packages/db/src/index.ts`, `packages/db/test/database.test.ts`.

**Produces:** `saveBudget`, `removeBudget`, `setBudgetOverride`, `clearBudgetOverride`,
`listBudgets(database, ws, month)` returning caps with the month's override applied.

- [x] Tests first: one budget per category; a second save replaces it; an override applies to its month
      and not the next; clearing an override returns the plan; a cap must be above zero.
- [x] Implement; run the db suite.
- [x] Commit `feat(db): budgets and their monthly overrides`.

### Task 3: the screen

**Files:** create `apps/web/src/features/budget/BudgetPage.tsx`,
`apps/web/src/features/budget/queries.ts`, `apps/web/e2e/budget.spec.ts`; modify
`apps/web/src/app/router.tsx`, `apps/web/src/app/Layout.tsx`.

- [x] E2E first: set a cap and see the month go over; an override changes one month only.
- [x] Implement `/budget`, month navigation as on the Spending page.
- [x] Full gate; commit `feat(web): the monthly budget sheet`.

---

## Slice 2 — The whole sheet

### Task 4: income, debt payments, savings

**Files:** modify `packages/core/src/budget/sheet.ts` and its test; create
`packages/db/src/repos/budget-sheet.ts`; modify `apps/web/src/features/budget/BudgetPage.tsx`.

- [x] Tests first: both bottom lines; a goal's `requiredMonthlyMinor` becomes a savings row; debt
      payments come from the period flows.
- [x] Implement, reading `flows` and `goalSummary` as the Goals page does.
- [x] Commit `feat: income, debt payments and goal savings on the sheet`.

### Task 5: what was actually saved

**Files:** modify `packages/db/migrations/0015_budgets.sql` is closed — create
`packages/db/migrations/0016_goal_contributions.sql`; modify `packages/db/src/repos/goal-transfers.ts`
(earmark writes), `packages/db/src/schema-budget.ts`; create `packages/db/test/goal-contributions.test.ts`.

- [x] Tests first: changing a set-aside writes a dated contribution; an unchanged amount writes nothing;
      the month's contributions sum into the savings row's actual.
- [x] Implement; full gate; commit `feat: dated goal contributions, so saving can be measured`.

---

## Slice 3 — Calculators

### Task 6: the formulas

**Files:** create `packages/core/src/budget/calculators.ts`, `packages/core/test/calculators.test.ts`.

- [x] Tests first: emergency months; education inflates each study year to its own year; retirement
      drawdown, including the zero real-return case; a negative or zero input is refused.
- [x] Implement per spec §5; commit `feat(core): emergency, education and retirement calculators`.

### Task 7: derived targets

**Files:** create `packages/db/migrations/0017_goal_calculators.sql`,
`packages/db/src/repos/goal-calculators.ts`, `packages/db/test/goal-calculators.test.ts`; modify
`packages/db/src/schema-budget.ts`, `packages/db/src/migrations.ts`.

- [x] Tests first: saving inputs derives the stage targets; typing an amount by hand deletes the
      calculator row; re-running updates the stages.
- [x] Implement; commit `feat(db): goals whose target is derived from a calculator`.

### Task 8: the calculator screens

**Files:** create `apps/web/src/features/goals/Calculator.tsx`; modify `GoalForm.tsx`, `GoalsPage.tsx`,
`apps/web/e2e/goals.spec.ts`.

- [x] E2E first: a retirement calculator sets the target and the goal's monthly figure appears on the
      budget sheet; editing the amount by hand says the link is broken.
- [x] Implement; full gate; commit `feat(web): work out the amount`.
- [x] Record execution notes; commit `docs: record budget and calculator execution status`.


---

## Execution notes

All eight tasks are done on `feat/budget-core`. Gate on the finished tree: `npm test` green (catalog 52,
core 467, db 411, web 182), `npm run typecheck` clean, `npm run e2e` 61 passed.

**The sheet arrived a slice early.** Task 1 built `budgetSheet` with income, debt payments, savings and
both bottom lines rather than caps alone, because splitting the input would have meant changing the
signature again a day later. Task 4's core work was therefore already done, and slice 2 became storage
and wiring: `budget-settings`, `budget-sheet`, and the page reading one assembled query instead of
rebuilding the sheet client-side.

**`categoryTree` could not be reused.** It prunes branches that spent nothing, which contradicts D10 —
a budget sheet must show a cap sitting unused on a quiet category. The budget module builds its own
tree, same shape, no pruning. This was noticed while reading the types, before any code was written.

**Two defects the tests found in my own work:**

1. `budgetSheet` computed `savingsPlanMinor` and `savingsActualMinor` but never returned the rows, so
   the page had nothing to list. A db test caught it as "Target cannot be null or undefined".
2. `saveGoal` deleted from `goal_calculators` unconditionally, which made it require migration 0017 and
   broke the version 8 migration test. It now clears the row only for a goal that already exists — a new
   goal cannot have one, and typing over an amount is always an update, so D11 is unaffected.

**One accessibility defect, caught by Playwright's strict mode.** The income control was a second
checkbox labelled "Just this month", giving the page two controls with the same accessible name. It is
"Bonus month" now, which is also what the migration comment calls that case.

**What "actually saved" means, and the double count avoided.** Three things count, once each: a change
to a set-aside, recorded in `goal_contributions` because `goal_earmarks` holds a balance with no
history; a tagged transfer, which is the only writer of `transactions.goal_id`; and a tagged buy paid
from everyday money. A buy funded from a savings pot or broker cash is skipped, because parking the
money there was the saving. That is the rule `putAwayMinor` already follows, and the bug it once had.
`adjustSetAsideTx` is deliberately not hooked: it would count a transfer twice.

**Deliberately not built, and why:**

- **A contractual debt-payments figure.** The sheet shows the month's real payments as both plan and
  actual, so that line cannot show a variance yet. What a loan asks for lives in the loan schedules from
  `0011`, and reading it back is its own slice. Showing a real number beats inventing a plan.
- **Blocking or warning on an over-cap purchase.** Going over is shown and counted, never refused.
- **Carry-over.** By decision: lumpy annual costs belong in goals, where the annuity spreads them.
- **Calculators for the other goal kinds.** Hajj, home, wedding and the rest are typed in, because only
  the owner knows the figure. The three that ship are the three with a formula worth trusting.

**Migrations 0015, 0016 and 0017.** `0015` carries the income tables as well as the budgets, so slice 2
needed no migration of its own.
