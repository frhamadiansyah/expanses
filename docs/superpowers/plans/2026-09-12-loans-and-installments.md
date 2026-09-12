# Loans and Installments (Slice 5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Format:** fast track, as chosen by the owner. Each task gives files, exact interfaces, and the named test cases that must be written first and fail before implementation. Code is written during execution, not in this document.

**Goal:** Make a loan behave like a loan — a schedule you can read a year ahead, a payment form filled in from the next row, a rate change that does not rewrite history, an extra payment that shows what it saves — and give a credit card's installment purchases (cicilan) their own billed and unbilled halves, so the balance sheet, the debt-servicing ratio and the points engine all stop guessing.

**Architecture:** `packages/core` gains a pure `loans` module: an amortisation schedule built from a balance and its rate periods, the effect of an extra payment, flat-to-effective conversion, and the billed/unbilled split of a card installment. `packages/db` gains migration `0011_loans` with `loan_terms`, `loan_rate_periods` and `card_installments`, the payment and rate-change writers, and the next-12-months figure the balance sheet needs. `apps/web` gains the Loans tab, a payment form prefilled from the schedule, installments under each card, and the two numbers that change on screens already built.

**Tech Stack:** unchanged (TypeScript 7, Vitest 5, Drizzle sqlite-proxy, better-sqlite3 in tests, Vite 8, React 19, TanStack Router/Query, Tailwind 4, Playwright). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-net-worth-coretax-goals-design.md` §8, with §3.1 for the balance sheet split.

## Global Constraints

- Money stays 64-bit integer minor units; rates stay basis points. No floats in stored values.
- Posting convention: **+ is a debit, − is a credit**. Every transaction balances to zero in base currency.
- **The ledger is the truth, the schedule is a projection.** A schedule is computed from the balance the ledger holds today, never stored and never reconciled against; recorded payments are what happened. A projected row is only ever a suggestion for a form.
- The last payment clears whatever remains, so rounding never leaves a few rupiah owing.
- Interest is spending. Principal is money put away. Both already flow through `periodFlows`; this slice must not double-count either.
- A card installment purchase is spending **once**, on the day it happened. The card balance carries the debt after that; the monthly bill is not a second expense.
- Every message names the thing and the amount in the owner's words: "This pays off in Mar 2041, 14 months earlier", never "success".
- Every task ends green on `npm test` and `npm run typecheck` at the repo root; web tasks also run `npm run e2e`.
- Commits end with the project trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## What earlier slices already settled, and what they left half-wired

- `periodFlows` already counts loan principal and its interest as a debt payment, and already accepts `homeLoanAccountIds` to keep a mortgage out of the non-mortgage ratio — **but nothing in production passes it**, so today every loan counts as consumer debt. Task 6 wires it from `loan_terms`.
- `sheetInputsAt` hardcodes `dueWithinYearMinor: subtype === 'loan' ? 0 : balanceMinor`, so a loan currently sits entirely under Long-term. Task 6 replaces the 0 with the next twelve months of principal.
- `computeCycleEarn` already refuses to earn on a line marked `cardFee` and tallies it separately (`packages/core/src/points/earn.ts:122`, `:221`). An installment purchase that earns nothing reuses that flag rather than inventing a second one.
- `BALANCE_SUBTYPES.liability` already allows `loan`, and the Accounts page already creates one. No account work.

## File Structure

```
packages/core/src/loans/schedule.ts     loanSchedule, ScheduleRow, RatePeriod, LoanTerms
packages/core/src/loans/effects.ts      extraPaymentEffect, flatToEffectiveBps, payoffMismatch
packages/core/src/loans/installments.ts installmentSplit, CardInstallment
packages/core/src/index.ts              + the loans exports
packages/core/test/loans-schedule.test.ts  loans-effects.test.ts  loans-installments.test.ts

packages/db/migrations/0011_loans.sql
packages/db/src/migrations.ts           + version 11
packages/db/src/schema-loans.ts         loanTerms, loanRatePeriods, cardInstallments
packages/db/src/repos/loans.ts          saveLoanTerms, loanFor, listLoans, recordLoanPayment,
                                        addRatePeriod, recordExtraPayment, scheduleFor
packages/db/src/repos/installments.ts   saveInstallment, listInstallments, installmentTotals
packages/db/src/repos/asset-values.ts   dueWithinYearMinor from the schedule
packages/db/src/repos/flows.ts          home loans read from loan_terms; billed installments
packages/db/src/index.ts                + both repos and the schema
packages/db/test/loans.test.ts  loans-payments.test.ts  installments.test.ts  loans-sheet.test.ts

apps/web/src/features/loans/
  loan-form.ts        pure: terms draft → save input, payment draft → payment input
  LoansPage.tsx       the Loans tab: totals, the list
  LoanDetailPage.tsx  one loan: figures, next 12 rows, the three actions
  PaymentForm.tsx     prefilled from the next scheduled row
  RateChangeForm.tsx  a new rate period
  ExtraPaymentForm.tsx  extra principal, and the what-if beside it
  InstallmentList.tsx card installments, billed and unbilled
  queries.ts          useLoans, useSchedule, useInstallments
  loan-form.test.ts
apps/web/src/features/networth/NetWorthTabs.tsx   + the Loans tab
apps/web/src/features/networth/overview-rows.ts   payment due, fixed rate ending, last installment
apps/web/src/features/cards/CardDetailPage.tsx    installments under the card
apps/web/src/app/router.tsx                       + /net-worth/loans, /net-worth/loans/$accountId
apps/web/e2e/loans.spec.ts
```

---

### Task 1: Core — the amortisation schedule

**Files:** Create `packages/core/src/loans/schedule.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/loans-schedule.test.ts`.

**Interfaces — Produces:**
```ts
export type LoanMethod = 'annuity' | 'flat' | 'zero';

export interface RatePeriod {
  /** First month this rate applies, as YYYY-MM-DD. */
  fromOn: string;
  rateBps: number;
  kind: 'fixed' | 'floating';
  /** The payment the bank asks for under this rate. 0 means "work it out". */
  paymentMinor: number;
}

export interface LoanTerms {
  originalMinor: number;
  firstPaymentOn: string;
  tenorMonths: number;
  method: LoanMethod;
  /** Day of the month the payment is taken, 1 to 28. */
  paymentDay: number;
}

export interface ScheduleRow {
  /** The date this payment falls due. */
  onDate: string;
  paymentMinor: number;
  principalMinor: number;
  interestMinor: number;
  /** What is still owed after this payment. */
  balanceMinor: number;
}

/**
 * The payments still to come, starting from the balance the ledger holds on `fromDate`.
 * Annuity charges interest on the balance; flat charges it on the original; zero has none.
 * The last row clears whatever is left, so rounding never leaves a few rupiah owing.
 */
export function loanSchedule(balanceMinor: number, terms: LoanTerms, periods: RatePeriod[], fromDate: string): ScheduleRow[];

/** The level payment an annuity needs to clear a balance over this many months at this rate. */
export function annuityPaymentMinor(balanceMinor: number, rateBps: number, months: number): number;
```

- [x] Tests (fail first, `loans-schedule.test.ts`): `an annuity charges interest on what is left, and the balance falls faster each month`; `an annuity clears exactly at the end of its tenor`; `a flat loan charges the same interest every month, on the original`; `a zero-rate loan is principal only`; `the last row clears the remainder, so the balance ends at zero`; `a rate period starting mid-loan changes the payment from that month`; `a floating rate keeps the payment and changes the split when the bank says so`; `the schedule starts from the ledger balance, not the original amount`; `a balance of zero has no rows`; `every row balances: payment is principal plus interest`; `payments fall on the payment day, and February is not skipped`.
- [x] Implement, export from `packages/core/src/index.ts`; run `npm test -w @expanses/core` and `npm run typecheck`; commit `feat(core): amortisation schedules for annuity, flat and zero loans`.

---

### Task 2: Core — what an extra payment does, and flat versus effective

**Files:** Create `packages/core/src/loans/effects.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/loans-effects.test.ts`.

**Interfaces — Consumes:** `loanSchedule`, `ScheduleRow`, `LoanTerms`, `RatePeriod` from Task 1.

**Interfaces — Produces:**
```ts
export interface ExtraPayment {
  amountMinor: number;
  onDate: string;
  /** Once, or the same amount every month from that date. */
  repeat: 'once' | 'monthly';
  /** Keep paying the same and finish sooner, or pay less for the same tenor. */
  keep: 'payment' | 'tenor';
  /** What the bank charges for paying early, as a share of the amount. */
  penaltyBps?: number;
}

export interface ExtraPaymentEffect {
  interestSavedMinor: number;
  monthsEarlier: number;
  /** The new payment when the tenor is kept instead of shortened. */
  newPaymentMinor: number | null;
  /** The month it now finishes, as YYYY-MM. */
  payoffMonth: string;
  penaltyMinor: number;
}

export function extraPaymentEffect(
  balanceMinor: number,
  terms: LoanTerms,
  periods: RatePeriod[],
  fromDate: string,
  extra: ExtraPayment,
): ExtraPaymentEffect;

/** A flat rate quoted by an Indonesian lender, as the effective rate it really is. */
export function flatToEffectiveBps(flatBps: number, tenorMonths: number): number;

/** Months between where the terms say the loan ends and where the schedule says it does. */
export function payoffMismatchMonths(schedule: ScheduleRow[], terms: LoanTerms): number;
/** Warn the owner when onboarding figures disagree by more than this. §8.2. */
export const PAYOFF_TOLERANCE_MONTHS = 2;
```

- [x] Tests (fail first, `loans-effects.test.ts`): `paying extra once shortens the loan and says how much interest it saves`; `paying extra every month shortens it further`; `keeping the tenor lowers the payment instead, and reports the new one`; `a penalty is reported apart from the interest saved`; `an extra payment larger than the balance clears it and saves the rest`; `an extra payment of nothing changes nothing`; `a flat 5% over 36 months is about 9,5% effective`; `flat and effective agree at a single month`; `a payoff two months past the tenor end is within tolerance, three is not`.
- [x] Implement, export; run `npm test -w @expanses/core` and `npm run typecheck`; commit `feat(core): extra payments, what-if and flat-to-effective rates`.

---

### Task 3: Core — a card installment, billed and unbilled

**Files:** Create `packages/core/src/loans/installments.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/loans-installments.test.ts`.

**Interfaces — Produces:**
```ts
export interface CardInstallment {
  totalMinor: number;
  months: number;
  monthlyMinor: number;
  /** First month it appears on a statement, as YYYY-MM. */
  firstBilledMonth: string;
  rateBps: number;
  conversionFeeMinor: number;
  /** Many issuers pay no points on a converted purchase. */
  earnsPoints: boolean;
}

export interface InstallmentSplit {
  billedMinor: number;
  unbilledMinor: number;
  /** The part falling due more than twelve months out, which is long-term on the balance sheet. */
  unbilledBeyond12Minor: number;
  monthsLeft: number;
  /** The month the last instalment is billed, as YYYY-MM. */
  lastMonth: string;
}

/** Where one installment stands on a date: what has been billed, what has not, and what is far off. */
export function installmentSplit(installment: CardInstallment, onDate: string): InstallmentSplit;
```

- [x] Tests (fail first, `loans-installments.test.ts`): `nothing is billed before the first month`; `three months in, three instalments are billed and the rest are not`; `the last instalment leaves nothing unbilled`; `a 24-month plan puts everything past month twelve in the beyond-12 figure`; `a 6-month plan has nothing beyond twelve months`; `the monthly amounts add back to the total`; `the last month is named`; `months left never falls below zero`.
- [x] Implement, export; run `npm test -w @expanses/core` and `npm run typecheck`; commit `feat(core): card installments split into billed and unbilled`.

---

### Task 4: DB — migration `0011_loans` and the terms

**Files:** Create `packages/db/migrations/0011_loans.sql`, `packages/db/src/schema-loans.ts`, `packages/db/src/repos/loans.ts` (terms half only); modify `packages/db/src/migrations.ts`, `packages/db/src/index.ts`, `packages/db/test/database.test.ts`; test `packages/db/test/loans.test.ts`.

**Interfaces — Produces:**
```ts
export interface LoanTermsRow {
  accountId: string;
  workspaceId: string;
  lenderName: string;
  lenderNpwp: string | null;
  purpose: string | null;
  originalMinor: number;
  firstPaymentOn: string;
  tenorMonths: number;
  method: LoanMethod;
  paymentDay: number;
  /** The house or car this loan bought, when it bought one. */
  assetAccountId: string | null;
  /** `101` by default; the Coretax utang code. */
  coretaxCode: string;
  status: 'open' | 'paid_off';
  statusOn: string | null;
  /** True when this loan bought a property, so it leaves the non-mortgage ratio alone. */
  isHomeLoan: boolean;
  periods: RatePeriodRow[];
}
export interface RatePeriodRow { id: string; accountId: string; fromOn: string; rateBps: number; kind: 'fixed' | 'floating'; paymentMinor: number }

export interface SaveLoanTermsInput {
  accountId: string; lenderName: string; lenderNpwp?: string | null; purpose?: string | null;
  originalMinor: number; firstPaymentOn: string; tenorMonths: number; method: LoanMethod; paymentDay: number;
  assetAccountId?: string | null; coretaxCode?: string;
  /** The rate it starts on. Later changes go through `addRatePeriod`. */
  rateBps: number; paymentMinor?: number; rateKind?: 'fixed' | 'floating';
}
export async function saveLoanTerms(database: Database, ws: WorkspaceContext, input: SaveLoanTermsInput): Promise<void>;
export async function loanFor(database: Database, ws: WorkspaceContext, accountId: string): Promise<LoanTermsRow | undefined>;
export async function listLoans(database: Database, ws: WorkspaceContext): Promise<LoanTermsRow[]>;
export async function homeLoanAccountIds(database: Database, ws: WorkspaceContext): Promise<string[]>;
export class LoanDbError extends Error {}
```

The migration, registered as `{ version: 11, name: 'loans', sql: loans }`:

```sql
CREATE TABLE loan_terms (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL,
  lender_name TEXT NOT NULL,
  lender_npwp TEXT,
  purpose TEXT,
  original_minor INTEGER NOT NULL,
  first_payment_on TEXT NOT NULL,
  tenor_months INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('annuity', 'flat', 'zero')),
  payment_day INTEGER NOT NULL,
  asset_account_id TEXT REFERENCES accounts(id),
  coretax_code TEXT NOT NULL DEFAULT '101',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid_off')),
  status_on TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE loan_rate_periods (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  workspace_id TEXT NOT NULL,
  from_on TEXT NOT NULL,
  rate_bps INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fixed', 'floating')),
  payment_minor INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX loan_rate_periods_account ON loan_rate_periods (account_id, from_on);
CREATE TABLE card_installments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  card_account_id TEXT NOT NULL REFERENCES accounts(id),
  transaction_id TEXT REFERENCES transactions(id),
  description TEXT NOT NULL,
  total_minor INTEGER NOT NULL,
  months INTEGER NOT NULL,
  monthly_minor INTEGER NOT NULL,
  first_billed_month TEXT NOT NULL,
  rate_bps INTEGER NOT NULL DEFAULT 0,
  conversion_fee_minor INTEGER NOT NULL DEFAULT 0,
  earns_points INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX card_installments_card ON card_installments (workspace_id, card_account_id);
```

`isHomeLoan` is derived, not stored: true when `asset_account_id` names an account whose subtype is `property`. The idempotency test in `database.test.ts` expects `[1..11]`.

- [x] Tests (fail first, `loans.test.ts`): `the migration adds all three tables and a v10 database still opens`; `saving terms keeps the lender and the tenor`; `saving terms writes the first rate period`; `saving again updates in place and keeps the periods`; `terms refuse an account that is not a loan`; `terms refuse a tenor of zero or a payment day outside 1 to 28`; `a loan against a property is a home loan`; `a loan against a vehicle is not`; `homeLoanAccountIds lists only the property-backed ones`.
- [x] Implement; run `npm test -w @expanses/db` and `npm run typecheck`; commit `feat(db): migration 0011, loan terms and rate periods`.

---

### Task 5: DB — payments, rate changes and extra principal

**Files:** Modify `packages/db/src/repos/loans.ts`; test `packages/db/test/loans-payments.test.ts`.

**Interfaces — Consumes:** Task 1's `loanSchedule`, Task 2's `extraPaymentEffect`, Task 4's rows.

**Interfaces — Produces:**
```ts
export interface LoanPaymentInput {
  accountId: string; occurredOn: string; moneyAccountId: string;
  principalMinor: number; interestMinor: number;
  /** Admin charges or insurance riding on the same payment, by category. */
  extras?: { categoryId: string; amountMinor: number }[];
  ratesToBase?: Record<string, number>;
}
export interface ExtraPaymentDbInput {
  accountId: string; occurredOn: string; moneyAccountId: string;
  amountMinor: number; penaltyMinor?: number;
  /** Shorten the tenor and keep paying the same, or keep the tenor and lower the payment. */
  keep: 'payment' | 'tenor';
  ratesToBase?: Record<string, number>;
}
export interface AddRatePeriodInput { accountId: string; fromOn: string; rateBps: number; kind: 'fixed' | 'floating'; paymentMinor?: number }

/** Posts one instalment: the bank is paid, the loan falls by the principal, interest is spending. */
export async function recordLoanPayment(database: Database, ws: WorkspaceContext, input: LoanPaymentInput): Promise<{ transactionId: string; balanceMinor: number; status: 'open' | 'paid_off' }>;
/** A rate change writes a period and posts nothing: no money moved. */
export async function addRatePeriod(database: Database, ws: WorkspaceContext, input: AddRatePeriodInput): Promise<string>;
export async function recordExtraPayment(database: Database, ws: WorkspaceContext, input: ExtraPaymentDbInput): Promise<{ transactionId: string; balanceMinor: number; newPaymentMinor: number | null }>;
/** The schedule for one loan, computed from the balance the ledger holds on that date. */
export async function scheduleFor(database: Database, ws: WorkspaceContext, accountId: string, fromDate: string): Promise<ScheduleRow[]>;
/** The row the payment form fills itself in from. */
export async function nextPaymentDue(database: Database, ws: WorkspaceContext, accountId: string, fromDate: string): Promise<ScheduleRow | undefined>;
```

Rules the tests pin: a payment beyond the balance is refused, naming the loan and what is left; a payment that clears the balance writes `status = 'paid_off'` with its date; extra principal with `keep: 'tenor'` adds a rate period carrying the lower payment, and with `keep: 'payment'` adds none; a penalty is a fee, never principal.

- [x] Tests (fail first, `loans-payments.test.ts`): `a payment lowers the loan and charges interest to Interest`; `extras on the same payment reach their own categories`; `a payment that clears the loan marks it paid off with its date`; `a payment beyond what is left is refused and nothing is written`; `the schedule after a payment starts from the new balance`; `nextPaymentDue names the date, the payment and the split`; `a rate change writes a period and posts no transaction`; `a rate change from next month leaves this month's schedule alone`; `extra principal keeping the payment shortens the loan`; `extra principal keeping the tenor writes a period with the lower payment`; `a penalty is charged as a fee, not as principal`; `periodFlows counts the payment as a debt payment once`.
- [x] Implement; run `npm test -w @expanses/db` and `npm run typecheck`; commit `feat(db): loan payments, rate changes and extra principal`.

---

### Task 6: DB — installments, and the two numbers that were waiting

**Files:** Create `packages/db/src/repos/installments.ts`; modify `packages/db/src/repos/asset-values.ts`, `packages/db/src/repos/flows.ts`, `packages/db/src/repos/points.ts`, `packages/db/src/index.ts`; test `packages/db/test/installments.test.ts`, `packages/db/test/loans-sheet.test.ts`.

**Interfaces — Consumes:** Task 3's `installmentSplit`, Task 4's `homeLoanAccountIds`, Task 5's `scheduleFor`.

**Interfaces — Produces:**
```ts
export interface CardInstallmentRow extends CardInstallment { id: string; cardAccountId: string; transactionId: string | null; description: string; createdAt: string }
export interface SaveInstallmentInput {
  cardAccountId: string; description: string; totalMinor: number; months: number;
  firstBilledMonth: string; transactionId?: string | null;
  rateBps?: number; conversionFeeMinor?: number; earnsPoints?: boolean;
}
export async function saveInstallment(database: Database, ws: WorkspaceContext, input: SaveInstallmentInput): Promise<string>;
export async function listInstallments(database: Database, ws: WorkspaceContext, cardAccountId?: string): Promise<CardInstallmentRow[]>;
export async function deleteInstallment(database: Database, ws: WorkspaceContext, id: string): Promise<void>;
/** Billed, unbilled, and the part beyond twelve months, added up per card on a date. */
export async function installmentTotals(database: Database, ws: WorkspaceContext, onDate: string): Promise<Record<string, InstallmentSplit>>;
```

Three changes to code already shipped, each pinned by a test:

1. `sheetInputsAt` replaces `dueWithinYearMinor: subtype === 'loan' ? 0 : balanceMinor` with the next twelve months of principal from `scheduleFor`, falling back to the whole balance when a loan has no terms yet. A card's unbilled instalments beyond twelve months move from short-term to long-term.
2. `periodFlows` reads `homeLoanAccountIds` from `loan_terms` when the caller passes none, so a mortgage stops counting as consumer debt, and adds the month's **billed** installment amounts to `debtPaymentsMinor`.
3. `cardSpendLines` marks a purchase converted to an installment with `earns_points = 0` as `cardFee: true`, which is the flag `computeCycleEarn` already refuses to earn on.

- [x] Tests (fail first, `installments.test.ts`): `saving an installment works out the monthly amount`; `the monthly amounts add back to the total`; `a plan linked to its purchase keeps the link`; `totals per card split billed from unbilled`; `deleting a plan leaves the purchase alone`; `a purchase converted with no points stops earning them`; `a purchase that keeps its points still earns`.
- [x] Tests (fail first, `loans-sheet.test.ts`): `a loan puts only the next twelve months of principal under Due within a year`; `a loan with no terms yet falls back to the whole balance`; `instalments beyond twelve months sit under Long-term`; `a mortgage stays out of the non-mortgage debt ratio`; `a car loan stays in it`; `billed instalments count as debt payments`; `an unbilled instalment counts as nothing yet`.
- [x] Implement; run `npm test -w @expanses/db` and `npm run typecheck`; commit `feat(db): card installments, and loans reaching the sheet and the ratios`.

---

### Task 7: Web — the Loans tab and its detail page

**Files:** Create `apps/web/src/features/loans/loan-form.ts`, `LoansPage.tsx`, `LoanDetailPage.tsx`, `PaymentForm.tsx`, `RateChangeForm.tsx`, `ExtraPaymentForm.tsx`, `queries.ts`, `loan-form.test.ts`; modify `apps/web/src/app/router.tsx`, `apps/web/src/features/networth/NetWorthTabs.tsx`.

**Interfaces — Produces:**
```ts
export interface LoanTermsDraft {
  accountId: string; lenderName: string; purpose: string; originalAmount: string;
  firstPaymentOn: string; tenorMonths: string; method: LoanMethod; paymentDay: string;
  rate: string; payment: string; rateKind: 'fixed' | 'floating'; assetAccountId: string; lenderNpwp: string;
}
export const emptyLoanTermsDraft: (accountId: string, today: string) => LoanTermsDraft;
export function loanTermsDraftToInput(draft: LoanTermsDraft, currency: string): SaveLoanTermsInput;

export interface PaymentDraft { occurredOn: string; moneyId: string; principal: string; interest: string; extras: { categoryId: string; amount: string }[] }
/** Fills the form in from the row the schedule says is next. */
export function paymentDraftFrom(row: ScheduleRow | undefined, today: string, moneyId: string, currency: string): PaymentDraft;
export function paymentDraftToInput(draft: PaymentDraft, accountId: string, currency: string, balanceMinor: number, lenderName: string): LoanPaymentInput;
```

Screens per §8.3: the Loans tab shows what the instalments come to each month and what is left in total, then each loan with its progress, rate and next payment. The detail page shows still owed, the payment, the next date, interest still to pay, the payoff month, months left, principal repaid, and the next twelve rows expandable — with Record payment, Rate change and Extra payment, the what-if shown before anything is written, and a note giving the effective rate whenever a flat rate is in use.

- [x] Tests (fail first, `loan-form.test.ts`): `reads amounts and a rate typed the Indonesian way`; `a flat loan keeps its quoted rate and notes the effective one`; `refuses a tenor of zero`; `refuses a payment day of 29`; `refuses a first payment in the future beyond the tenor`; `the payment form fills itself in from the next scheduled row`; `an empty schedule leaves the form blank rather than guessing`; `refuses a payment beyond what is left, naming the loan`; `extras with no category are dropped`.
- [x] Implement; run `npm test -w @expanses/web` and `npm run typecheck`; commit `feat(web): the Loans tab, payments, rate changes and what-if`.

---

### Task 8: Web — installments on the cards, the warnings, and end to end

**Files:** Create `apps/web/src/features/loans/InstallmentList.tsx`, `apps/web/e2e/loans.spec.ts`; modify `apps/web/src/features/cards/CardDetailPage.tsx`, `apps/web/src/features/networth/overview-rows.ts`, `overview-rows.test.ts`, `apps/web/src/features/loans/LoanDetailPage.tsx`.

**Interfaces — Consumes:** everything above. `attentionItems` gains a sixth kind of row:

```ts
export function attentionItems(
  values: AssetValueRow[], dueTemplates: TradeTemplateRow[], goalPlans?: GoalPlanRow[],
  idleCash?: IdleCashRow[], people?: PersonDebtRow[], loans?: LoanAttention[],
): AttentionItem[];
export interface LoanAttention {
  accountId: string; lenderName: string; currency: string;
  /** A payment due within seven days with nothing recorded for it. */
  paymentDueMinor: number | null; paymentDueOn: string | null;
  /** A fixed rate ending within sixty days. */
  fixedRateEndsOn: string | null;
  /** An installment plan whose last instalment is billed this month. */
  lastInstallmentOf: string | null;
}
```

Installments appear under each card on the card detail page and under the loan detail page, each showing billed against unbilled and the month it ends. §8.3's equity line is shown on the house or car the loan bought: its value, what is still owed, and the difference.

- [x] Tests (fail first, `overview-rows.test.ts`): `a payment due in three days is listed with the lender and the amount`; `a payment due in three weeks says nothing`; `a fixed rate ending in 40 days is listed`; `a fixed rate ending in a year says nothing`; `an installment finishing this month is listed`; `a loan already paid off says nothing`.
- [x] E2E (`apps/web/e2e/loans.spec.ts`, fail first): `onboard an existing KPR by its outstanding balance and terms, and read the next twelve rows`; `record the payment the form filled in, and watch the balance fall`; `a rate change moves the payment without posting anything`; `an extra payment shows what it saves before it is written`; `the balance sheet splits the loan into this year and later`; `interest shows as spending and principal does not`; `convert a card purchase into instalments: billed and unbilled, and the points stop`.
- [x] Implement; run `npm test`, `npm run typecheck`, `npm run e2e`; commit `feat(web): card installments, loan warnings and equity`.
- [x] Record execution notes at the end of this plan; commit `docs: record slice 5 execution status`.

---

## Self-review

**Spec coverage (§8):** all three tables and the corrected migration number (Task 4); `loanSchedule` with annuity, flat and zero, and rate periods (Task 1); `extraPaymentEffect`, `flatToEffectiveBps` and the payoff-mismatch warning (Task 2); `installmentSplit` (Task 3); payment posting, extra principal both ways, rate change without a transaction (Task 5); onboarding an existing loan by outstanding balance plus terms (Tasks 4 and 7); the balance sheet's next-twelve-months split and instalments beyond twelve months, billed instalments in the debt ratio, and the points exclusion (Task 6); the Loans tab, detail page, what-if and the flat-to-effective note (Task 7); installments under each card, equity on the asset, and the three attention rows (Task 8).

**Deliberately left for later, as §8 allows:** a new loan that pays for an asset at the moment of purchase ("Paid with a loan" inside Add asset) is not built here — onboarding an existing loan covers the owner's actual case, and the asset link is stored either way, so it can be added without a migration.

**Two things this slice finishes that earlier slices left half-wired:** `homeLoanAccountIds` finally has a production caller, and `dueWithinYearMinor` stops being hardcoded to zero for loans. Both are named in Task 6 with their own tests, because a reviewer would otherwise read them as unrelated changes.

---

## Execution notes

All eight tasks are done on `feat/loans`. Gate on the finished tree: `npm test` green (catalog 52, core 340, db 328, web 166), `npm run typecheck` clean, `npm run e2e` 44 passed.

**One real bug, caught end to end:** the payment form prefilled the next scheduled row's date, which is in the future, and `paymentDraftToInput` refuses a future-dated payment — so the form as built could never be saved without the owner editing the date by hand. The split still comes from the schedule; the date is now today, since that is when the money moves. A row already past keeps its own date, so a late payment records truthfully. Two unit cases pin both halves.

**Three numbers earlier slices left half-wired, now finished** — each was named in Task 6 with its own test, because a reviewer would otherwise read them as unrelated changes:

1. `dueWithinYearMinor` was hardcoded to `0` for loans, putting every mortgage wholly under Long-term. It now takes the next twelve months of principal from the schedule, and falls back to the whole balance for a loan with no terms yet. A slice 2 test expected the old placeholder and was rewritten to pin the fallback.
2. `periodFlows` accepted `homeLoanAccountIds` but nothing in production passed it, so every loan counted as consumer debt. It now reads them from `loan_terms` when the caller names none, deciding by what the loan actually bought. A caller may still name them, and a test pins that too.
3. A card purchase converted to a plan that earns nothing is marked with the `cardFee` flag `computeCycleEarn` already refuses to earn on, rather than inventing a second exclusion.

**Deviations from the plan, and why:**

- *`annuityPaymentMinor` was added to the schedule module.* The plan named it in Task 1's interface, and Task 2 and the extra-payment writer both needed it, so it is exported rather than kept private.
- *The level payment wobbles by one rupiah.* An annuity recomputed against a rounded balance each month lands one minor unit apart in some months. Pinning a single exact figure would mean storing the payment and letting the final row absorb the drift; the test allows a one-unit spread instead, which is what "level" means here.
- *Loan attention rows live in `features/loans/attention.ts`.* The Overview has no notion of schedules or plans, so the seven-day, sixty-day and last-instalment windows sit beside the loans they describe, and `attentionItems` only prints what it is handed.

**Two things the schedule deliberately does not do:** it is never stored, and it never reconciles against the ledger. Recorded payments are the truth; a schedule is what the terms imply from today's balance, which is why onboarding a loan mid-life needs only the outstanding balance and the terms.

**Left for slice 6:** `coretax_code` on `loan_terms` is stored and read by nothing yet; the utang table is built in the Coretax slice from the balances open on 31 December.

**Not built, as §8 allows:** buying an asset with a new loan in one step ("Paid with a loan" inside Add asset). Onboarding an existing loan covers the owner's actual case, and the asset link is stored either way, so it can be added later without a migration.
