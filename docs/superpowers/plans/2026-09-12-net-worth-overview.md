# Net Worth Overview and Health Ratios (Slice 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Format:** fast track, as chosen by the owner. Each task gives files, exact interfaces, and the named test cases that must be written first and fail before implementation. Code is written during execution, not in this document.

**Goal:** One Overview tab that shows net worth today and over time, the balance sheet the way a financial planner reads it, and the eight standard health ratios with a status and the formula behind each.

**Architecture:** `packages/core` gains two pure modules: `balance-sheet.ts` groups assets and splits debts into due-within-a-year and long-term, and `health.ts` turns a period's cash flow and the sheet totals into ratios with thresholds. `packages/db` gains `periodFlows` (income, spending and debt payments per month, transfers and opening balances excluded) and `netWorthSeries` (month-end net worth, computed, never stored). `apps/web` gains the Overview tab with the net worth card, chart, needs-attention list, balance sheet and ratio cards with a period switch.

**Tech Stack:** unchanged (TypeScript 7, Vitest 5, Drizzle sqlite-proxy, better-sqlite3 in tests, Vite 8, React 19, TanStack Router/Query, Tailwind 4, Playwright). No new dependencies; the chart reuses `ValueChart` from slice 1.

**Spec:** `docs/superpowers/specs/2026-09-11-net-worth-coretax-goals-design.md` (§3.1, §5)

## Global Constraints

- Money stays 64-bit integer minor units. No floats in stored values or arithmetic results.
- Net worth history is computed for month-ends, never stored.
- Take-home income is every income category except Realized Gains; spending is every expense category except Final Tax.
- Monthly figures are the period total divided by the months that have data, at most 12.
- A ratio with no data to stand on says "Not enough data" instead of a misleading number.
- Thresholds live in one table in `packages/core/src/assets/health.ts`, nowhere else.
- Until the Loans slice, a loan account's whole balance is long-term and every loan payment counts as a home-loan payment.
- Every task ends green on `npm test` and `npm run typecheck` at the repo root; web tasks also run `npm run e2e`.
- Commits end with the project trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File Structure

```
packages/core/src/assets/
  balance-sheet.ts     SheetAsset, SheetLiability, balanceSheet
  health.ts            PeriodFlows, SheetTotals, HealthRatio, healthRatios, RATIO_GUIDES
packages/core/test/
  assets-balance-sheet.test.ts   assets-health.test.ts

packages/db/src/repos/flows.ts          periodFlows
packages/db/src/repos/asset-values.ts   + netWorthSeries
packages/db/test/flows.test.ts          net-worth-series.test.ts

apps/web/src/features/networth/
  OverviewPage.tsx     net worth card, chart, needs attention, balance sheet, ratios
  HealthRatios.tsx     ratio cards with the period switch
  overview-rows.ts     attentionItems, sheetRowsFrom (pure)
  health-cards.ts      gauge and status presentation (pure)
  NetWorthTabs.tsx     + Overview
  queries.ts           + useNetWorthSeries, usePeriodFlows
apps/web/src/features/networth/overview-rows.test.ts  health-cards.test.ts
apps/web/e2e/net-worth.spec.ts
```

---

### Task 1: Core — balance sheet

**Files:** Create `packages/core/src/assets/balance-sheet.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/assets-balance-sheet.test.ts`.

**Interfaces — Consumes:** `PlanGroup` from `packages/core/src/assets/presets.ts`.

**Interfaces — Produces:**
```ts
export interface SheetAsset { accountId: string; name: string; planGroup: PlanGroup; valueMinor: number }
export interface SheetLiability {
  accountId: string; name: string; subtype: 'credit_card' | 'loan' | 'payable';
  balanceMinor: number;            // what is still owed, positive
  dueWithinYearMinor: number;      // principal due in the next 12 months
  note: string | null;
}
export interface SheetRow { accountId: string; name: string; amountMinor: number; note: string | null }
export interface SheetGroup { key: string; label: string; totalMinor: number; rows: SheetRow[] }
export interface BalanceSheet {
  assetGroups: SheetGroup[]; assetsTotalMinor: number;
  shortTerm: SheetGroup; longTerm: SheetGroup; liabilitiesTotalMinor: number;
  netWorthMinor: number;
}
export function balanceSheet(assets: SheetAsset[], liabilities: SheetLiability[]): BalanceSheet;
```

Rules: asset groups in the order `liquid`, `invest`, `owed`, `use`, empty groups dropped, labels from `PLAN_GROUP_LABELS`-style constants held in this module (`Cash & equivalents`, `Investments`, `Owed to you`, `Personal use`). A liability splits across the two groups: `dueWithinYearMinor` into "Due within a year" (labelled "Due within a year") and the remainder into "Long-term"; a row with nothing in a group is not listed there. Cards and payables pass `dueWithinYearMinor === balanceMinor`. Net worth is assets minus liabilities.

- [ ] Tests (fail first): `groups assets in balance-sheet order and drops empty groups`; `adds up each group and the asset total`; `a credit card sits entirely in due within a year`; `a loan with no principal due in a year is all long-term`; `a loan splits: 30 jt due within a year, the rest long-term`; `a split loan is listed in both groups with the split amounts and keeps its note`; `net worth is assets minus every debt`; `an empty sheet totals zero and has no groups`.
- [ ] Implement; run `npm test -w @expanses/core`; commit `feat(core): balance sheet grouping`.

### Task 2: Core — health ratios

**Files:** Create `packages/core/src/assets/health.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/assets-health.test.ts`.

**Interfaces — Produces:**
```ts
export interface PeriodFlows {
  months: number;                      // months with data, 1..12
  incomeMinor: number;                 // take-home, period total
  spendingMinor: number;               // period total
  debtPaymentsMinor: number;           // period total, principal and interest
  nonMortgageDebtPaymentsMinor: number;
}
export interface SheetTotals { liquidMinor: number; investMinor: number; assetsMinor: number; liabilitiesMinor: number; netWorthMinor: number }
export type RatioStatus = 'good' | 'watch' | 'act' | 'unknown';
export type RatioKey =
  | 'emergency_fund' | 'savings_rate' | 'liquidity' | 'debt_payments'
  | 'consumer_debt_payments' | 'debt_to_assets' | 'solvency' | 'investments_to_net_worth';
export interface HealthRatio {
  key: RatioKey; name: string;
  value: number | null;                // months for the emergency fund, percent for the rest
  unit: 'months' | 'percent';
  status: RatioStatus;
  target: number; max: number; lowerBetter: boolean;
  guide: string;                       // one line: the formula and the aim
}
export function healthRatios(flows: PeriodFlows, totals: SheetTotals): HealthRatio[];
export const MONTHLY = (totalMinor: number, months: number) => number;   // period total to a monthly figure
```

Thresholds, exactly as the spec's table: emergency fund good ≥ 3, watch 1.5–3, act below; savings rate good ≥ 10, watch 5–10, act below; liquidity good ≥ 15, watch 10–15, act below; debt payments good ≤ 25, watch 25–30, act above; consumer debt payments good ≤ 15, watch 15–20, act above; debt to assets good ≤ 50, watch 50–70, act above; solvency good ≥ 50, watch 30–50, act below; investments to net worth good ≥ 50, otherwise watch, never act.

Unknown rules: `months === 0` makes every flow-based ratio unknown; `incomeMinor <= 0` makes the three income ratios unknown; `netWorthMinor <= 0` makes liquidity, solvency and investments-to-net-worth unknown; `assetsMinor <= 0` makes debt-to-assets unknown. The emergency fund divides liquid assets by monthly spending plus monthly debt payments, and is unknown when that sum is zero.

- [ ] Tests (fail first): `returns the eight ratios in the order the screen shows them`; `emergency fund divides cash by monthly spending plus debt payments`; `emergency fund of 4,7 months is good, 2 months is watch, 1 month is act`; `savings rate uses take-home pay`; `debt payments at 26% is watch and at 31% is act`; `consumer debt payments has its own limits`; `debt to assets, solvency and investments to net worth read the totals`; `investments to net worth never says act`; `zero income makes the income ratios unknown, not zero`; `net worth of zero makes liquidity and solvency unknown`; `a period of 5 months divides by 5`.
- [ ] Implement; run `npm test -w @expanses/core`; commit `feat(core): financial health ratios`.

### Task 3: DB — period flows

**Files:** Create `packages/db/src/repos/flows.ts`; modify `packages/db/src/index.ts`; test `packages/db/test/flows.test.ts`.

**Interfaces — Consumes:** `PeriodFlows` (Task 2), `categoryIdsByKey` from `packages/db/src/repos/categories.ts`, `BALANCE_SUBTYPES` from `packages/db/src/repos/accounts.ts`.

**Interfaces — Produces:**
```ts
export interface PeriodFlowsResult extends PeriodFlows { from: string; to: string; byMonth: { month: string; incomeMinor: number; spendingMinor: number; debtPaymentsMinor: number }[] }
export function periodFlows(
  database: Database, ws: WorkspaceContext,
  range: { from: string; to: string },
  opts?: { homeLoanAccountIds?: string[] },
): Promise<PeriodFlowsResult>;
```

Rules: amounts in base currency from `entries.amountBaseMinor` on posted transactions inside the range. Income is every account of kind `income` except the one keyed `income.realized_gains`; spending is every account of kind `expense` except the one keyed `government.final_tax`. Debt payments are debits on liability accounts with subtype `loan` (money paid in, so the balance shrinks) plus the expense account keyed `fees.interest`. `nonMortgageDebtPaymentsMinor` leaves out payments into `homeLoanAccountIds`, which is empty until the Loans slice. `months` counts the distinct months in the range that have any posted transaction, at most 12. `byMonth` has one row per month in the range, oldest first, months with nothing included as zeros.

- [ ] Tests (fail first): `adds salary and bonus into take-home income`; `leaves realized gains out of income`; `adds expenses into spending`; `leaves final tax out of spending`; `ignores transfers between your own accounts`; `ignores opening balances`; `counts a loan payment and its interest as debt payments`; `a credit card bill paid in full is not a debt payment`; `non-mortgage payments leave out the home loan when its id is given`; `months counts only months with transactions`; `byMonth has a row per month, zeros included`; `another workspace is invisible`.
- [ ] Implement; run `npm test -w @expanses/db`; commit `feat(db): income, spending and debt payments per period`.

### Task 4: DB — net worth over time

**Files:** Modify `packages/db/src/repos/asset-values.ts`; test `packages/db/test/net-worth-series.test.ts`.

**Interfaces — Consumes:** `netWorthAt` (slice 1, same file).

**Interfaces — Produces:**
```ts
export interface NetWorthPoint { month: string; onDate: string; assetsMinor: number; liabilitiesMinor: number; netWorthMinor: number }
export function netWorthSeries(
  database: Database, ws: WorkspaceContext,
  months: string[],                       // "YYYY-MM", oldest first
  ratesToBase: Record<string, number>,
  today?: string,                         // the current month uses today, not its last day
): Promise<NetWorthPoint[]>;
export interface SheetInputs { assets: SheetAsset[]; liabilities: SheetLiability[] }
export function sheetInputsAt(database: Database, ws: WorkspaceContext, date: string): Promise<SheetInputs>;
```

`sheetInputsAt` turns `assetValuesAt` rows into `SheetAsset[]` and the liability accounts into `SheetLiability[]`: balance is the ledger balance made positive, `dueWithinYearMinor` equals the balance for `credit_card` and `payable` and is `0` for `loan` until the Loans slice, and the note says how many months are left only once loans exist, so it is `null` here.

- [ ] Tests (fail first): `one point per month, oldest first`; `the current month uses today`; `a month before the first transaction is zero`; `a gold price typed today does not change last month`; `sheetInputsAt returns assets with their plan group and value`; `sheetInputsAt makes debts positive`; `a credit card is due within a year and a loan is not, for now`.
- [ ] Implement; run `npm test -w @expanses/db`; commit `feat(db): net worth over time and balance sheet inputs`.

### Task 5: Web — Overview tab

**Files:** Create `apps/web/src/features/networth/OverviewPage.tsx`, `overview-rows.ts`, `overview-rows.test.ts`; modify `apps/web/src/features/networth/NetWorthTabs.tsx`, `apps/web/src/features/networth/queries.ts`, `apps/web/src/app/router.tsx`, `apps/web/src/app/Layout.tsx`.

**Interfaces — Consumes:** `balanceSheet` (Task 1), `netWorthSeries`, `sheetInputsAt` (Task 4), `useAssetValues`, `useDueTemplates` (slice 1).

**Interfaces — Produces:**
```ts
export interface AttentionItem { key: string; tone: 'warn' | 'info'; text: string; action: string; to: '/net-worth/assets' | '/net-worth/trades' }
export function attentionItems(values: AssetValueRow[], dueTemplates: TradeTemplateRow[]): AttentionItem[];
export function deltaSince(points: NetWorthPoint[], monthsBack: number): number | null;
export function useNetWorthSeries(months: string[]): UseQueryResult<NetWorthPoint[]>;
export function useSheet(date?: string): UseQueryResult<SheetInputs>;
```

Route `/net-worth` renders the Overview; `NetWorthTabs` lists Overview · Assets · Buy & sell; the sidebar item points at `/net-worth`. The page shows: net worth with the change since last month and since January, `ValueChart` over 12 months, a needs-attention card, and the balance sheet in two columns with a share bar per side and a net worth line underneath.

- [ ] Tests (fail first, `overview-rows.test.ts`): `lists stale prices and estimates as warnings`; `lists a due monthly buy`; `says nothing when everything is fresh`; `deltaSince returns the change against the month asked for`; `deltaSince is null when the series is too short`.
- [ ] Implement; run `npm test -w @expanses/web` and `npm run typecheck`; commit `feat(web): net worth overview with the balance sheet`.

### Task 6: Web — health ratios, dashboard link and end-to-end

**Files:** Create `apps/web/src/features/networth/HealthRatios.tsx`, `health-cards.ts`, `health-cards.test.ts`, `apps/web/e2e/net-worth.spec.ts`; modify `apps/web/src/features/networth/OverviewPage.tsx`, `apps/web/src/features/networth/queries.ts`, `apps/web/src/features/dashboard/DashboardPage.tsx`.

**Interfaces — Consumes:** `healthRatios`, `HealthRatio` (Task 2), `periodFlows` (Task 3), `balanceSheet` (Task 1).

**Interfaces — Produces:**
```ts
export type RatioPeriod = { key: 'ttm'; label: 'Last 12 months' } | { key: 'year'; label: string; year: number };
export function periodRange(period: RatioPeriod, today: string): { from: string; to: string; balanceDate: string };
export function ratioDisplay(ratio: HealthRatio): { value: string; statusLabel: string; gaugePercent: number; targetPercent: number };
export function usePeriodFlows(range: { from: string; to: string }): UseQueryResult<PeriodFlowsResult>;
```

`periodRange` for `ttm` is the 12 months ending today with balances as of today; for a year it is 1 Jan to 31 Dec with balances on 31 Dec. Ratio cards show name, status pill (On track · Watch · Act now · Not enough data), the value, a gauge with the guide marked, and the formula line. The Dashboard's net worth card gets a "See the full picture" link to `/net-worth`.

- [ ] Tests (fail first, `health-cards.test.ts`): `periodRange for the last 12 months ends today`; `periodRange for a year runs 1 Jan to 31 Dec with balances on 31 Dec`; `ratioDisplay shows months with one decimal and percentages with one decimal`; `ratioDisplay caps the gauge at 100%`; `an unknown ratio shows Not enough data and an empty gauge`.
- [ ] E2E (`apps/web/e2e/net-worth.spec.ts`, fail first): `salary, spending and a loan payment give the expected ratios`; `the balance sheet splits assets and debts and its net worth matches the card`; `a gold price update moves net worth by the price difference only`.
- [ ] Implement; run `npm test`, `npm run typecheck`, `npm run e2e`; commit `feat(web): financial health ratios on the overview`.
- [ ] Record execution notes at the end of this plan; commit `docs: record slice 2 execution status`.

---

## Self-review

**Spec coverage (§3.1, §5):** net worth at a date and the computed history (Task 4); balance sheet groups and the loan split (Task 1, 4); `periodFlows` with its exclusions and the months rule (Task 3); the eight ratios with thresholds, unknowns and the period switch (Task 2, 6); Overview screen with the card, chart, needs attention, sheet and ratio cards (Task 5, 6); dashboard link (Task 6).

**Left for later slices, as designed:** goals, lend and borrow, loan terms with the real 12-month principal split and home-loan marking, and the Coretax report.
