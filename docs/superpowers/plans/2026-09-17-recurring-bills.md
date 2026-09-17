# Recurring bills revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every recurring bill an out day and an optional pay-by day, record which month each payment settles, count bills in the month they come out on the budget sheet and the Cashflow chart, and replace today's Recurring sheet and `/bills` setup list with one Recurring screen (list, bill page, payment sheet, pay several, new/edit bill) that works by thumb and by mouse.

**Architecture:** Two side tables from migration 0044 — `bill_windows` (pay-by day, first tracked month) and `bill_payments` (transaction → bill month) — so no existing table gains a column. The window and state rules are pure functions in `packages/core/src/bills/schedule.ts`; `packages/db` reads facts (payments, skips, templates) and hands them to those functions. Every read and write of the new tables is guarded by `billTablesExist`, falling back to today's calendar-month rule, so older databases and the migration tests keep working. Decision A is one opt-in option, `billMonths`, on `categoryTotalsBetween`, which swaps the date filter for an attributed date (`attributedOn()` SQL). The web screen lives in a new `apps/web/src/features/bills/` folder under routes `/bills`, `/bills/new`, `/bills/$billId`, `/bills/$billId/edit`.

**Tech Stack:** TypeScript monorepo — `packages/core` (pure), `packages/db` (Drizzle over sqlite-proxy, SQL migrations as `?raw` imports), `apps/web` (React 19, TanStack Router/Query, Tailwind 4); Vitest; Playwright (`chromium` and `phone` projects).

**Spec:** `docs/superpowers/specs/2026-09-17-recurring-bills-design.md` (approved 2026-09-17)

## Global Constraints

- Branch `feat/recurring-bills`. Commit per task; merge and push only when the user asks. Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **No new columns on existing tables** (`expense_templates`, `transactions`, `bill_skips`, `entries`, `accounts`). The ORM names every column it knows on every insert, so a column there breaks any database still stopped at an older version (migration 0028's comment). New facts go in `bill_windows` and `bill_payments`.
- Migration 0044 is additive. Its backfill files every existing bill payment under the month of its `occurred_on`, so no figure changes on upgrade.
- **Older databases:** every repository read or write of `bill_windows` / `bill_payments` goes through `billTablesExist(db)`; without the tables it behaves exactly as today. Migration tests seed an older database either through these guarded repositories or with raw SQL naming only the columns that version had — never through an unguarded write.
- `transactions.template_id` keeps being written and copied exactly as today; `bill_skips` is unchanged.
- Bills stay book-scoped only through `listExpenseTemplates` (category in `book_categories`); the new tables carry no `book_id`.
- Decision A touches only `categoryTotalsBetween` callers named in Task 6. Transaction history, statements, balances, points, net worth and tax are not modified.
- Inside `database.transaction((tx) => …)` use `tx` only — `database.db` there deadlocks on the mutex.
- **Desktop is never weakened:** every swipe action also has a mouse/keyboard path; no control that exists on desktop today (add, edit, remove a bill, pay several on one date, skip, pay early) disappears.
- Country-neutral copy; no Indonesia-specific presets.
- Test snippets name real functions. Where an input object is shown for an existing function (`createAccount`, `postTransaction`, `saveExpenseTemplate`), it matches the signatures read on 2026-09-17; re-read the type if the compiler disagrees and match it.
- Gate before every commit: `npm run typecheck` (root), `npm test` (root), and `npx playwright test --workers=2` (in `apps/web`).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/bills/schedule.ts` | bill windows, states, which month a row speaks for, payable months, pill/schedule words |
| `packages/core/src/index.ts` | export the above |
| `packages/core/test/bills-schedule.test.ts` | pure tests for the above |
| `packages/db/migrations/0044_bill_months.sql` | `bill_windows`, `bill_payments`, index, backfill |
| `packages/db/src/migrations.ts` | register 0044 |
| `packages/db/src/schema-recurring.ts` | Drizzle `billWindows`, `billPayments` |
| `packages/db/src/repos/bill-months.ts` | `billTablesExist`, `attributedOn()` |
| `packages/db/src/repos/ledger.ts` | `billMonth` on posting; `replaceTransaction` keeps it |
| `packages/db/src/repos/expense-templates.ts` | pay-by day and first month on templates; `monthlyBills` rewrite; `billDetail`; `recordBillPayments`; `undoBillPayments`; `dueExpenseTemplates` on top of `monthlyBills` |
| `packages/db/src/repos/reports.ts` | `categoryTotalsBetween(..., { billMonths })` |
| `packages/db/src/repos/budget-sheet.ts` | asks for `billMonths` |
| `packages/db/test/bill-months-migration.test.ts` | 0044 on a version-43 database; payments written after it |
| `packages/db/test/monthly-bills.test.ts` | states, bill months, history (rewritten) |
| `packages/db/test/bill-payments.test.ts` | recording, refusing, undoing |
| `packages/db/test/bill-months-figures.test.ts` | decision A figures |
| `packages/db/test/expense-templates.test.ts` | pay-by day tests added |
| `packages/db/test/database.test.ts` | applied versions list gains 44 |
| `apps/web/src/features/bills/queries.ts` | `useMonthlyBills`, `useBillDetail` |
| `apps/web/src/features/bills/bill-view.ts` (+ `.test.ts`) | sections, summary, owed-now, subline, pill classes |
| `apps/web/src/features/bills/BillFormPage.tsx` | S1 new/edit |
| `apps/web/src/features/bills/RecurringPage.tsx` | V1 list, select mode, toast host |
| `apps/web/src/features/bills/BillRow.tsx` | row content, swipe wiring, desktop ⋯ menu |
| `apps/web/src/features/bills/SwipeRow.tsx` | pointer-driven swipe container |
| `apps/web/src/features/bills/PaySheet.tsx` | P1 |
| `apps/web/src/features/bills/PaySeveralSheet.tsx` | M2 sheet |
| `apps/web/src/features/bills/BillPage.tsx` | D1 + A1 |
| `apps/web/src/features/bills/UndoToast.tsx` | 4-second undo toast |
| `apps/web/src/features/transactions/Recurring.tsx` | Cashflow card only, links to `/bills` |
| `apps/web/src/features/transactions/SpendingReport.tsx`, `IncomeFlow.tsx`, `apps/web/src/features/dashboard/DashboardPage.tsx` | ask for `billMonths` |
| `apps/web/src/app/router.tsx` | the four bill routes |
| Deleted: `apps/web/src/features/transactions/BillsPage.tsx`, `BillList.tsx`, `BillsDue.tsx`; `useDueBills`/`useExpenseTemplates` in `apps/web/src/features/transactions/queries.ts` | superseded |
| `apps/web/e2e/recurring-bills.spec.ts` | chromium flows (rewritten) |
| `apps/web/e2e/phone-recurring-bills.spec.ts` | phone flows: swipes, select bar |

---

## Step 1 — Rules and records

### Task 1: Bill windows and states, pure

**Files:**
- Create: `packages/core/src/bills/schedule.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/bills-schedule.test.ts`

**Interfaces:**
- Produces: `DUE_SOON_DAYS`, types `BillStateKind`, `BillSettlement`, `BillWindow`, `BillStanding`, `BillTone`, `BillMonthsInput`; functions `billWindow`, `daysFrom`, `billStanding`, `currentBillMonth`, `payableBillMonths`, `billPill`, `dayMonth`, `monthName`, `ordinal`, `billSchedule`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/bills-schedule.test.ts
import { describe, expect, it } from 'vitest';
import {
  billPill,
  billSchedule,
  billStanding,
  billWindow,
  currentBillMonth,
  dayMonth,
  monthName,
  payableBillMonths,
} from '../src/index';

describe('billWindow', () => {
  it('opens and falls due in the same month when the pay-by day is later', () => {
    expect(billWindow('2026-09', 1, 10)).toEqual({ month: '2026-09', opensOn: '2026-09-01', payBy: '2026-09-10' });
  });

  it('carries a pay-by day earlier than the out day into the next month', () => {
    expect(billWindow('2026-08', 28, 5)).toEqual({ month: '2026-08', opensOn: '2026-08-28', payBy: '2026-09-05' });
    expect(billWindow('2026-12', 28, 5).payBy).toBe('2027-01-05');
  });

  it('is due on its out day when it has no pay-by day', () => {
    expect(billWindow('2026-09', 20, null)).toEqual({ month: '2026-09', opensOn: '2026-09-20', payBy: '2026-09-20' });
  });

  it('clamps days a month does not have', () => {
    expect(billWindow('2026-02', 31, null).opensOn).toBe('2026-02-28');
    expect(billWindow('2028-02', 30, 31)).toMatchObject({ opensOn: '2028-02-29', payBy: '2028-02-29' });
    expect(billWindow('2026-01', 31, 30).payBy).toBe('2026-02-28');
  });
});

describe('billStanding', () => {
  const internet = billWindow('2026-08', 28, 5);

  it('walks through the window: opens, pay by, due soon, due today, overdue', () => {
    expect(billStanding(internet, '2026-08-27', null)).toEqual({ state: 'upcoming', days: 1 });
    expect(billStanding(internet, '2026-08-28', null)).toEqual({ state: 'open', days: 8 });
    expect(billStanding(internet, '2026-09-01', null)).toEqual({ state: 'open', days: 4 });
    expect(billStanding(internet, '2026-09-02', null)).toEqual({ state: 'dueSoon', days: 3 });
    expect(billStanding(internet, '2026-09-05', null)).toEqual({ state: 'dueSoon', days: 0 });
    expect(billStanding(internet, '2026-09-08', null)).toEqual({ state: 'overdue', days: 3 });
  });

  it('is settled whatever the day once paid or skipped', () => {
    expect(billStanding(internet, '2026-09-30', 'paid')).toEqual({ state: 'paid', days: 0 });
    expect(billStanding(internet, '2026-08-01', 'skipped')).toEqual({ state: 'skipped', days: 0 });
  });

  it('without a pay-by day, is due on the out day and overdue the day after', () => {
    const pln = billWindow('2026-09', 20, null);
    expect(billStanding(pln, '2026-09-19', null)).toEqual({ state: 'upcoming', days: 1 });
    expect(billStanding(pln, '2026-09-20', null)).toEqual({ state: 'dueSoon', days: 0 });
    expect(billStanding(pln, '2026-09-21', null)).toEqual({ state: 'overdue', days: 1 });
  });
});

describe('which month a bill speaks for', () => {
  const internet = { outDay: 28, payByDay: 5, startsMonth: '2026-08' };

  it('raises last month while it is unsettled', () => {
    expect(currentBillMonth({ ...internet, today: '2026-09-08', settled: {} })).toBe('2026-08');
    expect(currentBillMonth({ ...internet, today: '2026-09-08', settled: { '2026-08': 'paid' } })).toBe('2026-09');
    expect(currentBillMonth({ ...internet, today: '2026-09-08', settled: { '2026-08': 'skipped' } })).toBe('2026-09');
  });

  it('never raises a month before the bill was tracked', () => {
    expect(currentBillMonth({ ...internet, startsMonth: '2026-09', today: '2026-09-08', settled: {} })).toBe('2026-09');
  });

  it('offers last, this and next month, oldest unsettled first', () => {
    expect(payableBillMonths({ ...internet, today: '2026-09-08', settled: {} })).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(payableBillMonths({ ...internet, today: '2026-09-08', settled: { '2026-08': 'paid', '2026-09': 'skipped' } })).toEqual(['2026-10']);
    expect(payableBillMonths({ ...internet, startsMonth: '2026-09', today: '2026-09-08', settled: {} })).toEqual(['2026-09', '2026-10']);
  });
});

describe('words', () => {
  const window = billWindow('2026-09', 20, 25);

  it('says each state the way the pill does', () => {
    expect(billPill({ state: 'upcoming', days: 5 }, window, null)).toEqual({ text: 'Opens 20 Sep', tone: 'grey' });
    expect(billPill({ state: 'open', days: 5 }, window, null)).toEqual({ text: 'Pay by 25 Sep', tone: 'blue' });
    expect(billPill({ state: 'dueSoon', days: 2 }, window, null)).toEqual({ text: 'Due in 2 days', tone: 'amber' });
    expect(billPill({ state: 'dueSoon', days: 1 }, window, null).text).toBe('Due in 1 day');
    expect(billPill({ state: 'dueSoon', days: 0 }, window, null).text).toBe('Due today');
    expect(billPill({ state: 'overdue', days: 3 }, window, null)).toEqual({ text: 'Overdue 3 days', tone: 'red' });
    expect(billPill({ state: 'overdue', days: 1 }, window, null).text).toBe('Overdue 1 day');
    expect(billPill({ state: 'paid', days: 0 }, window, '2026-09-01')).toEqual({ text: '✓ Paid 1 Sep', tone: 'green' });
    expect(billPill({ state: 'skipped', days: 0 }, window, null)).toEqual({ text: 'Skipped', tone: 'grey' });
  });

  it('names months, days and the schedule', () => {
    expect(monthName('2026-08', 'long')).toBe('August');
    expect(monthName('2026-08', 'short')).toBe('Aug');
    expect(dayMonth('2026-09-08')).toBe('8 Sep');
    expect(billSchedule(28, 5)).toBe('Every month · out on the 28th · pay by the 5th');
    expect(billSchedule(1, null)).toBe('Every month · out on the 1st');
    expect(billSchedule(22, 23)).toBe('Every month · out on the 22nd · pay by the 23rd');
    expect(billSchedule(11, 12)).toBe('Every month · out on the 11th · pay by the 12th');
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/core && npx vitest run test/bills-schedule.test.ts`
Expected: FAIL — `billWindow` is not exported.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/bills/schedule.ts
import { addMonths, monthOf, monthRange } from '../reports/periods';

/** How many days before its pay-by day a bill turns amber. */
export const DUE_SOON_DAYS = 3;

export type BillStateKind = 'upcoming' | 'open' | 'dueSoon' | 'overdue' | 'paid' | 'skipped';
export type BillSettlement = 'paid' | 'skipped' | null;
export type BillTone = 'grey' | 'blue' | 'amber' | 'red' | 'green';

/** One month's bill: the day it comes out and the day it must be paid by. */
export interface BillWindow {
  /** YYYY-MM: the month the bill belongs to, which is the month it comes out. */
  month: string;
  opensOn: string;
  payBy: string;
}

export interface BillStanding {
  state: BillStateKind;
  /** Days until it opens (upcoming), days left (open, dueSoon), days late (overdue); 0 when settled. */
  days: number;
}

export interface BillMonthsInput {
  today: string;
  /** The first month this bill can be owed for. */
  startsMonth: string;
  outDay: number;
  payByDay: number | null;
  /** Months already dealt with. */
  settled: Readonly<Record<string, 'paid' | 'skipped'>>;
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

/** A day of a month, or the month's last day when it is shorter. */
function dayIn(month: string, day: number): string {
  const last = Number(monthRange(month).to.slice(8, 10));
  return `${month}-${pad(Math.min(day, last))}`;
}

const utc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

/** Whole days from one YYYY-MM-DD to another; negative when `to` is earlier. */
export function daysFrom(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * A pay-by day earlier than the out day belongs to the following month: out on the 28th, pay by the 5th. With no
 * pay-by day the bill is due the day it comes out, which is how bills behaved before they had one.
 */
export function billWindow(month: string, outDay: number, payByDay: number | null): BillWindow {
  const opensOn = dayIn(month, outDay);
  if (payByDay === null) return { month, opensOn, payBy: opensOn };
  const payBy = payByDay >= outDay ? dayIn(month, payByDay) : dayIn(addMonths(month, 1), payByDay);
  return { month, opensOn, payBy };
}

/** Where one month's bill stands on a day. Settled first, then not out yet, then late, then how close. */
export function billStanding(window: BillWindow, today: string, settled: BillSettlement): BillStanding {
  if (settled === 'paid') return { state: 'paid', days: 0 };
  if (settled === 'skipped') return { state: 'skipped', days: 0 };
  if (today < window.opensOn) return { state: 'upcoming', days: daysFrom(today, window.opensOn) };
  const left = daysFrom(today, window.payBy);
  if (left < 0) return { state: 'overdue', days: -left };
  if (left <= DUE_SOON_DAYS) return { state: 'dueSoon', days: left };
  return { state: 'open', days: left };
}

/**
 * The month a bill's row speaks for today: last month while that is still unsettled (it has always come out by now),
 * otherwise this month. One month back only, and never before the bill was tracked.
 */
export function currentBillMonth({ today, startsMonth, settled }: BillMonthsInput): string {
  const month = monthOf(today);
  const previous = addMonths(month, -1);
  return previous >= startsMonth && !settled[previous] ? previous : month;
}

/** Months a payment can be recorded for, oldest first; the first is the default. */
export function payableBillMonths({ today, startsMonth, settled }: BillMonthsInput): string[] {
  const month = monthOf(today);
  return [addMonths(month, -1), month, addMonths(month, 1)].filter((m) => m >= startsMonth && !settled[m]);
}

export function monthName(month: string, width: 'long' | 'short'): string {
  const name = MONTHS_LONG[Number(month.slice(5, 7)) - 1]!;
  return width === 'long' ? name : name.slice(0, 3);
}

/** "8 Sep". */
export function dayMonth(date: string): string {
  return `${Number(date.slice(8, 10))} ${monthName(date.slice(0, 7), 'short')}`;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}

/** "Every month · out on the 28th · pay by the 5th". */
export function billSchedule(outDay: number, payByDay: number | null): string {
  return `Every month · out on the ${ordinal(outDay)}${payByDay === null ? '' : ` · pay by the ${ordinal(payByDay)}`}`;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The state pill's words and colour. */
export function billPill(standing: BillStanding, window: BillWindow, paidOn: string | null): { text: string; tone: BillTone } {
  switch (standing.state) {
    case 'upcoming':
      return { text: `Opens ${dayMonth(window.opensOn)}`, tone: 'grey' };
    case 'open':
      return { text: `Pay by ${dayMonth(window.payBy)}`, tone: 'blue' };
    case 'dueSoon':
      return { text: standing.days === 0 ? 'Due today' : `Due in ${plural(standing.days, 'day')}`, tone: 'amber' };
    case 'overdue':
      return { text: `Overdue ${plural(standing.days, 'day')}`, tone: 'red' };
    case 'paid':
      return { text: paidOn ? `✓ Paid ${dayMonth(paidOn)}` : '✓ Paid', tone: 'green' };
    case 'skipped':
      return { text: 'Skipped', tone: 'grey' };
  }
}
```

Add to `packages/core/src/index.ts`, after the `reports/periods` export:

```ts
export {
  billPill,
  billSchedule,
  type BillMonthsInput,
  type BillSettlement,
  billStanding,
  type BillStanding,
  type BillStateKind,
  type BillTone,
  billWindow,
  type BillWindow,
  currentBillMonth,
  dayMonth,
  daysFrom,
  DUE_SOON_DAYS,
  monthName,
  ordinal,
  payableBillMonths,
} from './bills/schedule';
```

(If `ordinal` or `daysFrom` collides with an existing export, `grep -n "ordinal\|daysFrom" packages/core/src/index.ts` first and rename these to `billOrdinal` / `billDaysFrom` throughout.)

- [ ] **Step 4: Run** — `cd packages/core && npx vitest run` → all pass. `npm run typecheck` → clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(core): a bill's window, where it stands, and the words for it"` (with the trailer).

### Task 2: Migration 0044, and payments that say their month

**Files:**
- Create: `packages/db/migrations/0044_bill_months.sql`, `packages/db/src/repos/bill-months.ts`
- Modify: `packages/db/src/migrations.ts`, `packages/db/src/schema-recurring.ts`, `packages/db/src/repos/ledger.ts` (`PostTransactionInput`, `LedgerErrorCode`, `postTransactionTx`, `replaceTransaction`), `packages/db/src/index.ts`, `packages/db/test/database.test.ts`
- Test: `packages/db/test/bill-months-migration.test.ts`

**Interfaces:**
- Produces: tables `bill_windows`, `bill_payments`; Drizzle `billWindows`, `billPayments`; `billTablesExist(db: Db): Promise<boolean>`; `PostTransactionInput.billMonth?: string | null`; ledger error `INVALID_BILL_MONTH`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/bill-months-migration.test.ts
import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  listAccounts,
  migrate,
  MIGRATIONS,
  postTransaction,
  replaceTransaction,
  saveExpenseTemplate,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb, type TestDb } from './helpers';

let executor: NodeExecutor | undefined;
let current: TestDb | undefined;
afterEach(() => {
  executor?.close();
  current?.executor.close();
  executor = undefined;
  current = undefined;
});

async function internetBill(database: Database, ws: WorkspaceContext) {
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const internet = (await listAccounts(database, ws)).find((a) => a.systemKey === 'utilities.internet_provider')!.id;
  const bill = await saveExpenseTemplate(database, ws, { name: 'Biznet Home', categoryAccountId: internet, moneyAccountId: bank.id, amountMinor: 450_000, dayOfMonth: 28 });
  const pay = (occurredOn: string, extra: { billMonth?: string } = {}) =>
    postTransaction(database, ws, {
      occurredOn,
      description: 'Biznet Home',
      templateId: bill,
      ...extra,
      lines: expenseLines({ categoryAccountId: internet, paymentAccountId: bank.id, amountMinor: 450_000, currency: 'IDR' }),
    });
  return { bank, internet, bill, pay };
}

describe('migration 0044', () => {
  it('is version 44 and named bill_months', () => {
    expect(MIGRATIONS.find((m) => m.version === 44)).toMatchObject({ name: 'bill_months' });
  });

  it('files every bill payment a version 43 database holds under the month it was paid in', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 43));
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    // The repositories look for the new tables before touching them, so these write what a version 43 build wrote.
    const { bank, internet, bill, pay } = await internetBill(older, ws);
    const paid = await pay('2026-09-03');
    const stray = await postTransaction(older, ws, {
      occurredOn: '2026-09-04',
      description: 'Warung',
      lines: expenseLines({ categoryAccountId: internet, paymentAccountId: bank.id, amountMinor: 20_000, currency: 'IDR' }),
    });
    // A template id that names no bill is left alone.
    await older.db.values(sql`UPDATE transactions SET template_id = 'not-a-bill' WHERE id = ${stray}`);

    expect(await migrate(older)).toEqual([44]);

    expect(await older.db.values(sql`SELECT template_id, workspace_id, pay_by_day FROM bill_windows`)).toEqual([[bill, ws.workspaceId, null]]);
    const [[starts]] = (await older.db.values<[string]>(sql`SELECT starts_month FROM bill_windows`)) as [[string]];
    expect(starts).toMatch(/^\d{4}-\d{2}$/);
    expect(await older.db.values(sql`SELECT transaction_id, template_id, bill_month FROM bill_payments`)).toEqual([[paid, bill, '2026-09']]);
  });

  it('records the month a payment names, defaults it to the month paid, and keeps it through a correction', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const { bank, internet, pay } = await internetBill(database, ws);

    const forAugust = await pay('2026-09-03', { billMonth: '2026-08' });
    const plain = await pay('2026-09-29');
    const monthOf = async (id: string) => database.db.values(sql`SELECT bill_month FROM bill_payments WHERE transaction_id = ${id}`);
    expect(await monthOf(forAugust)).toEqual([['2026-08']]);
    expect(await monthOf(plain)).toEqual([['2026-09']]);

    const corrected = await replaceTransaction(database, ws, forAugust, {
      occurredOn: '2026-09-03',
      description: 'Biznet Home',
      lines: expenseLines({ categoryAccountId: internet, paymentAccountId: bank.id, amountMinor: 475_000, currency: 'IDR' }),
    });
    expect(await monthOf(corrected)).toEqual([['2026-08']]);

    await expect(pay('2026-09-03', { billMonth: '2026-9' })).rejects.toMatchObject({ code: 'INVALID_BILL_MONTH' });
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/db && npx vitest run test/bill-months-migration.test.ts`
Expected: FAIL — no migration 44.

- [ ] **Step 3: Write the migration, tables and guard**

```sql
-- packages/db/migrations/0044_bill_months.sql
/* A recurring bill's window, and the month each payment settles.

   A bill comes out on one day and may be paid by a later one, sometimes in the next month (out on the 28th, pay by
   the 5th). So a payment made on 3 September can settle August's bill, and the calendar month it was paid in no
   longer says which bill it paid.

   Both facts live in tables of their own rather than in columns on expense_templates or transactions: the ORM names
   every column it knows on every insert, so a column there would break any database still stopped at an older
   version (see 0028). */
CREATE TABLE bill_windows (
  template_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  /* 1-31, or NULL: due on the day it comes out. Earlier than the out day means the following month. */
  pay_by_day INTEGER,
  /* YYYY-MM: the first month this bill can be owed for, so an upgrade never raises a debt from before it. */
  starts_month TEXT NOT NULL
);

CREATE TABLE bill_payments (
  transaction_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  /* YYYY-MM: the month whose bill this payment settles. */
  bill_month TEXT NOT NULL
);
CREATE INDEX bill_payments_template ON bill_payments (workspace_id, template_id, bill_month);

INSERT INTO bill_windows (template_id, workspace_id, pay_by_day, starts_month)
SELECT id, workspace_id, NULL, strftime('%Y-%m', 'now', 'localtime') FROM expense_templates;

/* Until now a payment settled the calendar month it was made in; filing it there changes no figure. */
INSERT INTO bill_payments (transaction_id, workspace_id, template_id, bill_month)
SELECT id, workspace_id, template_id, substr(occurred_on, 1, 7) FROM transactions
WHERE template_id IS NOT NULL AND template_id IN (SELECT id FROM expense_templates);
```

In `packages/db/src/migrations.ts` add `import billMonths from '../migrations/0044_bill_months.sql?raw';` after the 0043 import and `{ version: 44, name: 'bill_months', sql: billMonths },` after the version 43 entry. In `packages/db/test/database.test.ts` append `44` to the expected applied list.

Append to `packages/db/src/schema-recurring.ts`:

```ts
/** A bill's pay-by day and the first month it is tracked for. One row per bill. */
export const billWindows = sqliteTable('bill_windows', {
  templateId: text('template_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  payByDay: integer('pay_by_day'),
  startsMonth: text('starts_month').notNull(),
});

/** The month a bill payment settles. */
export const billPayments = sqliteTable('bill_payments', {
  transactionId: text('transaction_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  templateId: text('template_id').notNull(),
  billMonth: text('bill_month').notNull(),
});
```

```ts
// packages/db/src/repos/bill-months.ts
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../database';
import { transactions } from '../schema';

/**
 * Whether migration 0044 has run on this database. Every read and write of bill_windows and bill_payments asks
 * first, so a database stopped at an older version keeps today's calendar-month behaviour. A positive answer is
 * remembered per handle; a negative one is not, since migrate() may run later on the same handle.
 */
const billTables = new WeakMap<Db, boolean>();

export async function billTablesExist(db: Db): Promise<boolean> {
  if (billTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bill_payments'`);
  const exists = rows.length > 0;
  if (exists) billTables.set(db, true);
  return exists;
}

export const BILL_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
```

Export from `packages/db/src/index.ts`: `export { billTablesExist } from './repos/bill-months';`.

- [ ] **Step 4: Write bill months on posting** — in `packages/db/src/repos/ledger.ts`:

1. Add `'INVALID_BILL_MONTH'` to `LedgerErrorCode`.
2. Add to `PostTransactionInput`, under `templateId`:

```ts
  /** YYYY-MM: the month whose bill a template payment settles. Defaults to the month of occurredOn. */
  billMonth?: string | null;
```

3. Import `billPayments, expenseTemplates` from `'../schema-recurring'` and `BILL_MONTH, billTablesExist` from `'./bill-months'`.
4. In `postTransactionTx`, next to the MCC check:

```ts
  if (input.billMonth != null && !BILL_MONTH.test(input.billMonth)) {
    throw new LedgerError('INVALID_BILL_MONTH', `A bill month is YYYY-MM, got "${input.billMonth}"`);
  }
```

5. After the `bookTransactions` insert:

```ts
  // A payment against a bill says which month's bill it settles, which is not always the month it was paid in.
  if (input.templateId && (await billTablesExist(tx))) {
    const [bill] = await tx
      .select({ id: expenseTemplates.id })
      .from(expenseTemplates)
      .where(and(eq(expenseTemplates.id, input.templateId), eq(expenseTemplates.workspaceId, ws.workspaceId)));
    if (bill) {
      await tx.insert(billPayments).values({
        transactionId: id,
        workspaceId: ws.workspaceId,
        templateId: bill.id,
        billMonth: input.billMonth ?? input.occurredOn.slice(0, 7),
      });
    }
  }
```

6. In `replaceTransaction`, right after reading `original` and before `voidTransactionTx`:

```ts
    const [settles] = (await billTablesExist(tx))
      ? await tx.select({ billMonth: billPayments.billMonth }).from(billPayments).where(eq(billPayments.transactionId, id))
      : [];
```

and in the `postTransactionTx` call's input, after the `templateId` spread:

```ts
      // …nor change which month's bill it settled.
      ...(input.billMonth === undefined && settles ? { billMonth: settles.billMonth } : {}),
```

- [ ] **Step 5: Run** — `cd packages/db && npx vitest run` → all pass (including `books-sample-migration.test.ts`, `expense-templates.test.ts`).

- [ ] **Step 6: Commit** — `git commit -am "feat(db): bill windows and the month each payment settles (0044)"` (with the trailer; `git add` the new files first).

### Task 3: Pay-by day on a bill

**Files:**
- Modify: `packages/db/src/repos/expense-templates.ts` (`ExpenseTemplateRow`, `SaveExpenseTemplateInput`, `saveExpenseTemplate`, `listExpenseTemplates`, `toRow`)
- Test: `packages/db/test/expense-templates.test.ts`

**Interfaces:**
- Produces: `ExpenseTemplateRow.payByDay: number | null`, `ExpenseTemplateRow.startsMonth: string`; `SaveExpenseTemplateInput.payByDay?: number | null`, `SaveExpenseTemplateInput.startsMonth?: string` (only honoured when the bill is new; for tests and imports); error `PAY_BY_RANGE`.

- [ ] **Step 1: Failing tests** — append to `packages/db/test/expense-templates.test.ts` (add `isoDate` from `@expanses/core` and `sql` from `drizzle-orm` to its imports):

```ts
describe('pay-by day', () => {
  const internet = (context: Household, extra: { id?: string; payByDay?: number | null; startsMonth?: string } = {}) =>
    saveExpenseTemplate(context.database, context.ws, {
      name: 'Internet',
      categoryAccountId: context.phone.id,
      moneyAccountId: context.bca.id,
      amountMinor: 450_000,
      dayOfMonth: 28,
      ...extra,
    });

  it('saves a pay-by day, and starts tracking the bill this month', async () => {
    const context = await household();
    await internet(context, { payByDay: 5 });
    const [bill] = await listExpenseTemplates(context.database, context.ws);
    expect(bill).toMatchObject({ dayOfMonth: 28, payByDay: 5, startsMonth: isoDate().slice(0, 7) });
  });

  it('an edit changes the pay-by day but not the month the bill started', async () => {
    const context = await household();
    const id = await internet(context, { payByDay: 5, startsMonth: '2026-01' });
    await internet(context, { id, payByDay: null, startsMonth: '2026-06' });
    expect((await listExpenseTemplates(context.database, context.ws))[0]).toMatchObject({ payByDay: null, startsMonth: '2026-01' });
    expect(await context.database.db.values(sql`SELECT count(*) FROM bill_windows`)).toEqual([[1]]);
  });

  it('refuses a pay-by day outside a month', async () => {
    const context = await household();
    await expect(internet(context, { payByDay: 0 })).rejects.toMatchObject({ code: 'PAY_BY_RANGE' });
    await expect(internet(context, { payByDay: 32 })).rejects.toMatchObject({ code: 'PAY_BY_RANGE' });
  });
});
```

- [ ] **Step 2: Run** — `cd packages/db && npx vitest run test/expense-templates.test.ts` → FAIL (`payByDay` undefined).

- [ ] **Step 3: Implement**

In `ExpenseTemplateRow` add:

```ts
  /** The day it must be paid by; earlier than dayOfMonth means the next month. Null: due the day it comes out. */
  payByDay: number | null;
  /** YYYY-MM: the first month this bill can be owed for. */
  startsMonth: string;
```

In `SaveExpenseTemplateInput` add `payByDay?: number | null;` and `/** A new bill's first month; this month when absent. Ignored on an edit. */ startsMonth?: string;`.

Replace `toRow` with one that takes the window:

```ts
const toRow = (row: typeof expenseTemplates.$inferSelect, window?: { payByDay: number | null; startsMonth: string }): ExpenseTemplateRow => ({
  id: row.id,
  name: row.name,
  categoryAccountId: row.categoryAccountId,
  moneyAccountId: row.moneyAccountId,
  amountMinor: row.amountMinor,
  dayOfMonth: row.dayOfMonth,
  active: row.active === 1,
  payByDay: window?.payByDay ?? null,
  // An older database has no windows: the month the bill was made is the nearest honest answer.
  startsMonth: window?.startsMonth ?? row.createdAt.slice(0, 7),
});
```

In `saveExpenseTemplate`, after the day check:

```ts
  const payByDay = input.payByDay ?? null;
  if (payByDay !== null && (!Number.isInteger(payByDay) || payByDay < 1 || payByDay > 31)) {
    throw new RecurringError('PAY_BY_RANGE', 'The pay-by day must be between 1 and 31, or left empty');
  }
  if (input.startsMonth !== undefined && !BILL_MONTH.test(input.startsMonth)) {
    throw new RecurringError('MONTH_FORMAT', 'A month is written YYYY-MM');
  }
```

and after the template upsert:

```ts
  if (await billTablesExist(database.db)) {
    await database.db
      .insert(billWindows)
      .values({ templateId: id, workspaceId: ws.workspaceId, payByDay, startsMonth: input.startsMonth ?? isoDate().slice(0, 7) })
      .onConflictDoUpdate({ target: billWindows.templateId, set: { payByDay } });
  }
```

(imports: `isoDate` from `@expanses/core`; `billWindows` from `'../schema-recurring'`; `BILL_MONTH, billTablesExist` from `'./bill-months'`.)

In `listExpenseTemplates`, after the existing select:

```ts
  const windows = (await billTablesExist(database.db))
    ? await database.db.select().from(billWindows).where(eq(billWindows.workspaceId, ws.workspaceId))
    : [];
  const byTemplate = new Map(windows.map((w) => [w.templateId, w]));
  return rows.map((row) => toRow(row, byTemplate.get(row.id)));
```

- [ ] **Step 4: Run** — `cd packages/db && npx vitest run` → all pass. `npm run typecheck` → clean (web does not read the new fields yet).

- [ ] **Step 5: Commit** — `git commit -am "feat(db): a bill can say the day it must be paid by"` (with the trailer).

### Task 4: `monthlyBills` by bill month, and a bill's history

**Files:**
- Modify: `packages/db/src/repos/expense-templates.ts` (`BillState`, `MonthlyBill`, `monthlyBills`, `dueExpenseTemplates`; add `BillHistoryRow`, `BillDetail`, `billDetail`, internal `billFacts`)
- Modify: `apps/web/src/features/transactions/Recurring.tsx` (compile against the new states only)
- Test: `packages/db/test/monthly-bills.test.ts` (rewritten)

**Interfaces:**
- Consumes: `billWindow`, `billStanding`, `currentBillMonth`, `payableBillMonths` (Task 1); `billTablesExist` (Task 2); `payByDay`, `startsMonth` (Task 3); `hasBooks` from `./books`.
- Produces:

```ts
export type BillState = BillStateKind;
export interface MonthlyBill extends ExpenseTemplateRow {
  billMonth: string;
  window: BillWindow;
  state: BillStateKind;
  days: number;
  paidOn: string | null;
  paidMinor: number | null;
  paymentId: string | null;
  /** The fixed amount, else what it came to the last time it was paid, else null. */
  estimateMinor: number | null;
  payableMonths: string[];
}
export interface BillHistoryRow { month: string; window: BillWindow; state: BillStateKind; days: number; paidOn: string | null; paidMinor: number | null; paymentId: string | null }
export interface BillDetail { bill: MonthlyBill; history: BillHistoryRow[]; bookName: string | null }
export function monthlyBills(database: Database, ws: WorkspaceContext, onDate: string): Promise<MonthlyBill[]>;
export function billDetail(database: Database, ws: WorkspaceContext, templateId: string, onDate: string): Promise<BillDetail>;
```

- [ ] **Step 1: Rewrite the tests**

```ts
// packages/db/test/monthly-bills.test.ts
import { expenseLines, isoDate } from '@expanses/core';
import { afterEach, expect, it } from 'vitest';
import {
  billDetail,
  createAccount,
  listAccounts,
  monthlyBills,
  personalBook,
  postTransaction,
  saveExpenseTemplate,
  skipBill,
  unskipBill,
  voidTransaction,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function household() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const bill = (
    name: string,
    key: string,
    dayOfMonth: number,
    amountMinor: number | null,
    extra: { payByDay?: number | null; startsMonth?: string } = {},
  ) =>
    saveExpenseTemplate(database, ws, {
      name,
      categoryAccountId: category(key),
      moneyAccountId: bank.id,
      dayOfMonth,
      amountMinor,
      startsMonth: '2026-09',
      ...extra,
    });
  const pay = (templateId: string, key: string, occurredOn: string, amountMinor: number, billMonth?: string) =>
    postTransaction(database, ws, {
      occurredOn,
      description: 'Bill',
      templateId,
      billMonth,
      lines: expenseLines({ categoryAccountId: category(key), paymentAccountId: bank.id, amountMinor, currency: 'IDR' }),
    });
  return { database, ws, bank, bill, pay };
}

it('says where each bill stands on the day, soonest pay-by first', async () => {
  const h = await household();
  const rent = await h.bill('Apartment rent', 'property.housing_rent', 1, 7_500_000);
  await h.bill('Biznet Home', 'utilities.internet_provider', 10, 395_000);
  await h.bill('Telkomsel Halo', 'utilities.mobile_phone', 1, 185_000, { payByDay: 17 });
  await h.bill('Fitness First', 'personal_care.sports_fitness', 25, 850_000);
  await h.bill('Tuition', 'utilities.mobile_phone', 1, 3_500_000, { payByDay: 25 });
  await h.pay(rent, 'property.housing_rent', '2026-09-03', 7_600_000);

  const bills = await monthlyBills(h.database, h.ws, '2026-09-15');
  expect(bills.map((b) => [b.name, b.state, b.days])).toEqual([
    ['Apartment rent', 'paid', 0],
    ['Biznet Home', 'overdue', 5],
    ['Telkomsel Halo', 'dueSoon', 2],
    ['Fitness First', 'upcoming', 10],
    ['Tuition', 'open', 10],
  ]);
  expect(bills[0]).toMatchObject({ billMonth: '2026-09', paidOn: '2026-09-03', paidMinor: 7_600_000 });
  expect(bills[1]).toMatchObject({ paidOn: null, paidMinor: null, paymentId: null, payableMonths: ['2026-09', '2026-10'] });
});

it('raises last month’s bill while it is unpaid, and moves on once a payment names it', async () => {
  const h = await household();
  const internet = await h.bill('Biznet Home', 'utilities.internet_provider', 28, 450_000, { payByDay: 5, startsMonth: '2026-08' });

  expect((await monthlyBills(h.database, h.ws, '2026-09-02'))[0]).toMatchObject({ billMonth: '2026-08', state: 'dueSoon', days: 3 });
  expect((await monthlyBills(h.database, h.ws, '2026-09-08'))[0]).toMatchObject({
    billMonth: '2026-08',
    state: 'overdue',
    days: 3,
    payableMonths: ['2026-08', '2026-09', '2026-10'],
  });

  // Paid in September, for August.
  await h.pay(internet, 'utilities.internet_provider', '2026-09-08', 450_000, '2026-08');
  expect((await monthlyBills(h.database, h.ws, '2026-09-08'))[0]).toMatchObject({
    billMonth: '2026-09',
    state: 'upcoming',
    days: 20,
    payableMonths: ['2026-09', '2026-10'],
  });
});

it('a payment made early counts for the month it names', async () => {
  const h = await household();
  const gym = await h.bill('Fitness First', 'personal_care.sports_fitness', 25, 850_000);
  await h.pay(gym, 'personal_care.sports_fitness', '2026-08-30', 850_000, '2026-09');
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]).toMatchObject({ state: 'paid', paidOn: '2026-08-30' });
});

it('a voided payment settles nothing', async () => {
  const h = await household();
  const gym = await h.bill('Fitness First', 'personal_care.sports_fitness', 3, 850_000);
  const paid = await h.pay(gym, 'personal_care.sports_fitness', '2026-09-03', 850_000);
  await voidTransaction(h.database, h.ws, paid);
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]).toMatchObject({ state: 'overdue', paymentId: null });
});

it('a skipped month stops being owed, and can be taken back', async () => {
  const h = await household();
  const gym = await h.bill('Fitness First', 'personal_care.sports_fitness', 3, 850_000);
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]!.state).toBe('overdue');

  await skipBill(h.database, h.ws, gym, '2026-09');
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]!.state).toBe('skipped');
  // Skipping one month says nothing about the next.
  expect((await monthlyBills(h.database, h.ws, '2026-10-15'))[0]).toMatchObject({ billMonth: '2026-10', state: 'overdue' });
  await skipBill(h.database, h.ws, gym, '2026-09');

  await unskipBill(h.database, h.ws, gym, '2026-09');
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]!.state).toBe('overdue');
});

it('estimates a bill that varies from what it came to last time', async () => {
  const h = await household();
  const pln = await h.bill('PLN electricity', 'utilities.electricity', 20, null, { startsMonth: '2026-08' });
  await h.pay(pln, 'utilities.electricity', '2026-08-22', 802_000);
  expect((await monthlyBills(h.database, h.ws, '2026-09-08'))[0]).toMatchObject({ billMonth: '2026-09', state: 'upcoming', amountMinor: null, estimateMinor: 802_000 });
});

it('lists a bill’s months newest first: what is coming, what is late, what was paid or skipped', async () => {
  const h = await household();
  const internet = await h.bill('Biznet Home', 'utilities.internet_provider', 28, 450_000, { payByDay: 5, startsMonth: '2026-06' });
  await h.pay(internet, 'utilities.internet_provider', '2026-06-29', 450_000);
  await h.pay(internet, 'utilities.internet_provider', '2026-08-04', 450_000, '2026-07');
  await skipBill(h.database, h.ws, internet, '2026-05');

  const detail = await billDetail(h.database, h.ws, internet, '2026-09-08');
  expect(detail.bill).toMatchObject({ billMonth: '2026-08', state: 'overdue', days: 3 });
  expect(detail.history.map((row) => [row.month, row.state])).toEqual([
    ['2026-09', 'upcoming'],
    ['2026-08', 'overdue'],
    ['2026-07', 'paid'],
    ['2026-06', 'paid'],
    ['2026-05', 'skipped'],
  ]);
  expect(detail.history[2]).toMatchObject({ paidOn: '2026-08-04', paidMinor: 450_000 });
  expect(detail.bookName).toBe((await personalBook(h.database, h.ws)).name);
  await expect(billDetail(h.database, h.ws, 'nope', '2026-09-08')).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('holds its nerve when nothing recurring is set up', async () => {
  const h = await household();
  await expect(monthlyBills(h.database, h.ws, isoDate())).resolves.toEqual([]);
});
```

(Before running, confirm `utilities.mobile_phone` and `utilities.electricity` are real system keys: `grep -n "mobile_phone\|electricity" packages/core/src/categories/defaults.ts`. The sample seed uses both.)

- [ ] **Step 2: Run** — `cd packages/db && npx vitest run test/monthly-bills.test.ts` → FAIL (`billDetail` missing, states differ).

- [ ] **Step 3: Implement** — in `packages/db/src/repos/expense-templates.ts` replace everything from `/** Where a recurring bill stands this month. */` through the end of `monthlyBills`, and `dueExpenseTemplates`, with:

```ts
/** Where one month's bill stands. */
export type BillState = BillStateKind;

export interface MonthlyBill extends ExpenseTemplateRow {
  /** YYYY-MM: the month this row speaks for — last month while that is unsettled, otherwise this month. */
  billMonth: string;
  window: BillWindow;
  state: BillStateKind;
  days: number;
  /** The day the payment for billMonth was made. Not the day it was due. */
  paidOn: string | null;
  /** What it came to, which may differ from the template's amount. */
  paidMinor: number | null;
  paymentId: string | null;
  /** The fixed amount, else what it came to the last time it was paid, else null. */
  estimateMinor: number | null;
  /** Months a payment can be recorded for, oldest unsettled first. */
  payableMonths: string[];
}

export interface BillHistoryRow {
  month: string;
  window: BillWindow;
  state: BillStateKind;
  days: number;
  paidOn: string | null;
  paidMinor: number | null;
  paymentId: string | null;
}

export interface BillDetail {
  bill: MonthlyBill;
  history: BillHistoryRow[];
  /** The workspace the bill's category is filed in; null on a database without books. */
  bookName: string | null;
}

interface PaymentFact {
  templateId: string;
  billMonth: string;
  transactionId: string;
  occurredOn: string;
  amountMinor: number | null;
}

interface BillFacts {
  /** Per bill, newest payment first. */
  payments: Map<string, PaymentFact[]>;
  skips: Map<string, Set<string>>;
}

/** Posted payments and skips for these bills. Without migration 0044 a payment settles the month it was made in. */
async function billFacts(database: Database, ws: WorkspaceContext, templates: ExpenseTemplateRow[]): Promise<BillFacts> {
  const ids = templates.map((t) => t.id);
  const payments = new Map<string, PaymentFact[]>();
  const skips = new Map<string, Set<string>>();
  if (ids.length === 0) return { payments, skips };

  const rows = (await billTablesExist(database.db))
    ? await database.db
        .select({ templateId: billPayments.templateId, billMonth: billPayments.billMonth, transactionId: transactions.id, occurredOn: transactions.occurredOn })
        .from(billPayments)
        .innerJoin(transactions, eq(transactions.id, billPayments.transactionId))
        .where(and(eq(billPayments.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), inArray(billPayments.templateId, ids)))
    : (
        await database.db
          .select({ templateId: transactions.templateId, transactionId: transactions.id, occurredOn: transactions.occurredOn })
          .from(transactions)
          .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), inArray(transactions.templateId, ids)))
      ).map((row) => ({ ...row, templateId: row.templateId!, billMonth: row.occurredOn.slice(0, 7) }));

  const lines = rows.length === 0
    ? []
    : await database.db
        .select({ transactionId: entries.transactionId, accountId: entries.accountId, amountMinor: entries.amountMinor })
        .from(entries)
        .where(and(eq(entries.workspaceId, ws.workspaceId), inArray(entries.transactionId, rows.map((row) => row.transactionId))));
  const categoryOf = new Map(templates.map((t) => [t.id, t.categoryAccountId]));
  for (const row of rows) {
    const line = lines.find((l) => l.transactionId === row.transactionId && l.accountId === categoryOf.get(row.templateId));
    const list = payments.get(row.templateId) ?? [];
    list.push({ ...row, amountMinor: line ? Number(line.amountMinor) : null });
    payments.set(row.templateId, list);
  }
  for (const list of payments.values()) list.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));

  const skipRows = await database.db
    .select({ templateId: billSkips.templateId, month: billSkips.month })
    .from(billSkips)
    .where(and(eq(billSkips.workspaceId, ws.workspaceId), inArray(billSkips.templateId, ids)));
  for (const row of skipRows) {
    const set = skips.get(row.templateId) ?? new Set<string>();
    set.add(row.month);
    skips.set(row.templateId, set);
  }
  return { payments, skips };
}

function settledOf(template: ExpenseTemplateRow, facts: BillFacts): Record<string, 'paid' | 'skipped'> {
  const settled: Record<string, 'paid' | 'skipped'> = {};
  for (const month of facts.skips.get(template.id) ?? []) settled[month] = 'skipped';
  // A month both skipped and paid was paid.
  for (const payment of facts.payments.get(template.id) ?? []) settled[payment.billMonth] = 'paid';
  return settled;
}

function monthOfBill(template: ExpenseTemplateRow, facts: BillFacts, month: string, today: string): BillHistoryRow {
  const settled = settledOf(template, facts);
  const window = billWindow(month, template.dayOfMonth, template.payByDay);
  const payment = (facts.payments.get(template.id) ?? []).find((p) => p.billMonth === month) ?? null;
  const standing = billStanding(window, today, settled[month] ?? null);
  return { month, window, ...standing, paidOn: payment?.occurredOn ?? null, paidMinor: payment?.amountMinor ?? null, paymentId: payment?.transactionId ?? null };
}

function billRow(template: ExpenseTemplateRow, facts: BillFacts, today: string): MonthlyBill {
  const settled = settledOf(template, facts);
  const input = { today, startsMonth: template.startsMonth, outDay: template.dayOfMonth, payByDay: template.payByDay, settled };
  const { month, ...rest } = monthOfBill(template, facts, currentBillMonth(input), today);
  return {
    ...template,
    billMonth: month,
    ...rest,
    estimateMinor: template.amountMinor ?? facts.payments.get(template.id)?.[0]?.amountMinor ?? null,
    payableMonths: payableBillMonths(input),
  };
}

/**
 * Every active recurring bill, and where the month it speaks for stands on `onDate`.
 *
 * A bill belongs to the month it comes out, and a payment settles the month it names — so internet paid on
 * 3 September for August settles August, and September's bill is still to come.
 */
export async function monthlyBills(database: Database, ws: WorkspaceContext, onDate: string): Promise<MonthlyBill[]> {
  const templates = (await listExpenseTemplates(database, ws)).filter((template) => template.active);
  const facts = await billFacts(database, ws, templates);
  return templates
    .map((template) => billRow(template, facts, onDate))
    .sort((a, b) => a.window.payBy.localeCompare(b.window.payBy) || a.name.localeCompare(b.name));
}

/** One bill with its months, newest first: every month paid or skipped, and every month since it was tracked. */
export async function billDetail(database: Database, ws: WorkspaceContext, templateId: string, onDate: string): Promise<BillDetail> {
  const template = (await listExpenseTemplates(database, ws)).find((t) => t.id === templateId);
  if (!template) throw new RecurringError('NOT_FOUND', 'That bill is not here');
  const facts = await billFacts(database, ws, [template]);
  const months = new Set<string>([...(facts.skips.get(template.id) ?? []), ...(facts.payments.get(template.id) ?? []).map((p) => p.billMonth)]);
  for (let month = template.startsMonth; month <= monthOf(onDate); month = addMonths(month, 1)) months.add(month);
  const history = [...months]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 12)
    .map((month) => monthOfBill(template, facts, month, onDate));

  let bookName: string | null = null;
  if (await hasBooks(database.db)) {
    const [row] = await database.db
      .select({ name: books.name })
      .from(bookCategories)
      .innerJoin(books, eq(books.id, bookCategories.bookId))
      .where(eq(bookCategories.categoryAccountId, template.categoryAccountId));
    bookName = row?.name ?? null;
  }
  return { bill: billRow(template, facts, onDate), history, bookName };
}

/** Bills that are out and unpaid on `onDate`: overdue, due soon, or open. */
export async function dueExpenseTemplates(database: Database, ws: WorkspaceContext, onDate: string): Promise<MonthlyBill[]> {
  return (await monthlyBills(database, ws, onDate)).filter((bill) => bill.state === 'overdue' || bill.state === 'dueSoon' || bill.state === 'open');
}
```

Imports to add: `addMonths, billStanding, type BillStateKind, billWindow, type BillWindow, currentBillMonth, monthOf, payableBillMonths` from `@expanses/core`; `billPayments` from `'../schema-recurring'`; `books, bookCategories` from `'../schema-books'`; `hasBooks` from `'./books'`. Remove the now-unused `gte`, `lte` imports if nothing else uses them.

Since `startsMonth` goes back from the first-tracked month, `billDetail`'s loop runs at most from `startsMonth` to today; `slice(0, 12)` keeps the list short for old bills.

- [ ] **Step 4: Keep the web compiling** — in `apps/web/src/features/transactions/Recurring.tsx` (rebuilt in Task 7/9), map the old words onto the new states:

```ts
const OWED = new Set(['overdue', 'dueSoon', 'open']);
```

Replace `bill.state === 'owed'` with `OWED.has(bill.state)` (three places), `bill.state === 'later'` with `bill.state === 'upcoming'`, and in `lateness` read `bill.days` instead of computing from `dayOfMonth` (its one call site drops the `today` argument):

```ts
function lateness(bill: MonthlyBill): string {
  return bill.state === 'overdue' ? `${bill.days} ${bill.days === 1 ? 'day' : 'days'} late` : 'due';
}
```

In `skip`, skip `bill.billMonth` instead of `today.slice(0, 7)`; in `record`, pass `billMonth: bill.billMonth` to `postTransaction`. The existing e2e still passes: a bill out on the 1st is `overdue` or `dueSoon` and listed under "Owed now".

- [ ] **Step 5: Run** — `cd packages/db && npx vitest run` (including `expense-templates.test.ts`'s `dueExpenseTemplates` block and `books-sample-migration.test.ts`) → pass; `npm run typecheck` → clean; `cd apps/web && npx playwright test e2e/recurring-bills.spec.ts --workers=2` → pass.

- [ ] **Step 6: Commit** — `git commit -am "feat(db): bills by the month they come out, with each bill's history"` (with the trailer).

### Task 5: Recording payments, several at once, and undoing them

**Files:**
- Modify: `packages/db/src/repos/expense-templates.ts` (add `BillPaymentInput`, `recordBillPayments`, `undoBillPayments`)
- Test: `packages/db/test/bill-payments.test.ts`

**Interfaces:**
- Produces:

```ts
export interface BillPaymentInput {
  templateId: string;
  /** YYYY-MM: which month's bill this pays. */
  billMonth: string;
  amountMinor: number;
  /** The account that paid; the bill's own when absent. */
  moneyAccountId?: string;
}
export function recordBillPayments(database: Database, ws: WorkspaceContext, input: { paidOn: string; payments: BillPaymentInput[]; ratesToBase?: Record<string, number> }): Promise<string[]>;
export function undoBillPayments(database: Database, ws: WorkspaceContext, transactionIds: readonly string[]): Promise<void>;
```

Errors (`RecurringError.code`): `NOT_FOUND`, `MONTH_FORMAT`, `AMOUNT_RANGE`, `NOT_A_WALLET`, `ALREADY_SETTLED`. All-or-nothing.

- [ ] **Step 1: Failing tests**

```ts
// packages/db/test/bill-payments.test.ts
import { afterEach, expect, it } from 'vitest';
import {
  billDetail,
  createAccount,
  listAccounts,
  listTransactions,
  monthlyBills,
  recordBillPayments,
  saveExpenseTemplate,
  skipBill,
  undoBillPayments,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function household() {
  current = await setupDb();
  const { database, ws } = current;
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const jenius = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const internet = await saveExpenseTemplate(database, ws, {
    name: 'Biznet Home', categoryAccountId: category('utilities.internet_provider'), moneyAccountId: bca.id, amountMinor: 450_000, dayOfMonth: 28, payByDay: 5, startsMonth: '2026-08',
  });
  const rent = await saveExpenseTemplate(database, ws, {
    name: 'Apartment rent', categoryAccountId: category('property.housing_rent'), moneyAccountId: bca.id, amountMinor: 6_000_000, dayOfMonth: 1, startsMonth: '2026-09',
  });
  const pln = await saveExpenseTemplate(database, ws, {
    name: 'PLN electricity', categoryAccountId: category('utilities.electricity'), moneyAccountId: bca.id, amountMinor: null, dayOfMonth: 20, startsMonth: '2026-09',
  });
  const state = async (id: string, onDate: string) => (await monthlyBills(database, ws, onDate)).find((b) => b.id === id)!;
  return { database, ws, bca, jenius, category, internet, rent, pln, state };
}

it('records a payment on the day paid, for the month it names', async () => {
  const h = await household();
  const [id] = await recordBillPayments(h.database, h.ws, { paidOn: '2026-09-03', payments: [{ templateId: h.internet, billMonth: '2026-08', amountMinor: 450_000 }] });

  const [tx] = await listTransactions(h.database, h.ws, { from: '2026-09-01', to: '2026-09-30' });
  expect(tx).toMatchObject({ id, occurredOn: '2026-09-03', description: 'Biznet Home' });
  expect(tx!.entries.map((e) => [e.accountId, e.amountMinor])).toEqual([
    [h.category('utilities.internet_provider'), 450_000],
    [h.bca.id, -450_000],
  ]);
  expect(await h.state(h.internet, '2026-09-03')).toMatchObject({ billMonth: '2026-09', state: 'upcoming' });
  expect((await billDetail(h.database, h.ws, h.internet, '2026-09-03')).history.find((m) => m.month === '2026-08')).toMatchObject({ state: 'paid', paidOn: '2026-09-03' });
});

it('records several together, each for its own month and from its own account', async () => {
  const h = await household();
  const ids = await recordBillPayments(h.database, h.ws, {
    paidOn: '2026-09-21',
    payments: [
      { templateId: h.rent, billMonth: '2026-09', amountMinor: 6_000_000 },
      { templateId: h.pln, billMonth: '2026-09', amountMinor: 812_000, moneyAccountId: h.jenius.id },
    ],
  });
  expect(ids).toHaveLength(2);
  expect(await h.state(h.rent, '2026-09-21')).toMatchObject({ state: 'paid', paidMinor: 6_000_000 });
  expect(await h.state(h.pln, '2026-09-21')).toMatchObject({ state: 'paid', paidMinor: 812_000, estimateMinor: 812_000 });
  const [pln] = await listTransactions(h.database, h.ws, { accountId: h.jenius.id });
  expect(pln!.entries.find((e) => e.accountId === h.jenius.id)!.amountMinor).toBe(-812_000);
});

it('refuses a month already paid or skipped, and writes nothing from that batch', async () => {
  const h = await household();
  await recordBillPayments(h.database, h.ws, { paidOn: '2026-09-02', payments: [{ templateId: h.rent, billMonth: '2026-09', amountMinor: 6_000_000 }] });
  await expect(
    recordBillPayments(h.database, h.ws, {
      paidOn: '2026-09-21',
      payments: [
        { templateId: h.pln, billMonth: '2026-09', amountMinor: 812_000 },
        { templateId: h.rent, billMonth: '2026-09', amountMinor: 6_000_000 },
      ],
    }),
  ).rejects.toMatchObject({ code: 'ALREADY_SETTLED' });
  expect((await h.state(h.pln, '2026-09-21')).state).not.toBe('paid');

  await skipBill(h.database, h.ws, h.pln, '2026-09');
  await expect(
    recordBillPayments(h.database, h.ws, { paidOn: '2026-09-21', payments: [{ templateId: h.pln, billMonth: '2026-09', amountMinor: 812_000 }] }),
  ).rejects.toMatchObject({ code: 'ALREADY_SETTLED' });
});

it('refuses what cannot be a bill payment', async () => {
  const h = await household();
  const one = (payment: Partial<Parameters<typeof recordBillPayments>[2]['payments'][number]>) =>
    recordBillPayments(h.database, h.ws, { paidOn: '2026-09-21', payments: [{ templateId: h.rent, billMonth: '2026-09', amountMinor: 6_000_000, ...payment }] });
  await expect(one({ amountMinor: 0 })).rejects.toMatchObject({ code: 'AMOUNT_RANGE' });
  await expect(one({ billMonth: '2026-9' })).rejects.toMatchObject({ code: 'MONTH_FORMAT' });
  await expect(one({ templateId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(one({ moneyAccountId: h.category('property.housing_rent') })).rejects.toMatchObject({ code: 'NOT_A_WALLET' });
});

it('undo voids the payments, and the months are owed again', async () => {
  const h = await household();
  const ids = await recordBillPayments(h.database, h.ws, {
    paidOn: '2026-09-21',
    payments: [
      { templateId: h.rent, billMonth: '2026-09', amountMinor: 6_000_000 },
      { templateId: h.pln, billMonth: '2026-09', amountMinor: 812_000 },
    ],
  });
  await undoBillPayments(h.database, h.ws, ids);
  expect((await h.state(h.rent, '2026-09-21')).state).toBe('overdue');
  expect((await h.state(h.pln, '2026-09-21')).state).toBe('overdue');
  expect(await listTransactions(h.database, h.ws, { from: '2026-09-01', to: '2026-09-30' })).toEqual([]);
});
```

- [ ] **Step 2: Run** — `cd packages/db && npx vitest run test/bill-payments.test.ts` → FAIL (`recordBillPayments` missing).

- [ ] **Step 3: Implement** — append to `packages/db/src/repos/expense-templates.ts` (imports: `expenseLines` from `@expanses/core`; `postTransactionTx`, `voidTransactionTx` from `'./ledger'`; `type Db` from `'../database'`):

```ts
export interface BillPaymentInput {
  templateId: string;
  /** YYYY-MM: which month's bill this pays. */
  billMonth: string;
  amountMinor: number;
  /** The account that paid; the bill's own when absent. */
  moneyAccountId?: string;
}

async function isSettled(tx: Db, ws: WorkspaceContext, templateId: string, month: string): Promise<boolean> {
  const [skipped] = await tx
    .select({ month: billSkips.month })
    .from(billSkips)
    .where(and(eq(billSkips.workspaceId, ws.workspaceId), eq(billSkips.templateId, templateId), eq(billSkips.month, month)));
  if (skipped) return true;
  const [paid] = (await billTablesExist(tx))
    ? await tx
        .select({ id: transactions.id })
        .from(billPayments)
        .innerJoin(transactions, eq(transactions.id, billPayments.transactionId))
        .where(and(eq(billPayments.workspaceId, ws.workspaceId), eq(billPayments.templateId, templateId), eq(billPayments.billMonth, month), eq(transactions.status, 'posted')))
    : await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.templateId, templateId), eq(transactions.status, 'posted'), sql`substr(${transactions.occurredOn}, 1, 7) = ${month}`));
  return Boolean(paid);
}

/**
 * Records bill payments on one day, each an ordinary expense against its bill's category, linked to the bill and to
 * the month it settles. All or nothing: a batch caught up on a Sunday either lands whole or not at all.
 */
export function recordBillPayments(
  database: Database,
  ws: WorkspaceContext,
  input: { paidOn: string; payments: BillPaymentInput[]; ratesToBase?: Record<string, number> },
): Promise<string[]> {
  return database.transaction(async (tx) => {
    const ids: string[] = [];
    for (const payment of input.payments) {
      if (!BILL_MONTH.test(payment.billMonth)) throw new RecurringError('MONTH_FORMAT', 'A month is written YYYY-MM');
      if (!(Number.isSafeInteger(payment.amountMinor) && payment.amountMinor > 0)) {
        throw new RecurringError('AMOUNT_RANGE', 'Enter what the bill came to');
      }
      const [template] = await tx
        .select()
        .from(expenseTemplates)
        .where(and(eq(expenseTemplates.workspaceId, ws.workspaceId), eq(expenseTemplates.id, payment.templateId), sql`${expenseTemplates.archivedAt} IS NULL`));
      if (!template) throw new RecurringError('NOT_FOUND', 'That bill is not here');
      const [wallet] = await tx
        .select({ kind: accounts.kind, currency: accounts.currency })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.id, payment.moneyAccountId ?? template.moneyAccountId)));
      if (!wallet || (wallet.kind !== 'asset' && wallet.kind !== 'liability')) {
        throw new RecurringError('NOT_A_WALLET', 'A bill is paid from an account or a card');
      }
      if (await isSettled(tx, ws, template.id, payment.billMonth)) {
        throw new RecurringError('ALREADY_SETTLED', `${template.name} is already settled for that month`);
      }
      const currency = wallet.currency ?? ws.baseCurrency;
      ids.push(
        await postTransactionTx(tx, ws, {
          occurredOn: input.paidOn,
          description: template.name,
          templateId: template.id,
          billMonth: payment.billMonth,
          ratesToBase: input.ratesToBase,
          lines: expenseLines({ categoryAccountId: template.categoryAccountId, paymentAccountId: payment.moneyAccountId ?? template.moneyAccountId, amountMinor: payment.amountMinor, currency }),
        }),
      );
    }
    return ids;
  });
}

/** Takes recorded payments back: they are voided, so the months they settled are owed again. */
export function undoBillPayments(database: Database, ws: WorkspaceContext, transactionIds: readonly string[]): Promise<void> {
  return database.transaction(async (tx) => {
    for (const id of transactionIds) await voidTransactionTx(tx, ws, id);
  });
}
```

(`accounts.currency` is nullable for categories only; a wallet always has one. If `ledger.ts` already imports from `expense-templates.ts`, move `recordBillPayments`/`undoBillPayments` into a new `packages/db/src/repos/bill-payments.ts` and export it from `index.ts` to avoid a cycle — check with `grep -n "expense-templates" packages/db/src/repos/ledger.ts`.)

- [ ] **Step 4: Run** — `cd packages/db && npx vitest run` → all pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(db): record bill payments for a month, several at once, and undo them"` (with the trailer).

### Task 6: Decision A — bills counted in their bill month

**Files:**
- Modify: `packages/db/src/repos/bill-months.ts` (add `attributedOn`), `packages/db/src/repos/reports.ts` (`categoryTotalsBetween`), `packages/db/src/repos/budget-sheet.ts` (`budgetSheetFor`)
- Modify: `apps/web/src/features/transactions/SpendingReport.tsx`, `apps/web/src/features/transactions/IncomeFlow.tsx`, `apps/web/src/features/dashboard/DashboardPage.tsx`
- Test: `packages/db/test/bill-months-figures.test.ts`

**Interfaces:**
- Produces: `categoryTotalsBetween(database, ws, kind, from, to, opts: { excludeEvents?: boolean; billMonths?: boolean })`; `attributedOn(): SQL`.

- [ ] **Step 1: Failing test**

```ts
// packages/db/test/bill-months-figures.test.ts
import { expenseLines } from '@expanses/core';
import { afterEach, expect, it } from 'vitest';
import {
  budgetSheetFor,
  categoryTotalsBetween,
  createAccount,
  listAccounts,
  listTransactions,
  nativeBalances,
  postTransaction,
  recordBillPayments,
  saveExpenseTemplate,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/** August's internet (out on the 28th, pay by the 5th) paid on 3 September, and a meal on the 4th. */
async function augustInternetPaidInSeptember() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const internet = all.find((a) => a.systemKey === 'utilities.internet_provider')!.id;
  const restaurants = all.find((a) => a.systemKey === 'food_beverage.restaurants')!.id;
  const bill = await saveExpenseTemplate(database, ws, {
    name: 'Biznet Home', categoryAccountId: internet, moneyAccountId: bank.id, amountMinor: 450_000, dayOfMonth: 28, payByDay: 5, startsMonth: '2026-08',
  });
  const [payment] = await recordBillPayments(database, ws, { paidOn: '2026-09-03', payments: [{ templateId: bill, billMonth: '2026-08', amountMinor: 450_000 }] });
  await postTransaction(database, ws, {
    occurredOn: '2026-09-04',
    description: 'Warung',
    lines: expenseLines({ categoryAccountId: restaurants, paymentAccountId: bank.id, amountMinor: 100_000, currency: 'IDR' }),
  });
  return { database, ws, bank, bill, internet, restaurants, payment: payment! };
}

const ids = (rows: { accountId: string }[]) => rows.map((r) => r.accountId).sort();

it('category totals asked for by bill month count the bill in August', async () => {
  const { database, ws, internet, restaurants } = await augustInternetPaidInSeptember();

  expect(await categoryTotalsBetween(database, ws, 'expense', '2026-08-01', '2026-08-31', { billMonths: true })).toEqual([
    { accountId: internet, amountBaseMinor: 450_000, transactions: 1 },
  ]);
  expect(await categoryTotalsBetween(database, ws, 'expense', '2026-09-01', '2026-09-30', { billMonths: true })).toEqual([
    { accountId: restaurants, amountBaseMinor: 100_000, transactions: 1 },
  ]);
  // A week holds it on the bill's out day, not on the first of the month.
  expect(ids(await categoryTotalsBetween(database, ws, 'expense', '2026-08-24', '2026-08-30', { billMonths: true }))).toEqual([internet]);
  // Asked without the option, nothing moves: the day paid decides, as before.
  expect(ids(await categoryTotalsBetween(database, ws, 'expense', '2026-09-01', '2026-09-30'))).toEqual([internet, restaurants].sort());
  expect(await categoryTotalsBetween(database, ws, 'expense', '2026-08-01', '2026-08-31')).toEqual([]);
});

it('a bill paid inside its own month counts on the day it was paid', async () => {
  const { database, ws, bill, internet } = await augustInternetPaidInSeptember();
  await recordBillPayments(database, ws, { paidOn: '2026-09-30', payments: [{ templateId: bill, billMonth: '2026-09', amountMinor: 450_000 }] });
  expect(await categoryTotalsBetween(database, ws, 'expense', '2026-09-29', '2026-09-30', { billMonths: true })).toEqual([
    { accountId: internet, amountBaseMinor: 450_000, transactions: 1 },
  ]);
});

it('the budget sheet counts the bill in the month it came out', async () => {
  const { database, ws } = await augustInternetPaidInSeptember();
  expect((await budgetSheetFor(database, ws, '2026-08')).spendingActualMinor).toBe(450_000);
  expect((await budgetSheetFor(database, ws, '2026-09')).spendingActualMinor).toBe(100_000);
});

it('history and balances keep the payment on the day it was paid', async () => {
  const { database, ws, bank, payment } = await augustInternetPaidInSeptember();
  expect((await listTransactions(database, ws, { from: '2026-09-01', to: '2026-09-30' })).map((t) => t.id)).toContain(payment);
  expect(await listTransactions(database, ws, { from: '2026-08-01', to: '2026-08-31' })).toEqual([]);
  expect((await nativeBalances(database, ws, '2026-08-31'))[bank.id] ?? 0).toBe(0);
  expect((await nativeBalances(database, ws, '2026-09-30'))[bank.id]).toBe(-550_000);
});
```

- [ ] **Step 2: Run** — `cd packages/db && npx vitest run test/bill-months-figures.test.ts` → FAIL (August totals empty).

- [ ] **Step 3: Implement the attributed date** — append to `packages/db/src/repos/bill-months.ts`:

```ts
/**
 * The day a transaction counts on in a monthly spending figure. A bill payment made outside the month whose bill it
 * settles counts on that bill's out day in that month (clamped to the month's end); everything else, including a
 * bill paid inside its own month, counts on the day it happened.
 */
export const attributedOn = (): SQL => sql`COALESCE((
  SELECT CASE WHEN bp.bill_month = substr(${transactions.occurredOn}, 1, 7) THEN NULL
    ELSE min(date(bp.bill_month || '-01', '+' || (et.day_of_month - 1) || ' days'), date(bp.bill_month || '-01', '+1 month', '-1 day')) END
  FROM bill_payments bp JOIN expense_templates et ON et.id = bp.template_id
  WHERE bp.transaction_id = ${transactions.id}
), ${transactions.occurredOn})`;
```

In `packages/db/src/repos/reports.ts`, change the options type to `opts: { excludeEvents?: boolean; billMonths?: boolean } = {}`, import `attributedOn, billTablesExist` from `'./bill-months'`, and before the query:

```ts
  // The budget and Cashflow ask for bills in the month they came out; every other reader keeps the day paid.
  const byBillMonth = opts.billMonths === true && (await billTablesExist(database.db));
  const inPeriod = byBillMonth
    ? [
        sql`(${transactions.occurredOn} BETWEEN ${from} AND ${to} OR ${transactions.id} IN (SELECT transaction_id FROM bill_payments WHERE bill_month BETWEEN ${from.slice(0, 7)} AND ${to.slice(0, 7)}))`,
        sql`${attributedOn()} BETWEEN ${from} AND ${to}`,
      ]
    : [gte(transactions.occurredOn, from), lte(transactions.occurredOn, to)];
```

and in the `where(and(...))` replace the `gte`/`lte` pair with `...inPeriod,`. Update the JSDoc: "`billMonths` counts a bill payment in the month whose bill it settled (see the recurring bills spec, decision A)."

In `packages/db/src/repos/budget-sheet.ts` change the call to `categoryTotalsBetween(database, ws, 'expense', from, to, { excludeEvents: true, billMonths: true })`.

- [ ] **Step 4: The Cashflow readers ask for it**

- `apps/web/src/features/transactions/SpendingReport.tsx`: `queryFn: () => categoryTotalsBetween(database, ws, kind, from, to, { excludeEvents: true, billMonths: true })`.
- `apps/web/src/features/transactions/IncomeFlow.tsx`: the `spending` query → `categoryTotalsBetween(database, ws, 'expense', from, to, { billMonths: true })`.
- `apps/web/src/features/dashboard/DashboardPage.tsx`: the two expense calls (`spending`, `lastSpending`) gain `{ billMonths: true }`, so the dashboard's month agrees with Cashflow's. Leave the income call alone.

- [ ] **Step 5: Run** — `cd packages/db && npx vitest run` (all, `books-sample-migration.test.ts` must stay identical before/after migrating, since backfilled payments sit in their own month) → pass; `npm run typecheck` → clean.

- [ ] **Step 6: Commit** — `git commit -am "feat: the budget and Cashflow count a bill in the month it came out"` (with the trailer).

---

## Step 2 — The Recurring screen

UI tasks below give exact files, labels, copy and the key code; follow the existing components (`Sheet`, `PageHeader`, `RoundButton`, `Button`, `Card`, `Field`, `Input`, `Select`, `Money`, `ErrorBox` from `apps/web/src/ui`, `CategoryIcon` from `apps/web/src/features/categories/CategoryIcon.tsx`) and their Tailwind idioms. Every user-visible string is the prototype's.

### Task 7: Web data, the view model, and the Cashflow card

**Files:**
- Create: `apps/web/src/features/bills/queries.ts`, `apps/web/src/features/bills/bill-view.ts`, `apps/web/src/features/bills/bill-view.test.ts`
- Modify: `apps/web/src/features/transactions/Recurring.tsx`

**Interfaces:**
- Produces: `useMonthlyBills(today)`, `useBillDetail(billId, today)`; `isSettled`, `amountOf`, `sectionsOf`, `summaryOf`, `owedNow`, `sublineOf`, `pillOf`, `variesWords`, `PILL_CLASS`.

- [ ] **Step 1: Queries**

```ts
// apps/web/src/features/bills/queries.ts
import { billDetail, monthlyBills } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useMonthlyBills(today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['monthly-bills', ws.workspaceId, ws.bookId ?? null, today], queryFn: () => monthlyBills(database, ws, today) });
}

export function useBillDetail(billId: string, today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['bill-detail', ws.workspaceId, ws.bookId ?? null, billId, today], queryFn: () => billDetail(database, ws, billId, today) });
}
```

- [ ] **Step 2: Failing view-model test**

```ts
// apps/web/src/features/bills/bill-view.test.ts
import { billWindow } from '@expanses/core';
import type { MonthlyBill } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { owedNow, sectionsOf, sublineOf, summaryOf } from './bill-view';

const bill = (over: Partial<MonthlyBill>): MonthlyBill => ({
  id: over.name ?? 'x',
  name: 'x',
  categoryAccountId: 'c',
  moneyAccountId: 'm',
  amountMinor: 100,
  dayOfMonth: 1,
  payByDay: null,
  startsMonth: '2026-08',
  active: true,
  billMonth: '2026-09',
  window: billWindow('2026-09', 1, null),
  state: 'open',
  days: 5,
  paidOn: null,
  paidMinor: null,
  paymentId: null,
  estimateMinor: 100,
  payableMonths: ['2026-09'],
  ...over,
});

const rows = [
  bill({ name: 'Biznet', state: 'overdue', amountMinor: 450_000, estimateMinor: 450_000, billMonth: '2026-08' }),
  bill({ name: 'Tuition', state: 'dueSoon', amountMinor: 3_500_000, estimateMinor: 3_500_000 }),
  bill({ name: 'Telkomsel', state: 'open', amountMinor: null, estimateMinor: 290_000 }),
  bill({ name: 'PLN', state: 'upcoming', amountMinor: null, estimateMinor: 780_000 }),
  bill({ name: 'Rent', state: 'paid', amountMinor: 6_000_000, paidMinor: 6_000_000, paidOn: '2026-09-01' }),
  bill({ name: 'Gym', state: 'skipped', amountMinor: 350_000 }),
];

describe('the Recurring list', () => {
  it('groups by urgency and counts what is settled', () => {
    expect(sectionsOf(rows).map((s) => [s.title, s.rows.map((r) => r.name)])).toEqual([
      ['Overdue', ['Biznet']],
      ['Due soon', ['Tuition']],
      ['Later', ['Telkomsel', 'PLN']],
      ['Paid and skipped · 2', ['Rent', 'Gym']],
    ]);
  });

  it('adds up what is still to pay, saying when estimates are in it', () => {
    expect(summaryOf(rows, '2026-09-08')).toEqual({
      monthLabel: 'September',
      totalMinor: 450_000 + 3_500_000 + 290_000 + 780_000,
      approximate: true,
      variesText: '2 amounts vary',
      lines: [
        { key: 'overdue', label: 'Overdue', minor: 450_000, approximate: false },
        { key: 'dueSoon', label: 'Due soon', minor: 3_500_000, approximate: false },
        { key: 'later', label: 'Later this month', minor: 1_070_000, approximate: true },
      ],
      allSettled: false,
    });
    expect(summaryOf([rows[4]!], '2026-09-08')).toMatchObject({ totalMinor: 0, lines: [], allSettled: true });
  });

  it('owed now is what is out and unpaid', () => {
    expect(owedNow(rows)).toEqual({ minor: 450_000 + 3_500_000 + 290_000, approximate: true });
  });

  it('names an earlier month in the subline', () => {
    expect(sublineOf(rows[0]!, 'BCA Tahapan', '2026-09-08')).toBe('Aug bill · BCA Tahapan');
    expect(sublineOf(rows[1]!, 'BCA Tahapan', '2026-09-08')).toBe('BCA Tahapan');
  });
});
```

Run: `cd apps/web && npx vitest run src/features/bills/bill-view.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/web/src/features/bills/bill-view.ts
import { billPill, type BillTone, monthName } from '@expanses/core';
import type { MonthlyBill } from '@expanses/db';

export const isSettled = (bill: MonthlyBill) => bill.state === 'paid' || bill.state === 'skipped';
const isOutAndUnpaid = (bill: MonthlyBill) => bill.state === 'overdue' || bill.state === 'dueSoon' || bill.state === 'open';

/** What a row is worth in a total: what it came to once paid, else its amount, else the estimate. */
export const amountOf = (bill: MonthlyBill) => (bill.state === 'paid' ? (bill.paidMinor ?? 0) : (bill.amountMinor ?? bill.estimateMinor ?? 0));

export const variesWords = (n: number) => (n === 1 ? '1 amount varies' : `${n} amounts vary`);

export interface BillSection {
  key: 'overdue' | 'dueSoon' | 'later' | 'settled';
  title: string;
  rows: MonthlyBill[];
}

export function sectionsOf(rows: readonly MonthlyBill[]): BillSection[] {
  const settled = rows.filter(isSettled);
  return [
    { key: 'overdue' as const, title: 'Overdue', rows: rows.filter((b) => b.state === 'overdue') },
    { key: 'dueSoon' as const, title: 'Due soon', rows: rows.filter((b) => b.state === 'dueSoon') },
    { key: 'later' as const, title: 'Later', rows: rows.filter((b) => b.state === 'open' || b.state === 'upcoming') },
    { key: 'settled' as const, title: `Paid and skipped · ${settled.length}`, rows: settled },
  ].filter((section) => section.rows.length > 0);
}

const sum = (rows: readonly MonthlyBill[]) => rows.reduce((total, b) => total + amountOf(b), 0);
const anyVaries = (rows: readonly MonthlyBill[]) => rows.some((b) => b.amountMinor === null);

export interface BillSummary {
  monthLabel: string;
  totalMinor: number;
  approximate: boolean;
  variesText: string | null;
  lines: { key: 'overdue' | 'dueSoon' | 'later'; label: string; minor: number; approximate: boolean }[];
  allSettled: boolean;
}

export function summaryOf(rows: readonly MonthlyBill[], today: string): BillSummary {
  const open = rows.filter((b) => !isSettled(b));
  const varying = open.filter((b) => b.amountMinor === null).length;
  const groups = [
    { key: 'overdue' as const, label: 'Overdue', rows: open.filter((b) => b.state === 'overdue') },
    { key: 'dueSoon' as const, label: 'Due soon', rows: open.filter((b) => b.state === 'dueSoon') },
    { key: 'later' as const, label: 'Later this month', rows: open.filter((b) => b.state === 'open' || b.state === 'upcoming') },
  ];
  return {
    monthLabel: monthName(today.slice(0, 7), 'long'),
    totalMinor: sum(open),
    approximate: varying > 0,
    variesText: varying > 0 ? variesWords(varying) : null,
    lines: groups.filter((g) => sum(g.rows) > 0).map((g) => ({ key: g.key, label: g.label, minor: sum(g.rows), approximate: anyVaries(g.rows) })),
    allSettled: open.length === 0,
  };
}

/** What the Cashflow card calls owed: every bill that is out and unpaid. */
export function owedNow(rows: readonly MonthlyBill[]): { minor: number; approximate: boolean } {
  const out = rows.filter(isOutAndUnpaid);
  return { minor: sum(out), approximate: anyVaries(out) };
}

export function sublineOf(bill: MonthlyBill, accountName: string, today: string): string {
  return bill.billMonth < today.slice(0, 7) ? `${monthName(bill.billMonth, 'short')} bill · ${accountName}` : accountName;
}

export const PILL_CLASS: Record<BillTone, string> = {
  grey: 'bg-slate-100 text-slate-600',
  blue: 'bg-blue-50 text-blue-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  green: 'bg-emerald-50 text-emerald-700',
};

export function pillOf(bill: Pick<MonthlyBill, 'state' | 'days' | 'window' | 'paidOn'>): { text: string; className: string } {
  const pill = billPill({ state: bill.state, days: bill.days }, bill.window, bill.paidOn);
  return { text: pill.text, className: PILL_CLASS[pill.tone] };
}
```

Run the test again → PASS.

- [ ] **Step 4: The Cashflow card** — rewrite `apps/web/src/features/transactions/Recurring.tsx` to the card only. Delete `RecurringSheet`, `useBills`, `lateness`, `day`, `ordinal` and the `Sheet`/`Input`/`postTransaction`/`skipBill` imports. The card keeps `data-testid="recurring-card"` and becomes a `Link`:

```tsx
export function Recurring({ today = isoDate() }: { today?: string }) {
  const { ws } = useApp();
  const rows = useMonthlyBills(today).data ?? [];
  if (rows.length === 0) return null;
  const settled = rows.filter(isSettled).length;
  const owed = owedNow(rows);
  const done = settled === rows.length;
  return (
    <Card>
      <Link to="/bills" className="flex w-full items-center gap-3 text-left" data-testid="recurring-card">
        {/* icon span unchanged */}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Recurring</span>
          <span className="block truncate text-xs text-slate-500">{settled} of {rows.length} {rows.length === 1 ? 'bill' : 'bills'} paid</span>
        </span>
        {owed.minor > 0 && (
          <span className="shrink-0 text-sm font-semibold">
            {owed.approximate && '~'}
            <Money minor={owed.minor} currency={ws.baseCurrency} />
          </span>
        )}
        <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
      </Link>
    </Card>
  );
}
```

The sheet is gone, so in `apps/web/e2e/recurring-bills.spec.ts` mark the sheet-based tests `test.skip` with the comment `// Rewritten against the Recurring screen in Task 9.` (Task 9 replaces them) and keep `'a bill whose day has passed is owed…'`'s first half (card text `0 of 1 bill paid`, `150.000`) as its own un-skipped test named `'the Cashflow card counts the month’s bills'`.

- [ ] **Step 5: Run** — `npm run typecheck`, `npm test`, `cd apps/web && npx playwright test --workers=2` → pass.

- [ ] **Step 6: Commit** — `git commit -am "feat(web): the month's bills as a view model, and the card opens Recurring"` (with the trailer).

### Task 8: New and edit bill — S1

**Files:**
- Create: `apps/web/src/features/bills/BillFormPage.tsx`
- Modify: `apps/web/src/app/router.tsx` (routes `/bills/new`, `/bills/$billId/edit`), `apps/web/src/features/transactions/BillList.tsx` ("Add a bill" and "Edit" become links; its inline form goes)
- Test: `apps/web/e2e/recurring-bills.spec.ts`

**Interfaces:**
- Consumes: `saveExpenseTemplate` (`payByDay`), `listExpenseTemplates`.
- Produces: `BillFormPage` with `billId?: string`.

- [ ] **Step 1: Failing e2e** — in `apps/web/e2e/recurring-bills.spec.ts` replace `addBill` with:

```ts
/** Bills are set up on their own page. Out on the 1st unless told otherwise, so the bill is always out. */
async function addBill(page: Page, options: { name: string; amount?: string; out?: number; payBy?: number }) {
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(options.name);
  if (options.amount !== undefined) await page.getByLabel('Amount', { exact: true }).fill(options.amount);
  // Whichever category is first: the point is the bill, not which category it lands in.
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Bill is out on').selectOption(String(options.out ?? 1));
  if (options.payBy !== undefined) await page.getByLabel('Pay by').selectOption(String(options.payBy));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByTestId('bill-row').filter({ hasText: options.name })).toBeVisible();
}
```

and add:

```ts
test('a bill keeps its pay-by day through an edit', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Biznet Home', amount: '450000', out: 28, payBy: 5 });
  await page.getByTestId('bill-row').filter({ hasText: 'Biznet Home' }).getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit bill' })).toBeVisible();
  await expect(page.getByLabel('Bill is out on')).toHaveValue('28');
  await expect(page.getByLabel('Pay by')).toHaveValue('5');
  await page.getByLabel('Pay by').selectOption('');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByTestId('bill-row').filter({ hasText: 'Biznet Home' }).getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Pay by')).toHaveValue('');
});
```

(The `bill-row` Edit link exists only until Task 9 replaces the list; Task 9 rewrites this test to go through the bill page's ✎.)

Run: `cd apps/web && npx playwright test e2e/recurring-bills.spec.ts --project=chromium` → FAIL (no `/bills/new`).

- [ ] **Step 2: Routes** — in `apps/web/src/app/router.tsx`, after the `/bills` route:

```tsx
  createRoute({ getParentRoute: () => rootRoute, path: '/bills/new', component: () => <BillFormPage /> }),
  createRoute({ getParentRoute: () => rootRoute, path: '/bills/$billId/edit', component: EditBillRoute }),
```

with, in `BillFormPage.tsx`, `export function EditBillRoute() { const { billId } = useParams({ from: '/bills/$billId/edit' }); return <BillFormPage billId={billId} />; }` (if `useParams({ from })` does not type-check against the code-built route tree, use `useParams({ strict: false })` and read `billId` as `string`).

- [ ] **Step 3: The form** — `BillFormPage({ billId }: { billId?: string })`:

- State `name`, `amount`, `categoryAccountId`, `moneyAccountId`, `outDay` (string, default `'1'`), `payBy` (string, `''` = none), `error`. When `billId` is set, fill them once from `listExpenseTemplates` (query key `['expense-templates', ws.workspaceId, ws.bookId ?? null]`) — `amount` via `minorToMajorString(amountMinor, currency)`, `payBy` via `String(payByDay ?? '')`.
- Categories: `accounts.filter((a) => a.kind === 'expense' && a.subtype === 'category' && inOpenBook(a))` (as `BillList` does, with `useInOpenBook()`); wallets: subtypes `bank`, `cash`, `savings`, `credit_card`, not archived.
- Layout: `<PageHeader title={billId ? 'Edit bill' : 'New bill'} />`, then a `Card` with a `<form>`:
  - `Field label="Name"` → `Input` placeholder "Phone, water, gas".
  - `Field label="Amount" hint="Leave it empty when it changes every month, like electricity. You'll be asked each time."` → `Input inputMode="decimal"`.
  - `Field label="Category"` → `Select` with "Choose a category" first.
  - `Field label="Paid from"` → `Select` with "Choose an account" first.
  - A heading `<h2 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">When</h2>`.
  - `Field label="Repeats"` → `<Select value="monthly" disabled><option value="monthly">Every month</option></Select>`.
  - `Field label="Bill is out on"` → `Select` of `1..31`, each `<option value={n}>{ordinal(n)}</option>` (`ordinal` from `@expanses/core`).
  - `Field label="Pay by" hint="Earlier than the out day means the next month: out on the 28th, pay by the 5th."` → `Select` with `<option value="">No pay-by day</option>` then `1..31` as above.
  - Buttons: `<Button type="submit">Save</Button>` and a secondary `Link` "Cancel" back (to `/bills/$billId` when editing, `/bills` otherwise).
- Submit:

```ts
const wallet = accounts.find((a) => a.id === moneyAccountId);
const id = await saveExpenseTemplate(database, ws, {
  id: billId,
  name,
  categoryAccountId,
  moneyAccountId,
  amountMinor: amount.trim() === '' ? null : parseMajor(amount.trim(), wallet?.currency ?? ws.baseCurrency),
  dayOfMonth: Number(outDay),
  payByDay: payBy === '' ? null : Number(payBy),
});
await invalidate();
await navigate(billId ? { to: '/bills/$billId', params: { billId: id } } : { to: '/bills' });
```

Until Task 10 adds the bill page, navigate to `/bills` in both cases (change it in Task 10). Errors go to `ErrorBox`.

- [ ] **Step 4: Point the old list at it** — in `BillList.tsx` remove the inline form and its state; "Add a bill" becomes `<Link to="/bills/new">Add a bill</Link>` styled as the secondary button; each row's "Edit" becomes `<Link to="/bills/$billId/edit" params={{ billId: bill.id }}>Edit</Link>`. "Remove" stays.

- [ ] **Step 5: Run** — gate (`npm run typecheck`, `npm test`, `cd apps/web && npx playwright test --workers=2`) → pass.

- [ ] **Step 6: Commit** — `git commit -am "feat(web): new and edit bill, with the day it is out and the day to pay by"` (with the trailer).

### Task 9: The Recurring list — V1, swipes, desktop actions, payment sheet from the list

**Files:**
- Create: `apps/web/src/features/bills/RecurringPage.tsx`, `BillRow.tsx`, `SwipeRow.tsx`, `PaySheet.tsx`, `UndoToast.tsx`
- Modify: `apps/web/src/app/router.tsx` (`/bills` → `RecurringPage`)
- Delete: `apps/web/src/features/transactions/BillsPage.tsx`, `BillList.tsx`, `BillsDue.tsx`; in `apps/web/src/features/transactions/queries.ts` delete `useDueBills` and `useExpenseTemplates` (after `grep -rn "useDueBills\|useExpenseTemplates" apps/web/src` shows no other user; delete the file if empty)
- Test: `apps/web/e2e/recurring-bills.spec.ts` (rewrite the skipped tests)

**Interfaces:**
- Consumes: `useMonthlyBills`, `sectionsOf`, `summaryOf`, `sublineOf`, `pillOf`, `amountOf`; `recordBillPayments`, `undoBillPayments`, `skipBill`, `unskipBill`.
- Produces: `PaySheet({ bill, today, onClose, onPaid, fromList })`, `UndoToast({ text, onUndo, onDone })`, `SwipeRow`.

- [ ] **Step 1: Failing e2e** — replace the skipped tests with (keep `addWallet`, the new `addBill`, and the card test):

```ts
const row = (page: Page, name: string) => page.getByTestId('bill-row').filter({ hasText: name });

/** The desktop way to a row's actions: the ⋯ button, shown on hover and focus. */
async function rowAction(page: Page, name: string, action: RegExp) {
  await row(page, name).hover();
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

test('a bill that is out is paid from its row, and the month is settled', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });

  await page.goto('/transactions');
  await page.getByTestId('recurring-card').click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByTestId('bills-summary')).toContainText('Still to pay in');
  await expect(page.getByTestId('bills-summary')).toContainText('150.000');

  await rowAction(page, 'Phone', /^Pay/);
  const sheet = page.getByRole('dialog', { name: 'Pay Phone' });
  await expect(sheet.getByLabel('What it came to')).not.toHaveValue('');
  await sheet.getByRole('button', { name: 'Record payment' }).click();

  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Paid Phone');
  await expect(page.getByText('Paid and skipped · 1')).toBeVisible();
  await expect(row(page, 'Phone')).toContainText('✓ Paid');

  await page.goto('/transactions');
  await expect(page.getByTestId('recurring-card')).toContainText('1 of 1 bill paid');
  await expect(page.getByRole('listitem').filter({ hasText: 'Phone' }).first()).toBeVisible();
});

test('undo takes a payment back', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await rowAction(page, 'Phone', /^Pay/);
  await page.getByRole('dialog', { name: 'Pay Phone' }).getByRole('button', { name: 'Record payment' }).click();
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(/Paid and skipped/)).toHaveCount(0);
  await expect(row(page, 'Phone')).not.toContainText('✓ Paid');
});

test('a bill that varies asks what it came to', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Electricity' });
  await expect(row(page, 'Electricity')).toContainText('Amount varies');

  await rowAction(page, 'Electricity', /^Pay/);
  const sheet = page.getByRole('dialog', { name: 'Pay Electricity' });
  await expect(sheet.getByLabel('What it came to')).toHaveValue('');
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(sheet).toContainText('Enter what it came to');
  await sheet.getByLabel('What it came to').fill('432000');
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(sheet).toHaveCount(0);

  await page.goto('/transactions');
  await expect(page.getByRole('listitem').filter({ hasText: '432.000' }).first()).toBeVisible();
});

test('a month can be skipped, and the skip undone', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Fitness First', amount: '850000' });
  await rowAction(page, 'Fitness First', /^Skip/);
  await expect(page.getByRole('status')).toContainText('Skipped Fitness First this month');
  await expect(row(page, 'Fitness First')).toContainText('Skipped');
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Fitness First')).not.toContainText('Skipped');
});

test('a bill not out yet opens later, and can be paid early', async ({ page }) => {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  test.skip(now.getDate() >= last, 'Nothing is still to come on the last day of a month');
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Housing rent', amount: '5000000', out: 31 });
  await expect(page.getByText('Later', { exact: true })).toBeVisible();
  await expect(row(page, 'Housing rent')).toContainText('Opens');
  await rowAction(page, 'Housing rent', /^Pay/);
  await expect(page.getByRole('dialog', { name: 'Pay Housing rent' })).toBeVisible();
});
```

Move the pay-by edit test from Task 8 to use the list's page link later (Task 10); for now change its two `getByRole('link', { name: 'Edit' })` clicks to `page.goto` of the edit URL read from the row: add `data-bill-id={bill.id}` on each `bill-row` and navigate with `` await page.goto(`/bills/${await row(page, 'Biznet Home').getAttribute('data-bill-id')}/edit`) ``.

Run → FAIL (no Recurring screen).

- [ ] **Step 2: `SwipeRow`** — a pointer-driven container; no library.

```tsx
// apps/web/src/features/bills/SwipeRow.tsx
import { type ReactNode, useRef, useState } from 'react';
import { cx } from '../../ui';

const REVEAL = 76;
const PAY_AT = 70;
const OPEN_AT = 50;

/**
 * A row that slides: right past a threshold calls onSwipeRight, left reveals the action behind it. A tap is a tap —
 * the row's own button handles it — and a drag never also counts as a tap.
 */
export function SwipeRow({
  children,
  enabled,
  onSwipeRight,
  rightHint,
  leftAction,
}: {
  children: (suppressClick: () => boolean) => ReactNode;
  enabled: boolean;
  onSwipeRight?: () => void;
  rightHint?: ReactNode;
  leftAction?: ReactNode;
}) {
  const [x, setX] = useState(0);
  const drag = useRef<{ startX: number; startY: number; base: number; moved: boolean; pointer: number } | null>(null);
  const dragged = useRef(false);
  const canRight = enabled && Boolean(onSwipeRight);
  const canLeft = enabled && Boolean(leftAction);

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 flex items-stretch justify-between" aria-hidden={x === 0}>
        <div className="flex items-center bg-emerald-600 px-5 text-sm font-semibold text-white">{x > 0 && rightHint}</div>
        <div className="flex items-stretch">{x < 0 && leftAction}</div>
      </div>
      <div
        className={cx('relative bg-white', drag.current ? '' : 'transition-transform duration-150')}
        style={{ transform: `translateX(${x}px)`, touchAction: 'pan-y' }}
        onPointerDown={(e) => {
          dragged.current = false;
          if (!enabled) return;
          drag.current = { startX: e.clientX, startY: e.clientY, base: x, moved: false, pointer: e.pointerId };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.startX;
          if (!d.moved) {
            if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(e.clientY - d.startY)) return;
            d.moved = true;
            e.currentTarget.setPointerCapture(d.pointer);
          }
          let next = d.base + dx;
          if (!canRight) next = Math.min(next, 0);
          if (!canLeft) next = Math.max(next, 0);
          setX(Math.max(-110, Math.min(110, next)));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d?.moved) {
            if (x !== 0) {
              dragged.current = true;
              setX(0);
            }
            return;
          }
          dragged.current = true;
          if (x > PAY_AT && canRight) {
            setX(0);
            onSwipeRight!();
          } else setX(x < -OPEN_AT && canLeft ? -REVEAL : 0);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setX(0);
        }}
      >
        {children(() => {
          const was = dragged.current;
          dragged.current = false;
          return was;
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `BillRow`** — one row, used in normal and select mode:

- Wrapper `<div data-testid="bill-row" data-bill-id={bill.id} className="group relative border-t border-slate-100 first:border-t-0">`.
- `SwipeRow enabled={!selecting && !isSettled(bill)} onSwipeRight={() => onPay(bill)} rightHint="Pay" leftAction={<button type="button" onClick={() => onSkip(bill)} aria-label={`Skip ${bill.name}`} className="w-[76px] bg-slate-500 text-sm font-semibold text-white">Skip</button>}`.
- Inside, a full-width `<button type="button">` (min-h-14, flex, gap-3, px-3, text-left) whose `onClick` is `() => { if (suppressClick()) return; selecting ? onToggle(bill) : navigate({ to: '/bills/$billId', params: { billId: bill.id } }); }` — until Task 10 adds the page, a normal tap calls `onPay(bill)` for unsettled rows and does nothing for settled rows; Task 10 switches it to navigation. In select mode it has `role="checkbox"`, `aria-checked={picked}`, `aria-label={`Select ${bill.name}`}` and is `disabled` for settled rows.
- Leading: in select mode an unsettled row shows a 36px round tick box (`bg-emerald-600 text-white` with `Check` icon when picked, `bg-slate-100` otherwise); otherwise `<CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} />`.
- Middle: name (`text-sm font-medium truncate`), subline `sublineOf(bill, accountName, today)` (`text-xs text-slate-500 truncate`).
- Right: amount — `bill.state === 'paid'` → `<Money minor={bill.paidMinor ?? 0} …/>`; fixed → `<Money minor={bill.amountMinor} …/>`; varying with estimate → `<span className="text-slate-500">~<Money minor={bill.estimateMinor} …/> · varies</span>`; no estimate → `<span className="text-slate-500">Amount varies</span>`. Below it the pill: `<span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', pillOf(bill).className)}>{pillOf(bill).text}</span>`.
- Desktop ⋯ (not in select mode): `<button type="button" aria-label={`Actions for ${bill.name}`} aria-haspopup="menu" aria-expanded={menuOpen} className="absolute top-1/2 right-2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 md:flex md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 md:group-focus-within:opacity-100">` with `MoreHorizontal`. The menu (`role="menu"`, absolutely positioned under it, closes on Escape, on outside `pointerdown`, and after a choice) lists `role="menuitem"` buttons: **Pay…** and **Skip {monthName(bill.billMonth, 'short')} bill** (both only when unsettled), and **See bill** (added in Task 10). Leave the ⋯ out of the `SwipeRow`'s moving layer so a drag never lands on it; give the row's main button `md:pr-12` so the amount does not sit under it.

- [ ] **Step 4: `PaySheet`** — P1.

```tsx
export function PaySheet({ bill, today, onClose, onPaid, onSkipped, onSeeBill }: {
  bill: MonthlyBill;
  today: string;
  onClose: () => void;
  onPaid: (transactionIds: string[], amountMinor: number, paidOn: string, billMonth: string) => void;
  onSkipped: (billMonth: string) => void;
  /** Shown only when the sheet was opened from the list. */
  onSeeBill?: () => void;
}) {
```

- State: `amount` = `bill.amountMinor === null ? '' : minorToMajorString(bill.amountMinor, currency)` where `currency` is the paying account's currency; `month` = `bill.payableMonths[0] ?? bill.billMonth`; `payer` = `bill.moneyAccountId`; `paidOn` = `today`; `error`; `busy`.
- `<Sheet title={`Pay ${bill.name}`} onClose={onClose}>`:
  - Big input: `<Input aria-label="What it came to" inputMode="decimal" className="text-center text-3xl font-semibold" placeholder={bill.amountMinor === null ? 'What it came to' : undefined} …/>`.
  - When `bill.amountMinor === null`: `<p className="text-center text-xs text-slate-500">{bill.estimateMinor === null ? 'Amount varies' : <>Amount varies · last month <Money minor={bill.estimateMinor} currency={currency} /></>}</p>`.
  - A grouped list of three rows (label left, control right, each min-h-11): `Field`-free labels so the accessible names are exact — `<label htmlFor="pay-for">For</label><Select id="pay-for">` with options `bill.payableMonths.map((m) => <option value={m}>{monthName(m, 'long')} bill</option>)`; `<label htmlFor="pay-with">Paid with</label><Select id="pay-with">` over wallets (`bank`, `cash`, `savings`, `credit_card`, not archived); `<label htmlFor="pay-on">Paid on</label><Input id="pay-on" type="date">`.
  - Error line (`role="alert"`, `text-sm text-red-700`): "Enter what it came to".
  - `<Button className="w-full" disabled={busy}>Record payment</Button>`:

```ts
const amountMinor = amount.trim() ? parseMajor(amount.trim(), currency) : 0;
if (!(amountMinor > 0)) return setError('Enter what it came to');
const ids = await recordBillPayments(database, ws, { paidOn, payments: [{ templateId: bill.id, billMonth: month, amountMinor, moneyAccountId: payer }] });
await invalidate();
onPaid(ids, amountMinor, paidOn, month);
```

  - Links row: `<button type="button" className="text-sm font-medium text-slate-600">Skip this month</button>` (calls `skipBill(database, ws, bill.id, month)`, `invalidate()`, `onSkipped(month)`), and when `onSeeBill` is given `<button type="button" className="text-sm font-medium text-emerald-800">See bill ›</button>`.
  - Non-validation errors from `recordBillPayments` (e.g. `ALREADY_SETTLED`) go to `<ErrorBox error={error} />`.

- [ ] **Step 5: `UndoToast`**

```tsx
export function UndoToast({ text, onUndo, onDone }: { text: string; onUndo: () => void; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(timer);
  }, [text, onDone]);
  return (
    <div role="status" className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg md:bottom-6">
      <span>{text}</span>
      <button type="button" onClick={onUndo} className="min-h-11 px-2 font-semibold text-emerald-300">Undo</button>
    </div>
  );
}
```

- [ ] **Step 6: `RecurringPage`** — V1.

- `const today = isoDate()`; `rows = useMonthlyBills(today).data ?? []`; state `paying: MonthlyBill | null` and `toast: { text: string; undo: () => Promise<void> } | null`. Select mode, its state and its header button arrive in Task 11.
- Header: `<PageHeader title="Recurring" controls={<RoundButton label="New bill" onClick={() => navigate({ to: '/bills/new' })}><Plus size={18} aria-hidden /></RoundButton>} action={<Link to="/bills/new" aria-label="New bill" className="…secondary button classes…">+ New bill</Link>} />`.
- Empty: when `rows.length === 0`, `<Empty>No bills set up. The phone, the water, the gas — whatever comes round.</Empty>` and the New bill link.
- Summary: `<div data-testid="bills-summary">` wrapping a `Card` (Card accepts only `children`, `className`, `id`), from `summaryOf(rows, today)`: `<span className="text-xs text-slate-500">Still to pay in {s.monthLabel}</span>`; `<span className="text-3xl font-semibold tabular">{s.approximate && '~'}<Money minor={s.totalMinor} currency={ws.baseCurrency} />{s.variesText && <span className="text-sm font-normal text-slate-500"> · {s.variesText}</span>}</span>`; each `s.lines` entry as a justify-between row with label colour `text-red-700` / `text-amber-700` / `text-slate-500`, amount prefixed `~` when `approximate`; when `s.allSettled`: `<div className="flex justify-between text-emerald-700"><span>All paid for {s.monthLabel}</span><span>✓</span></div>`.
- Sections from `sectionsOf(rows)`: heading `<h2 className={cx('mt-4 mb-1 px-1 text-[11px] font-semibold tracking-wide uppercase', key === 'overdue' ? 'text-red-700' : key === 'dueSoon' ? 'text-amber-700' : 'text-slate-500')}>{title}</h2>` and a `Card className={cx('p-0 overflow-visible', key === 'settled' && 'opacity-60')}` holding `BillRow`s. (Card has `p-4`; pass `className="p-0"`; if `cx` does not let `p-0` win over `p-4` in Tailwind 4, wrap rows in a plain `div` with the card's ring/rounded classes instead.)
- Handlers:

```ts
const pay = (bill: MonthlyBill) => setPaying(bill);
async function skip(bill: MonthlyBill) {
  const month = bill.billMonth;
  await skipBill(database, ws, bill.id, month);
  await invalidate();
  setToast({ text: `Skipped ${bill.name} this month`, undo: () => unskipBill(database, ws, bill.id, month) });
}
const paid = (bill: MonthlyBill) => (ids: string[]) => {
  setPaying(null);
  setToast({ text: `Paid ${bill.name}`, undo: () => undoBillPayments(database, ws, ids) });
};
```

- Toast: `{toast && <UndoToast text={toast.text} onUndo={async () => { const t = toast; setToast(null); await t.undo(); await invalidate(); }} onDone={clearToast} />}` with `clearToast = useCallback(() => setToast(null), [])`.
- Sheet: `{paying && <PaySheet bill={paying} today={today} onClose={() => setPaying(null)} onPaid={paid(paying)} onSkipped={(m) => { const b = paying; setPaying(null); setToast({ text: `Skipped ${b.name} this month`, undo: () => unskipBill(database, ws, b.id, m) }); }} />}` (`onSeeBill` arrives in Task 10).

- [ ] **Step 7: Route and clean-up** — `router.tsx`: `/bills` → `RecurringPage`; remove the `BillsPage` import. Delete `BillsPage.tsx`, `BillList.tsx`, `BillsDue.tsx`, and the dead hooks. `nav.ts` keeps `{ to: '/bills', label: 'Recurring', icon: Receipt }`.

- [ ] **Step 8: Run** — gate → pass (`phone.spec.ts`'s "every screen reachable" still finds `/bills`).

- [ ] **Step 9: Commit** — `git commit -am "feat(web): one Recurring screen — the month's bills by urgency, swipe or menu to pay and skip"` (with the trailer).

### Task 10: The bill's page — D1, paying from it — A1

**Files:**
- Create: `apps/web/src/features/bills/BillPage.tsx`
- Modify: `apps/web/src/app/router.tsx` (`/bills/$billId`), `BillRow.tsx` (tap navigates; ⋯ gains **See bill**), `RecurringPage.tsx` (`onSeeBill`), `BillFormPage.tsx` (save navigates to the page when editing)
- Test: `apps/web/e2e/recurring-bills.spec.ts`

**Interfaces:**
- Consumes: `useBillDetail`, `pillOf`, `billSchedule`, `monthName`, `dayMonth`, `PaySheet`, `undoBillPayments`, `skipBill`, `unskipBill`, `deleteExpenseTemplate`.

- [ ] **Step 1: Failing e2e**

```ts
test('a bill’s page pays its month and stays, with the payment and an undo', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Biznet Home', amount: '450000', out: 1, payBy: 28 });
  await row(page, 'Biznet Home').click();

  await expect(page.getByRole('heading', { name: 'Biznet Home' })).toBeVisible();
  await expect(page.getByText('Every month · out on the 1st · pay by the 28th')).toBeVisible();
  await page.getByRole('button', { name: /^Pay \w+ bill$/ }).click();
  await page.getByRole('dialog', { name: 'Pay Biznet Home' }).getByRole('button', { name: 'Record payment' }).click();

  await expect(page.getByRole('dialog', { name: 'Pay Biznet Home' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  const banner = page.getByTestId('just-paid');
  await expect(banner).toContainText(/✓ Paid .*450\.000 on/);
  await expect(page.getByTestId('bill-history').locator('[data-new="true"]')).toContainText('450.000');
  await expect(page.getByRole('button', { name: /^Pay \w+ bill$/ })).toHaveCount(0);

  await banner.getByRole('button', { name: 'Undo' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Pay \w+ bill$/ })).toBeVisible();
});

test('from a bill’s page: skip its month, edit it, and stop it', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Gym', amount: '350000' });
  await row(page, 'Gym').click();
  await expect(page.getByText('Paid from')).toBeVisible();

  await page.getByRole('button', { name: /^Skip \w+ bill$/ }).click();
  await expect(page.getByTestId('bill-hero')).toContainText('Skipped');

  await page.getByRole('link', { name: 'Edit bill' }).click();
  await page.getByLabel('Pay by').selectOption('5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Every month · out on the 1st · pay by the 5th')).toBeVisible();

  await page.getByRole('button', { name: 'Stop this bill' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(row(page, 'Gym')).toHaveCount(0);
});
```

Also rewrite the Task 8 pay-by test to reach the form through `row(...).click()` then `getByRole('link', { name: 'Edit bill' })`, and drop `data-bill-id` navigation from it.

Run → FAIL.

- [ ] **Step 2: Route** — `createRoute({ getParentRoute: () => rootRoute, path: '/bills/$billId', component: BillRoute })`, where `BillRoute` reads `billId` like `EditBillRoute` and renders `<BillPage billId={billId} />`.

- [ ] **Step 3: `BillPage`**

- `const today = isoDate()`; `detail = useBillDetail(billId, today)`; state `paying: boolean`, `justPaid: { ids: string[]; amountMinor: number; paidOn: string; month: string } | null`, `error`.
- Top bar (all widths): `<div className="mb-2 flex items-center justify-between">` with `<Link to="/bills" aria-label="Back" className="flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70"><ChevronLeft size={18} aria-hidden /></Link>` and `<Link to="/bills/$billId/edit" params={{ billId }} aria-label="Edit bill" className="…same…"><Pencil size={16} aria-hidden /></Link>`.
- Hero `<section data-testid="bill-hero" className="flex flex-col items-center gap-1 text-center">`: `CategoryIcon size="lg"` (use the largest size `SIZES` defines), `<h1 className="text-lg font-semibold">{bill.name}</h1>`, amount (`text-3xl font-semibold`) — `Money` of `bill.amountMinor` or the text "Amount varies", `<span className="text-sm text-slate-500">{billSchedule(bill.dayOfMonth, bill.payByDay)}</span>`, the pill from `pillOf(bill)`.
- A1 line when `justPaid` and `bill.state === 'paid'` for that month: `<div data-testid="just-paid" role="status" className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>✓ Paid <Money minor={justPaid.amountMinor} currency={…} /> on {dayMonth(justPaid.paidOn)}</span><button type="button" className="min-h-11 font-semibold">Undo</button></div>`; Undo → `undoBillPayments(database, ws, justPaid.ids)`, `invalidate()`, `setJustPaid(null)`.
- Pay button when `!isSettled(bill)`: `<Button className="w-full">Pay {monthName(bill.billMonth, 'long')} bill</Button>` → `setPaying(true)`.
- Card: two justify-between rows "Paid from" / account name, and — only when `detail.bookName` — "Workspace" / `detail.bookName`.
- History: `<h2 …>History</h2>` then `<div data-testid="bill-history">` wrapping a `Card`, each `detail.history` row `<div data-new={justPaid?.month === row.month} className={cx('flex justify-between py-2 text-sm', justPaid?.month === row.month && 'rounded-lg bg-emerald-50 px-2')}>` with `{monthName(row.month, 'long')} bill` and, on the right: paid → `<><Money minor={row.paidMinor ?? 0} …/> · paid {dayMonth(row.paidOn!)}</>`; skipped → `Skipped`; otherwise `pillOf({ ...row, paidOn: null }).text`.
- When unsettled: `<button type="button" className="self-center text-sm font-medium text-slate-600">Skip {monthName(bill.billMonth, 'long')} bill</button>` → `skipBill(database, ws, bill.id, bill.billMonth)`, `invalidate()`.
- `<button type="button" className="self-center text-sm font-medium text-red-700">Stop this bill</button>` → `if (!window.confirm(`Stop ${bill.name}? Its payments stay in your history.`)) return; await deleteExpenseTemplate(database, ws, bill.id); await invalidate(); navigate({ to: '/bills' });`.
- Sheet: `{paying && <PaySheet bill={bill} today={today} onClose={() => setPaying(false)} onPaid={(ids, amountMinor, paidOn, month) => { setPaying(false); setJustPaid({ ids, amountMinor, paidOn, month }); }} onSkipped={() => setPaying(false)} />}` — no `onSeeBill`.
- `detail.error` with code `NOT_FOUND` (a stopped bill): render `<Empty>This bill has been stopped.</Empty>` and a link back.

- [ ] **Step 4: Wire the list** — `BillRow`'s tap navigates to `/bills/$billId` (select mode excepted); the ⋯ menu gains **See bill**; `RecurringPage` passes `onSeeBill={() => navigate({ to: '/bills/$billId', params: { billId: paying.id } })}` to `PaySheet`. `BillFormPage` edit-save navigates to `/bills/$billId`.

- [ ] **Step 5: Run** — gate → pass.

- [ ] **Step 6: Commit** — `git commit -am "feat(web): a bill's own page — its history, paying it, skipping, stopping"` (with the trailer).

### Task 11: Pay several — M2

**Files:**
- Create: `apps/web/src/features/bills/PaySeveralSheet.tsx`
- Modify: `apps/web/src/features/bills/RecurringPage.tsx`, `BillRow.tsx`
- Test: `apps/web/e2e/recurring-bills.spec.ts`

**Interfaces:**
- Consumes: `recordBillPayments`, `undoBillPayments`, `amountOf`, `pillOf`.
- Produces: `PaySeveralSheet({ bills, picked, today, onClose, onPaid })`.

- [ ] **Step 1: Failing e2e**

```ts
test('several bills are ticked and recorded together, on the day they were paid', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Electricity' });

  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await expect(page.getByRole('heading', { name: '0 selected' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select Phone' }).click();
  await page.getByRole('checkbox', { name: 'Select Electricity' }).click();
  await expect(page.getByRole('heading', { name: '2 selected' })).toBeVisible();
  await page.getByRole('button', { name: /^Pay 2 selected/ }).click();

  const sheet = page.getByRole('dialog', { name: 'Pay several' });
  await sheet.getByRole('button', { name: 'Record 2 bills' }).click();
  await expect(sheet).toContainText('Enter the amount of each ticked bill that varies');
  await sheet.getByLabel('What Electricity came to').fill('432000');
  const paidOn = new Date(Date.now() - 2 * 86_400_000);
  const iso = `${paidOn.getFullYear()}-${String(paidOn.getMonth() + 1).padStart(2, '0')}-${String(paidOn.getDate()).padStart(2, '0')}`;
  await sheet.getByLabel('Paid on').fill(iso);
  await sheet.getByRole('button', { name: 'Record 2 bills' }).click();

  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Paid 2 bills');
  await expect(page.getByRole('heading', { name: 'Recurring' })).toBeVisible();
  await page.goto('/transactions');
  await expect(page.getByTestId('recurring-card')).toContainText('2 of 2 bills paid');
});

test('unticking a bill in Pay several leaves it unpaid', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Internet', amount: '395000' });
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await page.getByRole('checkbox', { name: 'Select Phone' }).click();
  await page.getByRole('button', { name: /^Pay 1 selected/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay several' });
  // The rest of the month's unpaid bills are offered, unticked.
  await expect(sheet.getByRole('checkbox', { name: 'Pay Internet' })).not.toBeChecked();
  await sheet.getByRole('button', { name: 'Record 1 bill' }).click();
  await expect(row(page, 'Internet')).not.toContainText('✓ Paid');
  await expect(row(page, 'Phone')).toContainText('✓ Paid');
});
```

Run → FAIL.

- [ ] **Step 2: Select mode in `RecurringPage`**

- State `selecting: boolean`, `picked: Set<string>`. `toggle(bill)` adds/removes `bill.id`.
- Header when not selecting: `controls` = `RoundButton label="Select bills to pay"` (`ListChecks` icon) then the New bill `RoundButton`; `action` = `<Button variant="secondary" aria-label="Select bills to pay">Select</Button>` then the New bill link.
- Header when selecting: `title={`${picked.size} selected`}`; `controls` and `action` both a `Done` button (`<Button variant="secondary">Done</Button>`) that sets `selecting=false` and clears `picked`. (Only one of the two is displayed at a width; `getByRole` ignores the hidden one.)
- `BillRow` receives `selecting`, `picked={picked.has(bill.id)}`, `onToggle`. Swipes are off while selecting (`enabled={!selecting && …}`) and the ⋯ button is not rendered.
- Bottom bar when `selecting && picked.size > 0`:

```tsx
const chosen = rows.filter((b) => picked.has(b.id));
const approximate = chosen.some((b) => b.amountMinor === null);
<button
  type="button"
  onClick={() => setPayingSeveral(true)}
  className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex min-h-12 max-w-md items-center justify-between rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-lg md:sticky md:bottom-6 md:mt-4 md:w-full"
>
  <span>Pay {picked.size} selected</span>
  <span>{approximate && '~'}<Money minor={chosen.reduce((s, b) => s + amountOf(b), 0)} currency={ws.baseCurrency} /> ›</span>
</button>
```

- [ ] **Step 3: `PaySeveralSheet`**

- Props: `bills: MonthlyBill[]` (all unsettled rows), `picked: ReadonlySet<string>`, `today`, `onClose`, `onPaid(ids: string[], count: number)`.
- State: `ticked` (initialised from `picked`), `amounts: Record<string, string>`, `paidOn = today`, `error`, `busy`.
- Order: the picked bills first, then the others, each as they appear in `bills`.
- `<Sheet title="Pay several" onClose={onClose}>`; each line a `flex min-h-12 items-center gap-3`: `<input type="checkbox" className="h-5 w-5" aria-label={`Pay ${bill.name}`} checked={ticked.has(bill.id)} …/>`; name with the pill text beneath (`text-xs text-slate-500`, `pillOf(bill).text`); right: fixed amount as `Money`, or `<Input className="w-32" inputMode="decimal" aria-label={`What ${bill.name} came to`} placeholder="Amount" />`.
- `<label htmlFor="several-on">Paid on</label><Input id="several-on" type="date" />`.
- Error line: "Enter the amount of each ticked bill that varies".
- Button label: `ticked.size === 0 ? 'Record' : `Record ${ticked.size} ${ticked.size === 1 ? 'bill' : 'bills'}``, disabled when none.
- Record:

```ts
const chosen = bills.filter((b) => ticked.has(b.id));
const payments = chosen.map((b) => {
  const currency = currencyOf(b.moneyAccountId);
  const typed = amounts[b.id]?.trim();
  return { templateId: b.id, billMonth: b.billMonth, amountMinor: b.amountMinor ?? (typed ? parseMajor(typed, currency) : 0) };
});
if (payments.some((p) => !(p.amountMinor > 0))) return setError('Enter the amount of each ticked bill that varies');
const ids = await recordBillPayments(database, ws, { paidOn, payments });
await invalidate();
onPaid(ids, ids.length);
```

- In `RecurringPage`: `onPaid={(ids, count) => { setPayingSeveral(false); setSelecting(false); setPicked(new Set()); setToast({ text: count === 1 ? `Paid ${rows.find((b) => b.id === [...picked][0])?.name ?? '1 bill'}` : `Paid ${count} bills`, undo: () => undoBillPayments(database, ws, ids) }); }}`.

- [ ] **Step 4: Run** — gate → pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(web): tick several bills and record them on one date"` (with the trailer).

### Task 12: The phone — swipes and the select bar, end to end

**Files:**
- Create: `apps/web/e2e/phone-recurring-bills.spec.ts`
- Modify (only if a test exposes a defect): `SwipeRow.tsx`, `BillRow.tsx`, `RecurringPage.tsx`

**Interfaces:**
- Consumes: everything from Tasks 7–11.

- [ ] **Step 1: Write the phone spec**

```ts
// apps/web/e2e/phone-recurring-bills.spec.ts
import { expect, type Locator, type Page, test } from '@playwright/test';

/** Anything a finger is meant to hit must be at least this tall or wide. */
const TAP = 44;

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addWallet(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

async function addBill(page: Page, name: string, amount: string) {
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Bill is out on').selectOption('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
}

const row = (page: Page, name: string) => page.getByTestId('bill-row').filter({ hasText: name });

/** A horizontal drag across the row, in small steps, the way a thumb moves. */
async function swipe(page: Page, target: Locator, dx: number) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x + (dx * step) / 10, y);
  await page.mouse.up();
}

test('swiping a bill right opens its payment, and recording it settles the month', async ({ page }) => {
  await addWallet(page);
  await addBill(page, 'Phone', '150000');
  // No Pay button on a row: paying is a swipe away.
  await expect(row(page, 'Phone').getByRole('button', { name: /^Pay/ })).toHaveCount(0);

  await swipe(page, row(page, 'Phone'), 140);
  const sheet = page.getByRole('dialog', { name: 'Pay Phone' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'See bill ›' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('status')).toContainText('Paid Phone');
  await expect(row(page, 'Phone')).toContainText('✓ Paid');
});

test('swiping a bill left reveals Skip', async ({ page }) => {
  await addWallet(page);
  await addBill(page, 'Gym', '350000');
  await swipe(page, row(page, 'Gym'), -120);
  const skip = page.getByRole('button', { name: 'Skip Gym' });
  await expect(skip).toBeVisible();
  expect((await skip.boundingBox())!.height).toBeGreaterThanOrEqual(TAP);
  await skip.click();
  await expect(row(page, 'Gym')).toContainText('Skipped');
  // A settled row does not swipe open again.
  await swipe(page, row(page, 'Gym'), -120);
  await expect(page.getByRole('button', { name: 'Skip Gym' })).toHaveCount(0);
});

test('a tap opens the bill, not a swipe', async ({ page }) => {
  await addWallet(page);
  await addBill(page, 'Phone', '150000');
  await row(page, 'Phone').click();
  await expect(page.getByRole('heading', { name: 'Phone' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('select mode puts a pay bar above the tab bar, and swipes rest while it is on', async ({ page }) => {
  await addWallet(page);
  await addBill(page, 'Phone', '150000');
  await addBill(page, 'Internet', '395000');
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await swipe(page, row(page, 'Phone'), 140);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('checkbox', { name: 'Select Internet' }).click();
  const bar = page.getByRole('button', { name: /^Pay \d selected/ });
  await expect(bar).toBeVisible();
  const tabs = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(tabs.y);
  expect(barBox.height).toBeGreaterThanOrEqual(TAP);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(bar).toHaveCount(0);
});
```

The swipe in the select-mode test moves over the row's checkbox button; with swipes disabled it is a no-op drag, which may register as a tap and toggle "Select Phone" — assert only that no dialog opened and that the bar reads `Pay \d selected`, as written.

- [ ] **Step 2: Run** — `cd apps/web && npx playwright test e2e/phone-recurring-bills.spec.ts --project=phone`. Fix defects in `SwipeRow` if a swipe also fires a tap (the `suppressClick` guard), or if the bar overlaps the tab bar (adjust the `bottom-[…]` offset against `TabBar.tsx`'s `pb-3` + pill height).

- [ ] **Step 3: Full gate** — `npm run typecheck`, `npm test`, `cd apps/web && npx playwright test --workers=2` → all pass on `chromium` and `phone`.

- [ ] **Step 4: Commit** — `git commit -am "test(web): the Recurring screen by thumb — swipes and the select bar"` (with the trailer; `git add` the new spec first).

---

## Self-review against the agreed decisions

| Decision | Where |
|---|---|
| `day_of_month` stays "Bill is out on"; optional Pay by; earlier = next month | Task 1 `billWindow`, Task 3, Task 8 |
| No new columns; `bill_windows` side table | Task 2 migration, Global Constraints |
| `bill_payments(transaction_id PK, workspace_id, template_id, bill_month)`; default oldest unpaid, changeable | Task 2, Task 1 `payableBillMonths`, Task 9 PaySheet "For" |
| `transactions.template_id` keeps working; `bill_skips` stays | Task 2 (still written, copied on replace), Task 4 |
| Backfill bill_month = month of occurred_on | Task 2 SQL and test |
| Decision A: budget sheet and Cashflow chart by bill month; history, statements, balances, points, net worth unchanged; state per bill month | Task 6 (figures test), Task 4 |
| States, pill text and colours; no pay-by = due on out day | Task 1, Task 7 `PILL_CLASS` |
| V1 list: title, select icon then +, summary with ~ and varies, lines, four sections, rows, no Pay button | Tasks 7, 9, 11 |
| N2: tap → page, swipe right → payment sheet, swipe left → Skip | Tasks 9, 10, 12 |
| D1 bill page: back, edit, hero, schedule, pill, Pay <Month> bill, Paid from, Workspace, History, Skip link, Stop this bill | Task 10 |
| A1: sheet over the page, stay, Paid pill, green line with Undo, highlighted month | Task 10 |
| P1 payment sheet: title, editable amount, varies hint, For / Paid with / Paid on, Record payment, Skip this month, See bill › | Tasks 9, 10 |
| M2: select icon, "N selected", Done, tick boxes, swipe off, bottom bar, Pay several with amounts and one date, Record N bills | Task 11 |
| S1 form: Name, Amount (empty = varies), Category, Paid from, When: Repeats, Bill is out on, Pay by with hint, Save | Task 8 |
| Undo toast after pay/skip on the list | Task 9, Task 11 |
| Keep skip, pay early, varying amount, several on one date, list/edit/delete every bill; Cashflow card stays and opens the screen | Tasks 7–11 |
| Desktop not weakened: gesture-free actions | Task 9 ⋯ menu, e2e on `chromium` |
| Book-scoped via category; Workspace name on the bill page | Task 4 `billDetail.bookName`, Task 10 |
