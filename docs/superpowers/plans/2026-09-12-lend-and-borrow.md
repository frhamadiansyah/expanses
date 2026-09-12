# Lend and Borrow (Slice 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Format:** fast track, as chosen by the owner. Each task gives files, exact interfaces, and the named test cases that must be written first and fail before implementation. Code is written during execution, not in this document.

**Goal:** Track money lent to a person and money borrowed from one — including a loan put on a credit card and a dinner bill split with friends — so both sides show on the balance sheet, the card still earns its points, and the open balances are ready for the Coretax piutang and utang tables.

**Architecture:** `packages/core` gains a pure `debts` module that builds the postings for each action and refuses a repayment larger than the balance. `packages/db` gains migration `0010_debts`, a `debt_profiles` table beside the existing `receivable` and `payable` accounts, the record-and-settle repository, and a per-person read model. `apps/web` gains the Lend & borrow tab, "Someone owes part of this" on the transaction form, and the due-date rows on the Overview's attention list.

**Tech Stack:** unchanged (TypeScript 7, Vitest 5, Drizzle sqlite-proxy, better-sqlite3 in tests, Vite 8, React 19, TanStack Router/Query, Tailwind 4, Playwright). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-net-worth-coretax-goals-design.md` §7, with §3.1 for the balance sheet groups.

## Global Constraints

- Money stays 64-bit integer minor units. No floats in stored values.
- Posting convention: **+ is a debit, − is a credit**. Every transaction balances to zero in base currency.
- The ledger is immutable: corrections void and replace, never update in place.
- A person's debt is an ordinary account: `receivable` (asset) or `payable` (liability). `debt_profiles` adds who and why beside it; it never holds a balance of its own.
- Lending is not spending. A loan leaves the balance sheet's cash and appears under "Owed to you" at the same value.
- A card-funded loan writes the purchase category and MCC on the **card line** via `entries.spend_category_id`. `cardSpendLines` already reads that column, so the points engine needs no change — do not touch `packages/db/src/repos/points.ts`.
- Receivables never fund goals. `goalLinksFor` only reaches unit-priced holdings and parkable cash, so this needs no code; a test pins it.
- Every message names the person and the amount, in the owner's words: "Andi owes Rp 9.000.000", never "insufficient balance".
- Every task ends green on `npm test` and `npm run typecheck` at the repo root; web tasks also run `npm run e2e`.
- Commits end with the project trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## What slice 3.5 already settled, so this slice does not repeat it

- `entries.spend_category_id` exists (migration `0009_buy_flow`) and `cardSpendLines` merges any card line carrying it.
- `BALANCE_SUBTYPES` already allows `receivable` and `payable`, and the Accounts page already offers both types.
- `balanceSheet` already places a `receivable` asset in the **Owed to you** group (`GROUP_BY_SUBTYPE` in `asset-values.ts`) and a `payable` under **Due within a year** (`sheetInputsAt` gives every non-loan liability `dueWithinYearMinor = balanceMinor`). No balance-sheet code changes; Task 4 pins both with a test.

## File Structure

```
packages/core/src/debts/postings.ts     pure builders for every action, DebtError
packages/core/src/debts/status.ts       balance → open | settled, and the due-date state
packages/core/src/index.ts              + the debts exports
packages/core/test/debts-postings.test.ts  debts-status.test.ts

packages/db/migrations/0010_debts.sql
packages/db/src/migrations.ts           + version 10
packages/db/src/schema-debts.ts         debtProfiles table
packages/db/src/repos/debts.ts          saveDebtProfile, listDebtProfiles, the record actions
packages/db/src/repos/people.ts         peopleDebts read model for the screen
packages/db/src/index.ts                + both repos and the schema
packages/db/test/debts.test.ts  debts-card.test.ts  people.test.ts

apps/web/src/features/debts/
  debts-form.ts        pure: draft → record input, split-bill arithmetic
  DebtsPage.tsx        the Lend & borrow tab: two columns, person cards
  PersonCard.tsx       one person: total, loans, progress, due pill, history, actions
  DebtForm.tsx         add a loan in either direction
  queries.ts           usePeopleDebts, useDebtProfiles
  debts-form.test.ts
apps/web/src/features/transactions/
  TransactionForm.tsx  "Someone owes part of this"
  TransactionsPage.tsx "Lent to …", "Repayment from …" labels
apps/web/src/features/networth/
  NetWorthTabs.tsx     + the Lend & borrow tab
  overview-rows.ts     due within 21 days, and overdue
apps/web/src/app/router.tsx  + /net-worth/debts
apps/web/e2e/lend-borrow.spec.ts
```

---

### Task 1: Core — the postings for every action

**Files:** Create `packages/core/src/debts/postings.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/debts-postings.test.ts`.

**Interfaces — Produces:**
```ts
export type DebtDirection = 'lent' | 'borrowed';
export type DebtErrorCode = 'AMOUNT_NOT_POSITIVE' | 'OVER_REPAYMENT' | 'CURRENCY_MISMATCH' | 'SPLIT_MISMATCH';
export class DebtError extends Error { code: DebtErrorCode }

export interface DebtAccounts {
  /** The receivable or payable account for this person. */
  debtAccountId: string;
  /** Bank, cash, or the credit card that funded it. */
  moneyAccountId: string;
  /** Interest received on money lent. Seeded key `income.other`. */
  otherIncomeAccountId: string;
  /** Interest paid on money borrowed. Seeded key `fees.interest`. */
  interestAccountId: string;
  /** Where a forgiven balance goes. Seeded key `gifts_donations`, or the owner's choice. */
  forgivenessAccountId: string;
}

export interface PostingLine { accountId: string; amountMinor: number; currency: string }

/** Money handed over: the person owes it, the money account is lighter. */
export function lendPostings(input: { amountMinor: number; currency: string }, accounts: DebtAccounts): PostingLine[];
/** Money received back, with optional interest as Other Income. */
export function repaymentPostings(input: { amountMinor: number; interestMinor: number; currency: string; balanceMinor: number; personName: string }, accounts: DebtAccounts): PostingLine[];
export function borrowPostings(input: { amountMinor: number; currency: string }, accounts: DebtAccounts): PostingLine[];
export function repayBorrowedPostings(input: { amountMinor: number; interestMinor: number; currency: string; balanceMinor: number; personName: string }, accounts: DebtAccounts): PostingLine[];
/** Writes off what is left: the receivable goes, the amount becomes a gift. */
export function forgivePostings(input: { balanceMinor: number; currency: string }, accounts: DebtAccounts): PostingLine[];

export interface SplitShare { debtAccountId: string; amountMinor: number }
/** A bill paid in full by one card, where others owe their share. */
export function splitBillPostings(
  input: { totalMinor: number; ownCategoryId: string; ownShareMinor: number; shares: SplitShare[]; currency: string },
  accounts: Pick<DebtAccounts, 'moneyAccountId'>,
): PostingLine[];

export function debtDescription(action: 'lend' | 'repayment' | 'borrow' | 'repay' | 'forgive', personName: string): string;
```

Rules the tests pin: a repayment above `balanceMinor` throws `OVER_REPAYMENT` with the message `` `${personName} owes ${formatMinor(balanceMinor, currency)}` ``; every builder throws `AMOUNT_NOT_POSITIVE` on zero or less; interest is a separate line, never folded into principal; `splitBillPostings` throws `SPLIT_MISMATCH` unless `ownShareMinor + shares total === totalMinor`.

- [ ] Tests (fail first, `debts-postings.test.ts`): `lending moves money from the bank to the person`; `a repayment clears principal and puts interest under Other Income`; `a repayment above the balance names the person and what they owe`; `borrowing raises the payable and the bank`; `repaying borrowed money charges interest to Interest, not to principal`; `forgiving what is left turns the balance into a gift`; `a split bill charges own share to the category and each friend to their own receivable`; `a split that does not add up to the total is refused`; `every builder balances to zero`; `zero or negative amounts are refused`.
- [ ] Implement `postings.ts`, export from `packages/core/src/index.ts`; run `npm test -w @expanses/core` and `npm run typecheck`; commit `feat(core): postings for lending, borrowing and splitting a bill`.

---

### Task 2: Core — status and the due-date state

**Files:** Create `packages/core/src/debts/status.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/debts-status.test.ts`.

**Interfaces — Produces:**
```ts
export type DebtStatus = 'open' | 'settled' | 'forgiven';
export type DueState = 'none' | 'due_soon' | 'overdue';
/** Warn this many days before the date agreed. §7.3. */
export const DUE_SOON_DAYS = 21;

/** A balance at zero or less is settled, whatever the profile last said; a forgiven debt stays forgiven. */
export function statusFor(balanceMinor: number, recorded: DebtStatus): DebtStatus;
export function dueStateFor(dueOn: string | null, onDate: string, status: DebtStatus): DueState;
/** "Due in 6 days", "11 days overdue", "Due 30 Nov 2026". Empty string when there is no date. */
export function dueLabel(dueOn: string | null, onDate: string, status: DebtStatus): string;
```

- [ ] Tests (fail first, `debts-status.test.ts`): `a balance at zero is settled`; `a forgiven debt stays forgiven even with a balance`; `a debt due in 6 days is due soon`; `a debt due in 30 days is neither`; `a debt past its date is overdue`; `a settled debt is never due`; `no date means no due state`; `the label counts days both ways`.
- [ ] Implement, export, run `npm test -w @expanses/core` and `npm run typecheck`; commit `feat(core): debt status and due dates`.

---

### Task 3: DB — migration `0010_debts` and the profile table

**Files:** Create `packages/db/migrations/0010_debts.sql`, `packages/db/src/schema-debts.ts`; modify `packages/db/src/migrations.ts`, `packages/db/src/index.ts`; create `packages/db/src/repos/debts.ts` (profile half only); test `packages/db/test/debts.test.ts`.

**Interfaces — Produces:**
```ts
export interface DebtProfileRow {
  accountId: string;
  workspaceId: string;
  direction: DebtDirection;      // derived from the account kind, stored for the read model
  personName: string;
  personIdNumber: string | null; // NIK or NPWP, optional
  reason: string | null;
  dueOn: string | null;
  status: DebtStatus;
  statusOn: string | null;
  /** Receivable 0201 default, 0202 related party; payable 109 default, 103 related party. */
  coretaxCode: string;
  createdAt: string;
}
export interface SaveDebtProfileInput { accountId: string; personName: string; personIdNumber?: string | null; reason?: string | null; dueOn?: string | null; coretaxCode?: string }
export async function saveDebtProfile(database: Database, ws: WorkspaceContext, input: SaveDebtProfileInput): Promise<void>;
export async function getDebtProfile(database: Database, ws: WorkspaceContext, accountId: string): Promise<DebtProfileRow | undefined>;
export async function listDebtProfiles(database: Database, ws: WorkspaceContext): Promise<DebtProfileRow[]>;
export class DebtDbError extends Error {}
```

The migration, matching the numbering already in `migrations.ts` (`{ version: 10, name: 'debts', sql: debts }`):

```sql
CREATE TABLE debt_profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL,
  person_name TEXT NOT NULL,
  person_id_number TEXT,
  reason TEXT,
  due_on TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'forgiven')),
  status_on TEXT,
  coretax_code TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX debt_profiles_workspace ON debt_profiles (workspace_id, person_name);
```

- [ ] Tests (fail first, `debts.test.ts`): `the migration adds the table and a v9 database still opens`; `saving a profile keeps the person and the reason`; `saving again updates in place`; `a profile refuses an account from another workspace`; `a profile refuses an account that is not a receivable or a payable`; `the default Coretax code follows the direction`.
- [ ] Implement; run `npm test -w @expanses/db` and `npm run typecheck`; commit `feat(db): migration 0010 and debt profiles`.

---

### Task 4: DB — recording every action, and settling on zero

**Files:** Modify `packages/db/src/repos/debts.ts`; test `packages/db/test/debts.test.ts`, create `packages/db/test/debts-card.test.ts`.

**Interfaces — Consumes:** Task 1's builders, Task 2's `statusFor`, Task 3's profile rows.

**Interfaces — Produces:**
```ts
export interface RecordLoanInput {
  /** Existing person account, or `person` to open one. */
  debtAccountId?: string;
  person?: { name: string; direction: DebtDirection; currency: string; personIdNumber?: string | null; reason?: string | null; dueOn?: string | null };
  occurredOn: string;
  amountMinor: number;
  moneyAccountId: string;
  /** Card purchases only: the category the loan would have had, and its MCC, so points still count. */
  spendCategoryId?: string | null;
  mcc?: string | null;
  ratesToBase?: Record<string, number>;
}
export interface RecordRepaymentInput { debtAccountId: string; occurredOn: string; amountMinor: number; interestMinor?: number; moneyAccountId: string; ratesToBase?: Record<string, number> }
export interface ForgiveInput { debtAccountId: string; occurredOn: string; categoryId?: string | null }

export async function recordLoan(database: Database, ws: WorkspaceContext, input: RecordLoanInput): Promise<{ transactionId: string; debtAccountId: string }>;
export async function recordRepayment(database: Database, ws: WorkspaceContext, input: RecordRepaymentInput): Promise<{ transactionId: string; balanceMinor: number; status: DebtStatus }>;
export async function forgiveRemainder(database: Database, ws: WorkspaceContext, input: ForgiveInput): Promise<{ transactionId: string }>;
export async function splitBill(database: Database, ws: WorkspaceContext, input: SplitBillInput): Promise<{ transactionId: string; debtAccountIds: string[] }>;
export interface SplitBillInput {
  occurredOn: string; description: string; totalMinor: number; moneyAccountId: string;
  ownCategoryId: string; ownShareMinor: number;
  shares: { debtAccountId?: string; person?: { name: string; currency: string }; amountMinor: number }[];
  spendCategoryId?: string | null; mcc?: string | null; ratesToBase?: Record<string, number>;
}
```

Rules the tests pin: `recordLoan` with `person` creates the account (subtype `receivable` for `lent`, `payable` for `borrowed`) and its profile in the same database transaction; a repayment that brings the balance to zero writes `status = 'settled'` with `status_on`; a later loan to a settled person reopens it; a repayment beyond the balance throws and writes nothing; a card-funded loan puts `spend_category_id` and the MCC on the card line and `cardSpendLines` returns it; a forgiven balance sets `status = 'forgiven'`.

- [ ] Tests (fail first, `debts.test.ts`): `lending opens the person account and moves the money`; `lending to a person already known reuses their account`; `a repayment lowers what is owed`; `a repayment to zero settles the debt with its date`; `lending again reopens a settled person`; `a repayment above the balance is refused and nothing is written`; `interest received lands in Other Income, not in principal`; `borrowing raises the payable`; `repaying borrowed money charges Interest`; `forgiving the rest empties the balance and marks it forgiven`; `a split bill charges own share and opens a receivable for each friend`; `receivables do not fund goals`.
- [ ] Tests (fail first, `debts-card.test.ts`): `a loan put on a credit card raises the card balance`; `the card line carries the category and MCC`; `cardSpendLines counts a card-funded loan as card spend`; `points are estimated for it`.
- [ ] Implement; run `npm test -w @expanses/db` and `npm run typecheck`; commit `feat(db): lending, borrowing, repayments and split bills`.

---

### Task 5: DB — the per-person read model

**Files:** Create `packages/db/src/repos/people.ts`; modify `packages/db/src/index.ts`; test `packages/db/test/people.test.ts`.

**Interfaces — Consumes:** Task 2's `statusFor`/`dueStateFor`, Task 3's profiles, `nativeBalances` from `repos/ledger.ts`.

**Interfaces — Produces:**
```ts
export interface PersonLoanRow {
  accountId: string; reason: string | null; openedOn: string;
  originalMinor: number; balanceMinor: number; repaidMinor: number;
  dueOn: string | null; dueState: DueState; status: DebtStatus; currency: string;
}
export interface PersonDebtRow {
  personName: string; direction: DebtDirection; currency: string;
  totalMinor: number; loans: PersonLoanRow[];
  /** The soonest state across their open loans, for the pill on the card. */
  dueState: DueState;
}
export interface PeopleDebts { owedToYou: PersonDebtRow[]; youOwe: PersonDebtRow[]; settled: PersonDebtRow[] }
export async function peopleDebts(database: Database, ws: WorkspaceContext, onDate: string): Promise<PeopleDebts>;
export interface DebtHistoryRow { transactionId: string; occurredOn: string; kind: 'lend' | 'repayment' | 'forgive'; amountMinor: number; interestMinor: number }
export async function debtHistory(database: Database, ws: WorkspaceContext, accountId: string): Promise<DebtHistoryRow[]>;
```

`originalMinor` is the sum of the lending entries; `repaidMinor` is `originalMinor − balanceMinor`. People are grouped by `person_name` so one friend with three loans is one card.

- [ ] Tests (fail first, `people.test.ts`): `groups three loans to one person into one card`; `keeps money lent and money borrowed apart`; `reports what is left and what came back`; `a person with everything repaid moves to settled`; `the card carries the soonest due state`; `history lists the loan, its repayments and a forgiveness in date order`; `a voided repayment leaves the balance as it was`.
- [ ] Implement; run `npm test -w @expanses/db` and `npm run typecheck`; commit `feat(db): per-person debt totals and history`.

---

### Task 6: Web — the Lend & borrow tab

**Files:** Create `apps/web/src/features/debts/debts-form.ts`, `DebtsPage.tsx`, `PersonCard.tsx`, `DebtForm.tsx`, `queries.ts`, `debts-form.test.ts`; modify `apps/web/src/app/router.tsx`, `apps/web/src/features/networth/NetWorthTabs.tsx`.

**Interfaces — Produces:**
```ts
export interface DebtDraft {
  direction: DebtDirection; personName: string; existingAccountId: string;
  occurredOn: string; amount: string; moneyId: string; moneyIsCard: boolean;
  spendCategoryId: string; mcc: string; reason: string; dueOn: string; personIdNumber: string;
}
export const emptyDebtDraft: (today: string) => DebtDraft;
/** Turns what was typed into a RecordLoanInput, with messages meant for the screen. */
export function debtDraftToInput(draft: DebtDraft, currency: string, today: string): RecordLoanInput;
/** Names already used, so typing "An" suggests "Andi". */
export function personSuggestions(people: PeopleDebts, typed: string): string[];
export interface RepaymentDraft { amount: string; interest: string; occurredOn: string; moneyId: string }
export function repaymentDraftToInput(draft: RepaymentDraft, debtAccountId: string, currency: string, balanceMinor: number, personName: string): RecordRepaymentInput;
```

Screen: two columns, **Owed to you** and **You owe**, each a list of person cards showing the total, each loan with its reason and progress, a due pill, and Record repayment / Forgive rest / Edit. A **Settled** section underneath, collapsed. The add form asks direction, person (with suggestions), amount, date, account — and when a card is chosen, the category and MCC, with the note that the purchase still earns points.

- [ ] Tests (fail first, `debts-form.test.ts`): `reads an amount typed the Indonesian way`; `a card loan keeps the category and MCC, a bank loan drops them`; `refuses a loan with no person`; `refuses a date after today`; `refuses a repayment above what is owed, naming the person`; `suggests names already used, ignoring case`; `interest is optional and defaults to zero`.
- [ ] Implement the pure module and the screens; run `npm test -w @expanses/web` and `npm run typecheck`; commit `feat(web): the Lend & borrow tab`.

---

### Task 7: Web — the rest of the surface, and end to end

**Files:** Modify `apps/web/src/features/transactions/TransactionForm.tsx`, `TransactionsPage.tsx`, `apps/web/src/features/networth/overview-rows.ts`, `overview-rows.test.ts`; create `apps/web/e2e/lend-borrow.spec.ts`.

**Interfaces — Consumes:** everything above. `attentionItems` gains a fourth kind of row:

```ts
export function attentionItems(
  values: AssetValueRow[], dueTemplates: TradeTemplateRow[], goalPlans?: GoalPlanRow[],
  idleCash?: IdleCashRow[], people?: PersonDebtRow[],
): AttentionItem[];
```

The transaction form gains **"Someone owes part of this"** on an expense: a person and their share, which posts through `splitBill` instead of `postTransaction`. The Transactions page labels a lending transaction "Lent to Andi" and a repayment "Repayment from Andi" — the page already loads `accounts`, so it reads the subtype from there rather than widening `TransactionView`.

- [ ] Tests (fail first, `overview-rows.test.ts`): `a loan due in 6 days is listed with the person and the date`; `an overdue loan says how late it is`; `a loan due in two months says nothing`; `a settled loan says nothing`.
- [ ] E2E (`apps/web/e2e/lend-borrow.spec.ts`, fail first): `lend on a credit card: the card owes more, the points are estimated, and spending is unchanged`; `split a dinner bill: own share is spending, each friend owes their part`; `record a repayment and watch the balance fall`; `a repayment above the balance is refused by name`; `forgive the rest and the debt leaves the balance sheet`; `the balance sheet shows Owed to you and Due within a year`.
- [ ] Implement; run `npm test`, `npm run typecheck`, `npm run e2e`; commit `feat(web): split bills, debt labels and due-date warnings`.
- [ ] Record execution notes at the end of this plan; commit `docs: record slice 4 execution status`.

---

## Self-review

**Spec coverage (§7):** storage and the corrected migration number (Task 3); every posting in the §7.2 table (Task 1) and its recording (Task 4); over-repayment naming the person (Tasks 1 and 4); settle on zero (Tasks 2 and 4); card lending counted as card spend (Task 4, `debts-card.test.ts`); currency handling through the existing `ratesToBase` (Tasks 4 and 5); the Lend & borrow screens, person suggestions and the settled section (Task 6); "Someone owes part of this", the Transactions labels and the due-date attention rows (Task 7); the balance sheet placement, which already works and is pinned by a test in Task 4; receivables not funding goals, pinned in Task 4.

**Carried into slice 6, not built here:** `coretax_code` is stored and never read; the piutang and utang tables are built in the Coretax slice from the open balances on 31 December.

**Deliberately left out:** interest that accrues on its own — interest is typed on the repayment that carries it, which is how these debts work between people. Reminders and notifications: the attention list is the whole of it.
