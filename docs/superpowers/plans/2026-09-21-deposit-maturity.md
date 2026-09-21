# Deposit maturity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a time deposit be automated, per deposit and off by default. When it is switched on, the deposit's own page proposes each due event on its due date: the maturity with its three choices, and each monthly payout. The figures are computed from the stored terms (actual/365, floored, tax withheld). Every figure that reaches the ledger can be edited, and nothing posts until the user confirms. A quiet "Due" marker on the Net worth → Assets row makes a waiting proposal findable.

**Architecture:** Migration **0054** adds two side tables. `deposit_automation` holds one row of settings per deposit. `deposit_events` is the log of confirmed events. No column is added anywhere, and both tables are guarded by `automationTablesExist(db)` (a `WeakMap<Db, boolean>`, as `extrasTablesExist` does it). Due events are **derived**, never stored as pending rows. A pure function in `packages/core` works them out from the terms, the settings, the set of confirmed events and today's date. Confirming runs one `database.transaction` that uses `tx` only and calls the existing write paths. Interest goes through `postTransactionTx` with `incomeLines`. The principal leaving a deposit that does not roll over goes through `postTransactionTx` with `transferLines`. The new term goes through `saveDepositTermsTx`. Closing goes through `archiveAccountTx`, which is extracted from `archiveAccount` so that its refusal is kept. The web side is two components on `AssetDetailPage`, `MaturitySettings` (S2) and `DepositProposalCard` (P1), plus one flag on `AssetRow`.

**Tech Stack:** TypeScript monorepo — `packages/core` (pure), `packages/db` (Drizzle over sqlite-proxy, SQL migrations as `?raw` imports, `better-sqlite3` in tests), `apps/web` (React 19, TanStack Router/Query, Tailwind 4); Vitest; Playwright (`chromium` and `phone`).

**Spec:** `docs/superpowers/specs/2026-09-21-deposit-maturity-design.md` (approved 2026-09-21)

## Global Constraints

- **Migration number 0054, exactly.** 0050–0053 belong to other branches. The runner is set-based (`migrations.ts`: `todo = sorted.filter(!done)`), so gaps and order are harmless and a clash is not. 0054 is pure `CREATE TABLE`/`CREATE INDEX` and depends on nothing that 0050–0053 make.
- **No new columns on existing tables** (`deposit_terms`, `accounts`, `transactions`, `entries`, …). Drizzle names every column it knows on every insert, so a new column breaks any database stopped at an older version. New facts go in `deposit_automation` and `deposit_events`, and every read and write of them goes through `automationTablesExist(db)`. On a database without the tables, every deposit reads as off, `listDueDeposits` returns `[]`, and saving throws `DepositAutomationError('NOT_READY')`.
- **Money is integer minor units.** Interest is `floor(principal × rateBps × days / 3 650 000)` in **BigInt**; tax is `floor(gross × taxBps / 10 000)`; **net = gross − tax** (subtracted, never floored on its own). Day count is **actual/365** through the existing `daysFrom`. No `Math.round`, no float multiply of money. Typed amounts are read by `parseMajor(text, currency)`, the app's one separator-agnostic reader, and percentages by `parseRate`. No function in this plan decides which of `.` and `,` is a decimal point.
- **Call, never copy.** Each task below names the existing functions it must call. Grep before creating any name; the names introduced here were checked to be unused on 2026-09-21. In particular: posting is `postTransactionTx`, lines are `incomeLines`/`transferLines`, terms are `saveDepositTermsTx`, balances are `nativeBalances`, categories are `categoryIdsByKeyTx`, archiving is `archiveAccountTx` (extracted, not rewritten), rates are `useResolveRates`/`checkManualRate`/`upsertRate`, and day counts are `daysFrom`.
- Inside `database.transaction((tx) => …)` use `tx` only — `database.db` there deadlocks on the mutex.
- **Refusals are inherited** (spec §9): workspace scoping on every read, archived accounts, a payout account in the wrong currency, one that is not spendable, `TWO_BOOKS` from `postTransactionTx`, `MISSING_RATE` from `planPosting`, the archive's non-zero-balance refusal, and `NOT_NEXT` for a double or out-of-order confirm.
- **Native kit only** (`apps/web/src/ui/native/`): `InsetGroup`, `InsetRow`, `SwitchRow`, `SelectRow`, `TextRow`. Colours come from kit tokens (`var(--ph-tint)` etc.), so dark mode follows; there is no literal colour and no new visual treatment. **`InsetGroup` uses `Children.toArray`, which does not flatten fragments**: conditional rows are passed as arrays with keys, never wrapped in `<>…</>`.
- **Desktop is never weaker.** One component serves every width; every control is a real button, select or input, and is reachable by keyboard.
- **Country-neutral.** No Indonesian constant in code or copy. The tax is a per-deposit percentage defaulting to 20, and "Tax-free deposit" is a per-deposit switch with no threshold gate (spec §5.3, §14.1).
- **Tests must discriminate.** Every figure asserted in this plan was chosen so that the nearest wrong rule gives a different number (spec §5.2). Assert computed integers, never labels. Do not "simplify" a fixture to round numbers.
- Commit per task, on the branch the coordinator names. Every commit message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Gate before every commit:** `npm run typecheck`, `npm test`, `npm run build` from the root, plus the targeted Playwright run named in the task. Task 10 runs the full Playwright suite.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/deposits/maturity.ts` | `TERM_MONTHS`, `DEFAULT_TAX_BPS`, `addMonthsToDate`, `depositInterest`, `withholdTax`, `needsPayout`, `termStart`, `dueDepositEvents`, `eventKey`, types |
| `packages/core/src/index.ts` | export the above |
| `packages/core/test/deposit-maturity.test.ts` | the pure tests (Task 1) |
| `packages/db/migrations/0054_deposit_automation.sql` | two tables, two indexes |
| `packages/db/src/migrations.ts` | register `{ version: 54, name: 'deposit_automation' }` |
| `packages/db/src/schema-assets.ts` | Drizzle `depositAutomation`, `depositEvents` |
| `packages/db/src/repos/deposit-terms.ts` | **+** `getDepositTermsTx` (`getDepositTerms` delegates to it) |
| `packages/db/src/repos/accounts.ts` | **+** `archiveAccountTx` (`archiveAccount` delegates to it) |
| `packages/db/src/repos/deposit-automation.ts` | `automationTablesExist`, `DepositAutomationError`, `getDepositAutomation`, `saveDepositAutomation`, `listDueDeposits`, `confirmDepositEvent` |
| `packages/db/src/index.ts` | `export * from './repos/deposit-automation'` |
| `packages/db/test/deposit-automation-migration.test.ts` | 0054 on a version-49 database |
| `packages/db/test/deposit-automation.test.ts` | settings, proposals, confirm, refusals |
| `packages/db/test/deposit-combinations.test.ts` | the 24 combinations (Task 6) |
| `packages/db/test/database.test.ts` | applied-versions list gains 54 |
| `apps/web/src/features/networth/deposit-terms.ts` (+ test) | **+** `rateInputText`, `rateBpsFrom` (and `DepositTermsCard` calls them) |
| `apps/web/src/features/networth/maturity-settings.ts` (+ test) | `MATURITY_CHOICES`, `termLabel`, `payoutChoices`, `taxBpsFrom` |
| `apps/web/src/features/networth/MaturitySettings.tsx` | S2 group |
| `apps/web/src/features/networth/deposit-proposal.ts` (+ test) | `draftFrom`, `readDraft`, `closing`, `rolling`, `proposalHeader`, `interestLine`, `outcomeLine` |
| `apps/web/src/features/networth/DepositProposalCard.tsx` | P1 card |
| `apps/web/src/features/networth/queries.ts` | `useDepositAutomation`, `useDueDeposits` |
| `apps/web/src/features/networth/AssetDetailPage.tsx` | mounts both components |
| `apps/web/src/features/networth/asset-rows.ts` (+ test) | `AssetRow.due`, `groupAssets(…, due)`, `rowSubtitle` (moved from `AssetsPage`) |
| `apps/web/src/features/networth/AssetsPage.tsx` | passes due ids, uses `rowSubtitle` |
| `apps/web/e2e/deposit-maturity.ts` | shared helpers + the 24-row combinations table |
| `apps/web/e2e/deposit-maturity.spec.ts` | chromium: off by default, settings, edit figures, queue, 24 combinations |
| `apps/web/e2e/phone-deposit-maturity.spec.ts` | phone: four combinations by thumb |

---

## Step 1 — The arithmetic and the tables

### Task 1: The pure maturity math

**Files:**
- Create: `packages/core/src/deposits/maturity.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/deposit-maturity.test.ts`

**Interfaces:**
- Consumes: `daysFrom(from, to)` from `../bills/schedule` and `daysInMonth(year, month1)` from `../reports/periods`. Both are existing and exported; call them and do not re-implement them.
- Produces: `TERM_MONTHS`, `type TermMonths`, `type MaturityChoice`, `type InterestPaid`, `DEFAULT_TAX_BPS`, `addMonthsToDate(date: string, months: number): string`, `depositInterest(principalMinor: number, rateBps: number, days: number): number`, `withholdTax(grossMinor: number, taxBps: number, exempt: boolean): { taxMinor: number; netMinor: number }`, `needsPayout(choice: MaturityChoice): boolean`, `type DepositSchedule`, `type DepositEvent`, `eventKey(kind, dueOn): string`, `termStart(s: DepositSchedule): string`, `dueDepositEvents(s: DepositSchedule, done: ReadonlySet<string>, today: string): DepositEvent[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/deposit-maturity.test.ts
import { describe, expect, it } from 'vitest';
import {
  addMonthsToDate,
  depositInterest,
  type DepositSchedule,
  dueDepositEvents,
  eventKey,
  needsPayout,
  termStart,
  withholdTax,
} from '../src/index';

describe('addMonthsToDate', () => {
  it('keeps the day of the month, forwards and back', () => {
    expect(addMonthsToDate('2026-07-15', 3)).toBe('2026-10-15');
    expect(addMonthsToDate('2026-10-15', -3)).toBe('2026-07-15');
  });

  it('lands on the last day when the month is shorter, counted from the anchor each time', () => {
    expect(addMonthsToDate('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonthsToDate('2027-01-31', 2)).toBe('2027-03-31');
    expect(addMonthsToDate('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('wraps the year both ways', () => {
    expect(addMonthsToDate('2026-11-01', 3)).toBe('2027-02-01');
    expect(addMonthsToDate('2027-01-15', -1)).toBe('2026-12-15');
  });
});

describe('interest: actual/365, floored, in BigInt', () => {
  it('reproduces the mockup: Rp 50.000.000 at 4,25% for 92 days', () => {
    // 535 616,438… — 30/360 would give 531 250, actual/360 543 055.
    expect(depositInterest(50_000_000, 425, 92)).toBe(535_616);
  });

  it('floors rather than rounds', () => {
    // 174 657,53 — rounding would give 174 658.
    expect(depositInterest(50_000_000, 425, 30)).toBe(174_657);
    // US$10,000.00 in cents at 3,50% for 31 days: 2 972,60 — rounding gives 2 973; whole dollars give 2 900.
    expect(depositInterest(1_000_000, 350, 31)).toBe(2_972);
  });

  it('stays exact past 2^53', () => {
    // 10^12 × 1 000 × 366 = 3,66 × 10^17. The quotient is 100 273 972 602,739…
    expect(depositInterest(1_000_000_000_000, 1_000, 366)).toBe(100_273_972_602);
  });

  it('is nothing without a principal, a rate or days', () => {
    expect(depositInterest(0, 425, 92)).toBe(0);
    expect(depositInterest(50_000_000, 0, 92)).toBe(0);
    expect(depositInterest(50_000_000, 425, 0)).toBe(0);
  });
});

describe('tax withheld', () => {
  it('floors the tax and subtracts it, so net + tax is gross exactly', () => {
    // 107 123,2 → 107 123; net 428 493. Flooring the net directly would give 428 492.
    expect(withholdTax(535_616, 2_000, false)).toEqual({ taxMinor: 107_123, netMinor: 428_493 });
    // 36 095,8 → 36 095 (rounding gives 36 096); net 144 384.
    expect(withholdTax(180_479, 2_000, false)).toEqual({ taxMinor: 36_095, netMinor: 144_384 });
  });

  it('takes nothing from a tax-free deposit, whatever the percentage says', () => {
    expect(withholdTax(19_109, 2_000, true)).toEqual({ taxMinor: 0, netMinor: 19_109 });
    // The same deposit taxed: 3 821,8 → 3 821 (rounding gives 3 822).
    expect(withholdTax(19_109, 2_000, false)).toEqual({ taxMinor: 3_821, netMinor: 15_288 });
  });

  it('follows the percentage the user typed', () => {
    // 12,5% of 535 616 = 66 952 exactly.
    expect(withholdTax(535_616, 1_250, false)).toEqual({ taxMinor: 66_952, netMinor: 468_664 });
  });
});

describe('where the money lands', () => {
  it('needs a payout account unless everything rolls over', () => {
    expect(needsPayout('principal')).toBe(true);
    expect(needsPayout('close')).toBe(true);
    expect(needsPayout('principal_interest')).toBe(false);
  });
});

const quarterly: DepositSchedule = {
  maturesOn: '2026-10-15',
  termMonths: 3,
  termStartedOn: null,
  interestPaid: 'at_maturity',
  enabledOn: '2026-07-15',
};
const monthly: DepositSchedule = { ...quarterly, interestPaid: 'monthly' };

describe('the current term', () => {
  it('is dated back from the maturity when no roll-over has dated it', () => {
    expect(termStart(quarterly)).toBe('2026-07-15');
  });

  it('uses the stored start only while it still agrees with the maturity', () => {
    expect(termStart({ ...quarterly, maturesOn: '2027-04-30', termStartedOn: '2027-01-31' })).toBe('2027-01-31');
    // Changed by hand on the terms card: the stored start no longer adds up, so it is derived again.
    expect(termStart({ ...quarterly, termStartedOn: '2026-04-15' })).toBe('2026-07-15');
  });
});

describe('what is due', () => {
  it('is one maturity over the whole term when interest is paid at maturity', () => {
    expect(dueDepositEvents(quarterly, new Set(), '2026-10-15')).toEqual([
      { kind: 'maturity', dueOn: '2026-10-15', periodFrom: '2026-07-15', days: 92 },
    ]);
  });

  it('is nothing the day before', () => {
    expect(dueDepositEvents(quarterly, new Set(), '2026-10-14')).toEqual([]);
  });

  it('is each monthly payout, then the maturity for the last month, in date order', () => {
    expect(dueDepositEvents(monthly, new Set(), '2026-10-15')).toEqual([
      { kind: 'monthly', dueOn: '2026-08-15', periodFrom: '2026-07-15', days: 31 },
      { kind: 'monthly', dueOn: '2026-09-15', periodFrom: '2026-08-15', days: 31 },
      { kind: 'maturity', dueOn: '2026-10-15', periodFrom: '2026-09-15', days: 30 },
    ]);
  });

  it('dates every payout from the start, not from the payout before', () => {
    const fromJan31: DepositSchedule = { ...monthly, maturesOn: '2027-04-30', termStartedOn: '2027-01-31' };
    expect(dueDepositEvents(fromJan31, new Set(), '2027-04-30').map((e) => [e.dueOn, e.days])).toEqual([
      ['2027-02-28', 28],
      ['2027-03-31', 31],
      ['2027-04-30', 30],
    ]);
  });

  it('leaves out what was confirmed', () => {
    const done = new Set([eventKey('monthly', '2026-08-15')]);
    expect(dueDepositEvents(monthly, done, '2026-10-15').map((e) => e.dueOn)).toEqual(['2026-09-15', '2026-10-15']);
  });

  it('skips monthly payouts from before the switch was turned on, but never a passed maturity', () => {
    expect(dueDepositEvents({ ...monthly, enabledOn: '2026-09-01' }, new Set(), '2026-10-15').map((e) => e.dueOn)).toEqual([
      '2026-09-15',
      '2026-10-15',
    ]);
    expect(dueDepositEvents({ ...monthly, enabledOn: '2026-12-01' }, new Set(), '2026-12-01').map((e) => e.kind)).toEqual(['maturity']);
  });

  it('has only the maturity for a one-month deposit paying monthly', () => {
    const oneMonth: DepositSchedule = { ...monthly, termMonths: 1, maturesOn: '2026-08-15' };
    expect(dueDepositEvents(oneMonth, new Set(), '2026-08-15')).toEqual([
      { kind: 'maturity', dueOn: '2026-08-15', periodFrom: '2026-07-15', days: 31 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `cd packages/core && npx vitest run test/deposit-maturity.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Write the module**

```ts
// packages/core/src/deposits/maturity.ts
import { daysFrom } from '../bills/schedule';
import { daysInMonth } from '../reports/periods';

/**
 * A time deposit's maturity, worked out rather than stored.
 *
 * Nothing here posts or remembers anything. Given the terms, the automation settings, the events already confirmed
 * and today's date, it says what is due and what it comes to. Every figure is an estimate from the stored rate: the
 * owner confirms or corrects it against what the bank actually credited.
 */

export const TERM_MONTHS = [1, 3, 6, 12] as const;
export type TermMonths = (typeof TERM_MONTHS)[number];
export type MaturityChoice = 'principal' | 'principal_interest' | 'close';
export type InterestPaid = 'monthly' | 'at_maturity';

/** The withholding a new deposit starts with. An editable default, not a country rule: the user can change it per deposit. */
export const DEFAULT_TAX_BPS = 2_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** The same day `months` later (or earlier), or that month's last day when it has no such day: 31 Jan + 1 is 28 Feb. */
export function addMonthsToDate(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${y}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

/**
 * Interest for `days` days: actual/365, floored to the minor unit, in BigInt because principal × rate × days passes
 * 2^53 for a large deposit. A bank credits no fraction, so an estimate never promises more than arrives.
 */
export function depositInterest(principalMinor: number, rateBps: number, days: number): number {
  if (!Number.isSafeInteger(principalMinor) || principalMinor <= 0) return 0;
  if (!Number.isInteger(rateBps) || rateBps <= 0 || !Number.isInteger(days) || days <= 0) return 0;
  return Number((BigInt(principalMinor) * BigInt(rateBps) * BigInt(days)) / 3_650_000n);
}

/** The tax taken at source: floored, then subtracted, so gross = net + tax exactly. Nothing on a tax-free deposit. */
export function withholdTax(grossMinor: number, taxBps: number, exempt: boolean): { taxMinor: number; netMinor: number } {
  const taxMinor = exempt || grossMinor <= 0 ? 0 : Number((BigInt(grossMinor) * BigInt(taxBps)) / 10_000n);
  return { taxMinor, netMinor: grossMinor - taxMinor };
}

/** Whether anything lands outside the deposit. With principal + interest rolling over, nothing does. */
export const needsPayout = (choice: MaturityChoice): boolean => choice !== 'principal_interest';

export interface DepositSchedule {
  maturesOn: string;
  termMonths: TermMonths;
  /** Written by a confirmed roll-over; null before the first. */
  termStartedOn: string | null;
  interestPaid: InterestPaid;
  /** The day automation was last switched on. Monthly payouts before it were recorded by hand. */
  enabledOn: string;
}

export interface DepositEvent {
  kind: 'monthly' | 'maturity';
  dueOn: string;
  periodFrom: string;
  days: number;
}

export const eventKey = (kind: DepositEvent['kind'], dueOn: string): string => `${kind}:${dueOn}`;

/** The current term's first day: the stored one while it still adds up to the maturity, otherwise dated back from it. */
export function termStart(s: DepositSchedule): string {
  if (s.termStartedOn && addMonthsToDate(s.termStartedOn, s.termMonths) === s.maturesOn) return s.termStartedOn;
  return addMonthsToDate(s.maturesOn, -s.termMonths);
}

/**
 * Every event of the current term that is due and not yet confirmed, earliest first. Only the current term is ever
 * derived: the next one exists once its roll-over is confirmed, so an unconfirmed maturity holds back what follows.
 */
export function dueDepositEvents(s: DepositSchedule, done: ReadonlySet<string>, today: string): DepositEvent[] {
  const start = termStart(s);
  const events: DepositEvent[] = [];
  if (s.interestPaid === 'monthly') {
    for (let k = 1; k < s.termMonths; k++) {
      const periodFrom = addMonthsToDate(start, k - 1);
      const dueOn = addMonthsToDate(start, k);
      events.push({ kind: 'monthly', dueOn, periodFrom, days: daysFrom(periodFrom, dueOn) });
    }
  }
  const lastFrom = s.interestPaid === 'monthly' ? addMonthsToDate(start, s.termMonths - 1) : start;
  events.push({ kind: 'maturity', dueOn: s.maturesOn, periodFrom: lastFrom, days: daysFrom(lastFrom, s.maturesOn) });
  return events.filter(
    (event) => event.dueOn <= today && !done.has(eventKey(event.kind, event.dueOn)) && (event.kind === 'maturity' || event.dueOn >= s.enabledOn),
  );
}
```

Add to `packages/core/src/index.ts`:

```ts
export {
  addMonthsToDate,
  DEFAULT_TAX_BPS,
  type DepositEvent,
  type DepositSchedule,
  depositInterest,
  dueDepositEvents,
  eventKey,
  type InterestPaid,
  type MaturityChoice,
  needsPayout,
  TERM_MONTHS,
  type TermMonths,
  termStart,
  withholdTax,
} from './deposits/maturity';
```

- [ ] **Step 4: Run** — `cd packages/core && npx vitest run test/deposit-maturity.test.ts` → PASS; then the root gate (`npm run typecheck`, `npm test`, `npm run build`).
- [ ] **Step 5: Commit** — `feat(core): a deposit's due events and interest, worked out from its terms`.

---

### Task 2: Migration 0054

**Files:**
- Create: `packages/db/migrations/0054_deposit_automation.sql`, `packages/db/test/deposit-automation-migration.test.ts`
- Modify: `packages/db/src/migrations.ts`, `packages/db/src/schema-assets.ts`, `packages/db/test/database.test.ts`

**Interfaces:**
- Produces: tables `deposit_automation`, `deposit_events`; Drizzle `depositAutomation`, `depositEvents` in `schema-assets.ts` (exported as `assetsSchema.*` already by `index.ts`).

- [ ] **Step 1: The SQL**

```sql
/* Deposit maturity automation: the settings per deposit, and the log of events the owner confirmed.

   Both are side tables. 0047's deposit_terms keeps exactly its columns, because the ORM names every column it
   knows on every insert and a new one would break a database still stopped at an older version. No row in
   deposit_automation means "off", which is what every deposit was until now, so nothing is backfilled.

   Due events are never stored: they are worked out from deposit_terms, these settings, and deposit_events. There
   are no REFERENCES clauses, as in 0048, so a later rebuild of accounts never has to defer keys for these tables.
   The migration depends on nothing that 0050–0053 make, so it applies in any order among them. */
CREATE TABLE deposit_automation (
  account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  enabled_on TEXT,
  at_maturity TEXT NOT NULL DEFAULT 'principal' CHECK (at_maturity IN ('principal', 'principal_interest', 'close')),
  interest_paid TEXT NOT NULL DEFAULT 'at_maturity' CHECK (interest_paid IN ('monthly', 'at_maturity')),
  payout_account_id TEXT,
  term_months INTEGER NOT NULL DEFAULT 1 CHECK (term_months IN (1, 3, 6, 12)),
  term_started_on TEXT,
  keep_rate INTEGER NOT NULL DEFAULT 1 CHECK (keep_rate IN (0, 1)),
  tax_bps INTEGER NOT NULL DEFAULT 2000 CHECK (tax_bps BETWEEN 0 AND 10000),
  tax_exempt INTEGER NOT NULL DEFAULT 0 CHECK (tax_exempt IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE deposit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('monthly', 'maturity')),
  due_on TEXT NOT NULL,
  principal_minor INTEGER NOT NULL,
  gross_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  net_minor INTEGER NOT NULL,
  interest_transaction_id TEXT,
  principal_transaction_id TEXT,
  confirmed_at TEXT NOT NULL
);
/* One confirmation per event: a second confirm fails here and rolls its whole transaction back. */
CREATE UNIQUE INDEX deposit_events_once ON deposit_events (account_id, kind, due_on);
CREATE INDEX deposit_events_workspace ON deposit_events (workspace_id, account_id);
```

- [ ] **Step 2: Register it** — in `packages/db/src/migrations.ts`, next to the 0049 import:

```ts
import depositAutomation from '../migrations/0054_deposit_automation.sql?raw';
```

and as the last entry of `MIGRATIONS` (after 49, and after any 50–53 already present):

```ts
  { version: 54, name: 'deposit_automation', sql: depositAutomation },
```

- [ ] **Step 3: Drizzle** — append to `packages/db/src/schema-assets.ts`:

```ts
/** A deposit's automation settings (0054). No row means off. Booleans are 0/1, read into booleans by the repo. */
export const depositAutomation = sqliteTable('deposit_automation', {
  accountId: text('account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  enabled: integer('enabled').notNull(),
  enabledOn: text('enabled_on'),
  atMaturity: text('at_maturity', { enum: ['principal', 'principal_interest', 'close'] }).notNull(),
  interestPaid: text('interest_paid', { enum: ['monthly', 'at_maturity'] }).notNull(),
  payoutAccountId: text('payout_account_id'),
  termMonths: integer('term_months').notNull(),
  termStartedOn: text('term_started_on'),
  keepRate: integer('keep_rate').notNull(),
  taxBps: integer('tax_bps').notNull(),
  taxExempt: integer('tax_exempt').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Each maturity or monthly payout the owner confirmed (0054). Its figures as posted and as computed. */
export const depositEvents = sqliteTable('deposit_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  accountId: text('account_id').notNull(),
  kind: text('kind', { enum: ['monthly', 'maturity'] }).notNull(),
  dueOn: text('due_on').notNull(),
  principalMinor: integer('principal_minor').notNull(),
  grossMinor: integer('gross_minor').notNull(),
  taxMinor: integer('tax_minor').notNull(),
  netMinor: integer('net_minor').notNull(),
  interestTransactionId: text('interest_transaction_id'),
  principalTransactionId: text('principal_transaction_id'),
  confirmedAt: text('confirmed_at').notNull(),
});
```

- [ ] **Step 4: Tests** — in `packages/db/test/database.test.ts`, add `54` to the end of the applied-versions array on line 20 (keep any 50–53 another branch added, in ascending order). Create:

```ts
// packages/db/test/deposit-automation-migration.test.ts
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, createWorkspace, migrate, MIGRATIONS, openCashAccount } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const schemaOf = async (database: ReturnType<typeof createDatabase>) =>
  new Map(
    (await database.db.values<[string, string | null]>(sql`SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name`)).map(
      ([name, ddl]) => [name, ddl] as const,
    ),
  );

describe('migration 0054', () => {
  it('is version 54 and named deposit_automation', () => {
    expect(MIGRATIONS.find((m) => m.version === 54)).toMatchObject({ name: 'deposit_automation' });
  });

  it('adds its two tables to a version-49 database with a deposit in it, and changes nothing that was there', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    await openCashAccount(database, ws, { item: 'time_deposit', name: 'BCA Deposito', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-07-15', maturesOn: '2026-10-15', rateBps: 425 });
    const before = await schemaOf(database);
    const termsBefore = await database.db.values(sql`SELECT account_id, matures_on, rate_bps FROM deposit_terms`);

    expect(await migrate(database)).toContain(54);

    const after = await schemaOf(database);
    for (const [name, ddl] of before) expect(after.get(name)).toBe(ddl);
    expect(after.has('deposit_automation')).toBe(true);
    expect(after.has('deposit_events')).toBe(true);
    expect(after.has('deposit_events_once')).toBe(true);
    expect(await database.db.values(sql`SELECT account_id, matures_on, rate_bps FROM deposit_terms`)).toEqual(termsBefore);
    expect(await database.db.values(sql`SELECT count(*) FROM deposit_automation`)).toEqual([[0]]);
  });
});
```

- [ ] **Step 5: Run** — `cd packages/db && npx vitest run test/deposit-automation-migration.test.ts test/database.test.ts test/migration-safety.test.ts` → PASS; root gate.
- [ ] **Step 6: Commit** — `feat(db): migration 0054 — deposit automation settings and the confirmed-event log`.

---

## Step 2 — The repository

### Task 3: Settings, and the two extractions

**Files:**
- Create: `packages/db/src/repos/deposit-automation.ts`, `packages/db/test/deposit-automation.test.ts`
- Modify: `packages/db/src/repos/deposit-terms.ts`, `packages/db/src/repos/accounts.ts`, `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `depositTablesExist`, `saveDepositTermsTx` (existing); `SPENDABLE_SUBTYPES`, `AccountError` (existing); `TERM_MONTHS`, `DEFAULT_TAX_BPS` (Task 1).
- Produces: `getDepositTermsTx(tx: Db, ws, accountId): Promise<DepositTermsRow | undefined>`; `archiveAccountTx(tx: Db, ws, id): Promise<void>`; `automationTablesExist(db: Db): Promise<boolean>`; `DepositAutomationError` (`code: DepositAutomationErrorCode`); `type DepositAutomationSettings`, `type DepositAutomationRow`; `AUTOMATION_DEFAULTS`; `getDepositAutomation(database, ws, accountId): Promise<DepositAutomationRow>`; `type SaveDepositAutomationInput`; `saveDepositAutomation(database, ws, input): Promise<void>`.

- [ ] **Step 1: Extract `getDepositTermsTx`** — in `deposit-terms.ts`, replace `getDepositTerms` with:

```ts
/** The terms of one deposit, on any handle: a transaction already running, or `database.db`. */
export async function getDepositTermsTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<DepositTermsRow | undefined> {
  if (!(await depositTablesExist(tx))) return undefined;
  const [row] = await tx
    .select()
    .from(depositTerms)
    .where(and(eq(depositTerms.accountId, accountId), eq(depositTerms.workspaceId, ws.workspaceId)));
  return row;
}

export function getDepositTerms(database: Database, ws: WorkspaceContext, accountId: string): Promise<DepositTermsRow | undefined> {
  return getDepositTermsTx(database.db, ws, accountId);
}
```

Also update the two doc comments that say "Nothing is automated off it" (on `DepositTermsRow.maturesOn` and in `schema-assets.ts`) to: "Nothing is automated off it unless the owner switches automation on (0054)."

- [ ] **Step 2: Extract `archiveAccountTx`** — in `accounts.ts`, move the **whole body** of `archiveAccount`'s transaction callback, unchanged, into:

```ts
/** Archives inside a transaction already running. Refuses a system account, and a money account that still holds a balance. */
export async function archiveAccountTx(tx: Db, ws: WorkspaceContext, id: string): Promise<void> {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) throw new AccountError('Account not found');
  // Default categories carry keys too; only the system equity accounts are protected.
  if (SYSTEM_ACCOUNTS.some((s) => s.key === account.systemKey)) throw new AccountError('System accounts cannot be archived');
  if (account.kind === 'asset' || account.kind === 'liability') {
    // Archived money accounts leave net worth, so they must be empty first.
    const [row] = await tx
      .select({ total: sql<number>`coalesce(sum(${entries.amountMinor}), 0)` })
      .from(entries)
      .innerJoin(transactions, eq(entries.transactionId, transactions.id))
      .where(and(eq(entries.accountId, id), eq(transactions.status, 'posted')));
    if (Number(row?.total ?? 0) !== 0) {
      throw new AccountError(`${account.name} still has a balance. Bring it to zero before archiving so net worth stays correct.`);
    }
  }
  await tx.update(accounts).set({ archivedAt: new Date().toISOString() }).where(eq(accounts.id, id));
  await writeAudit(tx, ws, 'archive', id, {});
}

export async function archiveAccount(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.transaction((tx) => archiveAccountTx(tx, ws, id));
}
```

`npx vitest run test/accounts.test.ts` must still pass unchanged. That is the proof the refusal moved intact.

- [ ] **Step 3: Write the failing tests**

```ts
// packages/db/test/deposit-automation.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveAccount,
  createWorkspace,
  type Database,
  DepositAutomationError,
  getDepositAutomation,
  openCashAccount,
  saveDepositAutomation,
  type SaveDepositAutomationInput,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let bcaId: string;
let depositoId: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bcaId = (await openCashAccount(database, ws, { item: 'bank', name: 'BCA Tahapan', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-07-15' })).id;
  depositoId = (
    await openCashAccount(database, ws, {
      item: 'time_deposit',
      name: 'BCA Deposito',
      currency: 'IDR',
      openingBalanceMinor: 50_000_000,
      openedOn: '2026-07-15',
      maturesOn: '2026-10-15',
      rateBps: 425,
    })
  ).id;
});

export const on = (accountId: string, payoutAccountId: string | null, change: Partial<SaveDepositAutomationInput> = {}): SaveDepositAutomationInput => ({
  accountId,
  enabled: true,
  atMaturity: 'principal',
  interestPaid: 'at_maturity',
  payoutAccountId,
  termMonths: 3,
  keepRate: true,
  taxBps: 2_000,
  taxExempt: false,
  today: '2026-07-15',
  ...change,
});

describe('the switch', () => {
  it('is off for every deposit until it is turned on', async () => {
    expect(await getDepositAutomation(database, ws, depositoId)).toMatchObject({ enabled: false, enabledOn: null, taxBps: 2_000, taxExempt: false, termMonths: 1 });
  });

  it('keeps what was chosen, and remembers the day it was turned on', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly', taxBps: 1_250 }));
    expect(await getDepositAutomation(database, ws, depositoId)).toMatchObject({
      enabled: true,
      enabledOn: '2026-07-15',
      atMaturity: 'principal',
      interestPaid: 'monthly',
      payoutAccountId: bcaId,
      termMonths: 3,
      taxBps: 1_250,
    });
    // Saving again while on keeps the original day; turning off clears it; on again takes the new day.
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { today: '2026-08-01' }));
    expect((await getDepositAutomation(database, ws, depositoId)).enabledOn).toBe('2026-07-15');
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { enabled: false, today: '2026-08-02' }));
    expect((await getDepositAutomation(database, ws, depositoId)).enabledOn).toBeNull();
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { today: '2026-08-03' }));
    expect((await getDepositAutomation(database, ws, depositoId)).enabledOn).toBe('2026-08-03');
  });
});

describe('where the money may land', () => {
  const refused = (input: SaveDepositAutomationInput) => expect(saveDepositAutomation(database, ws, input)).rejects.toBeInstanceOf(DepositAutomationError);

  it('refuses an account in another currency', async () => {
    const usd = await openCashAccount(database, ws, { item: 'bank', name: 'Jenius USD', currency: 'USD' });
    await refused(on(depositoId, usd.id));
  });

  it('refuses an account that is not spendable, and the deposit itself', async () => {
    const other = await openCashAccount(database, ws, { item: 'time_deposit', name: 'Other deposit', currency: 'IDR', maturesOn: '2027-01-01' });
    await refused(on(depositoId, other.id));
    await refused(on(depositoId, depositoId));
  });

  it('refuses an archived account', async () => {
    const empty = await openCashAccount(database, ws, { item: 'bank', name: 'Old account', currency: 'IDR' });
    await archiveAccount(database, ws, empty.id);
    await refused(on(depositoId, empty.id));
  });

  it('refuses an account, or a deposit, of another workspace', async () => {
    const other = await createWorkspace(database, { name: 'Business', type: 'business', baseCurrency: 'IDR' });
    const theirs = await openCashAccount(database, other, { item: 'bank', name: 'Their bank', currency: 'IDR' });
    await refused(on(depositoId, theirs.id));
    await expect(saveDepositAutomation(database, other, on(depositoId, null))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a term or a tax the table could not hold', async () => {
    await refused(on(depositoId, bcaId, { termMonths: 2 as never }));
    await refused(on(depositoId, bcaId, { taxBps: 10_001 }));
    await refused(on(depositoId, bcaId, { taxBps: 12.5 }));
  });
});
```

Check `createWorkspace`'s `type` values against `repos/workspaces.ts` before running, and use whatever the second workspace type is called there.

- [ ] **Step 4: Write the repo (settings half)**

```ts
// packages/db/src/repos/deposit-automation.ts
import {
  addMonthsToDate,
  DEFAULT_TAX_BPS,
  type DepositEvent,
  type DepositSchedule,
  depositInterest,
  dueDepositEvents,
  eventKey,
  incomeLines,
  type InterestPaid,
  type MaturityChoice,
  needsPayout,
  TERM_MONTHS,
  type TermMonths,
  transferLines,
  uuidv7,
  withholdTax,
} from '@expanses/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { depositAutomation, depositEvents, depositTerms } from '../schema-assets';
import { AccountError, archiveAccountTx, SPENDABLE_SUBTYPES } from './accounts';
import { categoryIdsByKeyTx } from './categories';
import { type DepositTermsRow, getDepositTermsTx, saveDepositTermsTx } from './deposit-terms';
import { nativeBalances, postTransactionTx } from './ledger';

export type DepositAutomationErrorCode =
  | 'NOT_READY'
  | 'NOT_FOUND'
  | 'BAD_PAYOUT'
  | 'BAD_TERM'
  | 'BAD_TAX'
  | 'OFF'
  | 'NOT_NEXT'
  | 'BAD_FIGURE'
  | 'NO_PAYOUT'
  | 'NO_CATEGORY';

export class DepositAutomationError extends Error {
  readonly code: DepositAutomationErrorCode;

  constructor(code: DepositAutomationErrorCode, message: string) {
    super(message);
    this.name = 'DepositAutomationError';
    this.code = code;
  }
}

/**
 * Whether migration 0054 has run. Every read and write here asks first, so a database stopped at an older version
 * has every deposit off and nothing due. A positive answer is remembered per handle; a negative one is not, since
 * migrate() may run later on the same handle.
 */
const automationTables = new WeakMap<Db, boolean>();

export async function automationTablesExist(db: Db): Promise<boolean> {
  if (automationTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'deposit_events'`);
  const exists = rows.length > 0;
  if (exists) automationTables.set(db, true);
  return exists;
}

export interface DepositAutomationSettings {
  enabled: boolean;
  enabledOn: string | null;
  atMaturity: MaturityChoice;
  interestPaid: InterestPaid;
  payoutAccountId: string | null;
  termMonths: TermMonths;
  termStartedOn: string | null;
  keepRate: boolean;
  taxBps: number;
  taxExempt: boolean;
}

export interface DepositAutomationRow extends DepositAutomationSettings {
  accountId: string;
}

/** What a deposit with no row reads as: off, and the defaults the S2 group shows when it is first switched on. */
export const AUTOMATION_DEFAULTS: DepositAutomationSettings = {
  enabled: false,
  enabledOn: null,
  atMaturity: 'principal',
  interestPaid: 'at_maturity',
  payoutAccountId: null,
  termMonths: 1,
  termStartedOn: null,
  keepRate: true,
  taxBps: DEFAULT_TAX_BPS,
  taxExempt: false,
};

type AutomationRecord = typeof depositAutomation.$inferSelect;

const fromRecord = (r: AutomationRecord): DepositAutomationRow => ({
  accountId: r.accountId,
  enabled: r.enabled === 1,
  enabledOn: r.enabledOn,
  atMaturity: r.atMaturity,
  interestPaid: r.interestPaid,
  payoutAccountId: r.payoutAccountId,
  termMonths: r.termMonths as TermMonths,
  termStartedOn: r.termStartedOn,
  keepRate: r.keepRate === 1,
  taxBps: r.taxBps,
  taxExempt: r.taxExempt === 1,
});

async function automationTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<DepositAutomationRow | undefined> {
  const [row] = await tx
    .select()
    .from(depositAutomation)
    .where(and(eq(depositAutomation.accountId, accountId), eq(depositAutomation.workspaceId, ws.workspaceId)));
  return row ? fromRecord(row) : undefined;
}

export async function getDepositAutomation(database: Database, ws: WorkspaceContext, accountId: string): Promise<DepositAutomationRow> {
  const found = (await automationTablesExist(database.db)) ? await automationTx(database.db, ws, accountId) : undefined;
  return found ?? { accountId, ...AUTOMATION_DEFAULTS };
}

interface LiveDeposit {
  id: string;
  name: string;
  currency: string;
}

/** A time deposit of this workspace that is still open. Anything else is refused, whatever the caller thought it had. */
async function liveDepositTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<LiveDeposit> {
  const [row] = await tx
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency, subtype: accounts.subtype, archivedAt: accounts.archivedAt })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row || row.subtype !== 'time_deposit' || row.archivedAt !== null || row.currency === null) {
    throw new DepositAutomationError('NOT_FOUND', 'That deposit is not open in this workspace');
  }
  return { id: row.id, name: row.name, currency: row.currency };
}

/** Where money may land: an open, spendable account of this workspace holding the deposit's own currency. */
async function checkPayoutTx(tx: Db, ws: WorkspaceContext, payoutAccountId: string, currency: string): Promise<void> {
  const [row] = await tx
    .select({ subtype: accounts.subtype, currency: accounts.currency, archivedAt: accounts.archivedAt, kind: accounts.kind })
    .from(accounts)
    .where(and(eq(accounts.id, payoutAccountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row || row.kind !== 'asset' || row.archivedAt !== null || !SPENDABLE_SUBTYPES.includes(row.subtype)) {
    throw new DepositAutomationError('BAD_PAYOUT', 'Choose an open account in this workspace that money can land in');
  }
  if (row.currency !== currency) throw new DepositAutomationError('BAD_PAYOUT', `Choose an account that holds ${currency}`);
}

export interface SaveDepositAutomationInput {
  accountId: string;
  enabled: boolean;
  atMaturity: MaturityChoice;
  interestPaid: InterestPaid;
  payoutAccountId: string | null;
  termMonths: TermMonths;
  keepRate: boolean;
  taxBps: number;
  taxExempt: boolean;
  /** Local YYYY-MM-DD: becomes `enabledOn` when this save turns the switch on. */
  today: string;
}

/** Writes a deposit's settings. A missing payout is allowed here and refused at confirm, where it matters. */
export async function saveDepositAutomation(database: Database, ws: WorkspaceContext, input: SaveDepositAutomationInput): Promise<void> {
  if (!(TERM_MONTHS as readonly number[]).includes(input.termMonths)) throw new DepositAutomationError('BAD_TERM', 'A term is 1, 3, 6 or 12 months');
  if (!Number.isInteger(input.taxBps) || input.taxBps < 0 || input.taxBps > 10_000) {
    throw new DepositAutomationError('BAD_TAX', 'Tax withheld is a percentage from 0 to 100, to two decimals');
  }
  await database.transaction(async (tx) => {
    if (!(await automationTablesExist(tx))) throw new DepositAutomationError('NOT_READY', 'Update the app to automate a deposit');
    const deposit = await liveDepositTx(tx, ws, input.accountId);
    if (input.payoutAccountId !== null) {
      if (input.payoutAccountId === deposit.id) throw new DepositAutomationError('BAD_PAYOUT', 'The money cannot land in the deposit it came from');
      await checkPayoutTx(tx, ws, input.payoutAccountId, deposit.currency);
    }
    const before = await automationTx(tx, ws, deposit.id);
    const enabledOn = input.enabled ? (before?.enabled ? before.enabledOn : input.today) : null;
    const values = {
      accountId: deposit.id,
      workspaceId: ws.workspaceId,
      enabled: input.enabled ? 1 : 0,
      enabledOn,
      atMaturity: input.atMaturity,
      interestPaid: input.interestPaid,
      payoutAccountId: input.payoutAccountId,
      termMonths: input.termMonths,
      termStartedOn: before?.termStartedOn ?? null,
      keepRate: input.keepRate ? 1 : 0,
      taxBps: input.taxBps,
      taxExempt: input.taxExempt ? 1 : 0,
      updatedAt: new Date().toISOString(),
    };
    const { accountId, workspaceId, ...changes } = values;
    await tx.insert(depositAutomation).values(values).onConflictDoUpdate({ target: depositAutomation.accountId, set: changes });
  });
}
```

Add `export * from './repos/deposit-automation';` to `packages/db/src/index.ts` after the `deposit-terms` line. (Some imports above are first used in Tasks 4–5. If lint flags them as unused now, add them in the task that uses them.)

- [ ] **Step 5: Run** — `cd packages/db && npx vitest run test/deposit-automation.test.ts test/accounts.test.ts test/deposits.test.ts` → PASS; root gate.
- [ ] **Step 6: Commit** — `feat(db): a deposit's automation settings, off until the owner turns them on`.

---

### Task 4: What is due, with its figures

**Files:**
- Modify: `packages/db/src/repos/deposit-automation.ts`, `packages/db/test/deposit-automation.test.ts`

**Interfaces:**
- Consumes: `dueDepositEvents`, `depositInterest`, `withholdTax`, `eventKey` (Task 1); `nativeBalances(database, ws, asOf)` (existing; the principal is the balance **at the end of the due day**).
- Produces: `type DepositProposal`; `listDueDeposits(database, ws, today): Promise<DepositProposal[]>`; internal `scheduleOf`, `doneKeysTx` (used again by Task 5).

- [ ] **Step 1: Failing tests** — append:

```ts
import { listDueDeposits } from '../src/index';

describe('what is due', () => {
  it('is nothing while the switch is off, even after the maturity', async () => {
    expect(await listDueDeposits(database, ws, '2026-12-31')).toEqual([]);
  });

  it('proposes the maturity on its day, with the figures of the mockup', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    expect(await listDueDeposits(database, ws, '2026-10-14')).toEqual([]);
    const [proposal] = await listDueDeposits(database, ws, '2026-10-15');
    expect(proposal).toMatchObject({
      accountId: depositoId,
      name: 'BCA Deposito',
      currency: 'IDR',
      event: { kind: 'maturity', dueOn: '2026-10-15', periodFrom: '2026-07-15', days: 92 },
      waiting: 0,
      principalMinor: 50_000_000,
      rateBps: 425,
      grossMinor: 535_616,
      taxMinor: 107_123,
      netMinor: 428_493,
    });
  });

  it('queues monthly payouts in date order and proposes only the earliest, counting the rest', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const [proposal] = await listDueDeposits(database, ws, '2026-10-15');
    expect(proposal).toMatchObject({ event: { kind: 'monthly', dueOn: '2026-08-15', days: 31 }, waiting: 2, grossMinor: 180_479, taxMinor: 36_095, netMinor: 144_384 });
  });

  it('takes no tax from a tax-free deposit', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { taxExempt: true }));
    const [proposal] = await listDueDeposits(database, ws, '2026-10-15');
    expect(proposal).toMatchObject({ grossMinor: 535_616, taxMinor: 0, netMinor: 535_616 });
  });

  it('forgets an archived deposit', async () => {
    const small = await openCashAccount(database, ws, { item: 'time_deposit', name: 'Empty', currency: 'IDR', maturesOn: '2026-08-15', rateBps: 300 });
    await saveDepositAutomation(database, ws, on(small.id, bcaId, { termMonths: 1 }));
    await archiveAccount(database, ws, small.id);
    expect((await listDueDeposits(database, ws, '2026-10-15')).map((p) => p.accountId)).not.toContain(small.id);
  });
});
```

- [ ] **Step 2: Implement** — append to `deposit-automation.ts`:

```ts
function scheduleOf(settings: DepositAutomationRow, terms: Pick<DepositTermsRow, 'maturesOn'>): DepositSchedule {
  return {
    maturesOn: terms.maturesOn,
    termMonths: settings.termMonths,
    termStartedOn: settings.termStartedOn,
    interestPaid: settings.interestPaid,
    // Only read while enabled, when it is always set; the maturity is a harmless floor otherwise.
    enabledOn: settings.enabledOn ?? terms.maturesOn,
  };
}

async function doneKeysTx(db: Db, ws: WorkspaceContext, accountId: string): Promise<Set<string>> {
  const rows = await db
    .select({ kind: depositEvents.kind, dueOn: depositEvents.dueOn })
    .from(depositEvents)
    .where(and(eq(depositEvents.workspaceId, ws.workspaceId), eq(depositEvents.accountId, accountId)));
  return new Set(rows.map((row) => eventKey(row.kind, row.dueOn)));
}

export interface DepositProposal {
  accountId: string;
  name: string;
  currency: string;
  /** The earliest due event: the only one proposed. */
  event: DepositEvent;
  /** How many more are due after it. Each is worked out once the one before it is confirmed. */
  waiting: number;
  /** The deposit's balance at the end of the due day. */
  principalMinor: number;
  rateBps: number;
  grossMinor: number;
  taxMinor: number;
  netMinor: number;
  settings: DepositAutomationRow;
}

/** Every automated deposit of the workspace with something due today or earlier, soonest first. */
export async function listDueDeposits(database: Database, ws: WorkspaceContext, today: string): Promise<DepositProposal[]> {
  if (!(await automationTablesExist(database.db))) return [];
  const rows = await database.db
    .select({ automation: depositAutomation, terms: depositTerms, name: accounts.name, currency: accounts.currency })
    .from(depositAutomation)
    .innerJoin(depositTerms, eq(depositTerms.accountId, depositAutomation.accountId))
    .innerJoin(accounts, eq(accounts.id, depositAutomation.accountId))
    .where(
      and(
        eq(depositAutomation.workspaceId, ws.workspaceId),
        eq(accounts.workspaceId, ws.workspaceId),
        eq(depositAutomation.enabled, 1),
        isNull(accounts.archivedAt),
      ),
    );
  const proposals: DepositProposal[] = [];
  for (const row of rows) {
    if (row.currency === null) continue;
    const settings = fromRecord(row.automation);
    const due = dueDepositEvents(scheduleOf(settings, row.terms), await doneKeysTx(database.db, ws, settings.accountId), today);
    const [event] = due;
    if (!event) continue;
    // The existing balance reader, as of the due day: a payout posted into the deposit earlier in the term is in it.
    const principalMinor = (await nativeBalances(database, ws, event.dueOn))[settings.accountId] ?? 0;
    const grossMinor = depositInterest(principalMinor, row.terms.rateBps, event.days);
    const { taxMinor, netMinor } = withholdTax(grossMinor, settings.taxBps, settings.taxExempt);
    proposals.push({
      accountId: settings.accountId,
      name: row.name,
      currency: row.currency,
      event,
      waiting: due.length - 1,
      principalMinor,
      rateBps: row.terms.rateBps,
      grossMinor,
      taxMinor,
      netMinor,
      settings,
    });
  }
  return proposals.sort((a, b) => a.event.dueOn.localeCompare(b.event.dueOn));
}
```

- [ ] **Step 3: Run** — `cd packages/db && npx vitest run test/deposit-automation.test.ts` → PASS; root gate.
- [ ] **Step 4: Commit** — `feat(db): what a deposit has due, worked out and never stored`.

---

### Task 5: Confirming an event

**Files:**
- Modify: `packages/db/src/repos/deposit-automation.ts`, `packages/db/test/deposit-automation.test.ts`

**Interfaces:**
- Consumes (all existing, **called, not copied**): `postTransactionTx`, `incomeLines`, `transferLines`, `categoryIdsByKeyTx` (key `income.investment`), `saveDepositTermsTx`, `getDepositTermsTx`, `archiveAccountTx`, `addMonthsToDate`, `dueDepositEvents`.
- Produces: `type ConfirmDepositEventInput`, `type ConfirmedDepositEvent`, `confirmDepositEvent(database, ws, input): Promise<ConfirmedDepositEvent>`.

- [ ] **Step 1: Failing tests** — append:

```ts
import { confirmDepositEvent, type DepositProposal, getDepositTerms, listAccounts, nativeBalances } from '../src/index';

/** Confirms the proposal exactly as proposed, the way the card does when nothing was edited. */
export async function confirmAsProposed(database: Database, ws: WorkspaceContext, p: DepositProposal, today: string, rateToBase?: number) {
  return confirmDepositEvent(database, ws, {
    accountId: p.accountId,
    kind: p.event.kind,
    dueOn: p.event.dueOn,
    today,
    principalMinor: p.principalMinor,
    grossMinor: p.grossMinor,
    taxMinor: p.taxMinor,
    netMinor: p.netMinor,
    newRateBps: p.rateBps,
    newTermMonths: p.settings.termMonths,
    rateToBase,
  });
}

const next = async (today: string) => (await listDueDeposits(database, ws, today))[0]!;

describe('confirming', () => {
  it('rolls the principal over: net interest to the payout account, a new term, and nothing proposed after', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    await confirmAsProposed(database, ws, await next('2026-10-15'), '2026-10-15');
    const balances = await nativeBalances(database, ws);
    expect(balances[bcaId]).toBe(1_428_493);
    expect(balances[depositoId]).toBe(50_000_000);
    expect(await getDepositTerms(database, ws, depositoId)).toMatchObject({ maturesOn: '2027-01-15', rateBps: 425 });
    expect(await getDepositAutomation(database, ws, depositoId)).toMatchObject({ termStartedOn: '2026-10-15', termMonths: 3 });
    expect(await listDueDeposits(database, ws, '2026-10-15')).toEqual([]);
  });

  it('posts what was typed, not what was worked out, and carries a corrected rate and term', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    const p = await next('2026-10-15');
    await confirmDepositEvent(database, ws, {
      accountId: depositoId, kind: 'maturity', dueOn: '2026-10-15', today: '2026-10-15',
      principalMinor: p.principalMinor, grossMinor: p.grossMinor, taxMinor: p.taxMinor,
      netMinor: 428_500, newRateBps: 400, newTermMonths: 6,
    });
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_428_500);
    expect(await getDepositTerms(database, ws, depositoId)).toMatchObject({ maturesOn: '2027-04-15', rateBps: 400 });
  });

  it('closes a deposit that does not roll over: it empties into the payout account and is archived', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    const result = await confirmAsProposed(database, ws, await next('2026-10-15'), '2026-10-15');
    expect(result.archived).toBe(true);
    const balances = await nativeBalances(database, ws);
    expect(balances[bcaId]).toBe(51_428_493);
    expect(balances[depositoId] ?? 0).toBe(0);
    expect((await listAccounts(database, ws)).map((a) => a.id)).not.toContain(depositoId);
    expect((await getDepositAutomation(database, ws, depositoId)).enabled).toBe(false);
  });

  it('keeps a deposit open when the principal typed leaves money in it', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    const p = await next('2026-10-15');
    const result = await confirmDepositEvent(database, ws, { ...(await confirmInput(p)), principalMinor: 49_000_000 });
    expect(result.archived).toBe(false);
    expect((await nativeBalances(database, ws))[depositoId]).toBe(1_000_000);
    expect((await getDepositAutomation(database, ws, depositoId)).enabled).toBe(false);
  });

  it('refuses the second of two confirms, and anything that is not next', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const first = await next('2026-10-15');
    await expect(
      confirmDepositEvent(database, ws, { ...(await confirmInput(first)), dueOn: '2026-09-15' }),
    ).rejects.toMatchObject({ code: 'NOT_NEXT' });
    await confirmAsProposed(database, ws, first, '2026-10-15');
    await expect(confirmAsProposed(database, ws, first, '2026-10-15')).rejects.toMatchObject({ code: 'NOT_NEXT' });
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_144_384);
  });

  it('refuses while off, and without a payout account where money must land', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, null));
    await expect(confirmAsProposed(database, ws, await next('2026-10-15'), '2026-10-15')).rejects.toMatchObject({ code: 'NO_PAYOUT' });
    const p = await next('2026-10-15');
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { enabled: false }));
    await expect(confirmAsProposed(database, ws, p, '2026-10-15')).rejects.toMatchObject({ code: 'OFF' });
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_000_000);
  });

  it('refuses a figure that is not whole minor units, or a tax above the gross', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    const p = await next('2026-10-15');
    await expect(confirmDepositEvent(database, ws, { ...(await confirmInput(p)), netMinor: 428_493.5 })).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    await expect(confirmDepositEvent(database, ws, { ...(await confirmInput(p)), taxMinor: 600_000 })).rejects.toMatchObject({ code: 'BAD_FIGURE' });
  });
});

async function confirmInput(p: DepositProposal) {
  return {
    accountId: p.accountId, kind: p.event.kind, dueOn: p.event.dueOn, today: '2026-10-15',
    principalMinor: p.principalMinor, grossMinor: p.grossMinor, taxMinor: p.taxMinor, netMinor: p.netMinor,
    newRateBps: p.rateBps, newTermMonths: p.settings.termMonths,
  };
}
```

- [ ] **Step 2: Implement** — append to `deposit-automation.ts`:

```ts
export interface ConfirmDepositEventInput {
  accountId: string;
  kind: DepositEvent['kind'];
  dueOn: string;
  /** Local YYYY-MM-DD, to check that this event is still the earliest due. */
  today: string;
  /** Posted only when the deposit does not roll over; logged either way. */
  principalMinor: number;
  /** As computed from the stored rate, for the log. */
  grossMinor: number;
  taxMinor: number;
  /** What the bank credited, net of tax, as confirmed. 0 posts nothing. */
  netMinor: number;
  /** Maturity with a roll-over only. */
  newRateBps?: number;
  newTermMonths?: TermMonths;
  /** Units of base per one major unit of the deposit's currency, when that is not the base. */
  rateToBase?: number;
}

export interface ConfirmedDepositEvent {
  interestTransactionId: string | null;
  principalTransactionId: string | null;
  archived: boolean;
}

const whole = (n: number | undefined): n is number => n !== undefined && Number.isSafeInteger(n) && n >= 0;

/**
 * Posts one due event through the ledger's own paths and marks it done, all in one transaction. Refuses anything
 * that is not the earliest due event of an automated, open deposit of this workspace.
 */
export async function confirmDepositEvent(database: Database, ws: WorkspaceContext, input: ConfirmDepositEventInput): Promise<ConfirmedDepositEvent> {
  if (!whole(input.netMinor) || !whole(input.grossMinor) || !whole(input.taxMinor) || !whole(input.principalMinor) || input.taxMinor > input.grossMinor) {
    throw new DepositAutomationError('BAD_FIGURE', 'Every figure is a whole amount, not below zero, and the tax is not more than the interest');
  }
  return database.transaction(async (tx) => {
    if (!(await automationTablesExist(tx))) throw new DepositAutomationError('NOT_READY', 'Update the app to automate a deposit');
    const deposit = await liveDepositTx(tx, ws, input.accountId);
    const settings = await automationTx(tx, ws, deposit.id);
    const terms = await getDepositTermsTx(tx, ws, deposit.id);
    if (!settings?.enabled || !terms) throw new DepositAutomationError('OFF', 'Automation is off for this deposit');

    const [first] = dueDepositEvents(scheduleOf(settings, terms), await doneKeysTx(tx, ws, deposit.id), input.today);
    if (!first || first.kind !== input.kind || first.dueOn !== input.dueOn) {
      throw new DepositAutomationError('NOT_NEXT', 'This is not the next thing due on this deposit. Reopen it to see what is.');
    }

    const maturity = input.kind === 'maturity';
    const closing = maturity && settings.atMaturity === 'close';
    const rolling = maturity && !closing;
    if (needsPayout(settings.atMaturity) && settings.payoutAccountId === null) {
      throw new DepositAutomationError('NO_PAYOUT', 'Choose the account the money lands in first');
    }
    if (settings.payoutAccountId !== null && needsPayout(settings.atMaturity)) await checkPayoutTx(tx, ws, settings.payoutAccountId, deposit.currency);
    if (closing && input.principalMinor <= 0) throw new DepositAutomationError('BAD_FIGURE', 'Say how much came back');
    if (rolling && (!(TERM_MONTHS as readonly number[]).includes(input.newTermMonths ?? 0) || !whole(input.newRateBps))) {
      throw new DepositAutomationError('BAD_FIGURE', 'A roll-over needs its new term and rate');
    }

    const interestInto = needsPayout(settings.atMaturity) ? settings.payoutAccountId! : deposit.id;
    const ratesToBase = deposit.currency !== ws.baseCurrency && input.rateToBase !== undefined ? { [deposit.currency]: input.rateToBase } : {};

    let interestTransactionId: string | null = null;
    if (input.netMinor > 0) {
      const incomeAccountId = (await categoryIdsByKeyTx(tx, ws))['income.investment'];
      if (!incomeAccountId) {
        throw new DepositAutomationError('NO_CATEGORY', 'The "income.investment" category is missing. Reopen the app so default categories are restored.');
      }
      interestTransactionId = await postTransactionTx(tx, ws, {
        occurredOn: input.dueOn,
        description: `Interest: ${deposit.name}`,
        lines: incomeLines({ incomeAccountId, depositAccountId: interestInto, amountMinor: input.netMinor, currency: deposit.currency }),
        ratesToBase,
      });
    }

    let principalTransactionId: string | null = null;
    if (closing) {
      principalTransactionId = await postTransactionTx(tx, ws, {
        occurredOn: input.dueOn,
        description: `${deposit.name} matured`,
        lines: transferLines({ fromAccountId: deposit.id, toAccountId: settings.payoutAccountId!, amountMinor: input.principalMinor, currency: deposit.currency }),
        ratesToBase,
      });
    }

    const now = new Date().toISOString();
    if (rolling) {
      await saveDepositTermsTx(tx, ws, { accountId: deposit.id, maturesOn: addMonthsToDate(input.dueOn, input.newTermMonths!), rateBps: input.newRateBps! });
      await tx
        .update(depositAutomation)
        .set({ termMonths: input.newTermMonths!, termStartedOn: input.dueOn, updatedAt: now })
        .where(eq(depositAutomation.accountId, deposit.id));
    }

    await tx.insert(depositEvents).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      accountId: deposit.id,
      kind: input.kind,
      dueOn: input.dueOn,
      principalMinor: input.principalMinor,
      grossMinor: input.grossMinor,
      taxMinor: input.taxMinor,
      netMinor: input.netMinor,
      interestTransactionId,
      principalTransactionId,
      confirmedAt: now,
    });

    let archived = false;
    if (closing) {
      await tx.update(depositAutomation).set({ enabled: 0, enabledOn: null, updatedAt: now }).where(eq(depositAutomation.accountId, deposit.id));
      try {
        // The archive keeps its own refusal: it checks the balance and throws before it writes anything.
        await archiveAccountTx(tx, ws, deposit.id);
        archived = true;
      } catch (error) {
        if (!(error instanceof AccountError)) throw error;
      }
    }
    return { interestTransactionId, principalTransactionId, archived };
  });
}
```

- [ ] **Step 3: Run** — `cd packages/db && npx vitest run test/deposit-automation.test.ts` → PASS; root gate.
- [ ] **Step 4: Commit** — `feat(db): confirming a deposit's due event posts through the ledger and logs it once`.

---

### Task 6: Every combination, in the repository

**Files:**
- Create: `packages/db/test/deposit-combinations.test.ts`

**Interfaces:**
- Consumes: `saveDepositAutomation`, `listDueDeposits`, `confirmDepositEvent`, `openCashAccount`, `nativeBalances`, `listAccounts`. No new production code. If a case fails, fix the production code, never the table.

This is the combination walk at the level of the money: 3 choices × monthly/at maturity × taxed/tax-free × IDR/USD. The USD fixture runs in an IDR workspace, so a currency mistake (exponent, rate to base, payout currency) shows up as a wrong integer. The table was computed from spec §5, including the monthly compounding of *principal + interest* (the principal is the balance on each due day).

- [ ] **Step 1: Write the test**

```ts
// packages/db/test/deposit-combinations.test.ts
import type { MaturityChoice } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { confirmDepositEvent, listAccounts, listDueDeposits, nativeBalances, openCashAccount, saveDepositAutomation } from '../src/index';
import { setupDb } from './helpers';

const FIXTURE = {
  IDR: { opened: '2026-07-15', matures: '2026-10-15', principal: 50_000_000, rateBps: 425, payout: 1_000_000, fx: undefined },
  USD: { opened: '2026-08-01', matures: '2026-11-01', principal: 1_000_000, rateBps: 350, payout: 5_000, fx: 16_350 },
} as const;

type Row = [currency: 'IDR' | 'USD', choice: MaturityChoice, paid: 'monthly' | 'at_maturity', exempt: boolean, nets: number[], deposit: number, payout: number];

// prettier-ignore
const ROWS: Row[] = [
  ['IDR', 'principal',          'at_maturity', false, [428_493],                     50_000_000,  1_428_493],
  ['IDR', 'principal',          'at_maturity', true,  [535_616],                     50_000_000,  1_535_616],
  ['IDR', 'principal',          'monthly',     false, [144_384, 144_384, 139_726],   50_000_000,  1_428_494],
  ['IDR', 'principal',          'monthly',     true,  [180_479, 180_479, 174_657],   50_000_000,  1_535_615],
  ['IDR', 'principal_interest', 'at_maturity', false, [428_493],                     50_428_493,  1_000_000],
  ['IDR', 'principal_interest', 'at_maturity', true,  [535_616],                     50_535_616,  1_000_000],
  ['IDR', 'principal_interest', 'monthly',     false, [144_384, 144_800, 140_534],   50_429_718,  1_000_000],
  ['IDR', 'principal_interest', 'monthly',     true,  [180_479, 181_130, 175_920],   50_537_529,  1_000_000],
  ['IDR', 'close',              'at_maturity', false, [428_493],                     0,          51_428_493],
  ['IDR', 'close',              'at_maturity', true,  [535_616],                     0,          51_535_616],
  ['IDR', 'close',              'monthly',     false, [144_384, 144_384, 139_726],   0,          51_428_494],
  ['IDR', 'close',              'monthly',     true,  [180_479, 180_479, 174_657],   0,          51_535_615],
  ['USD', 'principal',          'at_maturity', false, [7_057],                       1_000_000,  12_057],
  ['USD', 'principal',          'at_maturity', true,  [8_821],                       1_000_000,  13_821],
  ['USD', 'principal',          'monthly',     false, [2_378, 2_301, 2_378],         1_000_000,  12_057],
  ['USD', 'principal',          'monthly',     true,  [2_972, 2_876, 2_972],         1_000_000,  13_820],
  ['USD', 'principal_interest', 'at_maturity', false, [7_057],                       1_007_057,  5_000],
  ['USD', 'principal_interest', 'at_maturity', true,  [8_821],                       1_008_821,  5_000],
  ['USD', 'principal_interest', 'monthly',     false, [2_378, 2_307, 2_389],         1_007_074,  5_000],
  ['USD', 'principal_interest', 'monthly',     true,  [2_972, 2_885, 2_990],         1_008_847,  5_000],
  ['USD', 'close',              'at_maturity', false, [7_057],                       0,          1_012_057],
  ['USD', 'close',              'at_maturity', true,  [8_821],                       0,          1_013_821],
  ['USD', 'close',              'monthly',     false, [2_378, 2_301, 2_378],         0,          1_012_057],
  ['USD', 'close',              'monthly',     true,  [2_972, 2_876, 2_972],         0,          1_013_820],
];

describe('every combination of choice, payout, tax and currency', () => {
  it.each(ROWS)('%s · %s · %s · tax-free %s', async (currency, choice, paid, exempt, nets, depositEnd, payoutEnd) => {
    const { database, ws, executor } = await setupDb('IDR');
    try {
      const f = FIXTURE[currency];
      const payout = await openCashAccount(database, ws, { item: 'bank', name: 'Payout', currency, openingBalanceMinor: f.payout, openedOn: f.opened, openingRateToBase: f.fx });
      const deposit = await openCashAccount(database, ws, {
        item: 'time_deposit', name: 'Deposito', currency, openingBalanceMinor: f.principal, openedOn: f.opened,
        openingRateToBase: f.fx, maturesOn: f.matures, rateBps: f.rateBps,
      });
      await saveDepositAutomation(database, ws, {
        accountId: deposit.id, enabled: true, atMaturity: choice, interestPaid: paid, payoutAccountId: payout.id,
        termMonths: 3, keepRate: true, taxBps: 2_000, taxExempt: exempt, today: f.opened,
      });

      // The app was not opened all term: everything waits, and is confirmed one at a time in date order.
      const posted: number[] = [];
      for (let p = (await listDueDeposits(database, ws, f.matures))[0]; p; p = (await listDueDeposits(database, ws, f.matures))[0]) {
        posted.push(p.netMinor);
        await confirmDepositEvent(database, ws, {
          accountId: p.accountId, kind: p.event.kind, dueOn: p.event.dueOn, today: f.matures,
          principalMinor: p.principalMinor, grossMinor: p.grossMinor, taxMinor: p.taxMinor, netMinor: p.netMinor,
          newRateBps: p.rateBps, newTermMonths: p.settings.termMonths, rateToBase: f.fx,
        });
      }

      expect(posted).toEqual(nets);
      const balances = await nativeBalances(database, ws);
      expect(balances[deposit.id] ?? 0).toBe(depositEnd);
      expect(balances[payout.id]).toBe(payoutEnd);
      const open = (await listAccounts(database, ws)).map((a) => a.id);
      expect(open.includes(deposit.id)).toBe(choice !== 'close');
    } finally {
      executor.close();
    }
  });
});
```

- [ ] **Step 2: Run** — `cd packages/db && npx vitest run test/deposit-combinations.test.ts` → 24 PASS; root gate.
- [ ] **Step 3: Commit** — `test(db): all 24 deposit combinations end in the right balances`.

---

## Step 3 — The deposit's page

### Task 7: The switch and its settings (S2)

**Files:**
- Create: `apps/web/src/features/networth/maturity-settings.ts`, `maturity-settings.test.ts`, `MaturitySettings.tsx`
- Modify: `apps/web/src/features/networth/deposit-terms.ts`, `deposit-terms.test.ts`, `DepositTermsCard.tsx`, `queries.ts`, `AssetDetailPage.tsx`

**Interfaces:**
- Consumes: `getDepositAutomation`, `saveDepositAutomation`, `SPENDABLE_SUBTYPES`, `type AccountRow` from `@expanses/db`; `TERM_MONTHS`, `needsPayout`, `parseRate`, `isoDate` from `@expanses/core`; `useAccounts`, `useInvalidateAll`; kit `InsetGroup`, `InsetRow`, `SwitchRow`, `SelectRow`, `TextRow`.
- Produces: `rateInputText(bps)`, `rateBpsFrom(text)`; `MATURITY_CHOICES`, `termLabel`, `payoutChoices`, `taxBpsFrom`; `useDepositAutomation(accountId)`, `useDueDeposits()`; `<MaturitySettings accountId currency />`.

- [ ] **Step 1: One reader and one writer of a typed rate.** In `deposit-terms.ts`, add:

```ts
import { parseRate } from '@expanses/core';

/** Basis points back into the percent a form asks for, with the comma its placeholder shows: 425 is "4,25"; 0 is empty. */
export const rateInputText = (rateBps: number): string => (rateBps === 0 ? '' : String(rateBps / 100).replace('.', ','));

/** A typed percent into basis points, read by `parseRate`: "4,25" is 425, "12,5" is 1250. */
export const rateBpsFrom = (text: string): number => Math.round(parseRate(text) * 100);
```

In `DepositTermsCard.tsx`, replace `rateBps === 0 ? '' : String(rateBps / 100).replace('.', ',')` with `rateInputText(rateBps)` and `Math.round(parseRate(rate) * 100)` with `rateBpsFrom(rate)`. There is no behaviour change, and the existing e2e is the check. Tests appended to `deposit-terms.test.ts`:

```ts
it('turns a stored rate into what the box shows, and back', () => {
  expect(rateInputText(425)).toBe('4,25');
  expect(rateInputText(2000)).toBe('20');
  expect(rateInputText(0)).toBe('');
  expect(rateBpsFrom('4,25')).toBe(425);
  expect(rateBpsFrom('6,37')).toBe(637); // 6.37 × 100 is 636.999… in floating point; the round is what keeps it 637
  expect(rateBpsFrom('12,5')).toBe(1250);
});
```

- [ ] **Step 2: The settings model**

```ts
// apps/web/src/features/networth/maturity-settings.ts
import type { MaturityChoice } from '@expanses/core';
import { type AccountRow, SPENDABLE_SUBTYPES } from '@expanses/db';
import { rateBpsFrom } from './deposit-terms';

export const MATURITY_CHOICES: readonly { id: MaturityChoice; title: string; subtitle: (payout: string | null) => string }[] = [
  { id: 'principal', title: 'Roll over the principal', subtitle: (payout) => `Interest lands in ${payout ?? 'the account below'}` },
  { id: 'principal_interest', title: 'Roll over principal + interest', subtitle: () => 'Nothing lands; the deposit grows' },
  { id: 'close', title: "Don't roll over", subtitle: (payout) => `Everything lands in ${payout ?? 'the account below'}` },
];

export const termLabel = (months: number): string => `${months} ${months === 1 ? 'month' : 'months'}`;

/** Where the money may land: the same rule `saveDepositAutomation` enforces, so the list never offers a refusal. */
export function payoutChoices(accounts: readonly AccountRow[], currency: string, depositId: string): AccountRow[] {
  return accounts.filter(
    (account) =>
      account.id !== depositId &&
      account.kind === 'asset' &&
      account.archivedAt === null &&
      account.currency === currency &&
      SPENDABLE_SUBTYPES.includes(account.subtype),
  );
}

/** The typed withholding in basis points, 0–100 %. */
export function taxBpsFrom(text: string): number {
  const bps = rateBpsFrom(text);
  if (bps < 0 || bps > 10_000) throw new Error('Tax withheld is a percentage from 0 to 100');
  return bps;
}
```

```ts
// apps/web/src/features/networth/maturity-settings.test.ts
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { payoutChoices, taxBpsFrom, termLabel } from './maturity-settings';

const account = (id: string, partial: Partial<AccountRow>): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind: 'asset', subtype: 'bank', name: id, icon: null, currency: 'IDR',
  valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-01-01T00:00:00Z', ...partial,
});

describe('where the money may land', () => {
  it('offers only open, spendable accounts in the deposit’s currency, never the deposit', () => {
    const all = [
      account('bca', {}),
      account('jenius-usd', { currency: 'USD' }),
      account('closed', { archivedAt: '2026-02-01T00:00:00Z' }),
      account('visa', { kind: 'liability', subtype: 'credit_card' }),
      account('deposito', { subtype: 'time_deposit' }),
      account('gopay', { subtype: 'ewallet' }),
    ];
    expect(payoutChoices(all, 'IDR', 'deposito').map((a) => a.id)).toEqual(['bca', 'gopay']);
    expect(payoutChoices(all, 'USD', 'deposito').map((a) => a.id)).toEqual(['jenius-usd']);
  });
});

describe('the rest of the group', () => {
  it('says a term in words', () => {
    expect(termLabel(1)).toBe('1 month');
    expect(termLabel(12)).toBe('12 months');
  });

  it('reads a withholding typed either way, and refuses more than all of it', () => {
    expect(taxBpsFrom('20')).toBe(2000);
    expect(taxBpsFrom('12,5')).toBe(1250);
    expect(taxBpsFrom('12.5')).toBe(1250);
    expect(() => taxBpsFrom('101')).toThrow();
  });
});
```

- [ ] **Step 3: Queries** — append to `networth/queries.ts` (and add `getDepositAutomation`, `listDueDeposits` to its `@expanses/db` import):

```ts
/** One deposit's automation settings; a deposit with none reads as off. */
export function useDepositAutomation(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['deposit-automation', ws.workspaceId, accountId], queryFn: () => getDepositAutomation(database, ws, accountId) });
}

/** What every automated deposit has due today or earlier: the proposal on its page, the marker on its row. */
export function useDueDeposits() {
  const { database, ws } = useApp();
  const today = isoDate();
  return useQuery({ queryKey: ['deposit-due', ws.workspaceId, today], queryFn: () => listDueDeposits(database, ws, today) });
}
```

- [ ] **Step 4: The component**

```tsx
// apps/web/src/features/networth/MaturitySettings.tsx
import { isoDate, needsPayout, TERM_MONTHS, type TermMonths } from '@expanses/core';
import { type DepositAutomationRow, saveDepositAutomation } from '@expanses/db';
import { Check } from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { rateInputText } from './deposit-terms';
import { MATURITY_CHOICES, payoutChoices, taxBpsFrom, termLabel } from './maturity-settings';
import { useDepositAutomation, useDepositTerms } from './queries';

/**
 * S2: the switch and its settings, inline on the deposit's page. Off is one row and changes nothing anywhere.
 * Mounted once the saved settings are in, so the local copy starts from them.
 */
export function MaturitySettings({ accountId, currency }: { accountId: string; currency: string }) {
  const automation = useDepositAutomation(accountId);
  const terms = useDepositTerms();
  if (!automation.data || !(terms.data ?? []).some((row) => row.accountId === accountId)) return null;
  return <SettingsGroup key={accountId} saved={automation.data} currency={currency} />;
}

function SettingsGroup({ saved, currency }: { saved: DepositAutomationRow; currency: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  /*
   * The settings live here, not in the query. Each change updates this copy at once and saves the whole of it,
   * one save after another, so two quick changes can never send the older settings last.
   */
  const [settings, setSettings] = useState(saved);
  const [taxText, setTaxText] = useState(rateInputText(saved.taxBps) || '0');
  const [error, setError] = useState<unknown>(null);
  const queue = useRef(Promise.resolve());

  const choices = payoutChoices(accounts.data ?? [], currency, settings.accountId);
  const payoutName = choices.find((account) => account.id === settings.payoutAccountId)?.name ?? null;

  function save(change: Partial<DepositAutomationRow>) {
    const next = { ...settings, ...change };
    setSettings(next);
    setError(null);
    queue.current = queue.current.then(async () => {
      try {
        await saveDepositAutomation(database, ws, {
          accountId: next.accountId,
          enabled: next.enabled,
          atMaturity: next.atMaturity,
          interestPaid: next.interestPaid,
          payoutAccountId: next.payoutAccountId,
          termMonths: next.termMonths,
          keepRate: next.keepRate,
          taxBps: next.taxBps,
          taxExempt: next.taxExempt,
          today: isoDate(),
        });
        await invalidate();
      } catch (e) {
        setError(e);
      }
    });
  }

  function commitTax() {
    try {
      const taxBps = taxBpsFrom(taxText);
      if (taxBps !== settings.taxBps) save({ taxBps });
    } catch (e) {
      setError(e);
    }
  }

  // Rows as an array: InsetGroup numbers its children with Children.toArray, which does not look inside a fragment.
  const rows = [
    <SwitchRow
      key="automate"
      label="Automate"
      checked={settings.enabled}
      hint="Propose it on the day; nothing posts until you confirm."
      onChange={(enabled) => save({ enabled, payoutAccountId: settings.payoutAccountId ?? (enabled ? (choices[0]?.id ?? null) : null) })}
    />,
  ];
  if (settings.enabled) {
    rows.push(
      ...MATURITY_CHOICES.map((choice) => (
        <InsetRow
          key={choice.id}
          testId={`maturity-${choice.id}`}
          title={choice.title}
          subtitle={choice.subtitle(payoutName)}
          value={settings.atMaturity === choice.id ? <Check size={18} aria-label="Chosen" className="text-[var(--ph-tint)]" /> : undefined}
          chevron={false}
          onClick={() => save({ atMaturity: choice.id })}
        />
      )),
      <SelectRow key="paid" label="Interest paid" value={settings.interestPaid} onChange={(e) => save({ interestPaid: e.target.value as DepositAutomationRow['interestPaid'] })}>
        <option value="monthly">Monthly</option>
        <option value="at_maturity">At maturity</option>
      </SelectRow>,
    );
    if (needsPayout(settings.atMaturity)) {
      rows.push(
        <SelectRow key="payout" label="Lands in" value={settings.payoutAccountId ?? ''} onChange={(e) => save({ payoutAccountId: e.target.value || null })}>
          {choices.length === 0 && <option value="">No account holds {currency}</option>}
          {choices.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>,
      );
    }
    rows.push(
      <SelectRow key="term" label="Term" value={String(settings.termMonths)} onChange={(e) => save({ termMonths: Number(e.target.value) as TermMonths })}>
        {TERM_MONTHS.map((months) => (
          <option key={months} value={months}>
            {termLabel(months)}
          </option>
        ))}
      </SelectRow>,
      <SwitchRow key="keep" label="Keep the rate when it rolls over" checked={settings.keepRate} onChange={(keepRate) => save({ keepRate })} />,
      <SwitchRow
        key="exempt"
        label="Tax-free deposit"
        checked={settings.taxExempt}
        hint="Only if the rules exempt this deposit on its own. Splitting a larger sum into smaller deposits doesn't make them tax-free."
        onChange={(taxExempt) => save({ taxExempt })}
      />,
    );
    if (!settings.taxExempt) {
      rows.push(
        <TextRow key="tax" label="Tax withheld %" value={taxText} inputMode="decimal" onChange={(e) => setTaxText(e.target.value)} onBlur={commitTax} />,
      );
    }
  }

  return (
    <>
      <InsetGroup header="At maturity">{rows}</InsetGroup>
      <ErrorBox error={error} />
    </>
  );
}
```

(`ErrorBox` is outside the group, so the fragment here is not a child of `InsetGroup`.)

In `AssetDetailPage.tsx`, import `MaturitySettings` and render it directly after `<DepositTermsCard …/>`:

```tsx
      {value && account?.subtype === 'time_deposit' && <MaturitySettings accountId={accountId} currency={value.currency} />}
```

- [ ] **Step 5: Targeted e2e** — create `apps/web/e2e/deposit-maturity.ts` and the first tests of `deposit-maturity.spec.ts` (full content in Task 10; write the helper file now as given there). Run the two tests *"is off by default and changes nothing"* and *"keeps its settings across a reload"*: `cd apps/web && npx playwright test deposit-maturity --project=chromium -g "off by default|keeps its settings"`.
- [ ] **Step 6: Run** — `cd apps/web && npx vitest run src/features/networth` → PASS; root gate.
- [ ] **Step 7: Commit** — `feat(networth): automate a deposit from its own page`.

---

### Task 8: The proposal (P1)

**Files:**
- Create: `apps/web/src/features/networth/deposit-proposal.ts`, `deposit-proposal.test.ts`, `DepositProposalCard.tsx`
- Modify: `apps/web/src/features/networth/AssetDetailPage.tsx`

**Interfaces:**
- Consumes: `confirmDepositEvent`, `upsertRate`, `type DepositProposal` from `@expanses/db`; `parseMajor`, `parseRate`, `minorToMajorString`, `formatMinor`, `isoDate`, `TERM_MONTHS` from `@expanses/core`; `useResolveRates`, `useAccounts`, `useInvalidateAll` (`lib/queries`); `checkManualRate`, `ratePreview` (`lib/rates`); `maturityLabel`, `rateLabel`, `rateInputText`, `rateBpsFrom` (`deposit-terms.ts`); `termLabel` (Task 7).
- Produces: `draftFrom`, `readDraft`, `closing`, `rolling`, `proposalHeader`, `interestLine`, `outcomeLine`, `newRateText`; `<DepositProposalCard accountId onClosed />`.

- [ ] **Step 1: Failing tests**

```ts
// apps/web/src/features/networth/deposit-proposal.test.ts
import type { DepositProposal } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { draftFrom, interestLine, outcomeLine, proposalHeader, readDraft } from './deposit-proposal';

const idr: DepositProposal = {
  accountId: 'dep', name: 'BCA Deposito', currency: 'IDR',
  event: { kind: 'maturity', dueOn: '2026-10-15', periodFrom: '2026-07-15', days: 92 }, waiting: 0,
  principalMinor: 50_000_000, rateBps: 425, grossMinor: 535_616, taxMinor: 107_123, netMinor: 428_493,
  settings: {
    accountId: 'dep', enabled: true, enabledOn: '2026-07-15', atMaturity: 'principal', interestPaid: 'at_maturity', payoutAccountId: 'bca',
    termMonths: 3, termStartedOn: null, keepRate: true, taxBps: 2_000, taxExempt: false,
  },
};
const usd: DepositProposal = { ...idr, currency: 'USD', principalMinor: 1_000_000, rateBps: 350, grossMinor: 2_972, taxMinor: 594, netMinor: 2_378 };

describe('the draft', () => {
  it('starts from the figures worked out, in the deposit’s own currency', () => {
    expect(draftFrom(idr)).toEqual({ net: '428493', principal: '50000000', rate: '4,25', term: 3 });
    expect(draftFrom(usd)).toMatchObject({ net: '23.78', rate: '3,5' });
  });

  it('leaves the rate empty when the rate is not kept', () => {
    expect(draftFrom({ ...idr, settings: { ...idr.settings, keepRate: false } }).rate).toBe('');
  });

  it('reads what was typed with the app’s one reader, whichever separator', () => {
    expect(readDraft(idr, { ...draftFrom(idr), net: '428.500' })).toMatchObject({ netMinor: 428_500, newRateBps: 425, newTermMonths: 3 });
    expect(readDraft(usd, { ...draftFrom(usd), net: '23,80' }).netMinor).toBe(2_380);
    expect(readDraft(usd, { ...draftFrom(usd), net: '23.80' }).netMinor).toBe(2_380);
  });

  it('asks for the rate of a new term that does not keep the old one', () => {
    expect(() => readDraft(idr, { ...draftFrom(idr), rate: '' })).toThrow('Type the rate the new term pays');
  });

  it('asks nothing about a new term on a monthly payout, and posts the typed principal only when closing', () => {
    const monthly: DepositProposal = { ...idr, event: { ...idr.event, kind: 'monthly', dueOn: '2026-08-15' } };
    expect(readDraft(monthly, { ...draftFrom(monthly), rate: '' })).toEqual({ netMinor: 428_493, principalMinor: 50_000_000 });
    const closing: DepositProposal = { ...idr, settings: { ...idr.settings, atMaturity: 'close' } };
    expect(readDraft(closing, { ...draftFrom(closing), principal: '49.000.000' })).toEqual({ netMinor: 428_493, principalMinor: 49_000_000 });
  });
});

describe('what the card says', () => {
  it('names the event and the day', () => {
    expect(proposalHeader(idr, '2026-10-15')).toBe('Matured today');
    expect(proposalHeader(idr, '2026-10-20')).toBe('Matured 15 Oct 2026');
    expect(proposalHeader({ ...idr, event: { ...idr.event, kind: 'monthly', dueOn: '2026-08-15' } }, '2026-10-15')).toBe('Interest due 15 Aug 2026');
  });

  it('says the interest after its tax, or tax-free', () => {
    expect(interestLine(idr)).toContain('428.493');
    expect(interestLine(idr)).toContain('after 20% tax');
    expect(interestLine({ ...idr, netMinor: 535_616, settings: { ...idr.settings, taxExempt: true } })).toContain('tax-free');
  });

  it('says where the money goes', () => {
    expect(outcomeLine(idr, 'BCA Tahapan')).toBe('Roll over 3 months · interest to BCA Tahapan');
    expect(outcomeLine({ ...idr, settings: { ...idr.settings, atMaturity: 'principal_interest' } }, null)).toBe('Roll over 3 months · interest stays in the deposit');
    expect(outcomeLine({ ...idr, settings: { ...idr.settings, atMaturity: 'close' } }, 'BCA Tahapan')).toBe('Everything to BCA Tahapan · the deposit closes');
  });
});
```

- [ ] **Step 2: The model**

```ts
// apps/web/src/features/networth/deposit-proposal.ts
import { formatMinor, minorToMajorString, parseMajor, type TermMonths } from '@expanses/core';
import type { DepositProposal } from '@expanses/db';
import { maturityLabel, rateBpsFrom, rateInputText, rateLabel } from './deposit-terms';
import { termLabel } from './maturity-settings';

export interface ProposalDraft {
  net: string;
  principal: string;
  rate: string;
  term: TermMonths;
}

export interface ProposalFigures {
  netMinor: number;
  principalMinor: number;
  newRateBps?: number;
  newTermMonths?: TermMonths;
}

export const closing = (p: DepositProposal): boolean => p.event.kind === 'maturity' && p.settings.atMaturity === 'close';
export const rolling = (p: DepositProposal): boolean => p.event.kind === 'maturity' && p.settings.atMaturity !== 'close';

export function draftFrom(p: DepositProposal): ProposalDraft {
  return {
    net: minorToMajorString(p.netMinor, p.currency),
    principal: minorToMajorString(p.principalMinor, p.currency),
    rate: p.settings.keepRate ? rateInputText(p.rateBps) : '',
    term: p.settings.termMonths,
  };
}

/** The figures to post, read by `parseMajor` in the deposit's currency. Throws a sentence the card shows. */
export function readDraft(p: DepositProposal, draft: ProposalDraft): ProposalFigures {
  const netMinor = draft.net.trim() === '' ? 0 : parseMajor(draft.net, p.currency);
  if (netMinor < 0) throw new Error('Interest cannot be below zero');
  const principalMinor = closing(p) ? parseMajor(draft.principal, p.currency) : p.principalMinor;
  if (closing(p) && principalMinor <= 0) throw new Error('Say how much came back');
  if (!rolling(p)) return { netMinor, principalMinor };
  if (!draft.rate.trim()) throw new Error('Type the rate the new term pays');
  return { netMinor, principalMinor, newRateBps: rateBpsFrom(draft.rate), newTermMonths: draft.term };
}

export function proposalHeader(p: DepositProposal, today: string): string {
  const when = p.event.dueOn === today ? 'today' : maturityLabel(p.event.dueOn);
  return p.event.kind === 'maturity' ? `Matured ${when}` : `Interest due ${when}`;
}

export function interestLine(p: DepositProposal): string {
  return `${formatMinor(p.netMinor, p.currency)} ${p.settings.taxExempt ? 'tax-free' : `after ${rateLabel(p.settings.taxBps)} tax`}`;
}

export function outcomeLine(p: DepositProposal, payoutName: string | null): string {
  const to = payoutName ?? 'the account you choose';
  if (p.event.kind === 'monthly') return p.settings.atMaturity === 'principal_interest' ? 'Stays in the deposit' : `To ${to}`;
  if (p.settings.atMaturity === 'close') return `Everything to ${to} · the deposit closes`;
  const term = `Roll over ${termLabel(p.settings.termMonths)}`;
  return p.settings.atMaturity === 'principal_interest' ? `${term} · interest stays in the deposit` : `${term} · interest to ${to}`;
}
```

- [ ] **Step 3: The card**

```tsx
// apps/web/src/features/networth/DepositProposalCard.tsx
import { formatMinor, isoDate, parseRate, TERM_MONTHS, type TermMonths } from '@expanses/core';
import { confirmDepositEvent, type DepositProposal, upsertRate } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { checkManualRate, ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ReadOnlyRow, SelectRow, TextRow } from '../../ui/native';
import { closing, draftFrom, interestLine, newRateText, outcomeLine, proposalHeader, readDraft, rolling } from './deposit-proposal';
import { termLabel } from './maturity-settings';
import { useDueDeposits } from './queries';

/** P1: the one due event of this deposit, on its own page and nowhere else. */
export function DepositProposalCard({ accountId, onClosed }: { accountId: string; onClosed: (archived: boolean) => void }) {
  const due = useDueDeposits();
  const proposal = (due.data ?? []).find((p) => p.accountId === accountId);
  if (!proposal) return null;
  // Keyed on the event, so the next one in the queue starts from its own figures.
  return <ProposalBody key={`${proposal.event.kind}:${proposal.event.dueOn}`} proposal={proposal} onClosed={onClosed} />;
}

function ProposalBody({ proposal: p, onClosed }: { proposal: DepositProposal; onClosed: (archived: boolean) => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(p));
  const [manualRate, setManualRate] = useState('');
  const [askRate, setAskRate] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const today = isoDate();
  const payoutName = (accounts.data ?? []).find((a) => a.id === p.settings.payoutAccountId)?.name ?? null;
  const foreign = p.currency !== ws.baseCurrency;

  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      const figures = readDraft(p, draft);
      let rateToBase: number | undefined;
      if (foreign) {
        if (manualRate.trim()) {
          rateToBase = parseRate(manualRate);
          await checkManualRate(database, p.currency, ws.baseCurrency, p.event.dueOn, rateToBase);
          await upsertRate(database, { fromCurrency: p.currency, toCurrency: ws.baseCurrency, onDate: p.event.dueOn, rate: rateToBase, source: 'manual', sourceDate: p.event.dueOn });
        } else {
          rateToBase = (await resolveRates([p.currency], p.event.dueOn)).rates[p.currency];
          if (rateToBase === undefined) {
            setAskRate(true);
            throw new Error(`No ${p.currency}→${ws.baseCurrency} rate for ${p.event.dueOn}. Enter it below.`);
          }
        }
      }
      const result = await confirmDepositEvent(database, ws, {
        accountId: p.accountId,
        kind: p.event.kind,
        dueOn: p.event.dueOn,
        today,
        principalMinor: figures.principalMinor,
        grossMinor: p.grossMinor,
        taxMinor: p.taxMinor,
        netMinor: figures.netMinor,
        newRateBps: figures.newRateBps,
        newTermMonths: figures.newTermMonths,
        rateToBase,
      });
      await invalidate();
      if (closing(p)) onClosed(result.archived);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const rows = editing
    ? [
        <TextRow key="net" label="Interest after tax" inputMode="decimal" value={draft.net} onChange={(e) => setDraft({ ...draft, net: e.target.value })} />,
        ...(closing(p)
          ? [<TextRow key="principal" label="Principal" inputMode="decimal" value={draft.principal} onChange={(e) => setDraft({ ...draft, principal: e.target.value })} />]
          : [<ReadOnlyRow key="principal" label="Principal" value={formatMinor(p.principalMinor, p.currency)} />]),
        ...(rolling(p)
          ? [
              <TextRow key="rate" label="New rate %" inputMode="decimal" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />,
              <SelectRow key="term" label="New term" value={String(draft.term)} onChange={(e) => setDraft({ ...draft, term: Number(e.target.value) as TermMonths })}>
                {TERM_MONTHS.map((months) => (
                  <option key={months} value={months}>
                    {termLabel(months)}
                  </option>
                ))}
              </SelectRow>,
            ]
          : []),
      ]
    : [
        <ReadOnlyRow key="principal" label="Principal" value={formatMinor(p.principalMinor, p.currency)} />,
        <ReadOnlyRow key="interest" label="Interest" value={interestLine(p)} />,
        <ReadOnlyRow key="outcome" label="Then" value={outcomeLine(p, payoutName)} />,
        ...(rolling(p) ? [<ReadOnlyRow key="rate" label="New rate" value={newRateText(draft.rate)} />] : []),
      ];
  if (foreign && askRate) {
    rows.push(
      <TextRow
        key="fx"
        label={`Rate: ${ws.baseCurrency} per 1 ${p.currency}`}
        hint={ratePreview(manualRate, p.currency, ws.baseCurrency) ?? undefined}
        inputMode="decimal"
        value={manualRate}
        onChange={(e) => setManualRate(e.target.value)}
      />,
    );
  }

  return (
    <div data-testid="deposit-proposal">
      <InsetGroup
        header={proposalHeader(p, today)}
        footer={`Worked out from the stored rate. Correct it to what the bank credited.${p.waiting > 0 ? ` ${p.waiting} more waiting after this one.` : ''}`}
      >
        {rows}
      </InsetGroup>
      <ErrorBox error={error} />
      <InsetGroup>
        {[
          <InsetRow key="edit" title={editing ? 'Done editing' : 'Edit figures'} chevron={false} onClick={() => setEditing((open) => !open)} />,
          <InsetRow key="confirm" title="Confirm" chevron={false} disabled={busy} onClick={() => void confirm()} />,
        ]}
      </InsetGroup>
    </div>
  );
}
```

`newRateText` is the one converter `rateBpsFrom` behind a guard, because a half-typed rate must not throw while rendering. Add it to `deposit-proposal.ts` (importing `rateBpsFrom` and `rateLabel` from `./deposit-terms`) and import it in the card:

```ts
/** The new term's rate as the card prints it: "4,25%", or what was typed while it does not read yet. */
export function newRateText(text: string): string {
  if (!text.trim()) return 'Type it';
  try {
    return rateLabel(rateBpsFrom(text));
  } catch {
    return text;
  }
}
```

with its test in `deposit-proposal.test.ts`: `expect(newRateText('4,25')).toBe('4,25%'); expect(newRateText('')).toBe('Type it'); expect(newRateText('4,')).toBe('4,');`. (Check the last case against `parseRate('4,')`: if it reads as 4, expect `'4%'` instead. The test states what `parseRate` does; it does not guess.)

In `AssetDetailPage.tsx`, render it directly after the hero block (the first `{value && (<>…</>)}`):

```tsx
      {value && account?.subtype === 'time_deposit' && (
        <DepositProposalCard accountId={accountId} onClosed={(archived) => archived && void navigate({ to: '/net-worth/assets' })} />
      )}
```

- [ ] **Step 4: Targeted e2e** — the tests *"proposes on the day and posts what was confirmed"*, *"posts an edited figure as typed, and a new rate that was not kept"* and *"proposes queued payouts one after another"* in Task 10's spec: `npx playwright test deposit-maturity --project=chromium -g "proposes|edited"`.
- [ ] **Step 5: Run** — `npx vitest run src/features/networth`; root gate.
- [ ] **Step 6: Commit** — `feat(networth): a due deposit event is proposed on its page and posted only when confirmed`.

---

### Task 9: The "Due" marker on the assets list

**Files:**
- Modify: `apps/web/src/features/networth/asset-rows.ts`, `asset-rows.test.ts`, `AssetsPage.tsx`

**Interfaces:**
- Consumes: `useDueDeposits` (Task 7).
- Produces: `AssetRow.due: boolean`; `groupAssets(values, profiles, due?: ReadonlySet<string>)`; `rowSubtitle(row: AssetRow): string` (moved from `AssetsPage.subtitleOf`, unchanged except for the new word).

- [ ] **Step 1: Failing test** — append to `asset-rows.test.ts`:

```ts
import { rowSubtitle } from './asset-rows';

describe('a deposit with something due', () => {
  it('says Due quietly in its subtitle, and nothing else changes', () => {
    const due = groupAssets(values, profiles, new Set(['bca'])).flatMap((group) => group.rows);
    const bca = due.find((row) => row.accountId === 'bca')!;
    expect(bca.due).toBe(true);
    expect(rowSubtitle(bca)).toBe('Balance · 0102 · Kas · Due');
    expect(due.find((row) => row.accountId === 'gold')!.due).toBe(false);
    // Without the set, as every other caller passes it: nobody is due.
    expect(groupAssets(values, profiles).flatMap((group) => group.rows).some((row) => row.due)).toBe(false);
  });
});
```

(Read `METHOD_LABELS.derived` and `CORETAX_SECTION_LABELS.kas` in `labels.ts` before running. If they are not "Balance" and "Kas", use the labels the file has. The assertion is about the order and the "Due" at the end.)

- [ ] **Step 2: Implement** — in `asset-rows.ts`: add `/** An automated deposit with a proposal waiting on its page. */ due: boolean;` to `AssetRow`; give `toRow` a third parameter `due: boolean` and set it; change `groupAssets` to:

```ts
export function groupAssets(values: AssetValueRow[], profiles: AssetProfileRow[], due: ReadonlySet<string> = new Set()): AssetGroup[] {
  const profileByAccount = new Map(profiles.map((profile) => [profile.accountId, profile]));
  const rows = values.map((value) => toRow(value, profileByAccount.get(value.accountId), due.has(value.accountId)));
  // …the rest unchanged
```

and move `subtitleOf` here as:

```ts
/** What the row says under its name: how it is valued, its tax code, and whether it needs attention. */
export function rowSubtitle(row: AssetRow): string {
  return [row.method, row.coretax, row.stale && !row.sold ? 'Update price' : null, row.sold ? 'Sold' : null, row.due ? 'Due' : null]
    .filter(Boolean)
    .join(' · ');
}
```

In `AssetsPage.tsx`, delete `subtitleOf`, use `rowSubtitle`, and compute:

```ts
  const due = useDueDeposits();
  const dueIds = new Set((due.data ?? []).map((proposal) => proposal.accountId));
  const groups = values.data && profiles.data ? groupAssets(values.data, profiles.data, dueIds) : [];
```

`valueTone` is not touched: the marker is quiet.

- [ ] **Step 3: Run** — `npx vitest run src/features/networth/asset-rows.test.ts`; the e2e *"marks the row Due"*; root gate.
- [ ] **Step 4: Commit** — `feat(networth): a deposit with something due says so on its row`.

---

## Step 4 — End to end

### Task 10: The combinations walk, the phone, and the full suite

**Files:**
- Create: `apps/web/e2e/deposit-maturity.ts`, `apps/web/e2e/deposit-maturity.spec.ts`, `apps/web/e2e/phone-deposit-maturity.spec.ts`

**Interfaces:**
- Consumes: the screens from Tasks 7–9 and `/accounts/new` (`CashAccountForm`: "Current account" / "Time deposit", `Name`, `Balance now`, `Currency`, `Rate: IDR per 1 USD`, `Matures on`, `Interest rate`, `Balance as of`, the **Add account** row).

Every amount, rate and percentage is typed **per keystroke** (`pressSequentially`), never with `fill()`. The one exception is `type="date"` inputs, which a browser only accepts whole. The clock is moved with `page.clock.setSystemTime`, as `recurring-bills.spec.ts` does, and the rate server is blocked, as `phone-add-transaction.spec.ts` does, so a USD confirm falls back to the rate stored when the account was opened.

- [ ] **Step 1: The helper**

```ts
// apps/web/e2e/deposit-maturity.ts
import { expect, type Page } from '@playwright/test';

export type Choice = 'principal' | 'principal_interest' | 'close';
export interface Combo {
  currency: 'IDR' | 'USD';
  choice: Choice;
  paid: 'monthly' | 'at_maturity';
  exempt: boolean;
  /** Each proposal's net interest, as the card prints it, in the order they are proposed. */
  nets: string[];
  /** The deposit's balance at the end, or null when it closed. */
  deposit: string | null;
  payout: string;
}

export const SETUP = {
  IDR: { opened: '2026-07-15', matures: '2026-10-15', payoutName: 'BCA Tahapan', payoutBalance: '1000000', depositName: 'BCA Deposito', depositBalance: '50000000', rate: '4,25', fx: undefined },
  USD: { opened: '2026-08-01', matures: '2026-11-01', payoutName: 'Jenius USD', payoutBalance: '50', depositName: 'Jenius Deposito', depositBalance: '10000', rate: '3,5', fx: '16350' },
} as const;

/** Noon local, so no time zone can move the day. */
export const at = (date: string) => new Date(`${date}T12:00:00`);

// prettier-ignore
export const COMBOS: Combo[] = [
  { currency: 'IDR', choice: 'principal',          paid: 'at_maturity', exempt: false, nets: ['428.493'],                       deposit: '50.000.000', payout: '1.428.493' },
  { currency: 'IDR', choice: 'principal',          paid: 'at_maturity', exempt: true,  nets: ['535.616'],                       deposit: '50.000.000', payout: '1.535.616' },
  { currency: 'IDR', choice: 'principal',          paid: 'monthly',     exempt: false, nets: ['144.384', '144.384', '139.726'], deposit: '50.000.000', payout: '1.428.494' },
  { currency: 'IDR', choice: 'principal',          paid: 'monthly',     exempt: true,  nets: ['180.479', '180.479', '174.657'], deposit: '50.000.000', payout: '1.535.615' },
  { currency: 'IDR', choice: 'principal_interest', paid: 'at_maturity', exempt: false, nets: ['428.493'],                       deposit: '50.428.493', payout: '1.000.000' },
  { currency: 'IDR', choice: 'principal_interest', paid: 'at_maturity', exempt: true,  nets: ['535.616'],                       deposit: '50.535.616', payout: '1.000.000' },
  { currency: 'IDR', choice: 'principal_interest', paid: 'monthly',     exempt: false, nets: ['144.384', '144.800', '140.534'], deposit: '50.429.718', payout: '1.000.000' },
  { currency: 'IDR', choice: 'principal_interest', paid: 'monthly',     exempt: true,  nets: ['180.479', '181.130', '175.920'], deposit: '50.537.529', payout: '1.000.000' },
  { currency: 'IDR', choice: 'close',              paid: 'at_maturity', exempt: false, nets: ['428.493'],                       deposit: null,         payout: '51.428.493' },
  { currency: 'IDR', choice: 'close',              paid: 'at_maturity', exempt: true,  nets: ['535.616'],                       deposit: null,         payout: '51.535.616' },
  { currency: 'IDR', choice: 'close',              paid: 'monthly',     exempt: false, nets: ['144.384', '144.384', '139.726'], deposit: null,         payout: '51.428.494' },
  { currency: 'IDR', choice: 'close',              paid: 'monthly',     exempt: true,  nets: ['180.479', '180.479', '174.657'], deposit: null,         payout: '51.535.615' },
  { currency: 'USD', choice: 'principal',          paid: 'at_maturity', exempt: false, nets: ['70,57'],                         deposit: '10.000,00',  payout: '120,57' },
  { currency: 'USD', choice: 'principal',          paid: 'at_maturity', exempt: true,  nets: ['88,21'],                         deposit: '10.000,00',  payout: '138,21' },
  { currency: 'USD', choice: 'principal',          paid: 'monthly',     exempt: false, nets: ['23,78', '23,01', '23,78'],       deposit: '10.000,00',  payout: '120,57' },
  { currency: 'USD', choice: 'principal',          paid: 'monthly',     exempt: true,  nets: ['29,72', '28,76', '29,72'],       deposit: '10.000,00',  payout: '138,20' },
  { currency: 'USD', choice: 'principal_interest', paid: 'at_maturity', exempt: false, nets: ['70,57'],                         deposit: '10.070,57',  payout: '50,00' },
  { currency: 'USD', choice: 'principal_interest', paid: 'at_maturity', exempt: true,  nets: ['88,21'],                         deposit: '10.088,21',  payout: '50,00' },
  { currency: 'USD', choice: 'principal_interest', paid: 'monthly',     exempt: false, nets: ['23,78', '23,07', '23,89'],       deposit: '10.070,74',  payout: '50,00' },
  { currency: 'USD', choice: 'principal_interest', paid: 'monthly',     exempt: true,  nets: ['29,72', '28,85', '29,90'],       deposit: '10.088,47',  payout: '50,00' },
  { currency: 'USD', choice: 'close',              paid: 'at_maturity', exempt: false, nets: ['70,57'],                         deposit: null,         payout: '10.120,57' },
  { currency: 'USD', choice: 'close',              paid: 'at_maturity', exempt: true,  nets: ['88,21'],                         deposit: null,         payout: '10.138,21' },
  { currency: 'USD', choice: 'close',              paid: 'monthly',     exempt: false, nets: ['23,78', '23,01', '23,78'],       deposit: null,         payout: '10.120,57' },
  { currency: 'USD', choice: 'close',              paid: 'monthly',     exempt: true,  nets: ['29,72', '28,76', '29,72'],       deposit: null,         payout: '10.138,20' },
];

export const comboName = (c: Combo) => `${c.currency} · ${c.choice} · ${c.paid} · ${c.exempt ? 'tax-free' : 'taxed'}`;

/** Types into a box one key at a time, the way a thumb or a keyboard does. */
export async function typeInto(page: Page, label: string, text: string) {
  const box = page.getByLabel(label, { exact: true });
  await box.click();
  await box.selectText();
  await box.press('Backspace');
  await box.pressSequentially(text, { delay: 20 });
}

export async function addMoneyAccount(
  page: Page,
  o: { kind: 'Current account' | 'Time deposit'; name: string; balance: string; currency: 'IDR' | 'USD'; fx?: string; opened: string; matures?: string; rate?: string },
) {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: o.kind }).click();
  await typeInto(page, 'Name', o.name);
  await typeInto(page, 'Balance now', o.balance);
  if (o.currency !== 'IDR') await page.getByLabel('Currency').selectOption(o.currency);
  if (o.fx) await typeInto(page, `Rate: IDR per 1 ${o.currency}`, o.fx);
  if (o.matures) await page.getByLabel('Matures on').fill(o.matures); // a date input only takes a whole date
  if (o.rate) await typeInto(page, 'Interest rate', o.rate);
  await page.getByLabel('Balance as of').fill(o.opened);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: o.name, exact: true })).toBeVisible();
}

export async function setUp(page: Page, currency: 'IDR' | 'USD') {
  const s = SETUP[currency];
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.clock.setSystemTime(at(s.opened));
  await addMoneyAccount(page, { kind: 'Current account', name: s.payoutName, balance: s.payoutBalance, currency, fx: s.fx, opened: s.opened });
  await addMoneyAccount(page, { kind: 'Time deposit', name: s.depositName, balance: s.depositBalance, currency, fx: s.fx, opened: s.opened, matures: s.matures, rate: s.rate });
  return s;
}

export async function openDeposit(page: Page, name: string) {
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).click();
}

export async function automate(page: Page, c: Pick<Combo, 'choice' | 'paid' | 'exempt'>, termMonths = '3') {
  await page.getByLabel('Automate').check();
  await expect(page.getByTestId('maturity-principal')).toBeVisible();
  await page.getByTestId(`maturity-${c.choice}`).click();
  await expect(page.getByTestId(`maturity-${c.choice}`).getByLabel('Chosen')).toBeVisible();
  await page.getByLabel('Interest paid').selectOption(c.paid);
  await page.getByLabel('Term', { exact: true }).selectOption(termMonths);
  if (c.exempt) await page.getByLabel('Tax-free deposit').check();
}

/** Confirms every proposal in the order given, checking each one's net before it is confirmed. */
export async function confirmEach(page: Page, nets: string[]) {
  const card = page.getByTestId('deposit-proposal');
  for (const [i, net] of nets.entries()) {
    await expect(card).toContainText(net);
    if (i < nets.length - 1) await expect(card).toContainText(`${nets.length - 1 - i} more waiting`);
    await card.getByRole('button', { name: 'Confirm' }).click();
    if (i < nets.length - 1) await expect(card).toContainText(nets[i + 1]!);
  }
}

export async function expectBalance(page: Page, name: string, figure: string) {
  await page.goto('/accounts');
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
  await expect(row).toContainText(figure);
}

export async function walk(page: Page, c: Combo) {
  const s = await setUp(page, c.currency);
  await openDeposit(page, s.depositName);
  await automate(page, c);
  // The app goes unopened until the maturity: everything due in the term waits for it.
  await page.clock.setSystemTime(at(s.matures));
  await page.goto('/net-worth/assets');
  await expect(page.getByRole('link', { name: new RegExp(`^${s.depositName}`) })).toContainText('Due');
  await page.getByRole('link', { name: new RegExp(`^${s.depositName}`) }).click();
  await confirmEach(page, c.nets);
  if (c.deposit === null) {
    await expect(page).toHaveURL(/\/net-worth\/assets$/);
    await expect(page.getByRole('link', { name: new RegExp(`^${s.depositName}`) })).toHaveCount(0);
  } else {
    await expect(page.getByTestId('deposit-proposal')).toHaveCount(0);
    await expectBalance(page, s.depositName, c.deposit);
  }
  await expectBalance(page, s.payoutName, c.payout);
}
```

- [ ] **Step 2: The chromium spec**

```ts
// apps/web/e2e/deposit-maturity.spec.ts
import { expect, test } from '@playwright/test';
import { at, automate, COMBOS, comboName, confirmEach, expectBalance, openDeposit, setUp, typeInto, walk } from './deposit-maturity';

test('is off by default and changes nothing', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await expect(page.getByLabel('Automate')).not.toBeChecked();
  await expect(page.getByTestId('maturity-principal')).toHaveCount(0);
  await page.clock.setSystemTime(at(s.matures));
  await page.goto('/net-worth/assets');
  await expect(page.getByRole('link', { name: /^BCA Deposito/ })).not.toContainText('Due');
  await openDeposit(page, s.depositName);
  await expect(page.getByTestId('deposit-proposal')).toHaveCount(0);
  await expectBalance(page, s.payoutName, '1.000.000');
});

test('keeps its settings across a reload, and a typed withholding', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'close', paid: 'monthly', exempt: false });
  await typeInto(page, 'Tax withheld %', '12,5');
  await page.getByLabel('Tax withheld %').press('Tab');
  await page.reload();
  await expect(page.getByLabel('Automate')).toBeChecked();
  await expect(page.getByTestId('maturity-close').getByLabel('Chosen')).toBeVisible();
  await expect(page.getByLabel('Interest paid')).toHaveValue('monthly');
  await expect(page.getByLabel('Term', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Lands in')).toHaveValue(/.+/);
  await expect(page.getByLabel('Tax withheld %')).toHaveValue('12,5');
});

test('proposes on the day and posts what was confirmed, with a new term', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'principal', paid: 'at_maturity', exempt: false });
  await page.clock.setSystemTime(at('2026-10-14'));
  await page.reload();
  await expect(page.getByTestId('deposit-proposal')).toHaveCount(0);
  await page.clock.setSystemTime(at(s.matures));
  await page.reload();
  const card = page.getByTestId('deposit-proposal');
  await expect(card).toContainText('Matured today');
  await expect(card).toContainText('50.000.000');
  await expect(card).toContainText('428.493');
  await expect(card).toContainText('after 20% tax');
  await expect(card).toContainText('Roll over 3 months · interest to BCA Tahapan');
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Matures 15 Jan 2027 · 4,25%')).toBeVisible();
  await expectBalance(page, s.payoutName, '1.428.493');
});

test('posts an edited figure as typed, and a new rate that was not kept', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'principal', paid: 'at_maturity', exempt: false });
  await page.getByLabel('Keep the rate when it rolls over').uncheck();
  await page.clock.setSystemTime(at(s.matures));
  await page.reload();
  const card = page.getByTestId('deposit-proposal');
  await card.getByRole('button', { name: 'Edit figures' }).click();
  await typeInto(page, 'Interest after tax', '428.500');
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card).toContainText('Type the rate the new term pays');
  await typeInto(page, 'New rate %', '4');
  await page.getByLabel('New term').selectOption('6');
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Matures 15 Apr 2027 · 4%')).toBeVisible();
  await expectBalance(page, s.payoutName, '1.428.500');
});

test('proposes queued payouts one after another, never on their own', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'principal', paid: 'monthly', exempt: false });
  await page.clock.setSystemTime(at(s.matures));
  await page.reload();
  await expect(page.getByTestId('deposit-proposal')).toContainText('Interest due 15 Aug 2026');
  await expectBalance(page, s.payoutName, '1.000.000'); // nothing moved by itself
  await openDeposit(page, s.depositName);
  await confirmEach(page, ['144.384', '144.384', '139.726']);
});

for (const combo of COMBOS) {
  test(`walks ${comboName(combo)}`, async ({ page }) => {
    await walk(page, combo);
  });
}
```

- [ ] **Step 3: The phone spec**

```ts
// apps/web/e2e/phone-deposit-maturity.spec.ts
import { test } from '@playwright/test';
import { COMBOS, comboName, walk } from './deposit-maturity';

// Four of the 24 by thumb: one of each choice, both currencies, both payouts, both tax states.
const PICK = [
  'IDR · principal · at_maturity · taxed',
  'IDR · principal_interest · monthly · tax-free',
  'USD · close · monthly · taxed',
  'USD · principal_interest · at_maturity · tax-free',
];

for (const combo of COMBOS.filter((c) => PICK.includes(comboName(c)))) {
  test(`walks ${comboName(combo)} on a phone`, async ({ page }) => {
    await walk(page, combo);
  });
}
```

- [ ] **Step 4: Run** — `cd apps/web && npx playwright test deposit-maturity --workers=2` (both projects) → 29 chromium + 4 phone pass. If a figure disagrees, compare it with Task 6's repository test for the same combination. The repository test decides whether the bug is in the arithmetic or the screen, and the table is not changed to match.
- [ ] **Step 5: The full gate** — `npm run typecheck`, `npm test`, `npm run build` from the root, then `cd apps/web && npx playwright test --workers=2`. `coretax-pickers.spec.ts` still sees "When it matures, move the money to an account with a transfer." (unchanged copy).
- [ ] **Step 6: Spec walk** — read the spec section by section against the shipped screens and the mapping below. Anything without a home is fixed before committing.
- [ ] **Step 7: Commit** — `test(e2e): every deposit combination walked by keyboard and by thumb`.

---

## Spec coverage

| Spec section | Task(s) |
|---|---|
| §1 What we are building | 1–10 |
| §2 Existing code, and the gap (interest paid, term not stored) | 2 (columns in the side table), 7 (the rows) |
| §3 S2 rows, defaults, hidden rows, save-on-change, off/on behaviour | 3 (enabledOn), 7 (component, model), 10 (settings e2e) |
| §4.1 Term start, `termStartedOn` agreement | 1 (`termStart`), 5 (written on roll-over) |
| §4.2 Events of a term, anchored dates | 1 |
| §4.3 Which are due; only the earliest proposed; `enabledOn` rule | 1, 4 (`waiting`), 10 (queue e2e) |
| §5 Day count, floor, tax, net = gross − tax, principal = due-day balance | 1, 4 |
| §5.1 Worked example (428 493) | 1, 4, 10 |
| §5.2 Discriminating fixtures | 1 (each row), 6, 10 |
| §5.3 Country-neutral tax (percent + tax-free switch, no gate) | 3 (validation), 7 (rows, copy) |
| §6.1–6.2 Proposal placement and wording | 8 |
| §6.3 Editing, per-keystroke, `parseMajor`/`parseRate`, manual rate row | 8, 10 |
| §6.4 Confirm: existing write paths, one transaction, log, archive via `archiveAccountTx` | 3 (extraction), 5, 8 (rate resolution, navigate) |
| §7 Due marker on the assets row | 9, 10 |
| §8 Migration 0054, guards, no columns | 2, 3 (`automationTablesExist`) |
| §9 Refusals | 3 (payout, workspace, archived), 5 (`NOT_NEXT`, `OFF`, `NO_PAYOUT`, `BAD_FIGURE`, archive refusal) |
| §10 Phone, desktop, dark | 7, 8 (kit only, tokens), 10 (phone project) |
| §11 Testing | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| §12 Out of scope | — (nothing built) |
| §13 Decisions taken here | 1 (13.3, 13.4), 3 (13.1, 13.8), 4 (13.5), 5 (13.2, 13.6, 13.7, 13.10), 7 (13.9) |
| §14 Open questions | none built; answers may add tasks |
