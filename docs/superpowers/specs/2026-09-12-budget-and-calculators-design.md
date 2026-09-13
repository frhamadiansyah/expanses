# Budgets and goal calculators — design

Approved by the owner on 12 September 2026. Budgets first, calculators second, because a calculator's
monthly figure has nowhere to land until the sheet exists.

## 1. Why

The Goals page already answers "what does this goal need each month" — `goalPlan` solves the annuity.
What it cannot answer is whether that amount survives contact with the month's spending. Today the
owner compares two screens by hand, and the retirement contribution loses to the restaurant budget
every time, invisibly.

One sheet per month puts income, spending caps, debt payments and goal savings in the same arithmetic,
so a goal's monthly amount competes with everything else for the same rupiah.

## 2. Decisions

| # | Decision | Chosen |
|---|---|---|
| D1 | Where a budget attaches | Any category account, parent or child |
| D2 | Child against parent | Nested: a child's spending counts toward its parent too |
| D3 | Savings on the sheet | One sheet: caps and goal savings together |
| D4 | Period model | A repeating plan; a month may be overridden |
| D5 | Unspent money | No carry-over; each month starts at the plan |
| D6 | Income | Typed expected take-home, actual shown beside it |
| D7 | Instalments | Counted in full at purchase, like every other card purchase |
| D8 | Ordinary card purchases | On purchase day |
| D9 | "Actually saved" | Dated movements, with earmark changes audited from now on |
| D10 | Unbudgeted spending | Every expense category appears, capped or not |
| D11 | Calculator and target | The calculator owns the target; typing over it breaks the link |

Two the owner left to the design: going over a cap shows as over and is counted in a header tally, but
never blocks a transaction; and retirement is a drawdown, not the 4% rule.

## 3. The sheet

```
Income (plan)                    actual
− Spending caps (category tree)  actual
− Debt payments                  actual
− Goal savings                   actual
= Left over (plan)               actual
```

Rules that follow from §2:

- **Nesting.** A budget covers its own branch. A child budget is a tighter cap inside its parent, and
  the same purchase moves both. `capsTotalMinor` sums only budgets with **no budgeted ancestor**, so a
  purchase is never counted twice in a total.
- **Overrides.** An override belongs to exactly one month and never carries. The sheet shows the plan
  figure beside it when they differ, so an override always looks deliberate.
- **Purchase-date spending.** The same rule as the Spending page and the ratios: a card purchase counts
  on the day it was made. Instalment and loan repayments are debt payments, never category spending, so
  no purchase is counted twice across the two lines.
- **Two bottom lines.** Plan (typed income − caps − planned debt payments − planned savings) and actual
  (real income − real spending − real debt payments − real saving). They answer different questions and
  are never merged.

## 4. Data

Migration `0015_budgets.sql`.

- `budgets`: `id`, `workspace_id`, `category_account_id` (an account with `subtype = 'category'`),
  `amount_minor` (> 0), `created_at`, `updated_at`. One row per budgeted category — this is the plan.
  Unique on (`workspace_id`, `category_account_id`).
- `budget_overrides`: `id`, `workspace_id`, `budget_id`, `month` (`YYYY-MM`), `amount_minor` (>= 0).
  Unique on (`budget_id`, `month`). `0` is a real value: this month, nothing.
- `budget_settings`: `workspace_id` (primary key), `expected_income_minor`, `updated_at`.
- `budget_income_overrides`: `workspace_id`, `month`, `amount_minor`. A bonus month is expected income
  for that month only.
- `goal_contributions`: `id`, `workspace_id`, `goal_id`, `account_id`, `delta_minor`, `occurred_on`,
  `source` (`earmark`), `created_at`. Written whenever a set-aside amount changes, because
  `goal_earmarks` holds a balance with no history. Tagged buys and tagged transfers are already dated
  transactions and are read from the ledger, not duplicated here.
- `goal_calculators`: `goal_id` (primary key), `workspace_id`, `kind` (`emergency` | `education` |
  `retirement`), `inputs_json`, `computed_minor`, `computed_at`. A row exists only while the target is
  derived; typing an amount by hand deletes it, which is how the link breaks.

Nothing here leaves the device, and `goal_contributions` carries no counterparty — §10.

## 5. Core

`packages/core/src/budget/sheet.ts`, pure:

```ts
export interface BudgetCap { categoryId: string; amountMinor: number }
export interface BudgetSheetInput {
  month: string;                       // YYYY-MM
  categories: CategoryNode[];          // expense accounts, as the Spending page passes them
  amounts: CategoryAmount[];           // categoryTotalsBetween for the month
  caps: BudgetCap[];                   // plan, with the month's overrides already applied
  incomePlanMinor: number;
  incomeActualMinor: number;
  debtPaymentsPlanMinor: number;
  debtPaymentsActualMinor: number;
  savings: SavingsRow[];
}
export interface SavingsRow { goalId: string; name: string; planMinor: number; actualMinor: number }
export interface BudgetLine extends CategoryTreeNode { capMinor: number | null; overMinor: number; children: BudgetLine[] }
export interface BudgetSheet {
  month: string;
  lines: BudgetLine[];                 // every expense category, capped or not
  capsTotalMinor: number;              // only budgets with no budgeted ancestor
  spendingActualMinor: number;
  overCount: number;
  incomePlanMinor: number; incomeActualMinor: number;
  debtPaymentsPlanMinor: number; debtPaymentsActualMinor: number;
  savingsPlanMinor: number; savingsActualMinor: number;
  leftOverPlanMinor: number; leftOverActualMinor: number;
}
export function budgetSheet(input: BudgetSheetInput): BudgetSheet;
```

`budgetSheet` builds on `categoryTree`, so roll-up behaviour is shared with the Spending page rather
than reimplemented. A line is over when `totalMinor > capMinor`; `overMinor` is the excess, `0` otherwise.

`packages/core/src/budget/calculators.ts`, pure:

```ts
export function emergencyTargetMinor(months: number, monthlyOutgoingMinor: number): number;
export interface EducationInputs { feeTodayMinor: number; startsInYears: number; yearsOfStudy: number; feeInflationBps: number }
export function educationStages(inputs: EducationInputs, today: string): { dueOn: string; targetMinor: number }[];
export interface RetirementInputs { annualSpendTodayMinor: number; yearsToRetirement: number; yearsInRetirement: number; inflationBps: number; returnInRetirementBps: number }
export function retirementTargetMinor(inputs: RetirementInputs): number;
```

Education: each year of study is its own stage, its fee inflated to the year it falls due —
`feeToday × (1 + i)^n`. One stage per year, so a goal with four years of study carries four stages and
the existing carry-forward funds them in order.

Retirement: the pot needed on the day you stop, drawn down over the retirement years.

```
spendAtRetirement = annualSpendToday × (1 + inflation)^yearsToRetirement
real               = (1 + returnInRetirement) / (1 + inflation) − 1
pot                = real === 0
                     ? spendAtRetirement × yearsInRetirement
                     : spendAtRetirement × (1 − (1 + real)^−yearsInRetirement) / real
```

The 4% rule is deliberately not used: it encodes American inflation, and at Indonesian rates it
understates the pot badly.

## 6. Screens

- `/budget`, month navigation matching the Spending page. Sections in the order of §3, each row showing
  plan, actual and the difference; over-cap rows carry the excess and the header counts them.
- The category section shows the tree, capped rows first, and every other expense category beneath —
  a cap is added by typing an amount on any row.
- Goal savings rows link to the goal. A derived target says what it was computed from and when.
- Calculators open from their goal: "Work out the amount". Emergency is the existing
  `targetMonths × monthlyOutgoing` given a face; education and retirement take the inputs in §5.

## 7. What already exists

`categoryTotalsBetween` (posted totals per category, base currency), `categoryTree` (roll-up),
`goalPlan` (the annuity — `requiredMonthlyMinor`), `capacityMonthlyMinor` (income − spending − debt
payments), `fitByRank`, and the emergency calculation itself. The new work is the plan storage, the
sheet, the earmark audit and two formulas.

## 8. Slices

1. **Budget core** — migration, repos, `budgetSheet`, and the `/budget` screen with caps against actual.
   Ships useful on its own.
2. **The whole sheet** — income line and its overrides, debt payments, goal savings rows,
   `goal_contributions`, both bottom lines.
3. **Calculators** — `goal_calculators`, the three calculators, derived targets feeding slice 2's rows.

## 9. Tests

Core: nesting (child counts toward parent); `capsTotalMinor` ignores budgets with a budgeted ancestor;
an override applies to one month and not the next; unbudgeted categories appear with a null cap; over
and under; both bottom lines; the three formulas, including `real === 0`.

DB: migration; unique budget per category; override replaced not duplicated; earmark change writes a
contribution row; a contribution is not written when the amount is unchanged.

E2E: set a cap and see the month go over; override one month and see the next unaffected; a goal's
monthly amount appears as a savings row; a calculator sets a target and the goal's monthly figure moves.

## 10. Privacy

Budgets, calculator inputs and contributions are ordinary workspace rows on the device, covered by the
existing backup. No new network call, no new identifier, no counterparty stored against a contribution.

## 11. Known limits

- No carry-over, by decision. Lumpy annual costs belong in goals, where the annuity spreads them.
- Earmark history starts the day slice 2 ships; months before it show no earmark contributions.
- Calculators assume constant rates, like the rest of the goal math. No scenarios, no Monte Carlo.
- Income is a single expected take-home. Multiple income streams are one number until asked for.
