# Debt-free Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A page of its own, **Debt-free plan** (`/net-worth/plan`), that shows how much of every loan, card and Lend & borrow debt is left, when it will all be gone, what to pay next, which debt to pay first (Snowball / Avalanche / By hand) and what an extra amount a month changes — plus a month Schedule, All debts, a Report, and ways in from Net worth, Liabilities, Account, Cashflow and the wide-screen sidebar. Shipped in three drops.

**Architecture:** A pure payoff engine and a pure instalment-standing reader in `packages/core` (heavily unit-tested). One new db repo (`debt-plan.ts`) reads the ledger movements on debt accounts, each loan's standing and schedule, the saved plan settings (existing `calculator_inputs` table, kind `debt_plan`, no migration) and, in drop 2, the bills of any month. In `apps/web/src/features/debt-plan/` pure view modules turn the existing readings (`groupDebts`, `useCardFacts`, `peopleDebts`, `monthlyBills`) into plan rows, engine inputs and screen words; thin pages draw them with the phone kit. Pay buttons open the existing pay sheets through one new search param on each target page. Nothing new posts to the ledger.

**Tech Stack:** TypeScript, vitest (+ fast-check for engine properties), React 19, TanStack Router + Query, Tailwind 4, the phone kit `apps/web/src/ui/native`, Playwright (`phone` 390×844 and `chromium` projects).

**Spec:** `docs/superpowers/specs/2026-11-11-debt-free-plan-design.md`. Read it before any task. It decides anything this plan does not; section numbers below (§) are the spec's. Mockups: `docs/mockups/debt-free-plan.png`, `docs/mockups/debt-plan-placement.png`.

## Global Constraints

- No "you"/"your" in any app text. `grep -rniE "\byou(r|rs)?\b"` over the diff's new strings before every commit.
- No sample numbers in placeholders or hints. The Extra a month field's placeholder is `Amount`.
- Country-neutral: no Indonesian-only presets, lender names or thresholds in code or copy. Invented test fixtures only (lenders `Kredit`, `Bank`, `BCA` already used by existing specs are fine); never copy real statement figures.
- **The Liabilities page (`apps/web/src/features/loans/DebtsPage.tsx`) changes by exactly one `CornerAction`.** No other line of it changes. The plan is never drawn inside it.
- Pay buttons reuse the existing sheets only: `LoanDetailPage` `PaySheet`/`PayExtraSheet`, `CardHero` `PaySheet`, `BillPage` `PaySheet`, `LoanPage` `RepaymentForm`. No new payment form, no new posting function.
- No database migration. Settings go in `calculator_inputs` (0053) under `kind = 'debt_plan'`.
- Money is integer minor units everywhere; rounding only with `roundHalfAwayFromZero`. Foreign debts convert with `convertMinor` at today's held rate (`useHeldRates`); no rate → left out of totals and named (spec §5.6).
- Reuse, don't rebuild: `groupDebts`/`owedMinor` (debt-rows.ts), `loanSchedule`/`scheduleFor`, `periodOn`, `rateTextPer`/`repaidPercent`/`monthYearLabel` (loan-view.ts), `useCardFacts`, `peopleDebts`, `monthlyBills`/`billStanding`/`amountOf`/`billsInReadCurrency`, `dueDateAfter`/`cycleBack`, `cardStatement`, `installmentSchedule`/`installmentTotals`, `DayReorder`/`movedBy`, `ProgressRing`, `ProgressBar`, `SegmentedControl`.
- Reminders, notifications, risk levels and daily challenges are **not** in this build.
- No mutation or invalidation outside `useInvalidateAll()` after a save; plan queries are keyed by `ws.workspaceId` (and `ws.bookId` where bills are read).

**Known failures to ignore** (pre-existing on the base branch): phone e2e `phone-bank-name` 12, `phone-card-plastic-swipe` 36, `phone-coretax-pickers` 32, `phone-currency-pockets` 38, `phone-design-kit` 77, `phone-gold-trade` 44, `phone-lend-borrow` 147, `phone-period` 34; core typecheck error `packages/core/test/points-mcc.test.ts:40`. Anything else red is this branch's to fix.

## Review Focus

- **Engine exactness:** one loan, no extra, must end in the month its own `loanSchedule` ends and pay exactly Σ `interestMinor` of its rows — annuity, flat, zero, and an annuity with a rate change. Task 2 holds this; any drift means the budget/rollover rule leaked money into a single debt.
- **Already-paid month:** a loan whose instalment this month is paid must start next month (`firstMonth: 1`, `scheduleFrom` = next month's 1st) and must not be charged a month of interest it already paid. Tasks 2 and 3.
- **Late matching:** a payment made late settles the oldest unpaid instalment, never the next one; an instalment due today is not late; instalments before the account's first ledger day are never late. Task 1.
- **Foreign debt with no rate:** listed, left out of Left to pay, the engine and every total, and named; never added as rupiah. Task 4.
- **Pay round trip:** `?pay=…` opens the sheet once; Save or Cancel goes back to the plan; a plain visit to the target page (no param) behaves exactly as today. Task 6.
- **Liabilities untouched:** `git diff main -- apps/web/src/features/loans/DebtsPage.tsx` shows one `CornerAction` and its import, nothing else. Task 10.

---

## Waves (tasks in one wave touch no common file and may run in parallel worktrees; a later wave needs the earlier ones merged)

**Drop 1 — engine, plan page, Pay first, ways in 1b/2/3/6**
- **Wave 1:** Task 1 (core standing), Task 2 (core payoff engine), Task 6 (pay params on the four target pages). Task 1 adds its export after the loans exports in `packages/core/src/index.ts`; Task 2 appends its export at the very end of that file, so the two hunks never touch.
- **Wave 2:** Task 3 (db `debt-plan.ts`). Needs Task 1.
- **Wave 3:** Task 4 (web `plan-inputs.ts` + `pay-target.ts`). Needs Tasks 1–3, 6.
- **Wave 4:** Task 5 (web `plan-view.ts`). Needs Task 4.
- **Wave 5:** Task 7 (web `queries.ts`). Needs Tasks 3–5.
- **Wave 6:** Task 8 (plan page + routes). Needs Task 7.
- **Wave 7:** Task 9 (Pay first page + By hand) and Task 10 (ways in 1b, 2, 3, sidebar). No file in common — Task 9 edits only `PayFirstPage.tsx`/`ByHandList.tsx`; Task 10 edits `OverviewPage.tsx`, `DebtsPage.tsx`, `nav.ts`, `AccountMenuPage.tsx`, `Layout.tsx`.
- **Wave 8:** Task 11 (wide Plan layout). Needs Tasks 8–9.
- **Wave 9:** Task 12 (drop 1 e2e, phone + chromium). **Drop 1 is shippable after this wave.**

**Drop 2 — Schedule and the Cashflow row**
- **Wave 10:** Task 13 (db `billsInMonth`), Task 14 (web `schedule-view.ts` + `cycleDueIn`). Separate files.
- **Wave 11:** Task 15 (web month queries). Needs 13, 14.
- **Wave 12:** Task 16 (Schedule page, row, wide tab) and Task 17 (Cashflow due row). Separate files.
- **Wave 13:** Task 18 (drop 2 e2e). **Drop 2 is shippable after this wave.**

**Drop 3 — All debts, Report, wide tabs**
- **Wave 14:** Task 19 (web `all-debts-view.ts` + `report-view.ts`).
- **Wave 15:** Task 20 (All debts page) and Task 21 (Report page + wide Report tab). Task 20 owns the `/net-worth/plan/debts` route and the All debts row; Task 21 owns `/net-worth/plan/report`, the Report row and the tab. Both edit `router.tsx` and `DebtPlanPage.tsx` → **run 20 then 21** (sequential), or let one builder take both.
- **Wave 16:** Task 22 (drop 3 e2e + final checks). **Drop 3 is shippable after this wave.**

**Commands used throughout** (from the worktree root `/Users/frhamadiansyah/Documents/Projects/Expanses/.worktrees/debt-plan`; run `npm install` once first):
- Core unit: `cd packages/core && npx vitest run test/<file>.test.ts`
- DB unit: `cd packages/db && npx vitest run test/<file>.test.ts`
- Web unit: `cd apps/web && npx vitest run src/<path>.test.ts`
- Phone e2e: `cd apps/web && npx playwright test --project=phone e2e/<file>.spec.ts` (builds first; `E2E_REUSE=1` reuses `dist` when `src` is unchanged).
- Desktop e2e: `cd apps/web && npx playwright test --project=chromium e2e/<file>.spec.ts`
- Typecheck: `npm run typecheck` (ignore `points-mcc.test.ts:40`). All unit tests: `npm test`.

Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

# Drop 1

### Task 1: Core — a loan instalment's standing

**Files:**
- Modify: `packages/core/src/loans/schedule.ts` — export the existing private `paymentDate` (no behaviour change).
- Create: `packages/core/src/loans/standing.ts`
- Modify: `packages/core/src/index.ts` — one new line **directly after** the `./loans/schedule` export (line 383), plus `paymentDate` added to that existing line.
- Test: `packages/core/test/loans-standing.test.ts` (new). `packages/core/test/loans-schedule.test.ts` must pass unchanged.

**Interfaces (exported from `@expanses/core`):**

```ts
// schedule.ts — now exported
export function paymentDate(firstPaymentOn: string, paymentDay: number, index: number): string;

// standing.ts
export interface InstalmentDue {
  /** 1 for the loan's first instalment. */
  number: number;
  dueOn: string;
}
export interface InstalmentPayment {
  id: string;
  occurredOn: string;
  /** What the transaction paid: principal plus every line riding on it, in the loan's currency. */
  totalMinor: number;
  /** Recorded from a bank message, notification or screenshot (transactions.source = 'email'). */
  fromMessage: boolean;
}
export type InstalmentStatus = 'paid' | 'late' | 'upcoming';
export interface InstalmentState extends InstalmentDue {
  status: InstalmentStatus;
  paidOn: string | null;
  paymentId: string | null;
  paidMinor: number | null;
  fromMessage: boolean;
  /** Late: days since it fell due. Paid: days after the due day it was paid (0 when on time or early). Upcoming: 0. */
  daysLate: number;
}
/** The instalments due from `fromOn` to `toOn`, both inclusive, never past the tenor. */
export function instalmentDates(terms: Pick<LoanTerms, 'firstPaymentOn' | 'paymentDay' | 'tenorMonths'>, fromOn: string, toOn: string): InstalmentDue[];
/** Spec §6.2: oldest unpaid first, each taking the earliest unused payment made after the previous instalment's due day. */
export function instalmentStanding(dues: readonly InstalmentDue[], payments: readonly InstalmentPayment[], today: string): InstalmentState[];
```

- [ ] **Step 1: Write the failing test** `packages/core/test/loans-standing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { instalmentDates, instalmentStanding, type InstalmentPayment } from '../src/index';

const terms = { firstPaymentOn: '2026-08-01', paymentDay: 1, tenorMonths: 6 };
const pay = (id: string, occurredOn: string, totalMinor = 1_071_155, fromMessage = false): InstalmentPayment => ({ id, occurredOn, totalMinor, fromMessage });

describe('instalmentDates', () => {
  it('lists the instalments in the range, numbered from the loan’s first', () => {
    expect(instalmentDates(terms, '2026-09-01', '2026-11-30')).toEqual([
      { number: 2, dueOn: '2026-09-01' },
      { number: 3, dueOn: '2026-10-01' },
      { number: 4, dueOn: '2026-11-01' },
    ]);
  });
  it('stops at the tenor', () => {
    expect(instalmentDates(terms, '2026-01-01', '2027-12-31').map((d) => d.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('instalmentStanding', () => {
  const dues = instalmentDates(terms, '2026-08-01', '2026-11-30');

  it('an instalment with no payment and its day gone is late, counted in days', () => {
    const states = instalmentStanding(dues, [pay('a', '2026-08-01'), pay('b', '2026-09-02'), pay('c', '2026-10-01')], '2026-11-04');
    expect(states.map((s) => s.status)).toEqual(['paid', 'paid', 'paid', 'late']);
    expect(states[3]).toMatchObject({ number: 4, daysLate: 3, paidOn: null });
    expect(states[1]).toMatchObject({ paidOn: '2026-09-02', daysLate: 1, paymentId: 'b' });
  });

  it('due today is upcoming, not late', () => {
    expect(instalmentStanding(dues, [pay('a', '2026-08-01'), pay('b', '2026-09-01'), pay('c', '2026-10-01')], '2026-11-01')[3]!.status).toBe('upcoming');
  });

  it('a late payment settles the oldest unpaid instalment, not the next one', () => {
    // September was missed; the only later payment is on 15 Oct. It pays September (44 days late); October stays late.
    const states = instalmentStanding(dues, [pay('a', '2026-08-01'), pay('b', '2026-10-15')], '2026-10-20');
    expect(states.map((s) => [s.number, s.status, s.paymentId, s.daysLate])).toEqual([
      [1, 'paid', 'a', 0],
      [2, 'paid', 'b', 44],
      [3, 'late', null, 19],
      [4, 'upcoming', null, 0],
    ]);
  });

  it('a payment on an instalment’s own due day is not taken by the next one', () => {
    const states = instalmentStanding(dues, [pay('a', '2026-08-01'), pay('b', '2026-09-01')], '2026-09-10');
    expect(states.map((s) => s.paymentId)).toEqual(['a', 'b', null, null]);
  });

  it('one payment settles one instalment', () => {
    const states = instalmentStanding(dues, [pay('a', '2026-09-15', 2_142_312)], '2026-09-20');
    expect(states.map((s) => s.status)).toEqual(['paid', 'late', 'upcoming', 'upcoming']);
  });

  it('a payment a few days early counts for the instalment it was early for', () => {
    const states = instalmentStanding(dues, [pay('a', '2026-07-28')], '2026-08-05');
    expect(states[0]).toMatchObject({ status: 'paid', daysLate: 0, paidOn: '2026-07-28' });
  });

  it('carries the payment’s figure and whether it came from a bank message', () => {
    const [first] = instalmentStanding(dues, [pay('a', '2026-08-01', 1_200_000, true)], '2026-08-02');
    expect(first).toMatchObject({ paidMinor: 1_200_000, fromMessage: true });
  });

  it('nothing tracked, nothing late', () => {
    expect(instalmentStanding([], [pay('a', '2026-08-01')], '2026-11-04')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `cd packages/core && npx vitest run test/loans-standing.test.ts` → "instalmentDates is not a function" (not exported).

- [ ] **Step 3: Implement.** In `schedule.ts` change `function paymentDate` to `export function paymentDate` (body unchanged). Create `standing.ts`:

```ts
import { daysFrom } from '../bills/schedule';
import { addMonthsToDate } from '../deposits/maturity';
import { type LoanTerms, paymentDate } from './schedule';

// …interfaces as above…

export function instalmentDates(terms: Pick<LoanTerms, 'firstPaymentOn' | 'paymentDay' | 'tenorMonths'>, fromOn: string, toOn: string): InstalmentDue[] {
  const dues: InstalmentDue[] = [];
  for (let index = 0; index < terms.tenorMonths; index += 1) {
    const dueOn = paymentDate(terms.firstPaymentOn, terms.paymentDay, index);
    if (dueOn > toOn) break;
    if (dueOn >= fromOn) dues.push({ number: index + 1, dueOn });
  }
  return dues;
}

export function instalmentStanding(dues: readonly InstalmentDue[], payments: readonly InstalmentPayment[], today: string): InstalmentState[] {
  const sorted = [...payments].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id));
  const used = new Set<string>();
  return dues.map((due, index) => {
    // Oldest unpaid first: the earliest payment not yet taken, made after the previous instalment's day (for the
    // first tracked one, after the same day a month earlier). No upper bound, so a late payment settles the arrears.
    const after = index > 0 ? dues[index - 1]!.dueOn : addMonthsToDate(due.dueOn, -1);
    const payment = sorted.find((p) => !used.has(p.id) && p.occurredOn > after);
    if (payment) {
      used.add(payment.id);
      return { ...due, status: 'paid', paidOn: payment.occurredOn, paymentId: payment.id, paidMinor: payment.totalMinor, fromMessage: payment.fromMessage, daysLate: Math.max(0, daysFrom(due.dueOn, payment.occurredOn)) };
    }
    const late = due.dueOn < today;
    return { ...due, status: late ? 'late' : 'upcoming', paidOn: null, paymentId: null, paidMinor: null, fromMessage: false, daysLate: late ? daysFrom(due.dueOn, today) : 0 };
  });
}
```

Add to `index.ts`: extend line 383 with `paymentDate`, and after it:
`export { type InstalmentDue, instalmentDates, type InstalmentPayment, type InstalmentState, instalmentStanding, type InstalmentStatus } from './loans/standing';`

- [ ] **Step 4: Run, expect PASS** — the standing test and `test/loans-schedule.test.ts`.
- [ ] **Step 5: Commit** — `git add packages/core && git commit -m "Core reads a loan instalment's standing: paid, late or upcoming, oldest unpaid first"` (+ trailer).

---

### Task 2: Core — the payoff engine

**Files:**
- Create: `packages/core/src/debts/payoff.ts`
- Modify: `packages/core/src/index.ts` — **append at the very end** one export line (keeps clear of Task 1's hunk).
- Test: `packages/core/test/debts-payoff.test.ts` (new).

**Interfaces (exported from `@expanses/core`):**

```ts
export type PayoffMethod = 'snowball' | 'avalanche' | 'byHand';
export type PayoffInterest = { kind: 'balance' } | { kind: 'fixed'; minor: number } | { kind: 'none' };
export interface PayoffDebt {
  key: string;
  name: string;
  /** What is owed now, base currency, minor units. Debts at 0 are ignored. */
  balanceMinor: number;
  /** Yearly basis points for month 0, 1, …; the last holds after; [] is 0%. Null: rate unknown (a loan with no terms). */
  ratesBps: readonly number[] | null;
  interest: PayoffInterest;
  /** What its own schedule asks in month 0, 1, …; the month after the last, everything left is due. [] = no schedule. */
  minimumsMinor: readonly number[];
  /** What keeps rolling to other debts each month once this one's schedule has ended (spec §7.3). */
  regularMinor: number;
  /** Month index its own months begin; before it nothing accrues and nothing is due. Default 0. */
  firstMonth?: number;
  late: boolean;
  daysLate: number;
}
export interface PayoffOptions {
  /** YYYY-MM of month 0. */
  startMonth: string;
  method: PayoffMethod;
  byHand?: readonly string[];
  extraMinor: number;
  capMonths?: number;
}
export interface PayoffDebtResult { key: string; endMonth: string | null; interestMinor: number; paidMinor: number }
export interface PayoffPlan {
  order: string[];
  debtFreeMonth: string | null;
  /** Months until nothing is owed, counting month 0 as 1. Null when unknown. */
  months: number | null;
  unknown: null | { reason: 'noRate' | 'neverCleared'; keys: string[] };
  interestMinor: number;
  debts: PayoffDebtResult[];
}
export interface ExtraEffect { plan: PayoffPlan; baseline: PayoffPlan; interestSavedMinor: number | null; monthsSooner: number | null }
export interface MethodSuggestion {
  method: 'avalanche' | 'snowball';
  reason: 'ratesDiffer' | 'manySmall' | 'ratesUnknown';
  highestKey?: string;
  lowestKey?: string;
  smallCount?: number;
}
export interface ScheduledLoanInput {
  key: string;
  name: string;
  balanceMinor: number;
  rows: readonly ScheduleRow[];
  method: LoanMethod;
  periods: readonly RatePeriod[];
  startMonth: string;
  late: boolean;
  daysLate: number;
}
export const PAYOFF_CAP_MONTHS = 600;
export const RATE_SPREAD_BPS = 500;
export const SMALL_DEBT_SHARE_BPS = 1_000;
export const SMALL_DEBT_COUNT = 3;
export function payoffOrder(debts: readonly PayoffDebt[], method: PayoffMethod, byHand?: readonly string[]): string[];
export function simulatePayoff(debts: readonly PayoffDebt[], options: PayoffOptions): PayoffPlan;
export function extraEffect(debts: readonly PayoffDebt[], options: PayoffOptions): ExtraEffect;
export function suggestMethod(debts: readonly PayoffDebt[]): MethodSuggestion | null;
export function payoffDebtFromSchedule(input: ScheduledLoanInput): PayoffDebt;
```

- [ ] **Step 1: Write the failing test** `packages/core/test/debts-payoff.test.ts`. Helper `debt(key, overrides)` builds a 0%, no-schedule debt (`ratesBps: [0]`, `interest: none`, `minimumsMinor: []`, `regularMinor: 0`, `late: false`, `daysLate: 0`). Tests (real assertions):

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { extraEffect, loanSchedule, type LoanTerms, payoffDebtFromSchedule, payoffOrder, type PayoffDebt, simulatePayoff, suggestMethod } from '../src/index';

const debt = (key: string, o: Partial<PayoffDebt> = {}): PayoffDebt => ({ key, name: key, balanceMinor: 0, ratesBps: [0], interest: { kind: 'none' }, minimumsMinor: [], regularMinor: 0, late: false, daysLate: 0, ...o });
const opts = { startMonth: '2026-11', method: 'snowball' as const, extraMinor: 0 };

describe('a single loan with no extra is paid exactly as its own schedule says', () => {
  const cases: [string, LoanTerms, number][] = [
    ['annuity', { originalMinor: 6_000_000, firstPaymentOn: '2026-11-01', tenorMonths: 6, method: 'annuity', paymentDay: 1 }, 2_400],
    ['flat', { originalMinor: 12_000_000, firstPaymentOn: '2026-11-25', tenorMonths: 12, method: 'flat', paymentDay: 25 }, 1_200],
    ['zero', { originalMinor: 2_400_000, firstPaymentOn: '2026-11-10', tenorMonths: 6, method: 'zero', paymentDay: 10 }, 0],
  ];
  for (const [name, terms, rateBps] of cases) {
    it(name, () => {
      const periods = [{ fromOn: terms.firstPaymentOn, rateBps, kind: 'fixed' as const, paymentMinor: 0 }];
      const rows = loanSchedule(terms.originalMinor, terms, periods, '2026-11-01');
      const one = payoffDebtFromSchedule({ key: 'L', name: 'L', balanceMinor: terms.originalMinor, rows, method: terms.method, periods, startMonth: '2026-11', late: false, daysLate: 0 });
      const plan = simulatePayoff([one], opts);
      expect(plan.debtFreeMonth).toBe(rows.at(-1)!.onDate.slice(0, 7));
      expect(plan.interestMinor).toBe(rows.reduce((s, r) => s + r.interestMinor, 0));
      expect(plan.debts[0]!.paidMinor).toBe(rows.reduce((s, r) => s + r.paymentMinor, 0));
    });
  }
  it('an annuity whose rate drops part-way', () => {
    const terms: LoanTerms = { originalMinor: 100_000_000, firstPaymentOn: '2026-11-25', tenorMonths: 24, method: 'annuity', paymentDay: 25 };
    const periods = [
      { fromOn: '2026-11-25', rateBps: 900, kind: 'fixed' as const, paymentMinor: 0 },
      { fromOn: '2027-11-25', rateBps: 600, kind: 'floating' as const, paymentMinor: 0 },
    ];
    const rows = loanSchedule(terms.originalMinor, terms, periods, '2026-11-01');
    const plan = simulatePayoff([payoffDebtFromSchedule({ key: 'L', name: 'L', balanceMinor: 100_000_000, rows, method: 'annuity', periods, startMonth: '2026-11', late: false, daysLate: 0 })], opts);
    expect(plan.debtFreeMonth).toBe('2028-10');
    expect(plan.interestMinor).toBe(rows.reduce((s, r) => s + r.interestMinor, 0));
  });
  it('a loan already paid this month starts next month and is not charged that month’s interest', () => {
    const terms: LoanTerms = { originalMinor: 6_000_000, firstPaymentOn: '2026-10-01', tenorMonths: 6, method: 'annuity', paymentDay: 1 };
    const periods = [{ fromOn: '2026-10-01', rateBps: 2_400, kind: 'fixed' as const, paymentMinor: 0 }];
    const rows = loanSchedule(5_000_000, terms, periods, '2026-12-01'); // November already paid
    const one = payoffDebtFromSchedule({ key: 'L', name: 'L', balanceMinor: 5_000_000, rows, method: 'annuity', periods, startMonth: '2026-11', late: false, daysLate: 0 });
    expect(one.firstMonth).toBe(1);
    expect(one.minimumsMinor[0]).toBe(0);
    const plan = simulatePayoff([one], opts);
    expect(plan.debtFreeMonth).toBe(rows.at(-1)!.onDate.slice(0, 7));
    expect(plan.interestMinor).toBe(rows.reduce((s, r) => s + r.interestMinor, 0));
  });
});

describe('rollover', () => {
  // A: 1.000.000 at 500.000 × 2; B: 3.000.000 at 500.000 × 6. Both 0%.
  const a = debt('A', { balanceMinor: 1_000_000, minimumsMinor: [500_000, 500_000], regularMinor: 500_000 });
  const b = debt('B', { balanceMinor: 3_000_000, minimumsMinor: Array(6).fill(500_000), regularMinor: 500_000 });
  it('a finished debt’s payment goes to the next in line', () => {
    const plan = simulatePayoff([a, b], opts);
    expect(plan.debts.find((d) => d.key === 'A')!.endMonth).toBe('2026-12');
    expect(plan.debts.find((d) => d.key === 'B')!.endMonth).toBe('2027-02'); // m3, not m5
    expect(plan.debtFreeMonth).toBe('2027-02');
    expect(plan.months).toBe(4);
  });
  it('nothing already paid this month rolls over in month 0', () => {
    const paid = debt('P', { balanceMinor: 1_000_000, minimumsMinor: [0, 500_000, 500_000], regularMinor: 500_000, firstMonth: 1 });
    const other = debt('Q', { balanceMinor: 2_000_000, minimumsMinor: Array(4).fill(500_000), regularMinor: 500_000 });
    const plan = simulatePayoff([paid, other], opts);
    expect(plan.debts.find((d) => d.key === 'Q')!.endMonth).toBe('2027-02'); // its own schedule; P never ends early
  });
});

describe('extra a month', () => {
  const one = debt('A', { balanceMinor: 1_200_000, minimumsMinor: Array(12).fill(100_000), regularMinor: 100_000 });
  it('goes to the first in line and brings the month forward', () => {
    const effect = extraEffect([one], { ...opts, extraMinor: 100_000 });
    expect(effect.baseline.debtFreeMonth).toBe('2027-10');
    expect(effect.plan.debtFreeMonth).toBe('2027-04');
    expect(effect.monthsSooner).toBe(6);
    expect(effect.interestSavedMinor).toBe(0);
  });
  it('saves interest on an interest-bearing debt', () => {
    const loan = debt('K', { balanceMinor: 6_000_000, ratesBps: [2_400], interest: { kind: 'balance' }, minimumsMinor: Array(6).fill(1_071_155), regularMinor: 1_071_155 });
    const effect = extraEffect([loan], { ...opts, extraMinor: 3_000_000 });
    expect(effect.plan.debtFreeMonth).toBe('2026-12');
    expect(effect.plan.interestMinor).toBe(120_000 + 40_977);
    expect(effect.interestSavedMinor).toBeGreaterThan(0);
  });
  it('more extra never ends later and never costs more interest (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.integer({ min: 0, max: 5_000_000 }), (x, y) => {
        const [lo, hi] = x <= y ? [x, y] : [y, x];
        const debts = [
          debt('K', { balanceMinor: 6_000_000, ratesBps: [2_400], interest: { kind: 'balance' }, minimumsMinor: Array(6).fill(1_071_155), regularMinor: 1_071_155 }),
          debt('M', { balanceMinor: 50_000_000, ratesBps: [900], interest: { kind: 'balance' }, minimumsMinor: Array(60).fill(1_037_918), regularMinor: 1_037_918 }),
        ];
        const low = simulatePayoff(debts, { ...opts, method: 'avalanche', extraMinor: lo });
        const high = simulatePayoff(debts, { ...opts, method: 'avalanche', extraMinor: hi });
        return high.months! <= low.months! && high.interestMinor <= low.interestMinor;
      }),
    );
  });
});

describe('order', () => {
  const small = debt('small', { balanceMinor: 500_000 });
  const pricey = debt('pricey', { balanceMinor: 9_000_000, ratesBps: [3_540], interest: { kind: 'balance' } });
  const mortgage = debt('mortgage', { balanceMinor: 28_400_000, ratesBps: [750], interest: { kind: 'balance' } });
  const noTerms = debt('noTerms', { balanceMinor: 3_000_000, ratesBps: null });
  const late = debt('late', { balanceMinor: 3_600_000, ratesBps: [3_540], interest: { kind: 'balance' }, late: true, daysLate: 3 });
  it('snowball: smallest first', () => expect(payoffOrder([mortgage, pricey, small], 'snowball')).toEqual(['small', 'pricey', 'mortgage']));
  it('avalanche: highest rate first, unknown after known rates and before 0%', () =>
    expect(payoffOrder([small, mortgage, noTerms, pricey], 'avalanche')).toEqual(['pricey', 'mortgage', 'noTerms', 'small']));
  it('late debts go on top in every method', () => {
    for (const method of ['snowball', 'avalanche', 'byHand'] as const) expect(payoffOrder([small, late, mortgage], method, ['mortgage', 'small'])[0]).toBe('late');
  });
  it('by hand keeps the saved order, appends new debts smallest first, drops gone keys', () =>
    expect(payoffOrder([small, pricey, mortgage], 'byHand', ['mortgage', 'gone', 'pricey'])).toEqual(['mortgage', 'pricey', 'small']));
  it('extra goes to the first in line', () => {
    const plan = simulatePayoff([pricey, mortgage], { ...opts, method: 'avalanche', extraMinor: 1_000_000 });
    expect(plan.order[0]).toBe('pricey');
    expect(plan.debts.find((d) => d.key === 'pricey')!.paidMinor).toBeGreaterThan(0);
  });
});

describe('unknown', () => {
  it('a debt with no rate makes the plan’s month unknown but the others still end', () => {
    const plan = simulatePayoff([debt('known', { balanceMinor: 600_000, minimumsMinor: [300_000, 300_000], regularMinor: 300_000 }), debt('noTerms', { balanceMinor: 1_000_000, ratesBps: null })], opts);
    expect(plan.debtFreeMonth).toBeNull();
    expect(plan.unknown).toEqual({ reason: 'noRate', keys: ['noTerms'] });
    expect(plan.debts.find((d) => d.key === 'known')!.endMonth).toBe('2026-12');
  });
  it('a debt no money ever reaches is never cleared', () => {
    const plan = simulatePayoff([debt('friend', { balanceMinor: 1_000_000 })], { ...opts, capMonths: 24 });
    expect(plan.unknown).toEqual({ reason: 'neverCleared', keys: ['friend'] });
    expect(plan.months).toBeNull();
  });
  it('a payment below the interest is never cleared', () => {
    const plan = simulatePayoff([debt('grow', { balanceMinor: 10_000_000, ratesBps: [3_600], interest: { kind: 'balance' }, minimumsMinor: Array(600).fill(100_000), regularMinor: 100_000 })], opts);
    expect(plan.unknown?.reason).toBe('neverCleared');
  });
  it('a debt with no schedule is cleared by freed money', () => {
    const plan = simulatePayoff([debt('A', { balanceMinor: 1_000_000, minimumsMinor: [500_000, 500_000], regularMinor: 500_000 }), debt('friend', { balanceMinor: 1_000_000 })], opts);
    // A ends in December; from January its 500.000 a month goes to the friend: 2 months.
    expect(plan.debts.find((d) => d.key === 'friend')!.endMonth).toBe('2027-02');
  });
  it('a lump bigger than the month’s level is paid whole, never a negative leftover', () => {
    const plan = simulatePayoff([debt('card', { balanceMinor: 6_214_300, minimumsMinor: [6_214_300] }), debt('A', { balanceMinor: 1_000_000, minimumsMinor: [500_000, 500_000], regularMinor: 500_000 })], opts);
    expect(plan.debts.find((d) => d.key === 'card')!.endMonth).toBe('2026-11');
    expect(plan.debts.find((d) => d.key === 'A')!.endMonth).toBe('2026-12');
  });
});

describe('suggestMethod', () => {
  const k = (key: string, balanceMinor: number, rate: number | null) => debt(key, { balanceMinor, ratesBps: rate === null ? null : [rate], interest: rate ? { kind: 'balance' } : { kind: 'none' } });
  it('avalanche when every rate is known and they differ by 5 points or more', () =>
    expect(suggestMethod([k('paylater', 3_600_000, 3_540), k('mortgage', 28_400_000, 750), k('card', 6_214_300, 0)])).toEqual({ method: 'avalanche', reason: 'ratesDiffer', highestKey: 'paylater', lowestKey: 'mortgage' }));
  it('snowball when three or more debts are each 10% of the total or less', () =>
    expect(suggestMethod([k('a', 500_000, 900), k('b', 600_000, 1_000), k('c', 700_000, 1_100), k('big', 40_000_000, 1_200)])).toEqual({ method: 'snowball', reason: 'manySmall', smallCount: 3 }));
  it('avalanche wins when both hold', () =>
    expect(suggestMethod([k('a', 500_000, 3_600), k('b', 600_000, 0), k('c', 700_000, 0), k('big', 40_000_000, 900)])?.method).toBe('avalanche'));
  it('snowball when a rate is unknown', () => expect(suggestMethod([k('a', 5_000_000, 900), k('b', 6_000_000, null)])).toEqual({ method: 'snowball', reason: 'ratesUnknown' }));
  it('nothing when rates are close', () => expect(suggestMethod([k('a', 5_000_000, 900), k('b', 6_000_000, 1_100)])).toBeNull());
});
```

Check the hand figures before relying on them: rollover A/B — m0 A 1.0M→0.5M, B 3.0M→2.5M; m1 A→0, B→2.0M; m2 budget 0.5M (B min) + 0.5M freed (A's `regularMinor`, its schedule ended) → B 1.0M; m3 → 0 ⇒ B ends 2027-02. Extra 3M on K: m0 interest 120.000, min 1.071.155, extra → 2.048.845; m1 interest 40.977, owed 2.089.821, min 1.071.155, extra 3.000.000 clears it ⇒ 2026-12, interest 160.977. Extra 100.000 on A (1.2M, 100k×12): 200k a month ⇒ 6 months, m5 = 2027-04; baseline m11 = 2027-10. Rate drop: 24 rows from 2026-11 ⇒ last 2028-10.

- [ ] **Step 2: Run it, expect FAIL** — `cd packages/core && npx vitest run test/debts-payoff.test.ts` (module missing).

- [ ] **Step 3: Implement `payoff.ts`** exactly to spec §7:
  - `payoffOrder`: late first (`daysLate` desc, then name); rest by method. Snowball comparator: `balanceMinor` asc, then current rate desc (unknown as −1), then `name`. Avalanche rank: positive rate → `rate + 1`, unknown → 1, zero → 0; sort rank desc, then `balanceMinor` asc, then `name`. By hand: saved keys present (in saved order), then the others in Snowball order.
  - `simulatePayoff`: drop debts with `balanceMinor <= 0`; keep `balance`, `interest`, `paid`, `endIndex` per key. For `m` from 0 while anything is owed and `m < cap`:
    1. `spent = 0`; for each key in order with balance > 0 and `m >= firstMonth`: charge = fixed minor, or `roundHalfAwayFromZero(balance * rateAt(m) / 10_000 / 12)` for `balance` with a known rate, else 0; `balance += charge`; due = `m < minimums.length ? minimums[m] : minimums.length > 0 ? balance : 0`; `pay = min(max(0, due), balance)`; apply; if balance hits 0 record `endIndex = m`.
    2. `freed` = Σ over debts whose `endIndex < m` of (`m < minimums.length ? minimums[m] : regularMinor`).
    3. `left = extra + freed` (month 0: `freed` is 0 by construction); pour `left` down the order into balances still owed (including debts before their `firstMonth`), recording `endIndex = m` on any cleared.
  - Result: `debts[].endMonth = addMonths(startMonth, endIndex)`; `unknown` = `noRate` with the keys whose `ratesBps === null` (first, if any), else `neverCleared` with keys still owed at the cap; `debtFreeMonth`/`months` null when `unknown`, else from the largest `endIndex` (`months = max + 1`). `interestMinor` = Σ charges.
  - `extraEffect`: `plan` = with `extraMinor`, `baseline` = same with 0; `interestSavedMinor` = both `unknown === null` ? `baseline.interestMinor − plan.interestMinor` : null; `monthsSooner` likewise from `months`.
  - `suggestMethod`: spec §8, constants above; "small" = `balance * 10_000 <= total * SMALL_DEBT_SHARE_BPS`.
  - `payoffDebtFromSchedule`: month index of each row = months between `startMonth` and `row.onDate.slice(0, 7)` (skip negatives); `minimumsMinor[i]` = Σ row payments in month `i` (0 where none); `ratesBps[i]` = `periodOn(periods, row.onDate)?.rateBps ?? 0` (a gap month takes the next row's rate); `firstMonth` = index of the first row; `regularMinor` = first row payment > 0; `interest` = `{ kind: 'fixed', minor: rows[0]?.interestMinor ?? 0 }` for flat, `none` for zero, `balance` for annuity. No rows: `minimumsMinor: []`, `ratesBps: [periodOn(periods, startMonth + '-01')?.rateBps ?? 0]`.
  - Append to `index.ts`: `export { extraEffect, type ExtraEffect, type MethodSuggestion, PAYOFF_CAP_MONTHS, type PayoffDebt, type PayoffDebtResult, payoffDebtFromSchedule, type PayoffInterest, type PayoffMethod, type PayoffOptions, payoffOrder, type PayoffPlan, RATE_SPREAD_BPS, type ScheduledLoanInput, simulatePayoff, SMALL_DEBT_COUNT, SMALL_DEBT_SHARE_BPS, suggestMethod } from './debts/payoff';`

- [ ] **Step 4: Run, expect PASS** — `npx vitest run test/debts-payoff.test.ts test/loans-schedule.test.ts`, then `cd ../.. && npm run typecheck` (only `points-mcc.test.ts:40` may fail).
- [ ] **Step 5: Commit** — `git commit -m "Core payoff engine: snowball, avalanche and by-hand order, freed payments roll over, extra a month, suggestion"` (+ trailer).

---

### Task 3: DB — debt movements, loan plan facts, saved settings

**Files:**
- Create: `packages/db/src/repos/debt-plan.ts`
- Modify: `packages/db/src/index.ts` — `export * from './repos/debt-plan';`
- Test: `packages/db/test/debt-plan.test.ts` (new; `setupDb()` from `test/helpers`, patterned on `test/loans.test.ts` and `test/calculator-inputs.test.ts`).

**Interfaces:**

```ts
export interface DebtMovement {
  transactionId: string;
  accountId: string;
  occurredOn: string;
  /** Positive: the debt went down (a payment). Negative: it went up (borrowing, a charge, an opening balance). Account currency. */
  amountMinor: number;
  /** Every expense line in the same transaction (interest, insurance, admin), summed. */
  chargesMinor: number;
  /** Lines under the `miscellaneous.interest` category (any book's copy). */
  interestMinor: number;
  fromMessage: boolean;
}
export async function debtMovements(database: Database, ws: WorkspaceContext, accountIds: readonly string[], range?: { from?: string; to?: string }): Promise<DebtMovement[]>;

export interface LoanPlanFact {
  accountId: string;
  owedMinor: number;
  /** The later of the first payment and the account's first ledger day. */
  trackFrom: string;
  /** Tracked instalments through the end of the current month (spec §6.2). */
  instalments: InstalmentState[];
  /** Today, or next month's 1st when this month's instalment is already paid. */
  scheduleFrom: string;
  schedule: ScheduleRow[];
}
/** Every open loan with terms. Loans with no terms or paid off are not here. */
export async function loanPlanFacts(database: Database, ws: WorkspaceContext, today: string): Promise<LoanPlanFact[]>;

export type DebtPlanMethod = 'snowball' | 'avalanche' | 'byHand';
export interface DebtPlanSettings { method: DebtPlanMethod | null; order: string[]; extraMinor: number; extraCurrency: string | null }
export class DebtPlanError extends Error { constructor(public readonly code: 'NO_TABLES' | 'INVALID', message: string) }
export async function getDebtPlanSettings(database: Database, ws: WorkspaceContext): Promise<DebtPlanSettings | null>;
export async function saveDebtPlanSettings(database: Database, ws: WorkspaceContext, settings: DebtPlanSettings): Promise<void>;
```

Implementation notes:
- `debtMovements`: one SQL over `entries` ⨝ `transactions` (posted only, `ws.workspaceId`, `entries.account_id IN ids`, optional `occurred_on` range), `GROUP BY transaction, account`, summing `amount_minor` (a liability's entry is positive when it falls — the sign `loanPayments` reads). A second query over the same transaction ids sums `entries` on `accounts.kind = 'expense'` with `amount_minor > 0` (charges) and those whose account id is in `categoryIdsByKeyAllTx(db, ws)['miscellaneous.interest']` (interest). `fromMessage = source === 'email'`. Sorted by `occurredOn`, then `transactionId`.
- `loanPlanFacts`: `listLoans` → open ones; `debtMovements` once for their ids; per loan: `trackFrom = max(firstPaymentOn, earliest movement day)`; `instalments = instalmentStanding(instalmentDates(terms, trackFrom, monthRange(monthOf(today)).to), payments, today)` with payments = movements with `amountMinor > 0` → `{ id: transactionId, occurredOn, totalMinor: amountMinor + chargesMinor, fromMessage }`; `scheduleFrom` = next month's 1st when the instalment due this month is `paid`, else `today`; `schedule = await scheduleFor(database, ws, accountId, scheduleFrom)`; `owedMinor` = the existing `owedOnTx` reading (export a non-tx wrapper or read through `scheduleFor`'s transaction — keep one source).
- Settings: `calculator_inputs` row `(workspaceId, kind 'debt_plan')`, JSON `{ version: 1, ...settings }`, guarded by `healthTablesExist` exactly like `saveLifeCoverDraft` (`NO_TABLES` with the same words). Refuse (`INVALID`) a negative or non-integer `extraMinor`, a duplicate key in `order`, or an unknown method. A row it cannot read returns `null`.

- [ ] **Step 1: Write the failing test** `packages/db/test/debt-plan.test.ts`. Fixtures: `bca` bank (opening 50.000.000 on 2026-08-01); `kredit` loan account (opening 6.000.000 on 2026-08-01) with `saveLoanTerms` (`firstPaymentOn 2026-09-01`, 6 months, annuity, payment day 1, `rateBps 2400`, `originalMinor 6_000_000`); `recordLoanPayment` on 2026-09-01 (principal 951.155, interest 120.000) and 2026-10-03 (principal from `nextPaymentDue`). Assertions:
  - `debtMovements(…, [kredit.id])` returns 3 rows; the opening is `amountMinor: -6_000_000`; the first payment `{ amountMinor: 951_155, interestMinor: 120_000, chargesMinor: 120_000, fromMessage: false }`.
  - With `range: { from: '2026-10-01' }` only the October payment.
  - `loanPlanFacts(…, '2026-11-04')`: one fact; `trackFrom: '2026-09-01'`; `instalments.map(i => [i.number, i.status])` = `[[1,'paid'],[2,'paid'],[3,'late']]`; `instalments[2].daysLate === 3`; `scheduleFrom === '2026-11-04'`; `schedule[0].onDate === '2026-11-01'`.
  - After paying on 2026-11-04 again: `loanPlanFacts(…, '2026-11-05')` → instalment 3 `paid` with `daysLate: 3`, `scheduleFrom: '2026-12-01'`, `schedule[0].onDate === '2026-12-01'`.
  - A loan with no terms and a paid-off loan are not in `loanPlanFacts`.
  - A payment recorded with `source: 'email'` (post through `postTransaction` with that source, as `test/drafts*.test.ts` do) has `fromMessage: true`.
  - Settings: `getDebtPlanSettings` → `null` at first; save `{ method: 'avalanche', order: ['a','b'], extraMinor: 500_000, extraCurrency: 'IDR' }` and read it back equal; saving again replaces it; `extraMinor: -1` and `order: ['a','a']` reject with `DebtPlanError` code `INVALID`; a second workspace reads `null`.
- [ ] **Step 2: Run, expect FAIL** — `cd packages/db && npx vitest run test/debt-plan.test.ts`.
- [ ] **Step 3: Implement** per the notes.
- [ ] **Step 4: Run, expect PASS**, plus `npx vitest run test/loans.test.ts test/loans-payments.test.ts test/calculator-inputs.test.ts` unchanged.
- [ ] **Step 5: Commit** — `git commit -m "DB reads debt movements and each loan's standing for the plan; plan settings kept per workspace"`.

---

### Task 4: Web — plan rows from the existing readings, and pay targets

**Files:**
- Create: `apps/web/src/features/debt-plan/pay-target.ts`, `apps/web/src/features/debt-plan/plan-inputs.ts`
- Test: `apps/web/src/features/debt-plan/pay-target.test.ts`, `apps/web/src/features/debt-plan/plan-inputs.test.ts`

**Interfaces:**

```ts
// pay-target.ts — the links Task 6's params answer
export type PayTarget =
  | { to: '/net-worth/loans/$accountId'; params: { accountId: string }; search: { pay: 'due' | 'extra' } }
  | { to: '/cards/$cardId'; params: { cardId: string }; search: { pay: true } }
  | { to: '/bills/$billId'; params: { billId: string }; search: { pay: true } }
  | { to: '/net-worth/lend-borrow/loan/$accountId'; params: { accountId: string }; search: { repay: true } };
export const loanPay: (accountId: string, what?: 'due' | 'extra') => PayTarget;
export const cardPay: (cardId: string) => PayTarget;
export const billPay: (billId: string) => PayTarget;
export const personPay: (accountId: string) => PayTarget;

// plan-inputs.ts
export type PlanItemKind = 'loan' | 'card' | 'person' | 'bill';
export interface PlanItem {
  key: string;                 // `${kind}:${id}:${dueOn}`
  debtKey: string | null;      // null for a bill
  kind: PlanItemKind;
  title: string;               // "Kredit · 4/6", "BCA Visa", "Electricity", "Dewi"
  detail: string;              // "Statement · 18 Nov", "Bill · 20 Nov", "Lend & borrow · 3 Dec", "Oct instalment"
  dueOn: string;
  status: 'paid' | 'late' | 'upcoming';
  daysLate: number;
  minor: number | null;        // own currency; what was paid when paid
  currency: string;
  baseMinor: number | null;
  approximate: boolean;
  paidOn: string | null;
  fromMessage: boolean;
  pay: PayTarget | null;
}
export type PlanDebtKind = 'loan' | 'card' | 'person' | 'payable';
export interface PlanDebt {
  key: string;                 // DebtRow.key
  kind: PlanDebtKind;
  accountId: string | null;
  personName: string | null;
  name: string;
  currency: string;
  leftMinor: number; borrowedMinor: number; repaidMinor: number;      // own currency, borrowed = left + repaid
  leftBase: number | null; borrowedBase: number | null; repaidBase: number | null;
  missing: string | null;      // currency with no rate
  rateBps: number | null;      // null: unknown (loan with no terms)
  ratePer: 'month' | 'year';
  hasTerms: boolean;
  instalmentOf: number | null; // tenor, for "4/6"
  endsMonth: string | null;    // its own schedule's last month
  next: PlanItem | null;       // spec §6.5
  late: boolean; daysLate: number;
  paidOff: boolean; paidOffMonth: string | null;
  payoff: PayoffDebt | null;   // null when paid off or no base rate
}
export interface PlanReadings {
  accounts: readonly DebtAccount[];
  balances: Readonly<Record<string, number>>;
  loans: readonly LoanTermsRow[];
  items: Readonly<Record<string, string>>;
  loanFacts: readonly LoanPlanFact[];
  cards: Readonly<Record<string, CardFacts>>;
  cardPlans: readonly CardInstallmentRow[];
  people: PeopleDebts;
  movements: readonly DebtMovement[];
  baseCurrency: string;
  ratesToBase: Readonly<Record<string, number>>;
}
/** Every debt in the plan, active then paid off (spec §5). Built on `groupDebts`, never beside it. */
export function planDebts(readings: PlanReadings, today: string): PlanDebt[];
```

Rules (spec §5–§6): active rows come from `groupDebts({ …, sheet: null }, today).groups[].rows` (cards with `minor === 0` dropped); paid-off loans from `.cleared`; paid-off people from `people.settled` with `direction === 'borrowed'`. Loans read their `LoanPlanFact` (no fact → `hasTerms` from `loans`, `rateBps: null` when no terms). Late loan items name `"<name> · <n>/<tenor>"`, earlier-month ones carry detail `"<Mon> instalment"`. The engine input per kind is spec §7.1: loans through `payoffDebtFromSchedule` (startMonth = `monthOf(today)`), converted to base with `convertMinor` at `ratesToBase` (balance, minimums, fixed interest, regular); cards: month-0 minimum = left − `installmentSplit` unbilled sum of that card's plans, later months from `installmentSchedule(plan, statementDay)` billed amounts, `regularMinor` = Σ `monthlyMinor` of the card's running plans; people: lump in the month of the earliest open `dueOn` (overdue → 0); payables: no minimums. `payoff: null` when the currency has no rate.

- [ ] **Step 1: Write the failing tests.**
  - `pay-target.test.ts`: each builder returns the exact object above (e.g. `loanPay('L1')` → `{ to: '/net-worth/loans/$accountId', params: { accountId: 'L1' }, search: { pay: 'due' } }`).
  - `plan-inputs.test.ts` with hand-built readings (no db): a late paylater fact (instalment 4/6 late 3 days) → `{ late: true, daysLate: 3, next: { title: 'Kredit · 4/6', status: 'late', pay: loanPay(id) } }`; a loan with no terms → `{ rateBps: null, hasTerms: false, next: null, payoff.ratesBps: null }`; a card with `billedMinor 6_214_300, leftToPayMinor 6_214_300, dueOn '2026-11-18'` → `{ repaidMinor: 0, next.detail: 'Statement · 18 Nov', payoff.minimumsMinor[0]: 6_214_300, payoff.ratesBps: [0] }`; a card owing nothing is absent; a person with `originalMinor 1_000_000`, total `850_000`, due `2026-12-03` → `{ borrowedMinor: 1_000_000, repaidMinor: 150_000, payoff.minimumsMinor: [0, 850_000] }`; a person with no due date → `payoff.minimumsMinor: []`; a USD loan with no USD rate → `{ leftBase: null, missing: 'USD', payoff: null }`; a USD loan at 16.250 → `leftBase === convertMinor(…)`; a paid-off loan → `{ paidOff: true, leftMinor: 0, borrowedMinor: originalMinor, paidOffMonth: '2026-09' }`; a settled person debt → `paidOff: true`; a receivable never appears; every row satisfies `borrowedMinor === leftMinor + repaidMinor`.
- [ ] **Step 2: Run, expect FAIL** — `cd apps/web && npx vitest run src/features/debt-plan/`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**; `npx vitest run src/features/networth/debt-rows.test.ts` unchanged.
- [ ] **Step 5: Commit** — `git commit -m "Plan rows read every debt off the Liabilities reading, with each one's next payment and its engine input"`.

---

### Task 5: Web — what the plan screens say

**Files:**
- Create: `apps/web/src/features/debt-plan/plan-view.ts`
- Test: `apps/web/src/features/debt-plan/plan-view.test.ts`

**Interfaces:**

```ts
export interface PlanSummary {
  leftMinor: number | null; borrowedMinor: number | null; repaidMinor: number | null;
  percent: number;                       // repaidPercent(borrowed, left)
  missing: string[];                     // currencies with no rate, sorted
  counts: { active: number; late: number; paidOff: number };
  debtFree: { month: string | null; why: string | null };   // "August 2028" | null, and the reason line
  payNext: { debt: PlanDebt; item: PlanItem; when: string } | null;
}
export function planSummary(debts: readonly PlanDebt[], baseline: PayoffPlan | null, today: string): PlanSummary;
/** "3 days late", "1 day late", "due today", "due tomorrow", "due 18 Nov". */
export function whenWords(item: Pick<PlanItem, 'status' | 'daysLate' | 'dueOn'>, today: string): string;
/** "August 2028": the month written out with its year. */
export function longMonth(month: string): string;
/** "No terms on Dollar car loan yet" | "Payments never clear Dewi" | "No USD rate yet". */
export function unknownWords(plan: PayoffPlan | null, debts: readonly PlanDebt[], missing: readonly string[]): string | null;
export function suggestionWords(s: MethodSuggestion | null, debts: readonly PlanDebt[]): string | null;
export function methodLabel(method: PayoffMethod): 'Snowball' | 'Avalanche' | 'By hand';
/** The saved method, else the suggestion's, else Avalanche. */
export function methodOf(saved: DebtPlanSettings | null, suggestion: MethodSuggestion | null): PayoffMethod;
export interface PayFirstRow { debt: PlanDebt; place: number | null /* null = late "!" */; subtitle: string; amountMinor: number | null; lateTag: string | null; pay: PayTarget | null; extraTag: string | null }
export function payFirstRows(debts: readonly PlanDebt[], order: readonly string[], extraMinor: number, baseCurrency: string): PayFirstRow[];
/** "Goes to Kredit, then rolls to Akulaku" | "Goes to Kredit" | null. */
export function rollsWords(order: readonly string[], debts: readonly PlanDebt[]): string | null;
/** The late count the Account row, the sidebar and the corner read: "1 late" | undefined. */
export function lateNote(count: number): string | undefined;
```

Rules: spec §4.0, §4.1, §6.6–§6.8, §8. `payNext` = the late item with the most days late, else the soonest-due unpaid item, ties by plan order; bills never. Pay-first subtitles: loan `"<rateTextPer> · left <formatMinor>"` (the online loan's per comes from `loanRatePer(items[accountId])`, already on `PlanDebt.ratePer`), `"No terms yet"`; card `"Statement due 18 Nov"` / `"Nothing billed"`; person `"Due 3 Dec"` / `"No fixed months"`. Suggestion words exactly as spec §8 with each rate in its loan's wording via `rateTextPer`.

- [ ] **Step 1: Failing tests** — real strings: `whenWords({status:'late',daysLate:3,…})` → `'3 days late'`, `daysLate 1` → `'1 day late'`, due today → `'due today'`, tomorrow → `'due tomorrow'`, `'2026-11-18'` from `'2026-11-11'` → `'due 18 Nov'`; `longMonth('2028-08')` → `'August 2028'`; `planSummary` over the Task 4 fixture set: `counts` `{ active: 4, late: 1, paidOff: 1 }`, `percent` = `repaidPercent(borrowed, left)`, `payNext.item.title === 'Kredit · 4/6'` and `when === '3 days late'`; a USD debt with no rate → `leftMinor: null, missing: ['USD']`; `unknownWords` for `{ reason: 'noRate', keys: ['L2'] }` → `'No terms on Dollar car loan yet'`; `suggestionWords({ method: 'avalanche', reason: 'ratesDiffer', highestKey, lowestKey })` → `'Suggested: Avalanche. Rates are known for every debt and differ a lot (2,95% a month vs 7,5% a year).'`; manySmall 3 → `'Suggested: Snowball. 3 small debts: clearing them first shortens the list quickly.'`; `methodOf(null, null)` → `'avalanche'`, `methodOf(null, {method:'snowball',…})` → `'snowball'`, a saved `byHand` wins; `payFirstRows` puts the late debt first with `place: null` and `lateTag: '3 days late'`, numbers the rest 1, 2, …, gives the first in line `extraTag: '+ extra Rp 500.000'` only when it is a loan and extra > 0; `rollsWords` → `'Goes to Kredit, then rolls to BCA Visa'`; `lateNote(0)` → `undefined`, `lateNote(2)` → `'2 late'`. Add one test that greps every exported string-producing function's output for `/\byou(r)?\b/i` and expects none.
- [ ] **Step 2: Run, expect FAIL.** - [ ] **Step 3: Implement.** - [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Plan words: the header's figures, Pay next, the suggestion and the Pay first rows"`.

---

### Task 6: Pay params on the four existing pay flows (parallel with Tasks 1–2)

**Files:**
- Modify: `apps/web/src/app/router.tsx` — `validateSearch` on `/net-worth/loans/$accountId` (`{ pay?: 'due' | 'extra' }`), on `/net-worth/lend-borrow/loan/$accountId` (`{ repay?: true }`), on `/bills/$billId` (`fromSearch` widened to a new `billSearch` returning `{ from?: 'cashflow'; pay?: true }`), and `CardSearch` on `/cards/$cardId` gains `pay?: true` (the `tab` redirect is untouched).
- Modify: `apps/web/src/features/loans/LoanDetailPage.tsx` — read `pay` from search; on first render with `pay === 'due'` (and terms loaded) set `opened = 'pay'`, `'extra'` → `'extra'`; when the sheet was opened from the param, `close()` calls `router.history.back()` instead of only clearing state.
- Modify: `apps/web/src/features/cards/CardHero.tsx` (or `CardDetailPage.tsx`, wherever `paying` is owned — it is `CardHero` line 206) — same pattern with `pay`.
- Modify: `apps/web/src/features/bills/BillPage.tsx` — same with `pay` → `setPaying(true)`.
- Modify: `apps/web/src/features/debts/LoanPage.tsx` — same with `repay` → `setRepaying(true)`.
- Create: `apps/web/src/lib/open-once.ts` — `useOpenFromSearch(flag: boolean, open: () => void, ready: boolean): { fromSearch: boolean; done: () => void }`: calls `open` once when `flag && ready`, remembers it, and `done()` goes back in history when it did (else no-op). One hook for all four pages.
- Test: `apps/web/src/lib/open-once.test.ts` (unit, with `renderHook` as other `lib` hook tests do, or a pure helper `shouldOpen(flag, ready, opened)` if the repo's tests avoid React rendering); `apps/web/e2e/phone-pay-params.spec.ts` (new).

- [ ] **Step 1: Failing e2e** `phone-pay-params.spec.ts`: open a bank account and a paylater (`openLoan(page, { kind: 'Online loan or paylater', name: 'Kredit', owed: '6000000', lender: 'Kredit', months: '6' })`); then (the plan page is not built yet) visit `/net-worth/loans` first so there is a page to go back to, and `await page.goto('/net-worth/loans/<id>?pay=due')` (read the id from the Liabilities row link's `href`) → expect `page.getByRole('button', { name: 'Save payment' })` visible; Cancel → expect URL `/net-worth/loans` (went back). `?pay=extra` → the Pay extra sheet's confirm button visible. A plain `/net-worth/loans/<id>` → no sheet (`Save payment` count 0). Same three checks for a card (`/cards/<id>?pay=1` → sheet titled `Pay BCA Visa`), a bill (`/bills/<id>?pay=1` → the bill's pay sheet), and a Lend & borrow loan (`/net-worth/lend-borrow/loan/<id>?repay=1` → the repayment form).
- [ ] **Step 2: Run, expect FAIL** — `cd apps/web && npx playwright test --project=phone e2e/phone-pay-params.spec.ts`.
- [ ] **Step 3: Implement** with `useOpenFromSearch`. No other behaviour on those pages changes.
- [ ] **Step 4: Run, expect PASS**, plus `e2e/phone-loan-actions.spec.ts`, `e2e/phone-recurring-bills.spec.ts`, `e2e/loans.spec.ts`, `e2e/card-statements.spec.ts` (chromium) still green.
- [ ] **Step 5: Commit** — `git commit -m "Loan, card, bill and Lend & borrow pages open their own pay sheet from a link, and go back after it"`.

---

### Task 7: Web — plan queries

**Files:**
- Create: `apps/web/src/features/debt-plan/queries.ts`
- Test: `apps/web/src/features/debt-plan/plan-model.test.ts` for the pure `planModel` the hook calls (the hook itself is exercised by e2e).

**Interfaces:**

```ts
export function useLoanPlanFacts(today?: string): UseQueryResult<LoanPlanFact[]>;      // ['loan-plan-facts', ws.workspaceId, today]
export function useDebtMovements(accountIds: readonly string[], range?: { from?: string; to?: string }): UseQueryResult<DebtMovement[]>;
export function useDebtPlanSettings(): UseQueryResult<DebtPlanSettings | null>;        // ['debt-plan-settings', ws.workspaceId]
/** Saves and invalidates through useInvalidateAll; errors come back to the caller. */
export function useSaveDebtPlanSettings(): (next: DebtPlanSettings) => Promise<void>;
export interface DebtPlanModel {
  debts: PlanDebt[];
  method: PayoffMethod;
  suggestion: MethodSuggestion | null;
  /** The chosen order with no extra (the header's month, spec §7.5). */
  baseline: PayoffPlan;
  /** With the saved extra. */
  effect: ExtraEffect;
  summary: PlanSummary;
  extraMinor: number;          // in base, after conversion of the saved figure
  extraMissing: string | null; // the saved extra's currency when it has no rate
}
/** Pure: readings + settings → everything the screens draw. */
export function planModel(readings: PlanReadings, settings: DebtPlanSettings | null, today: string): DebtPlanModel;
export function useDebtPlan(): { model: DebtPlanModel | null; error: unknown; isPending: boolean };
/** The late count for the Account row, sidebar and corners; 0 until read. */
export function useLateDebtCount(): number;
/** Whether any debt exists, active or paid off — for the Net worth corner (spec §4.6). */
export function useHasDebts(): boolean;
```

`useDebtPlan` gathers exactly what `DebtsPage` gathers (`useAccounts`, `useBalances`, `useLoans`, `useLoanItems`, `usePeopleDebts`, `useCardFacts` for live credit cards, `useHeldRates` over liability and people currencies) plus `useLoanPlanFacts`, `useInstallments()`, `useDebtMovements(liability ids)` and `useDebtPlanSettings`, and calls `planModel`.

- [ ] **Step 1: Failing test** `plan-model.test.ts`: with the Task 4 fixture readings and `settings = null` the method is the suggestion's; with `{ method: 'byHand', order: [...] }` the effect's `plan.order` follows it (late first); with `extraMinor: 500_000, extraCurrency: 'IDR'` the `effect.plan.months` is not more than `baseline.months`; with `extraCurrency: 'USD'` and no USD rate → `extraMinor: 0, extraMissing: 'USD'`; `summary.debtFree.month` comes from `baseline` (no extra).
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Plan queries: one model from the Liabilities readings, the loans' standing and the saved settings"`.

---

### Task 8: Plan page (phone) and the plan routes

**Files:**
- Create: `apps/web/src/features/debt-plan/DebtPlanPage.tsx`, `apps/web/src/features/debt-plan/PlanHeader.tsx`
- Create: `apps/web/src/features/debt-plan/PayFirstPage.tsx` — a placeholder exporting `PayFirstPage` that renders `PushedTitle title="Pay first"`; Task 9 fills it.
- Modify: `apps/web/src/app/router.tsx` — routes `/net-worth/plan` (`validateSearch: { tab?: 'plan' | 'schedule' | 'report' }`, only `plan` honoured in drop 1) and `/net-worth/plan/pay-first`, placed before `/net-worth/loans`.
- Move (if needed): `ProgressRing` from `features/cards/CardBack.tsx` to `apps/web/src/ui/native/ProgressRing.tsx` and export it from the kit index; `CardBack.tsx` imports it from there (no visual change).

Page per spec §4.0: `PushedTitle title="Debt-free plan" back="Net worth" backTo="/net-worth"`; `PlanHeader` (testids: `plan-ring` with `aria-label="NN% repaid"`, `plan-left`, `plan-repaid`, `plan-debt-free`, `plan-debt-free-why`, `plan-count-active|late|paid-off`, `plan-pay-next`); `InsetGroup` with the `Pay first` row (`value={methodLabel(model.method)}`, `to="/net-worth/plan/pay-first"`). Pay next is a `Link` built from the item's `PayTarget`. Missing-rate total uses the `No USD rate yet` wording. Empty state per §4.0.

- [ ] **Step 1: Failing e2e** — add to a new `apps/web/e2e/phone-debt-plan.spec.ts` the first test (Task 12 extends the file): pin the clock (`page.clock.setSystemTime(new Date('2026-11-11T12:00:00'))`), seed with the helper `seedPlan(page)` from a new `apps/web/e2e/debt-plan.ts` (a bank account; KPR via the debt picker, Home mortgage, owed 28.400.000, lender BCA, rate 7,5, months 120; BCA Visa with billing date 31 / due date 18 and a purchase of 6.214.300 dated 2026-10-20; Dewi borrowed 850.000 via Affiliate debt). Assert at `/net-worth/plan`: heading `Debt-free plan`; `plan-left` → `Rp 35.464.300`; counts `3 active`, `0 late`, `0 paid off`; `Pay first` row value `Snowball` or `Avalanche` per the suggestion (here rates 7,5% only → one interest-charging debt → no ratesDiffer; 2 of 3 debts ≤ 10% → not manySmall; all known → **no suggestion → Avalanche**) → expect `Avalanche`; `plan-pay-next` text contains `BCA Visa` and `due 18 Nov`.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS** (`--project=phone e2e/phone-debt-plan.spec.ts`).
- [ ] **Step 5: Commit** — `git commit -m "Debt-free plan page: ring, left to pay, debt-free month, counts and Pay next"`.

---

### Task 9: Pay first page and By hand order

**Files:**
- Modify: `apps/web/src/features/debt-plan/PayFirstPage.tsx`
- Create: `apps/web/src/features/debt-plan/ByHandList.tsx`, `apps/web/src/features/debt-plan/extra-field.ts` (+ `extra-field.test.ts`)

**Interfaces:**

```ts
// extra-field.ts — typed text ↔ minor units in the base currency, reusing groupTypedAmount / parseGroupedMajor
export function extraFromTyped(typed: string, currency: string): number;   // '' → 0; throws on a bad figure
export function typedFromExtra(minor: number, currency: string): string;  // 0 → ''
```

Page per spec §4.1: `SegmentedControl` (`Snowball`/`Avalanche`/`By hand`, `label="Order"`) saving `{ ...settings, method }`; method lines; suggestion panel (`data-testid="plan-suggestion"`); Extra group (`TextRow label="Extra a month" prefix={base} placeholder="Amount" inputMode="decimal"`, saved on blur and on Enter; subtitle `rollsWords`); `Debt-free` row (`data-testid="plan-extra-debt-free"`: `longMonth(plan)` + quiet `not <monthYearLabel(baseline)>` when they differ); `Interest saved` row (`data-testid="plan-interest-saved"`) only when `effect.interestSavedMinor > 0`. Numbered list rows `data-testid="pay-first-row"`, badge `!`/number, red `lateTag`, amount, `Pay` link (`aria-label="Pay <name>"`); `extraTag` links to `loanPay(id, 'extra')`. By hand: `ByHandList` reuses `DayReorder`, `reorderAttrs`, `movedBy` and the visually-hidden `Move up`/`Move down` buttons exactly as `WalletReorderPage`; every move saves `{ method: 'byHand', order }` where `order` is the non-late keys; late rows render above without a handle.

- [ ] **Step 1: Failing tests** — `extra-field.test.ts`: `extraFromTyped('500.000','IDR')` → `500_000`, `''` → `0`, `'abc'` throws `'The amount must be a number'`, `typedFromExtra(500_000,'IDR')` → `'500.000'`, `typedFromExtra(0,'IDR')` → `''`; `typedFromExtra(1_250, 'USD')` → `'12,50'`. E2E (append to `phone-debt-plan.spec.ts`): see Task 12's Pay first tests — write them now and expect FAIL.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Pay first: order, suggestion, extra a month with its debt-free month and interest saved, and an order by hand"`.

---

### Task 10: Ways in — Net worth corner, Liabilities corner, Account row, sidebar

**Files:**
- Modify: `apps/web/src/features/networth/OverviewPage.tsx` — between Trade and Financial health: `...(hasDebts ? [{ key: 'plan', label: 'Debt-free plan', glyph: <Target size={18} aria-hidden />, to: '/net-worth/plan' as const }] : [])` (`useHasDebts()`); `max={3}` unchanged.
- Modify: `apps/web/src/features/loans/DebtsPage.tsx` — **only** `actions` gains `{ key: 'plan', label: 'Debt-free plan', glyph: <Target size={20} aria-hidden />, to: '/net-worth/plan' }` before `add`, and `Target` joins the `lucide-react` import.
- Modify: `apps/web/src/app/nav.ts` — Money group: `{ to: '/net-worth/plan', label: 'Debt-free plan', icon: Target }` after Goals. `REACHABLE` picks it up by itself.
- Modify: `apps/web/src/features/account/AccountMenuPage.tsx` — `note('/net-worth/plan')` → `lateNote(useLateDebtCount())`, drawn red (`<span className="text-[var(--ph-alarm)]">`).
- Modify: `apps/web/src/app/Layout.tsx` — after the `Net worth` NAV link, a `PlanLink` (like `ReviewLink`): indented (`pl-6`), `Debt-free plan`, red pill `N late` when > 0.

- [ ] **Step 1: Failing e2e** (in `phone-debt-plan.spec.ts`): after `seedPlan`, `/net-worth` corner link `Debt-free plan` visible and opens `/net-worth/plan`; `/net-worth/loans` corner link `Debt-free plan` visible and `Add a debt` still there; `/account` row `^Debt-free plan` visible. On a fresh app `/net-worth` has **no** `Debt-free plan` link. Chromium (new `apps/web/e2e/debt-plan.spec.ts`): the sidebar's `Debt-free plan` link sits right after `Net worth` and opens the page.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS**, plus the existing `e2e/phone.spec.ts` (reachability picks up the new row), `e2e/phone-debts-page.spec.ts`, `e2e/debts-page.spec.ts`, `e2e/net-worth.spec.ts` green.
- [ ] **Step 5: Check** `git diff main -- apps/web/src/features/loans/DebtsPage.tsx` shows the import and the one action only.
- [ ] **Step 6: Commit** — `git commit -m "Debt-free plan opens from Net worth's and Liabilities' corners, Account → Money and the sidebar, with the late count"`.

---

### Task 11: Wide screens — the plan beside the numbered list

**Files:**
- Modify: `apps/web/src/features/debt-plan/DebtPlanPage.tsx` — `usePhone()` false → two-column layout per spec §4.5 (no tabs yet).
- Create: `apps/web/src/features/debt-plan/PlanTable.tsx` — the numbered list as a table (`#`, `Debt`, `Rate`, `Progress`, `Left`, Pay), built on the kit's `RecordTable` if it fits, otherwise a plain `<table>` with the kit's tokens; rows carry `data-testid="plan-table-row"`.
- Reuse: `PlanHeader`, the method `SegmentedControl` and the Extra field from Task 9 (extract them to `PlanControls.tsx` if Task 9 left them inline).

- [ ] **Step 1: Failing e2e** (chromium, `debt-plan.spec.ts`): at 1280 wide, `/net-worth/plan` shows the header, a `radiogroup` named `Order`, the `Extra a month` field and a table whose header cells read `#`, `Debt`, `Rate`, `Progress`, `Left`; rows in plan order; typing an extra updates `plan-extra-debt-free`.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Wide screens show the plan beside its numbered list"`.

---

### Task 12: Drop 1 e2e — phone and desktop journeys

**Files:**
- Modify: `apps/web/e2e/phone-debt-plan.spec.ts`, `apps/web/e2e/debt-plan.spec.ts`, `apps/web/e2e/debt-plan.ts` (helpers: `seedPlan`, `seedLatePaylater`, `planRows(page)` returning the pay-first rows' names in order).

`seedLatePaylater(page)`: `page.clock.setSystemTime(new Date('2026-10-01T12:00:00'))`; a bank account `BCA Tahapan` (balance 50.000.000); `openLoan` kind `Online loan or paylater`, name `Kredit`, owed `6000000`, lender `Kredit`, `Interest a month` `2`, months `6` (first payment 2026-11-01); then `page.clock.setSystemTime(new Date('2026-11-04T12:00:00'))`.

Tests (phone; each pins its clock first):
- [ ] **Late on top, Pay next pays it**: `seedLatePaylater` + Dewi 850.000 (Affiliate debt). `/net-worth/plan`: `plan-count-late` → `1 late`; `plan-pay-next` → `Pay next · Kredit` and `3 days late`; Account row reads `Debt-free plan` with `1 late`. Pay first: the first `pay-first-row` has `!` and `3 days late`. Tap `plan-pay-next` → URL `/net-worth/loans/…?pay=due`, `Save payment` visible; Save → back on `/net-worth/plan`; `plan-count-late` → `0 late`.
- [ ] **Extra a month**: `seedLatePaylater`. `plan-debt-free` → `April 2027`. Pay first: type `3000000` into `Extra a month`, press Enter → `plan-extra-debt-free` contains `December 2026` and `not Apr 2027`; `plan-interest-saved` digits > 0. Reload → the field still shows `3.000.000` (kept in the database). Back to the plan: header still `April 2027` (the header has no extra, spec §7.5).
- [ ] **Order and suggestion**: `seedPlan` + a paylater `Akulaku` (owed 2.105.700, `Interest a month` 2,5, 6 months) → rates 30%/yr vs 7,5%/yr known → suggestion `Suggested: Avalanche.` with `2,5% a month vs 7,5% a year`. Choose `Snowball` → rows in order `Dewi`, `Akulaku`, `BCA Visa`, `KPR BCA`; reload → still Snowball; `Avalanche` → `Akulaku`, `KPR BCA`, `Dewi`, `BCA Visa` (0% ones last, smaller first).
- [ ] **By hand**: choose `By hand`; focus the hidden `Move down` on the first row and press it → first two swap; reload → kept; the plan page's `Pay first` row value reads `By hand`.
- [ ] **No terms → unknown**: `openAccount(page, { subtype: 'loan', name: 'Dollar car loan', currency: 'USD', balance: '1000.00', rate: '16250' })` (no months → no terms) → `plan-debt-free` `Unknown`, `plan-debt-free-why` `No terms on Dollar car loan yet`; the row has no Pay button.
- [ ] **Corners and Account row** (Task 10's assertions live here too).
- [ ] Desktop (`debt-plan.spec.ts`): sidebar link; wide layout table (Task 11); Pay from the table opens the loan's sheet.
- [ ] Run: `cd apps/web && npx playwright test --project=phone e2e/phone-debt-plan.spec.ts e2e/phone-pay-params.spec.ts e2e/phone.spec.ts e2e/phone-debts-page.spec.ts` and `npx playwright test --project=chromium e2e/debt-plan.spec.ts e2e/debts-page.spec.ts e2e/net-worth.spec.ts e2e/loans.spec.ts`. All green (known failures excepted).
- [ ] `npm test` and `npm run typecheck` green (known failure excepted).
- [ ] **Commit** — `git commit -m "Drop 1 journeys: late on top, Pay next, extra a month, order by hand, unknown debt-free month"`. **Drop 1 ships here** (TestFlight per `reference-testflight-upload`, if the owner asks).

---

# Drop 2

### Task 13: DB — the bills of any month

**Files:**
- Modify: `packages/db/src/repos/expense-templates.ts` — add `billsInMonth` beside `monthlyBills`, built from the private `listExpenseTemplates`, `billFacts`, `monthOfBill`; no change to existing functions.
- Test: `packages/db/test/bills-in-month.test.ts` (new).

```ts
export interface BillMonthRow extends BillHistoryRow {
  bill: ExpenseTemplateRow;
  /** The fixed amount, else what it came to the last time it was paid. */
  estimateMinor: number | null;
}
/** Every active bill owed in `month` (its repeat, on or after its first month), where that month stands on `today`. Skipped and paused months are included with their state. */
export async function billsInMonth(database: Database, ws: WorkspaceContext, month: string, today: string): Promise<BillMonthRow[]>;
```

- [ ] **Step 1: Failing test** — a monthly bill (out day 20, pay by 25) started 2026-09 paid for October: `billsInMonth(…, '2026-10', '2026-11-11')` → one row, `state: 'paid'`; `'2026-11'` → `state: 'open'` (or `dueSoon` on the 22nd), `window.payBy: '2026-11-25'`; `'2026-08'` → `[]` (before it started); a yearly bill (month 3) is absent from `'2026-11'`; a skipped month → `state: 'skipped'`; a bill in another book is absent when `ws.bookId` names this book.
- [ ] **Step 2–4:** FAIL → implement → PASS; `test/bill-payments.test.ts`, `test/bill-pauses.test.ts` unchanged.
- [ ] **Step 5: Commit** — `git commit -m "DB reads the bills owed in any month and where each stands"`.

### Task 14: Web — the month model (Schedule, Report, the Cashflow row)

**Files:**
- Modify: `apps/web/src/features/cards/statement-dates.ts` — add `cycleDueIn`; test in `statement-dates.test.ts` (existing file, new cases).
- Create: `apps/web/src/features/debt-plan/schedule-view.ts`, `schedule-view.test.ts`

```ts
// statement-dates.ts
/** The statement whose due day falls in `month`, or null (spec §6.4). */
export function cycleDueIn(month: string, statementDay: number, dueDay: number): Cycle | null;

// schedule-view.ts
export interface CardMonth { cardId: string; name: string; currency: string; dueOn: string; statement: CardStatement }
export interface MonthInput {
  month: string; today: string;
  debts: readonly PlanDebt[];
  loanFacts: readonly LoanPlanFact[];
  cards: readonly CardMonth[];
  bills: readonly BillMonthRow[];        // already in the read currency (billsInReadCurrency applied by the hook)
  billCurrency: string;
  show: { loans: boolean; cards: boolean; bills: boolean };
  baseCurrency: string; ratesToBase: Readonly<Record<string, number>>;
}
export function monthItems(input: MonthInput): PlanItem[];
export function monthSections(items: readonly PlanItem[], month: string, today: string): { late: PlanItem[]; comingUp: PlanItem[]; paid: PlanItem[] };
export function monthTotals(items: readonly PlanItem[], month: string): { dueMinor: number; paidMinor: number; lateMinor: number; missing: string[] };
/** "5 due this month": unpaid items due in the current month, bills included. */
export function dueThisMonthCount(items: readonly PlanItem[], month: string): number;
export interface DueRowModel { item: PlanItem; title: string; subtitle: string; tone: 'alarm' | 'warn'; rest: number }
/** The Cashflow row: instalments, statements and bills late or due within BILL_DUE_SOON_DAYS; null when none (spec §4.6). */
export function dueRow(items: readonly PlanItem[], today: string): DueRowModel | null;
```

Rules: spec §4.2, §6.4, §6.9, §4.6. Loan items for past/current months from `fact.instalments` (paid at `paidMinor`, else expected amount per §6.2); future months from `fact.schedule` rows (`upcoming`, number from months since `firstPaymentOn` + 1); the current month's `late` section also takes late instalments of earlier months. Card item: `cycleDueIn` → amount `statement.closingMinor`, paid when `leftToPayMinor <= 0`, late when `dueOn < today` and left > 0; a statement not yet closed shows `so far` (`approximate: true`); a statement that billed nothing (`closingMinor <= 0`) is not an item. Bills: `payBy` as due day, `overdue` → late, `paid` → paid (paidOn from the row), `skipped`/`paused` dropped; pay target `billPay(bill.id)`. Person items: `dueOn` in month.

- [ ] **Step 1: Failing tests** — `cycleDueIn('2026-11', 31, 18)` → `{ start: '2026-10-01', end: '2026-10-31' }`; `cycleDueIn('2026-11', 20, 5)` → the cycle ending `2026-10-20` (due 5 Nov); a month with no due day in it (statement 28, due 28 of the same month… design one) → null. `monthItems` on a fixture with a late paylater (4/6, due 1 Nov), a card due 18 Nov (billed 6.214.300, unpaid), an Electricity bill pay-by 20 Nov (780.000, open), a mortgage instalment paid 1 Nov from a bank message: sections → late `[Kredit · 4/6]`, coming up `[BCA Visa, Electricity]`, paid `[KPR BCA · 63/120]` with `fromMessage: true`; totals → `{ dueMinor: 1_071_155 + 6_214_300 + 780_000 + 2_480_000, paidMinor: 2_480_000, lateMinor: 1_071_155 }`; `show.bills: false` drops Electricity from items and totals; October unpaid paylater instalment appears in November's late section with detail `Oct instalment` but not in November's `dueMinor`; `dueThisMonthCount` → 3; `dueRow(itemsOn('2026-11-16'), '2026-11-16')` → `{ title: 'Kredit instalment', subtitle: '15 days late · +1 due in 2 days', tone: 'alarm' }` (BCA Visa on the 18th is within 3 days, Electricity on the 20th is not); `dueRow(itemsOn('2026-11-17'), '2026-11-17')` → subtitle `16 days late · +2 more`; with the paylater paid and on `2026-11-17`: `{ title: 'BCA Visa statement', subtitle: 'Due tomorrow · +1 due in 3 days', tone: 'warn' }`; nothing late and nothing within 3 days → `null`. A card statement that billed nothing is not an item.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `git commit -m "The plan's month: instalments, statements and bills with their due, paid and late totals"`.

### Task 15: Web — month queries

**Files:** Modify `apps/web/src/features/debt-plan/queries.ts`.

```ts
/** Each live card's statement due in each month asked, read through cardStatement (the card page's reader). */
export function useCardMonths(months: readonly string[]): UseQueryResult<Record<string, CardMonth[]>>;
export function useBillsInMonth(month: string): UseQueryResult<BillMonthRow[]>;  // key includes ws.bookId; current month reads monthlyBills' rows mapped to the same shape
export function usePlanMonth(month: string, show?: MonthInput['show']): { items: PlanItem[] | null; error: unknown };
export function usePlanMonths(months: readonly string[]): { byMonth: Record<string, PlanItem[]> | null; error: unknown }; // debts only, for the Report
export function useDueRow(): DueRowModel | null;
```

- [ ] Steps: no new pure logic (the model is Task 14's); verify with `npm run typecheck` and the e2e in Task 18. Commit — `git commit -m "Month queries for the Schedule, the Report and the Cashflow row"`.

### Task 16: Schedule page, its row and the wide Schedule tab

**Files:**
- Create: `apps/web/src/features/debt-plan/SchedulePanel.tsx` (tiles, sections, rows — shared by phone page and wide tab), `apps/web/src/features/debt-plan/SchedulePage.tsx`
- Modify: `router.tsx` — `/net-worth/plan/schedule` with `validateSearch: { month?: string }` (YYYY-MM only).
- Modify: `DebtPlanPage.tsx` — `Schedule` row (`value="N due this month"`), and on wide screens the `Plan | Schedule` `SegmentedControl` (`?tab=schedule`).

Spec §4.2. Tiles testids `schedule-due|paid|late`; sections `schedule-late|coming-up|paid`; rows `schedule-row` with `Pay` link `aria-label="Pay <title>"`; month stepper buttons `Previous month`/`Next month`; ⋯ menu with three switches.

- [ ] **Step 1: Failing e2e** (Task 18's schedule tests, written now). **Step 2–4.** **Step 5: Commit** — `git commit -m "Schedule: a month of instalments, statements and bills, with Pay on every row"`.

### Task 17: Cashflow due row

**Files:**
- Create: `apps/web/src/features/debt-plan/DueRow.tsx` — drawn like `NotRecorded`/`Recurring` (`flex w-full items-center gap-3 py-3`, round icon, two lines, figure, chevron), `data-testid="due-row"`, a `Link` to the item's `PayTarget`.
- Modify: `apps/web/src/features/transactions/WaitingBox.tsx` — `<DueRow />` first, above `<Recurring />`. Nothing else in the box changes.

- [ ] **Step 1: Failing e2e** (Task 18). **Step 2–4.** **Step 5: Commit** — `git commit -m "Cashflow shows what is late or due within three days, one tap from paying it"`.

### Task 18: Drop 2 e2e

**Files:** Create `apps/web/e2e/phone-debt-plan-schedule.spec.ts`; extend `apps/web/e2e/debt-plan.ts` with `seedMonth(page)`: clock 2026-10-01 → bank account, `seedLatePaylater`'s Kredit; a card `BCA Visa` with billing date 31 / due date 14 and a 6.214.300 purchase on 2026-10-20; clock 2026-11-11 → a monthly bill `Electricity` 780.000 out day 10, pay by 12 (`/bills/new`, as `phone-recurring-bills.spec.ts`'s `addBill`).

- [ ] **Schedule**: `/net-worth/plan/schedule` → heading `Schedule`, month `Nov 2026`; `schedule-late` holds `Kredit · 1/6` with `10 days late`; `schedule-coming-up` holds `Electricity` (`Tomorrow`) and `BCA Visa` (`14 Nov`); tiles: `schedule-late` → `Rp 1.071.155`; Pay on Electricity → `/bills/…?pay=1`, the bill's sheet; save → back on the Schedule, Electricity now under `Paid` with `Paid 11 Nov`, `schedule-paid` tile → `Rp 780.000`. `Previous month` → `Oct 2026`, nothing late. ⋯ → switch off `Bills` → Electricity gone and the Paid tile `Rp 0`.
- [ ] **Plan row**: `/net-worth/plan` row `Schedule` value `2 due this month` (after paying the bill: Kredit + BCA Visa).
- [ ] **Cashflow row**: `/transactions` → `due-row` reads `Kredit instalment` and `10 days late · +2 more` (before paying the bill); tap → `/net-worth/loans/…?pay=due` with `Save payment`. After paying Kredit and the bill, and with BCA Visa due in 3 days → `due-row` reads `BCA Visa statement` / `Due in 3 days`. Set the clock to 2026-11-01 with nothing late (a fresh seed without the paylater): `due-row` count 0.
- [ ] **Desktop** (`debt-plan.spec.ts`): the `Schedule` tab shows the same sections.
- [ ] Run the drop-2 specs plus `e2e/phone-recurring-bills.spec.ts`, `e2e/cashflow-controls.spec.ts`, `e2e/phone-cashflow-controls.spec.ts`; `npm test`; `npm run typecheck`.
- [ ] **Commit** — `git commit -m "Drop 2 journeys: Schedule month, Pay from a row, Cashflow due row"`. **Drop 2 ships here.**

---

# Drop 3

### Task 19: Web — All debts and Report models

**Files:** Create `apps/web/src/features/debt-plan/all-debts-view.ts`, `report-view.ts` and their tests.

```ts
// all-debts-view.ts
export type DebtFilter = 'all' | 'active' | 'late' | 'paidOff';
export type DebtSort = 'mostLeft' | 'leastLeft' | 'highestRate' | 'endsSoonest' | 'name';
export function chipCounts(debts: readonly PlanDebt[]): Record<DebtFilter, number>;
export function filterDebts(debts: readonly PlanDebt[], filter: DebtFilter): PlanDebt[];
export function sortDebts(debts: readonly PlanDebt[], sort: DebtSort): PlanDebt[];   // paid off always after active
/** "52% repaid · ends Aug 2028" | "Statement due 18 Nov" | "Lend & borrow · no fixed months" | "Late · 40% repaid · 3 of 6 paid". */
export function allDebtsSubtitle(debt: PlanDebt, today: string): string;
export function readSort(storage?: Pick<Storage, 'getItem'>): DebtSort;          // try/catch, default mostLeft
export function writeSort(sort: DebtSort, storage?: Pick<Storage, 'setItem'>): void;

// report-view.ts
export type ReportPeriod = 'month' | '3m' | 'year' | 'all';
export function periodMonths(period: ReportPeriod, today: string, earliest: string | null): string[];
export function reportFigures(movements: readonly DebtMovement[], debts: readonly PlanDebt[], months: readonly string[], baseCurrency: string, ratesToBase: Readonly<Record<string, number>>): { borrowedMinor: number | null; repaidMinor: number | null; interestMinor: number | null; leftMinor: number | null; missing: string[] };
export interface MonthBar { month: string; dueMinor: number; paidMinor: number; late: number; allPaid: boolean; soFar: boolean; nothingDue: boolean }
/** The month line's tag: "All paid" | "1 late" | "Nothing due" (a month with no item due). */
export function monthTag(bar: MonthBar): string;
export function monthBars(byMonth: Readonly<Record<string, readonly PlanItem[]>>, months: readonly string[], today: string): MonthBar[];  // 'all' passes the last 12
```

- [ ] **Step 1: Failing tests** — chips on the Task 4 fixture `{ all: 5, active: 4, late: 1, paidOff: 1 }`; `sortDebts(…, 'mostLeft')` order by `leftBase` desc with paid off last; `highestRate` puts unknown after known; `allDebtsSubtitle` for each kind (exact strings above); `readSort` with a throwing storage → `'mostLeft'`. `periodMonths('3m','2026-11-11',null)` → `['2026-09','2026-10','2026-11']`, `'year'` → Jan..Nov, `'all'` from `earliest`; `reportFigures` on movements (opening −6.000.000 on 2026-10-01, payment 951.155 with interest 120.000 on 2026-11-11, card spend −6.214.300 on 2026-10-20): `'month'` → borrowed 0, repaid 951.155, interest 120.000; `'all'` → borrowed 12.214.300, repaid 951.155, and `left === borrowed − repaid` (identity); a USD movement with no rate → nulls and `missing: ['USD']`; `monthBars` → the current month has `soFar: true`, a month with a late item `late: 1, allPaid: false` and `monthTag` `'1 late'`, a fully paid month `allPaid: true` / `'All paid'`, a month with no items `nothingDue: true, allPaid: false` / `'Nothing due'`.
- [ ] **Step 2–4.** **Step 5: Commit** — `git commit -m "All debts and Report models: chips, sorts, period figures and paid-against-due bars"`.

### Task 20: All debts page (sequential before Task 21)

**Files:** Create `apps/web/src/features/debt-plan/AllDebtsPage.tsx`; modify `router.tsx` (`/net-worth/plan/debts`), `DebtPlanPage.tsx` (`All debts` row with the count). Spec §4.3; chips as `role="radio"` buttons in a `radiogroup` named `Show`; sort in a corner menu `Sort: <label>`; rows `data-testid="all-debts-row"` linking with the Liabilities `destination` rule (extract `destination` from `DebtsPage.tsx`? **No** — Liabilities must not change; write `debtLink(debt)` in `pay-target.ts` with the same three routes and a unit test).

- [ ] Failing e2e (Task 22) → implement → pass. Commit — `git commit -m "All debts: filter, sort, progress per debt and the ones paid off"`.

### Task 21: Report page and the wide Report tab

**Files:** Create `apps/web/src/features/debt-plan/ReportPanel.tsx`, `ReportPage.tsx`; modify `router.tsx` (`/net-worth/plan/report`, `validateSearch: { period?: ReportPeriod }`), `DebtPlanPage.tsx` (`Report` row; wide control becomes `Plan | Schedule | Report`). Bars drawn with plain SVG/divs in the kit's tokens (grey `--ph-fill` due, green `--ph-up` paid), legend `Due` / `Paid`; month lines testid `report-month`. Load the `dataviz` skill before drawing the bars.

- [ ] Failing e2e (Task 22) → implement → pass. Commit — `git commit -m "Report: borrowed, repaid, left and interest for a period, with paid against due by month"`.

### Task 22: Drop 3 e2e and final checks

**Files:** Create `apps/web/e2e/phone-debt-plan-report.spec.ts`; extend `debt-plan.spec.ts`.

- [ ] **Seed** (`seedReport` in `debt-plan.ts`): `seedMonth`, plus — with the clock on 2026-10-05 — a 0% `Personal loan` `Bank kecil` owed 500.000, lender `Bank`, months 1, paid off on 2026-10-06 from its page's `Pay off`; then clock 2026-11-11 and pay Kredit's 1/6 from the plan's Pay next (prefilled principal 951.155, interest 120.000).
- [ ] **All debts**: `/net-worth/plan/debts`: chips `All 3`, `Active 2`, `Late 0`, `Paid off 1`; default sort `Most left` → `BCA Visa` (6.214.300) then `Kredit` (5.048.845); `Paid off` chip → only `Bank kecil` with `Paid off` and `Oct 2026`; sort `Name` → `BCA Visa`, `Kredit` (paid off still last); reload → sort kept.
- [ ] **Report**: `/net-worth/plan/report` `This month` → `Borrowed` `Rp 0`, `Repaid` `Rp 951.155`, `Interest paid` `Rp 120.000`, `Left` = `plan-left` (`Rp 11.263.145`); `All` → `Borrowed` `Rp 12.714.300` (6.000.000 + 6.214.300 + 500.000), `Repaid` `Rp 1.451.155`, and Borrowed − Repaid = Left; November's `report-month` line reads `so far`; October's reads `Nothing due`.
- [ ] **Desktop**: the three tabs switch without leaving `/net-worth/plan`; `?tab=report` deep-links.
- [ ] Full checks: `npm test`; `npm run typecheck`; `cd apps/web && npx playwright test --project=phone e2e/phone-debt-plan*.spec.ts e2e/phone-pay-params.spec.ts e2e/phone.spec.ts e2e/phone-debts-page.spec.ts e2e/phone-loan-actions.spec.ts e2e/phone-recurring-bills.spec.ts` and `--project=chromium e2e/debt-plan.spec.ts e2e/debts-page.spec.ts e2e/net-worth.spec.ts e2e/loans.spec.ts e2e/card-statements.spec.ts`. Known failures excepted.
- [ ] Copy grep over the branch: `git diff main --unified=0 -- apps/web/src | grep '^+' | grep -niE "\byou(r|rs)?\b"` → nothing in user-facing strings.
- [ ] `git diff main -- apps/web/src/features/loans/DebtsPage.tsx` → only Task 10's lines.
- [ ] **Commit** — `git commit -m "Drop 3 journeys: All debts and Report"`. **Drop 3 ships here.** State plainly in the hand-off which reviews were skipped (fast track).
