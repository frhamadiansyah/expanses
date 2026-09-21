# Currency pockets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one bank account hold several currencies: a parent row in Accounts (P1) that adds its pockets up at the day's rates, one ordinary money account per currency underneath, a way to open such an account with an optional rate per opening balance, a way to add a pocket, and a Move between pockets screen that records the exchange as a two-legged transfer so the bank's spread is visible and kept. A single-currency account does not change at all.

**Architecture:** No migration. A pocket is an ordinary `accounts` row (`kind: 'asset'`, its own currency) whose `parent_id` names the parent; the parent is an `accounts` row that never holds an entry. That rule is enforced once, in `postTransactionTx`, the only place entries are written. A parent is recognised by one function (`pocketParentIds`) from the account list; `assetValuesAt` drops parents, which covers net worth, the tax report, idle cash, goal funding and health ratios; pickers use a new `moneyHolders` in place of `accounts.filter(isMoneyAccount)`. Pure arithmetic (`sumToBase`, `exchangeCost`, `impliedRate`) lives in `packages/core/src/money/exchange.ts`. The two display parts securities will reuse — the R1 figure (`approxLine`, `ApproxFigure`: a native figure with its `≈` converted value beneath) and the grouped row (`groupedFigure`, `GroupedRow`: a parent that sums its children and holds nothing itself) — live in the kit, `apps/web/src/ui/native/approx.ts` and `Grouped.tsx`. The Accounts page gains a Money summary tile, and the net-worth Assets list shows an account with pockets as one grouped row, with its group totals converted rather than added raw (user decisions 7 and 8, 2026-09-21). The Move screen holds an ordinary transfer `FormDraft` and saves through the Transfer tab's own `formToPost` → `ratesForSave` → `postTransaction`; its second figure's currency comes from a new `receivedField` beside `amountFields`, which the Transfer tab's Received row and `transferPostingLines` are changed to read as well.

**Tech Stack:** TypeScript monorepo — `packages/core` (pure), `packages/db` (Drizzle over sqlite-proxy, `better-sqlite3` in tests), `apps/web` (React 19, TanStack Router/Query, Tailwind 4, native kit in `apps/web/src/ui/native/`); Vitest; Playwright (`chromium`, `phone`).

**Spec:** `docs/superpowers/specs/2026-09-21-currency-pockets-design.md`
**Decisions:** `decisions-pockets.md` (user, 2026-09-19), mockup `pockets.html`. Chosen: **P1**; opening balance takes an **optional rate**, resolved for the opening date when blank.

## Global Constraints

- **Migration 0052 is reserved for this feature and is NOT used.** Nothing here writes SQL DDL. `accounts.parent_id` exists since 0001. If a task seems to need a table, stop and ask — do not take 0052 silently.
- **No new columns on existing tables** (`transactions`, `accounts`, `entries`, `cards`, `expense_templates`, …). Drizzle names every column it knows on every insert. This plan adds none and changes no CHECK.
- **Money is integer minor units, never float.** IDR 0, USD/SGD 2, JPY 0, KWD 3. Conversion is `convertMinor` (round half away from zero). **Sum signed values, then clamp or reword** — never `Math.abs` each term before a sum. A figure with a sign is shown by choosing the words ("cost you" / "gained you") and negating once in the negative branch.
- **A total across currencies needs every rate.** Missing a rate → no total, and the missing code is named. Never add raw minor units across currencies (the `/net-worth/loans` defect), and never silently drop the unconvertible part (what `toBase` in `asset-values.ts:138-143` does by returning 0 — do not call or copy it for pockets).
- **The one reader of a typed figure is `evaluateAmount`** (settled on blur by `settledAmount`); **which currency a transfer figure is read in is decided by `amountFields(...).amount` and `receivedField(...)`**, nowhere else. Opening balances are read by `parseMajor(text, thatPocketsCurrency)`, the reader `CashAccountForm` already uses. No new parser, no separator logic.
- **Nothing posts to a parent.** The refusal lives in `postTransactionTx`; no screen re-implements it. Screens only avoid *offering* a parent, via `moneyHolders`.
- **Every screen is built from the native kit** (`InsetGroup`, `InsetRow`, `Hero`, `LargeTitle`, `SelectRow`, `TextRow`, `ReadOnlyRow`, `SwitchRow`, `RecordTable`, `Figure`, `SCREEN`). Colours only through `var(--ph-*)` tokens — dark mode must work. No literal colours, no `slate-`, no `bg-white` in any file this plan creates. Corner actions are glyphs. No new visual treatment.
- **Desktop is never weakened.** The Accounts page keeps all five `RecordTable` columns on desktop, Rename and Archive included, for parents too.
- **Country-neutral.** No bank names in copy (the mockup's BCA/OCBC/Livin Mandiri lines are not shipped). Only the tax report is Indonesia-specific.
- **Build order (binding ruling, 2026-09-21): currency pockets builds BEFORE securities.** Securities is not built and nothing here waits for it or looks for its helpers. This plan writes the shared parts, and securities reuses them later: `sumToBase` in core (no multi-currency sum that refuses a missing rate exists today; core's `netWorth` returns a partial total beside `missingRates` and is not a substitute), and in the kit `approxLine` / `rateLine` / `groupedFigure` (`ui/native/approx.ts`) with `ApproxFigure` / `GroupedRow` (`ui/native/Grouped.tsx`), exported from `ui/native/index.ts`. Keep them free of pocket words so securities can call them unchanged.
- **Branches from main, not from set-aside.** `feat/set-aside` (not merged) also edits: `packages/db/src/repos/ledger.ts` (`postTransactionTx` — set-aside adds `setAside` after `writeExtrasTx`; this plan adds the parent refusal after the `found` select), `packages/db/src/index.ts`, `packages/core/src/index.ts`, `TransactionCard.tsx`, `EditSheet.tsx`, `TransactionsPage.tsx`, `ReviewPage.tsx`, `EventDetailPage.tsx`, `CardHero.tsx`, `StatementPanel.tsx`, `LoanDetailPage.tsx`, `DebtForm.tsx`, `PersonCard.tsx`, `PaySheet.tsx`, `AssetDetailPage.tsx`, and reads `assetValuesAt` in `idle-cash.ts` / `goal-funding.ts` (this plan changes what `assetValuesAt` returns, not those files). Whichever merges second resolves those hunks; every picker edit here is the one-line `moneyHolders(...)` swap, so re-apply it on top of set-aside's version rather than taking either side whole.
- Inside `database.transaction((tx) => …)` use `tx` only — `database.db` there deadlocks.
- Snippets name real functions with signatures read on 2026-09-21. If the compiler disagrees, re-read the type and match it; do not change the called function.
- Branch `feat/currency-pockets`. Commit per task; every message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Gate before every commit:** from root `npm run typecheck`, `npm test`, `npm run build`; then the task's targeted Playwright specs. Task 10 runs the full suite.
- **Playwright runs on its own port, from an untracked config.** Before the first e2e run, create `apps/web/playwright.cu.config.ts` (already listed in `.git/info/exclude`; never commit it):

  ```ts
  import { defineConfig } from '@playwright/test';
  import base from './playwright.config';

  export default defineConfig({
    ...base,
    use: { ...base.use, baseURL: 'http://localhost:4179' },
    webServer: { command: 'npm run build && npx vite preview --port 4179 --strictPort', url: 'http://localhost:4179', reuseExistingServer: false, timeout: 180_000 },
  });
  ```

  Every command is `cd apps/web && npx playwright test -c playwright.cu.config.ts '<regex>' --workers=2`, where the regex is anchored on the spec's file name — `'e2e/currency-pockets\.spec\.ts$'`, never a bare word: `currency-pockets` alone matches the worktree's own path (`.worktrees/currency-pockets/…`) and so runs every spec.
- **E2E types figures keystroke by keystroke** (`pressSequentially`), never `fill()`, for every money field this feature adds.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/money/exchange.ts` | `sumToBase`, `exchangeCost`, `impliedRate` (Task 1) |
| `packages/core/src/index.ts` | export them |
| `packages/core/test/exchange.test.ts` | Task 1 |
| `packages/db/src/repos/accounts.ts` | `pocketName`, `pocketParentIds`; pocket rules in `createAccountTx`; `sortOrder?` on `CreateAccountInput` (existing column); `renameAccount` carries to pockets; `archiveAccount` refuses a parent with open pockets (Tasks 2, 3) |
| `packages/db/src/repos/cash-accounts.ts` | `openCashAccountTx` extracted; `parentId`, `sortOrder` on `OpenCashAccountInput` (Task 2) |
| `packages/db/src/repos/assets.ts` | `getAssetProfileTx` — `getAssetProfile` inside a caller's transaction, so `addPocket` reads the bank without a second JSON reader (Task 2) |
| `packages/db/src/repos/pockets.ts` | `openPocketedAccount`, `addPocket`, `openingsOf` (Task 2) |
| `packages/db/src/repos/ledger.ts` | `POCKET_PARENT` refusal in `postTransactionTx` (Task 3) |
| `packages/db/src/repos/asset-values.ts` | `assetValuesAt` leaves parents out (Task 3) |
| `packages/db/src/index.ts` | `export * from './repos/pockets'` |
| `packages/db/test/pockets.test.ts` | Tasks 2, 3 |
| `apps/web/src/lib/queries.ts` | `moneyHolders` (Task 4) |
| `apps/web/src/lib/rates.ts` | `openingRateFor` — the two copied opening-rate blocks become one (Task 4) |
| `apps/web/src/lib/queries.test.ts`, `apps/web/src/lib/rates.test.ts` | Task 4 |
| `apps/web/src/features/transactions/tx-form.ts` (+ `.test.ts`) | `receivedField`; `transferPostingLines` and the goal branch read it (Task 4) |
| `apps/web/src/features/transactions/TransactionCard.tsx` | Received row from `receivedField`; pickers from `moneyHolders` (Task 4) |
| `EditSheet.tsx`, `QuickRowEditor.tsx`, `TransactionsPage.tsx`, `ReviewPage.tsx`, `EventDetailPage.tsx`, `ImportPage.tsx`, `GoalForm.tsx`, `CardHero.tsx`, `StatementPanel.tsx`, `LoanDetailPage.tsx`, `DebtForm.tsx`, `PersonCard.tsx`, `BusinessSection.tsx`, `BillFormPage.tsx`, `PaySheet.tsx`, `TradesPage.tsx`, `CardsPage.tsx` | pickers from `moneyHolders` (Task 4) |
| `apps/web/src/features/networth/add-asset.ts` (+ `.test.ts`), `AddAssetForm.tsx` | Add asset's rate goes through `openingRateFor`: `16.500` no longer read as 16500, a blank foreign rate resolved (Task 4) |
| `apps/web/src/ui/native/approx.ts` (+ `.test.ts`), `apps/web/src/ui/native/Grouped.tsx`, `ui/native/index.ts` | the shared parts: `approxLine`, `rateLine`, `groupedFigure`; `ApproxFigure`, `GroupedRow` (Task 4) |
| `apps/web/src/features/ownables/CashAccountForm.tsx`, `apps/web/src/features/accounts/AccountsPage.tsx` | `openingRateFor` (Task 4); the switch and pockets group (Task 5); the parent row (Task 5); the Money tile (Task 8) |
| `apps/web/src/features/accounts/pockets.ts` (+ `.test.ts`) | `pocketsOf`, `parentTotal`, `readPockets`, `nextPocketCurrency`, `moveDraft`, `withPockets`, `moveView`, `bankRateText`, `spreadLine`, `moveDescription` (Task 4); `moneySummary` (Task 8) |
| `apps/web/src/features/networth/asset-rows.ts` (+ `.test.ts`), `AssetsPage.tsx` | pockets grouped under their account; group and page totals converted, refusing a missing rate (Task 9) |
| `apps/web/src/features/accounts/queries.ts` | `useHeldRates`, `useOpenings` (Task 5) |
| `apps/web/src/features/accounts/PocketsPage.tsx` | `/accounts/$accountId` (Task 5) |
| `apps/web/src/features/networth/AssetDetailPage.tsx` | ≈ line, Opened at, back to parent (Task 5) |
| `apps/web/src/features/accounts/AddPocketPage.tsx` | `/accounts/$accountId/pocket` (Task 6) |
| `apps/web/src/features/accounts/MovePage.tsx` | `/accounts/$accountId/move` (Task 7) |
| `apps/web/src/app/router.tsx` | three routes (Tasks 5, 6, 7) |
| `apps/web/e2e/pockets.ts` | `openWithPockets`, `mockRates` helpers (Task 5) |
| `apps/web/e2e/currency-pockets.spec.ts` | chromium (Tasks 5–10) |
| `apps/web/e2e/phone-currency-pockets.spec.ts` | phone (Task 10) |
| `apps/web/playwright.cu.config.ts` | **untracked**, port 4179 (Global Constraints) |

---

### Task 1: The arithmetic — adding pockets up, the bank's rate, the spread

**Files:**
- Create: `packages/core/src/money/exchange.ts`, `packages/core/test/exchange.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `convertMinor(amountMinor, from, to, rate)` and `currencyInfo(code)` (`packages/core/src/money/money.ts`, `currencies.ts`).
- Produces: `sumToBase({ amounts, baseCurrency, ratesToBase }): { totalMinor: number | null; missing: string[] }`; `exchangeCost({ fromMinor, fromCurrency, toMinor, toCurrency, baseCurrency, ratesToBase }): ExchangeCost | null` with `ExchangeCost = { fromBaseMinor; toBaseMinor; costMinor }`; `impliedRate({ fromMinor, fromCurrency, toMinor, toCurrency }): number | null`.

`sumToBase` is written here, for pockets and for securities after it (build-order ruling). Checked 2026-09-21: core has no sum that refuses a missing rate — `netWorth` (`ledger/balances.ts`) adds what it can and lists `missingRates`, and `toBase` (`asset-values.ts:138`) answers 0. Neither is called or copied.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/exchange.test.ts
import { describe, expect, it } from 'vitest';
import { exchangeCost, impliedRate, sumToBase } from '../src/index';

describe('adding pockets up', () => {
  it('converts each pocket at its own rate and adds them — the mockup’s three pockets', () => {
    // $2,400.00 at 16.250 = 39.000.000; S$1,150.00 at 12.680 = 14.582.000; Rp 5.400.000 as it is.
    expect(
      sumToBase({
        amounts: [
          { minor: 240_000, currency: 'USD' },
          { minor: 115_000, currency: 'SGD' },
          { minor: 5_400_000, currency: 'IDR' },
        ],
        baseCurrency: 'IDR',
        ratesToBase: { USD: 16_250, SGD: 12_680 },
      }),
    ).toEqual({ totalMinor: 58_982_000, missing: [] });
  });

  it('gives no total when one rate is missing, and names it', () => {
    const got = sumToBase({
      amounts: [
        { minor: 240_000, currency: 'USD' },
        { minor: 115_000, currency: 'SGD' },
        { minor: 5_400_000, currency: 'IDR' },
      ],
      baseCurrency: 'IDR',
      ratesToBase: { USD: 16_250 },
    });
    // Not 44.400.000 (the SGD pocket dropped) and not 44.515.000 (its minor units added as rupiah).
    expect(got).toEqual({ totalMinor: null, missing: ['SGD'] });
  });

  it('subtracts an overdrawn pocket rather than adding it', () => {
    // −$10.00 at 16.000 is −160.000; with Rp 1.000.000 that is 840.000. Absolute values would say 1.160.000.
    expect(
      sumToBase({ amounts: [{ minor: -1_000, currency: 'USD' }, { minor: 1_000_000, currency: 'IDR' }], baseCurrency: 'IDR', ratesToBase: { USD: 16_000 } }),
    ).toEqual({ totalMinor: 840_000, missing: [] });
  });

  it('rounds each conversion half away from zero, not down', () => {
    // $1.03 at 15.940,37 = 16.418,5811 → 16.419. Flooring gives 16.418.
    expect(sumToBase({ amounts: [{ minor: 103, currency: 'USD' }], baseCurrency: 'IDR', ratesToBase: { USD: 15_940.37 } }).totalMinor).toBe(16_419);
  });

  it('needs no rate for the base currency itself', () => {
    expect(sumToBase({ amounts: [{ minor: 5_400_000, currency: 'IDR' }], baseCurrency: 'IDR', ratesToBase: {} })).toEqual({ totalMinor: 5_400_000, missing: [] });
  });
});

describe('what the bank’s rate cost', () => {
  it('is what left minus what arrived, both at the day’s rate — the mockup’s $500 → S$638', () => {
    expect(
      exchangeCost({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: { USD: 16_250, SGD: 12_680 } }),
    ).toEqual({ fromBaseMinor: 8_125_000, toBaseMinor: 8_089_840, costMinor: 35_160 });
  });

  it('is negative when the bank gave more than the day’s rate', () => {
    expect(
      exchangeCost({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 65_000, toCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: { USD: 16_250, SGD: 12_680 } })!.costMinor,
    ).toBe(-117_000);
  });

  it('reads each side at its own exponent — USD (2) into IDR (0)', () => {
    // $100.50 at 16.250 = 1.633.125; Rp 1.630.000 arrived; 3.125 lost. Reading 10050 as rupiah would say 1.619.950 gained.
    expect(exchangeCost({ fromMinor: 10_050, fromCurrency: 'USD', toMinor: 1_630_000, toCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: { USD: 16_250 } })).toEqual({
      fromBaseMinor: 1_633_125,
      toBaseMinor: 1_630_000,
      costMinor: 3_125,
    });
  });

  it('reads three decimals for KWD', () => {
    // KWD 1.234 at 53.000,7 = 65.402,8638 → 65.403.
    expect(exchangeCost({ fromMinor: 1_234, fromCurrency: 'KWD', toMinor: 65_000, toCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: { KWD: 53_000.7 } })!.costMinor).toBe(403);
  });

  it('is unknown without both rates', () => {
    expect(exchangeCost({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: { USD: 16_250 } })).toBeNull();
  });
});

describe('the bank’s rate', () => {
  it('is what arrived per unit that left, in major units', () => {
    expect(impliedRate({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD' })).toBeCloseTo(1.276, 10);
    expect(impliedRate({ fromMinor: 10_050, fromCurrency: 'USD', toMinor: 1_630_000, toCurrency: 'IDR' })).toBeCloseTo(16_218.905472, 5);
    // Reading KWD at two decimals would give 5.267,42 — ten times too small.
    expect(impliedRate({ fromMinor: 1_234, fromCurrency: 'KWD', toMinor: 65_000, toCurrency: 'IDR' })).toBeCloseTo(52_674.230146, 5);
  });

  it('is unknown until both figures are more than zero', () => {
    expect(impliedRate({ fromMinor: 0, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD' })).toBeNull();
    expect(impliedRate({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 0, toCurrency: 'SGD' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see them fail** — `cd packages/core && npx vitest run test/exchange.test.ts` → fails: exports missing.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/money/exchange.ts
import { currencyInfo } from './currencies';
import { convertMinor } from './money';

type Rates = Readonly<Record<string, number>>;

const rateOf = (code: string, baseCurrency: string, ratesToBase: Rates): number | null => {
  if (code === baseCurrency) return 1;
  const rate = ratesToBase[code];
  return rate !== undefined && rate > 0 ? rate : null;
};

/**
 * Amounts in several currencies as one figure in the base currency — or none at all.
 *
 * A missing rate gives `totalMinor: null` and names the currency. It never adds the rest without it, and never adds
 * a foreign amount's minor units as if they were base: both are the mixed-currency defect `/net-worth/loans` has.
 * Signed amounts are added as they are, so an overdrawn pocket lowers the total.
 */
export function sumToBase({
  amounts,
  baseCurrency,
  ratesToBase,
}: {
  amounts: readonly { minor: number; currency: string }[];
  baseCurrency: string;
  ratesToBase: Rates;
}): { totalMinor: number | null; missing: string[] } {
  const missing = [...new Set(amounts.filter((a) => rateOf(a.currency, baseCurrency, ratesToBase) === null).map((a) => a.currency))].sort();
  if (missing.length > 0) return { totalMinor: null, missing };
  const totalMinor = amounts.reduce((sum, a) => sum + convertMinor(a.minor, a.currency, baseCurrency, rateOf(a.currency, baseCurrency, ratesToBase)!), 0);
  return { totalMinor, missing: [] };
}

export interface ExchangeCost {
  fromBaseMinor: number;
  toBaseMinor: number;
  /** Positive: the bank's rate cost this much. Negative: it gave this much more than the day's rate. */
  costMinor: number;
}

/**
 * What an exchange at the bank's rate cost, against the day's rates. The ledger records the same figure: each leg
 * of `exchangeLines` is converted by `convertMinor` at these rates, so the Currency exchange account's base total
 * for the posting is exactly `costMinor`.
 */
export function exchangeCost({
  fromMinor,
  fromCurrency,
  toMinor,
  toCurrency,
  baseCurrency,
  ratesToBase,
}: {
  fromMinor: number;
  fromCurrency: string;
  toMinor: number;
  toCurrency: string;
  baseCurrency: string;
  ratesToBase: Rates;
}): ExchangeCost | null {
  const a = rateOf(fromCurrency, baseCurrency, ratesToBase);
  const b = rateOf(toCurrency, baseCurrency, ratesToBase);
  if (a === null || b === null) return null;
  const fromBaseMinor = convertMinor(fromMinor, fromCurrency, baseCurrency, a);
  const toBaseMinor = convertMinor(toMinor, toCurrency, baseCurrency, b);
  return { fromBaseMinor, toBaseMinor, costMinor: fromBaseMinor - toBaseMinor };
}

/** Units that arrived per unit that left, in major units. For display only: nothing stores it or posts with it. */
export function impliedRate({ fromMinor, fromCurrency, toMinor, toCurrency }: { fromMinor: number; fromCurrency: string; toMinor: number; toCurrency: string }): number | null {
  if (!(fromMinor > 0) || !(toMinor > 0)) return null;
  const major = (minor: number, code: string) => minor / 10 ** currencyInfo(code).exponent;
  return major(toMinor, toCurrency) / major(fromMinor, fromCurrency);
}
```

Add to `packages/core/src/index.ts` beside the `evaluateAmount` export:

```ts
export { exchangeCost, type ExchangeCost, impliedRate, sumToBase } from './money/exchange';
```

- [ ] **Step 4: Run** — `cd packages/core && npx vitest run test/exchange.test.ts` → pass. Then the gate: `npm run typecheck && npm test && npm run build` (root).
- [ ] **Step 5: Commit** — `feat(core): add pockets up and price the bank's spread, refusing a total without every rate`

---

### Task 2: Opening an account with pockets

**Files:**
- Create: `packages/db/src/repos/pockets.ts`, `packages/db/test/pockets.test.ts`
- Modify: `packages/db/src/repos/accounts.ts`, `packages/db/src/repos/cash-accounts.ts`, `packages/db/src/repos/assets.ts`, `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `createAccountTx`, `systemAccountId`, `AccountError` (`accounts.ts`); `saveAssetProfileTx`, `toProfile` (`assets.ts`); `saveDepositTermsTx`; `cashItem` (core).
- Produces: `CreateAccountInput.sortOrder?: number`; `getAssetProfileTx(tx, ws, accountId)`; `pocketName(parentName: string, currency: string): string`; `pocketParentIds(rows: readonly Pick<AccountRow, 'id' | 'parentId' | 'kind'>[]): Set<string>`; `openCashAccountTx(tx, ws, input)`; `OpenCashAccountInput.parentId?: string`; `openPocketedAccount(database, ws, OpenPocketedAccountInput): Promise<{ parent: AccountRow; pockets: AccountRow[] }>`; `addPocket(database, ws, AddPocketInput): Promise<AccountRow>`; `openingsOf(database, ws, accountIds): Promise<Record<string, Opening>>` with `Opening = { occurredOn; amountMinor; currency; fxRateToBase }`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/pockets.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPocket,
  type Database,
  getAssetProfile,
  listAccounts,
  nativeBalances,
  openCashAccount,
  openingsOf,
  openPocketedAccount,
  pocketName,
  pocketParentIds,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

/** The mockup's account. SGD opens at a rate with a fraction, so a rate stored as a whole number is caught. */
const valas = () =>
  openPocketedAccount(database, ws, {
    item: 'savings',
    name: 'BCA Pocket Valas',
    bank: 'BCA',
    openedOn: '2025-02-04',
    pockets: [
      { currency: 'USD', openingBalanceMinor: 240_000, openingRateToBase: 15_940 },
      { currency: 'SGD', openingBalanceMinor: 115_000, openingRateToBase: 12_110.5 },
      { currency: 'IDR', openingBalanceMinor: 5_400_000 },
    ],
  });

describe('opening an account with pockets', () => {
  it('writes a parent that holds nothing and one ordinary money account per currency', async () => {
    const { parent, pockets } = await valas();
    expect(parent).toMatchObject({ kind: 'asset', subtype: 'savings', currency: 'IDR', parentId: null, name: 'BCA Pocket Valas' });
    expect(await getAssetProfile(database, ws, parent.id)).toBeUndefined();
    expect(pockets.map((p) => [p.name, p.currency, p.subtype, p.parentId])).toEqual([
      ['BCA Pocket Valas · USD', 'USD', 'savings', parent.id],
      ['BCA Pocket Valas · SGD', 'SGD', 'savings', parent.id],
      ['BCA Pocket Valas · IDR', 'IDR', 'savings', parent.id],
    ]);
    const balances = await nativeBalances(database, ws);
    expect(balances[parent.id]).toBeUndefined();
    expect(pockets.map((p) => balances[p.id])).toEqual([240_000, 115_000, 5_400_000]);
    // Each pocket is filed as the kind of account it is, with the bank on its own kas row.
    const profile = await getAssetProfile(database, ws, pockets[0]!.id);
    expect(profile).toMatchObject({ coretaxSection: 'kas', coretaxCode: '0102' });
    expect(profile!.coretaxFields).toEqual({ inst: 'BCA' });
    expect(pocketParentIds(await listAccounts(database, ws))).toEqual(new Set([parent.id]));
    // The order they were given is kept in sort_order: ids made in the same millisecond are not ordered (uuidv7
    // here has no counter), so "the order they were added" cannot be read off the id.
    expect(pockets.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  it('keeps the rate each opening balance was posted at', async () => {
    const { pockets } = await valas();
    const openings = await openingsOf(database, ws, pockets.map((p) => p.id));
    expect(openings[pockets[0]!.id]).toEqual({ occurredOn: '2025-02-04', amountMinor: 240_000, currency: 'USD', fxRateToBase: 15_940 });
    expect(openings[pockets[1]!.id]!.fxRateToBase).toBe(12_110.5);
    expect(openings[pockets[2]!.id]!.fxRateToBase).toBe(1);
  });

  it('refuses one currency twice, fewer than two pockets, and a time deposit — leaving nothing behind', async () => {
    const before = (await listAccounts(database, ws)).length;
    await expect(
      openPocketedAccount(database, ws, { item: 'savings', name: 'Twice', pockets: [{ currency: 'USD' }, { currency: 'USD' }] }),
    ).rejects.toThrow('USD is listed twice');
    await expect(openPocketedAccount(database, ws, { item: 'savings', name: 'One', pockets: [{ currency: 'USD' }] })).rejects.toThrow('at least two currencies');
    await expect(
      openPocketedAccount(database, ws, { item: 'time_deposit', name: 'Deposit', pockets: [{ currency: 'USD' }, { currency: 'SGD' }] }),
    ).rejects.toThrow('A time deposit holds one currency');
    // A pocket that fails half-way (no rate for its opening balance) takes the parent and the first pocket with it.
    await expect(
      openPocketedAccount(database, ws, {
        item: 'savings',
        name: 'Half',
        pockets: [{ currency: 'IDR', openingBalanceMinor: 1_000 }, { currency: 'USD', openingBalanceMinor: 1_000 }],
      }),
    ).rejects.toThrow();
    expect((await listAccounts(database, ws)).length).toBe(before);
  });
});

describe('adding a pocket', () => {
  it('files it under the parent’s kind, with the bank its first pocket has', async () => {
    const { parent } = await valas();
    const jpy = await addPocket(database, ws, { parentId: parent.id, currency: 'JPY', openingBalanceMinor: 30_000, openedOn: '2026-09-21', openingRateToBase: 108.3 });
    expect(jpy).toMatchObject({ name: 'BCA Pocket Valas · JPY', currency: 'JPY', subtype: 'savings', parentId: parent.id, sortOrder: 3 });
    expect((await getAssetProfile(database, ws, jpy.id))!.coretaxFields).toEqual({ inst: 'BCA' });
    expect((await nativeBalances(database, ws))[jpy.id]).toBe(30_000);
  });

  it('refuses a currency the account already has, and an account with no pockets', async () => {
    const { parent } = await valas();
    await expect(addPocket(database, ws, { parentId: parent.id, currency: 'USD' })).rejects.toThrow('already has a USD pocket');
    const plain = await openCashAccount(database, ws, { item: 'savings', name: 'Mandiri Valas', currency: 'USD', openingBalanceMinor: 180_000, openingRateToBase: 15_720 });
    await expect(addPocket(database, ws, { parentId: plain.id, currency: 'SGD' })).rejects.toThrow('has no pockets');
  });
});

describe('names', () => {
  it('name the bank and the currency', () => {
    expect(pocketName('BCA Pocket Valas', 'USD')).toBe('BCA Pocket Valas · USD');
  });

  it('only a money account named as a parent is one — categories are not', () => {
    const rows = [
      { id: 'p', parentId: null, kind: 'asset' },
      { id: 'usd', parentId: 'p', kind: 'asset' },
      { id: 'food', parentId: null, kind: 'expense' },
      { id: 'dining', parentId: 'food', kind: 'expense' },
    ] as const;
    expect(pocketParentIds(rows)).toEqual(new Set(['p']));
  });
});
```

- [ ] **Step 2: Run to see them fail** — `cd packages/db && npx vitest run test/pockets.test.ts`.

- [ ] **Step 3: `accounts.ts` — names, parent test, and the pocket rules in `createAccountTx`**

Add after `SPENDABLE_SUBTYPES`:

```ts
/** A pocket's stored name: the bank and the currency, so every list that prints a name already says both. */
export const pocketName = (parentName: string, currency: string) => `${parentName} · ${currency}`;

/**
 * The accounts that are pocket parents: every asset account some asset account names in `parent_id`, archived pockets
 * included. Categories use `parent_id` too, but they are income or expense, so they never count here.
 */
export function pocketParentIds(rows: readonly Pick<AccountRow, 'id' | 'parentId' | 'kind'>[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) if (row.kind === 'asset' && row.parentId) ids.add(row.parentId);
  return ids;
}

/** A money account under a parent is a pocket; these are the rules for one (spec §3.4). */
async function checkPocketTx(tx: Db, ws: WorkspaceContext, pocket: AccountRow, parent: AccountRow): Promise<void> {
  if (pocket.kind !== 'asset') throw new AccountError('Only a money account holds pockets');
  if (parent.parentId !== null) throw new AccountError('A pocket cannot hold pockets of its own');
  if (parent.archivedAt !== null) throw new AccountError(`${parent.name} is archived`);
  if (parent.subtype !== pocket.subtype) throw new AccountError(`A pocket is the same kind of account as ${parent.name}`);
  // Any entry at all, posted or void: an account that has ever held money is not a parent.
  const [held] = await tx.select({ n: sql<number>`count(*)` }).from(entries).where(eq(entries.accountId, parent.id));
  if (Number(held?.n ?? 0) > 0) throw new AccountError(`${parent.name} already holds money of its own, so it cannot hold pockets`);
  const open = await tx
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, parent.id), isNull(accounts.archivedAt)));
  if (open.some((row) => row.currency === pocket.currency)) throw new AccountError(`${parent.name} already has a ${pocket.currency} pocket`);
}
```

`CreateAccountInput` gains `sortOrder?: number` (the column exists; nothing new in the schema), and the row literal in `createAccountTx` takes `sortOrder: input.sortOrder ?? 0` in place of `sortOrder: 0`. Every existing caller passes nothing and keeps 0.

In `createAccountTx`, the existing parent block becomes:

```ts
    if (row.parentId) {
      const [parent] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, row.parentId), eq(accounts.workspaceId, ws.workspaceId)));
      if (!parent || parent.kind !== row.kind) throw new AccountError('Parent must be an account of the same kind');
      if (row.kind === 'asset' || row.kind === 'liability') await checkPocketTx(tx, ws, row, parent);
    }
```

- [ ] **Step 4: `cash-accounts.ts` — one opening path, inside a caller's transaction**

Replace the file's function with (the body is today's, moved; nothing new except `parentId`):

```ts
import { cashItem, type MoneyAccountSubtype } from '@expanses/core';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { AccountError, type AccountRow, createAccountTx } from './accounts';
import { saveAssetProfileTx } from './assets';
import { saveDepositTermsTx } from './deposit-terms';

export interface OpenCashAccountInput {
  // … every existing field, unchanged …
  /** The account this is a pocket of. Only `openPocketedAccount` and `addPocket` pass it. */
  parentId?: string;
  /** A pocket's place among its account's pockets. Only `openPocketedAccount` and `addPocket` pass it. */
  sortOrder?: number;
}

/** Opens a money account with the code and the behaviour its catalogue item fixes. */
export function openCashAccount(database: Database, ws: WorkspaceContext, input: OpenCashAccountInput): Promise<AccountRow> {
  return database.transaction((tx) => openCashAccountTx(tx, ws, input));
}

export async function openCashAccountTx(tx: Db, ws: WorkspaceContext, input: OpenCashAccountInput): Promise<AccountRow> {
  const item = cashItem(input.item);
  const { behaviour } = item;
  if (behaviour.opens !== 'money') throw new AccountError(`${item.label} is not a money account`);
  if (behaviour.valuedBy === 'deposit' && !input.maturesOn) throw new AccountError('Say when the deposit matures');
  const account = await createAccountTx(tx, ws, {
    name: input.name,
    kind: 'asset',
    subtype: behaviour.subtype,
    currency: input.currency,
    openingBalanceMinor: input.openingBalanceMinor,
    openedOn: input.openedOn,
    openingRateToBase: input.openingRateToBase,
    parentId: input.parentId ?? null,
    sortOrder: input.sortOrder,
  });
  await saveAssetProfileTx(tx, ws, {
    accountId: account.id,
    assetKind: 'cash',
    planGroup: 'liquid',
    coretaxSection: 'kas',
    coretaxCode: item.code,
    coretaxFields: input.bank ? { inst: input.bank } : undefined,
  });
  if (behaviour.valuedBy === 'deposit') {
    await saveDepositTermsTx(tx, ws, { accountId: account.id, maturesOn: input.maturesOn!, rateBps: input.rateBps ?? 0 });
  }
  return account;
}
```

Keep the two explanatory comments the old body had, on the same lines.

`assets.ts`: `getAssetProfile` becomes a one-line call of a new `getAssetProfileTx(tx: Db, ws, accountId)` holding today's body (`database.db` → `tx`), so the bank is read through `toProfile` — the one reader of `coretax_fields_json` — and never by a second `JSON.parse`.

- [ ] **Step 5: `pockets.ts`**

```ts
import { cashItem, type MoneyAccountSubtype } from '@expanses/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { AccountError, type AccountRow, createAccountTx, pocketName, systemAccountId } from './accounts';
import { getAssetProfileTx } from './assets';
import { openCashAccountTx } from './cash-accounts';

export interface PocketInput {
  currency: string;
  openingBalanceMinor?: number;
  /** Settled by the screen before saving (`openingRateFor`): typed and checked, or resolved for the opening date. */
  openingRateToBase?: number;
}

export interface OpenPocketedAccountInput {
  item: MoneyAccountSubtype;
  name: string;
  bank?: string;
  openedOn?: string;
  pockets: PocketInput[];
}

/**
 * One account holding several currencies: a parent that holds nothing, and one ordinary money account per currency
 * under it. All of it in one transaction — a pocket that cannot be opened leaves no parent and no other pocket.
 */
export async function openPocketedAccount(
  database: Database,
  ws: WorkspaceContext,
  input: OpenPocketedAccountInput,
): Promise<{ parent: AccountRow; pockets: AccountRow[] }> {
  const item = cashItem(input.item);
  if (item.behaviour.opens !== 'money') throw new AccountError(`${item.label} is not a money account`);
  if (item.behaviour.valuedBy === 'deposit') throw new AccountError('A time deposit holds one currency. Open one deposit per currency.');
  const codes = input.pockets.map((pocket) => pocket.currency);
  const twice = codes.find((code, i) => codes.indexOf(code) !== i);
  if (twice) throw new AccountError(`${twice} is listed twice. One pocket per currency.`);
  if (codes.length < 2) throw new AccountError('An account with pockets holds at least two currencies. Add a second, or open it as a plain account.');
  return database.transaction(async (tx) => {
    // The table requires a currency on every asset; the parent's is never read as money (spec §3.1).
    const parent = await createAccountTx(tx, ws, { name: input.name, kind: 'asset', subtype: item.behaviour.subtype, currency: ws.baseCurrency });
    const pockets: AccountRow[] = [];
    for (const [sortOrder, pocket] of input.pockets.entries()) {
      pockets.push(
        await openCashAccountTx(tx, ws, {
          item: input.item,
          name: pocketName(parent.name, pocket.currency),
          currency: pocket.currency,
          openingBalanceMinor: pocket.openingBalanceMinor,
          openedOn: input.openedOn,
          openingRateToBase: pocket.openingRateToBase,
          bank: input.bank,
          parentId: parent.id,
          sortOrder,
        }),
      );
    }
    return { parent, pockets };
  });
}

export interface AddPocketInput {
  parentId: string;
  currency: string;
  openingBalanceMinor?: number;
  openedOn?: string;
  openingRateToBase?: number;
}

/** One more currency in an account that already has pockets. A plain account does not become a parent (spec §17.1). */
export async function addPocket(database: Database, ws: WorkspaceContext, input: AddPocketInput): Promise<AccountRow> {
  return database.transaction(async (tx) => {
    const [parent] = await tx.select().from(accounts).where(and(eq(accounts.id, input.parentId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!parent) throw new AccountError('Account not found');
    const siblings = await tx
      .select({ id: accounts.id, sortOrder: accounts.sortOrder })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, parent.id), eq(accounts.kind, 'asset')))
      .orderBy(asc(accounts.sortOrder), asc(accounts.id));
    const first = siblings[0];
    if (!first) throw new AccountError(`${parent.name} has no pockets. Open a new account with pockets instead.`);
    const inst = (await getAssetProfileTx(tx, ws, first.id))?.coretaxFields.inst;
    const bank = inst?.trim() ? inst : undefined;
    return openCashAccountTx(tx, ws, {
      item: parent.subtype as MoneyAccountSubtype,
      name: pocketName(parent.name, input.currency),
      currency: input.currency,
      openingBalanceMinor: input.openingBalanceMinor,
      openedOn: input.openedOn,
      openingRateToBase: input.openingRateToBase,
      bank,
      parentId: parent.id,
      // After every pocket it has, archived ones included, so a re-added currency does not jump the queue.
      sortOrder: Math.max(...siblings.map((row) => row.sortOrder)) + 1,
    });
  });
}

export interface Opening {
  occurredOn: string;
  amountMinor: number;
  currency: string;
  /** The rate the opening balance was posted at: what "Opened at" shows. */
  fxRateToBase: number;
}

/** Each account's opening balance — the earliest posted entry that met the Opening balance equity account. */
export async function openingsOf(database: Database, ws: WorkspaceContext, accountIds: readonly string[]): Promise<Record<string, Opening>> {
  if (accountIds.length === 0) return {};
  const equityId = await systemAccountId(database.db, ws, 'opening_balance');
  const openingTxs = (
    await database.db.select({ id: entries.transactionId }).from(entries).where(and(eq(entries.workspaceId, ws.workspaceId), eq(entries.accountId, equityId)))
  ).map((row) => row.id);
  if (openingTxs.length === 0) return {};
  const rows = await database.db
    .select({
      accountId: entries.accountId,
      occurredOn: transactions.occurredOn,
      amountMinor: entries.amountMinor,
      currency: entries.currency,
      fxRateToBase: entries.fxRateToBase,
    })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        inArray(entries.accountId, [...accountIds]),
        inArray(entries.transactionId, openingTxs),
      ),
    )
    .orderBy(asc(transactions.occurredOn), asc(transactions.createdAt));
  const out: Record<string, Opening> = {};
  for (const row of rows) if (!(row.accountId in out)) out[row.accountId] = { occurredOn: row.occurredOn, amountMinor: row.amountMinor, currency: row.currency, fxRateToBase: row.fxRateToBase };
  return out;
}
```

`packages/db/src/index.ts`: add `export * from './repos/pockets';` after `./repos/cash-accounts`.

- [ ] **Step 6: Run** — `cd packages/db && npx vitest run test/pockets.test.ts test/deposits.test.ts test/accounts.test.ts test/assets.test.ts` → pass (deposits proves the extraction changed nothing; assets proves `getAssetProfile` still reads the same). Then the root gate.
- [ ] **Step 7: Commit** — `feat(db): an account can hold a pocket per currency, opened in one transaction`

---

### Task 3: The parent holds nothing — posting, archiving, renaming, and every value reader

**Files:**
- Modify: `packages/db/src/repos/ledger.ts`, `packages/db/src/repos/accounts.ts`, `packages/db/src/repos/asset-values.ts`
- Test: `packages/db/test/pockets.test.ts` (append)

**Interfaces:**
- Consumes: Task 2; `exchangeLines`, `transferLines`, `exchangeCost` (core); `postTransaction`, `assetValuesAt`, `netWorthAt`, `coretaxInputsFor`, `periodFlows`, `schema`.
- Produces: `LedgerErrorCode` gains `'POCKET_PARENT'`; `archiveAccount` refuses a parent with open pockets; `renameAccount` carries the name to pockets; `assetValuesAt` never returns a parent.

- [ ] **Step 1: Append the failing tests**

```ts
// packages/db/test/pockets.test.ts (append; add these to the import list:
//   archiveAccount, assetValuesAt, coretaxInputsFor, LedgerError, netWorthAt, periodFlows, postTransaction,
//   renameAccount, schema, systemAccountId
// and from '@expanses/core': exchangeCost, exchangeLines, transferLines; from 'drizzle-orm': and, eq)

describe('the parent holds no money', () => {
  it('refuses any posting that touches it, before writing anything', async () => {
    const { parent, pockets } = await valas();
    const txCount = async () => (await database.db.select().from(schema.transactions)).length;
    const before = await txCount();
    await expect(
      postTransaction(database, ws, { occurredOn: '2026-09-21', description: 'Into the parent', lines: transferLines({ fromAccountId: pockets[2]!.id, toAccountId: parent.id, amountMinor: 1_000, currency: 'IDR' }) }),
    ).rejects.toMatchObject({ code: 'POCKET_PARENT', message: 'BCA Pocket Valas holds no money of its own. Choose one of its pockets.' });
    expect(await txCount()).toBe(before);
  });

  it('is archived only after its pockets', async () => {
    const { parent } = await valas();
    await expect(archiveAccount(database, ws, parent.id)).rejects.toThrow('BCA Pocket Valas still has pockets: USD, SGD, IDR. Archive each pocket first.');
  });

  it('renames the pockets still named after it, and leaves a renamed pocket alone', async () => {
    const { parent, pockets } = await valas();
    await renameAccount(database, ws, pockets[1]!.id, 'My Singapore money');
    await renameAccount(database, ws, parent.id, 'OCBC Multi');
    const names = new Map((await listAccounts(database, ws)).map((a) => [a.id, a.name]));
    expect([names.get(parent.id), names.get(pockets[0]!.id), names.get(pockets[1]!.id), names.get(pockets[2]!.id)]).toEqual([
      'OCBC Multi',
      'OCBC Multi · USD',
      'My Singapore money',
      'OCBC Multi · IDR',
    ]);
  });
});

describe('what the parent is worth to every reader', () => {
  it('is nothing: net worth and the asset list see each pocket once and the parent never', async () => {
    const { parent, pockets } = await valas();
    const values = await assetValuesAt(database, ws, '2026-09-21');
    // THE assertion that fails before Step 5: today the parent is returned as a 0-valued row, which idle cash and
    // goal funding would list. The net-worth and daftar-harta checks below pass today too (a parent holds 0, and
    // the kas table skips a balance ≤ 0); they guard the figures, they do not prove the filter.
    expect(values.some((row) => row.accountId === parent.id)).toBe(false);
    // Rows come in (sort_order, name) order; the pockets' sort_order 0,1,2 is what makes this USD, SGD, IDR — by name
    // alone it would be IDR, SGD, USD.
    expect(values.filter((row) => pockets.some((p) => p.id === row.accountId)).map((row) => [row.currency, row.valueMinor])).toEqual([
      ['USD', 240_000],
      ['SGD', 115_000],
      ['IDR', 5_400_000],
    ]);
    // The mockup's total, at the mockup's rates — not the opening rates, and not the parent counted on top.
    expect((await netWorthAt(database, ws, '2026-09-21', { USD: 16_250, SGD: 12_680 })).assetsMinor).toBe(58_982_000);
  });

  it('puts one kas row per pocket on daftar harta, and none for the parent', async () => {
    const { parent, pockets } = await valas();
    const inputs = await coretaxInputsFor(database, ws, 2026);
    expect(inputs.cash.some((row) => row.accountId === parent.id)).toBe(false);
    expect(inputs.cash.map((row) => [row.accountId, row.name, row.code, row.currency, row.balanceMinor])).toEqual([
      [pockets[0]!.id, 'BCA Pocket Valas · USD', '0102', 'USD', 240_000],
      [pockets[1]!.id, 'BCA Pocket Valas · SGD', '0102', 'SGD', 115_000],
      [pockets[2]!.id, 'BCA Pocket Valas · IDR', '0102', 'IDR', 5_400_000],
    ]);
  });
});

describe('a move between pockets', () => {
  const moveUsdToSgd = async () => {
    const { pockets } = await valas();
    const exchangeId = await systemAccountId(database.db, ws, 'currency_exchange');
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-21',
      description: 'BCA Pocket Valas: USD → SGD',
      lines: exchangeLines({ fromAccountId: pockets[0]!.id, fromAmountMinor: 50_000, fromCurrency: 'USD', toAccountId: pockets[1]!.id, toAmountMinor: 63_800, toCurrency: 'SGD', exchangeAccountId: exchangeId }),
      ratesToBase: { USD: 16_250, SGD: 12_680 },
    });
    return { pockets, exchangeId, id };
  };

  it('records the bank’s spread on the Currency exchange account, to the rupiah the screen showed', async () => {
    const { exchangeId, id } = await moveUsdToSgd();
    const legs = await database.db
      .select({ base: schema.entries.amountBaseMinor })
      .from(schema.entries)
      .where(and(eq(schema.entries.transactionId, id), eq(schema.entries.accountId, exchangeId)));
    const recorded = legs.reduce((sum, leg) => sum + leg.base, 0);
    const shown = exchangeCost({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: { USD: 16_250, SGD: 12_680 } })!;
    expect(recorded).toBe(shown.costMinor);
    expect(recorded).toBe(35_160);
  });

  it('moves the pockets’ own balances, each in its own currency', async () => {
    const { pockets } = await moveUsdToSgd();
    const balances = await nativeBalances(database, ws);
    expect([balances[pockets[0]!.id], balances[pockets[1]!.id]]).toEqual([190_000, 178_800]);
  });

  it('reaches neither income nor spending, and lowers put-away by exactly the spread (today’s rule, pinned)', async () => {
    await moveUsdToSgd();
    const flows = await periodFlows(database, ws, { from: '2026-09-01', to: '2026-09-30' });
    expect([flows.incomeMinor, flows.spendingMinor, flows.putAwayMinor]).toEqual([0, 0, -35_160]);
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: `ledger.ts` — the refusal, before anything is planned or written**

`LedgerErrorCode` gains `| 'POCKET_PARENT'`. In `postTransactionTx`, the `found` select gains `name: accounts.name`, and directly after it:

```ts
  // A pocket parent holds no money: it only adds its pockets up (currency pockets spec §2). This is the one place
  // every entry in the ledger is written, so no screen, import or repository function can get round it.
  const parentOf = ids.length
    ? await tx
        .select({ parentId: accounts.parentId })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'asset'), inArray(accounts.parentId, ids)))
        .limit(1)
    : [];
  if (parentOf.length > 0) {
    const name = found.find((a) => a.id === parentOf[0]!.parentId)?.name ?? 'That account';
    throw new LedgerError('POCKET_PARENT', `${name} holds no money of its own. Choose one of its pockets.`);
  }
```

- [ ] **Step 4: `accounts.ts` — archive and rename**

In `archiveAccount`, after the system-account check and before the balance check:

```ts
    if (account.kind === 'asset') {
      const open = await tx
        .select({ currency: accounts.currency })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, id), isNull(accounts.archivedAt)))
        .orderBy(asc(accounts.sortOrder), asc(accounts.id));
      if (open.length > 0) {
        throw new AccountError(`${account.name} still has pockets: ${open.map((row) => row.currency).join(', ')}. Archive each pocket first.`);
      }
    }
```

`renameAccount` becomes:

```ts
export async function renameAccount(database: Database, ws: WorkspaceContext, id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new AccountError('Name is required');
  await database.transaction(async (tx) => {
    const [before] = await tx.select({ name: accounts.name }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
    await tx.update(accounts).set({ name: trimmed }).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
    if (before) {
      // Pockets still named after the account follow it; one the owner renamed keeps its own name.
      const pockets = await tx
        .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, id), eq(accounts.kind, 'asset')));
      for (const pocket of pockets) {
        if (pocket.currency && pocket.name === pocketName(before.name, pocket.currency)) {
          await tx.update(accounts).set({ name: pocketName(trimmed, pocket.currency) }).where(eq(accounts.id, pocket.id));
        }
      }
    }
    await writeAudit(tx, ws, 'rename', id, { name: trimmed });
  });
}
```

- [ ] **Step 5: `asset-values.ts` — parents are not assets**

In `assetValuesAt`, read archived rows too so a parent whose pockets are all archived is still recognised, then filter:

```ts
  const rows = await database.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'asset')))
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));
  // A pocket parent holds nothing, so it is no asset: net worth, the tax report, idle cash and goals all read here.
  const parents = pocketParentIds(rows);
  const assetsAccounts = rows.filter((row) => row.archivedAt === null && assetSubtypes.includes(row.subtype) && !parents.has(row.id));
```

Import `pocketParentIds` from `./accounts`. Keep `isNull` in the import: `netWorthAt` in the same file still uses it.

- [ ] **Step 6: Run** — `cd packages/db && npx vitest run test/pockets.test.ts test/asset-values.test.ts test/ledger.test.ts test/accounts.test.ts test/flows.test.ts test/flows-putaway.test.ts`, then the root gate.
- [ ] **Step 7: Commit** — `feat(db): a pocket parent holds nothing — refused by the ledger, absent from every value reader`

---

### Task 4: The web kit — who can pay, the opening rate, the second figure, and the pocket model

**Files:**
- Modify: `apps/web/src/lib/queries.ts`, `apps/web/src/lib/rates.ts`, `apps/web/src/features/transactions/tx-form.ts`, `TransactionCard.tsx`, `EditSheet.tsx`, `QuickRowEditor.tsx`, `TransactionsPage.tsx`, `apps/web/src/features/review/ReviewPage.tsx`, `apps/web/src/features/events/EventDetailPage.tsx`, `apps/web/src/features/import/ImportPage.tsx`, `apps/web/src/features/goals/GoalForm.tsx`, `apps/web/src/features/cards/CardHero.tsx`, `apps/web/src/features/cards/StatementPanel.tsx`, `apps/web/src/features/loans/LoanDetailPage.tsx`, `apps/web/src/features/debts/DebtForm.tsx`, `apps/web/src/features/debts/PersonCard.tsx`, `apps/web/src/features/coretax/BusinessSection.tsx`, `apps/web/src/features/bills/BillFormPage.tsx`, `apps/web/src/features/bills/PaySheet.tsx`, `apps/web/src/features/networth/TradesPage.tsx`, `apps/web/src/features/cards/CardsPage.tsx`, `apps/web/src/features/ownables/CashAccountForm.tsx`, `apps/web/src/features/accounts/AccountsPage.tsx`, `apps/web/src/features/networth/add-asset.ts`, `apps/web/src/features/networth/AddAssetForm.tsx`, `apps/web/src/ui/native/index.ts`
- Create: `apps/web/src/features/accounts/pockets.ts`, `pockets.test.ts`, `apps/web/src/lib/queries.test.ts`, `apps/web/src/lib/rates.test.ts`, `apps/web/src/ui/native/approx.ts`, `apps/web/src/ui/native/approx.test.ts`, `apps/web/src/ui/native/Grouped.tsx`
- Test: `apps/web/src/features/transactions/tx-form.test.ts` (append), `apps/web/src/features/networth/add-asset.test.ts` (append)

**Interfaces:**
- Consumes: `pocketParentIds` (Task 2); `sumToBase`, `exchangeCost`, `impliedRate` (Task 1); `amountFields`, `emptyForm`, `formToPost`, `settledAmount`, `MoneyFieldSpec` (tx-form); `evaluateAmount`, `parseMajor`, `parseRate`, `convertMinor`, `formatMinor`, `currencyInfo`, `CURRENCIES` (core); `checkManualRate` (lib/rates); `upsertRate` (db); `InsetRow`, `Figure`, `toneClass`, `GroupChild` (kit).
- Produces: `moneyHolders(accounts): AccountRow[]`; `openingRateFor({...}): Promise<number | undefined>`; `receivedField(draft, accounts): MoneyFieldSpec | null` (`which: 'received'`); in the kit `approxLine`, `rateLine`, `groupedFigure`, `ApproxFigure`, `GroupedRow`; pockets model (see file structure). `NewAssetPlan` loses `openingRateToBase` and gains `rateNeededMinor` / `rateDate` (Step 5b).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/queries.test.ts
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { isMoneyAccount, moneyHolders } from './queries';

const rows = [
  { id: 'valas', parentId: null, kind: 'asset', subtype: 'savings', currency: 'IDR', archivedAt: null },
  { id: 'usd', parentId: 'valas', kind: 'asset', subtype: 'savings', currency: 'USD', archivedAt: null },
  { id: 'sgd', parentId: 'valas', kind: 'asset', subtype: 'savings', currency: 'SGD', archivedAt: null },
  { id: 'mandiri', parentId: null, kind: 'asset', subtype: 'savings', currency: 'USD', archivedAt: null },
  { id: 'card', parentId: null, kind: 'liability', subtype: 'credit_card', currency: 'IDR', archivedAt: null },
  { id: 'food', parentId: null, kind: 'expense', subtype: 'category', currency: null, archivedAt: null },
  { id: 'dining', parentId: 'food', kind: 'expense', subtype: 'category', currency: null, archivedAt: null },
] as AccountRow[];

describe('who can hold money', () => {
  it('is every money account except a pocket parent', () => {
    expect(moneyHolders(rows).map((a) => a.id)).toEqual(['usd', 'sgd', 'mandiri', 'card']);
  });

  it('leaves isMoneyAccount as it was: a parent’s history is still owner-wide', () => {
    expect(isMoneyAccount(rows[0]!)).toBe(true);
  });
});
```

```ts
// apps/web/src/lib/rates.test.ts
import { createDatabase, createWorkspace, findRate, migrate } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it } from 'vitest';
import { openingRateFor } from './rates';

async function setup() {
  const database = createDatabase(createNodeExecutor());
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  return { database, ws };
}

describe('the rate an opening balance is posted at', () => {
  it('is the typed one, checked and stored for the opening date', async () => {
    const { database, ws } = await setup();
    const resolveRates = async () => ({ rates: {} as Record<string, number> });
    const rate = await openingRateFor({ database, ws, currency: 'USD', openedOn: '2025-02-04', openingBalanceMinor: 240_000, typed: '15.940,5', resolveRates });
    expect(rate).toBe(15_940.5);
    expect((await findRate(database, 'USD', 'IDR', '2025-02-04'))!.rate).toBe(15_940.5);
  });

  it('is resolved for the opening date when left blank', async () => {
    const { database, ws } = await setup();
    const asked: [string[], string][] = [];
    const resolveRates = async (currencies: string[], onDate: string) => {
      asked.push([currencies, onDate]);
      return { rates: { SGD: 12_110.5 } as Record<string, number> };
    };
    expect(await openingRateFor({ database, ws, currency: 'SGD', openedOn: '2025-02-04', openingBalanceMinor: 115_000, typed: '  ', resolveRates })).toBe(12_110.5);
    expect(asked).toEqual([[['SGD'], '2025-02-04']]);
  });

  it('stops, naming the currency, when blank and unresolvable', async () => {
    const { database, ws } = await setup();
    const resolveRates = async () => ({ rates: {} as Record<string, number> });
    await expect(openingRateFor({ database, ws, currency: 'SGD', openedOn: '2025-02-04', openingBalanceMinor: 115_000, typed: '', resolveRates })).rejects.toThrow(
      'No SGD→IDR rate available. Enter it manually.',
    );
  });

  it('is not needed for the base currency or an empty balance', async () => {
    const { database, ws } = await setup();
    const resolveRates = async () => {
      throw new Error('must not be asked');
    };
    expect(await openingRateFor({ database, ws, currency: 'IDR', openedOn: '2025-02-04', openingBalanceMinor: 5_400_000, typed: '', resolveRates })).toBeUndefined();
    expect(await openingRateFor({ database, ws, currency: 'USD', openedOn: '2025-02-04', openingBalanceMinor: 0, typed: '', resolveRates })).toBeUndefined();
  });
});
```

Append to `tx-form.test.ts` (add `receivedField` to its import list):

```ts
describe('the second figure of a transfer', () => {
  const pockets = [
    { id: 'usd', name: 'Valas · USD', kind: 'asset', subtype: 'savings', currency: 'USD', parentId: 'valas' },
    { id: 'sgd', name: 'Valas · SGD', kind: 'asset', subtype: 'savings', currency: 'SGD', parentId: 'valas' },
    { id: 'kwd', name: 'Valas · KWD', kind: 'asset', subtype: 'savings', currency: 'KWD', parentId: 'valas' },
    { id: 'idr', name: 'Valas · IDR', kind: 'asset', subtype: 'savings', currency: 'IDR', parentId: 'valas' },
    { id: 'fx', name: 'Currency exchange', kind: 'equity', subtype: 'equity', currency: null, systemKey: 'currency_exchange' },
  ] as AccountRow[];
  const move: FormDraft = { ...emptyForm('ws-1'), mode: 'transfer', moneyId: 'usd', toId: 'sgd', amount: '500', toAmount: '638', occurredOn: '2026-09-21' };

  it('is read in the To account’s currency, and only when the two differ', () => {
    expect(receivedField(move, pockets)).toEqual({ which: 'received', label: 'Received amount (SGD)', value: '638', currency: 'SGD' });
    expect(receivedField({ ...move, toId: 'usd', moneyId: 'usd' }, pockets)).toBeNull();
    expect(receivedField({ ...move, mode: 'expense' }, pockets)).toBeNull();
  });

  it('is the figure the posting moves — at KWD’s three decimals, not the From account’s two', () => {
    // `1.5` tells all three apart: KWD 1.500 minor, USD (the From pocket) 150, IDR refuses it. (`1.500` would not:
    // parseMajor reads it as 1500 minor in KWD and in IDR alike.)
    const post = formToPost({ ...move, toId: 'kwd', toAmount: '1.5' }, pockets);
    if (post.kind !== 'post') throw new Error('expected a plain posting');
    const into = post.input.lines.find((line) => line.accountId === 'kwd')!;
    const field = receivedField({ ...move, toId: 'kwd', toAmount: '1.5' }, pockets)!;
    expect(into).toMatchObject({ currency: field.currency, amountMinor: evaluateAmount(field.value, field.currency) });
    expect(into.amountMinor).toBe(1_500);
  });

  it('agrees with the posting at every keystroke', () => {
    const typing = (text: string) => [...text].map((_, i) => text.slice(0, i + 1));
    for (const out of typing('100.50')) {
      for (const into of typing('1.630.000')) {
        const draft = { ...move, toId: 'idr', amount: out, toAmount: into };
        const leaves = amountFields(draft, pockets, 'IDR').amount;
        const arrives = receivedField(draft, pockets)!;
        const outMinor = evaluateAmount(leaves.value, leaves.currency);
        const intoMinor = evaluateAmount(arrives.value, arrives.currency);
        if (outMinor === null || intoMinor === null) {
          expect(() => formToPost(draft, pockets)).toThrow();
          continue;
        }
        const post = formToPost(draft, pockets);
        if (post.kind !== 'post') throw new Error('expected a plain posting');
        expect(post.input.lines.find((line) => line.accountId === 'usd')).toMatchObject({ currency: 'USD', amountMinor: -outMinor });
        expect(post.input.lines.find((line) => line.accountId === 'idr')).toMatchObject({ currency: 'IDR', amountMinor: intoMinor });
      }
    }
  });
});
```

```ts
// apps/web/src/features/accounts/pockets.test.ts
import { evaluateAmount } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { formToPost } from '../transactions/tx-form';
import { bankRateText, moveDraft, moveView, nextPocketCurrency, parentTotal, pocketsOf, readPockets, spreadLine, withPockets } from './pockets';

// Ids deliberately out of order: the pockets were made in one millisecond, so only sort_order says which came first.
const accounts = [
  { id: 'v', name: 'Valas', parentId: null, kind: 'asset', subtype: 'savings', currency: 'IDR', archivedAt: null, sortOrder: 0 },
  { id: 'c-usd', name: 'Valas · USD', parentId: 'v', kind: 'asset', subtype: 'savings', currency: 'USD', archivedAt: null, sortOrder: 0 },
  { id: 'a-sgd', name: 'Valas · SGD', parentId: 'v', kind: 'asset', subtype: 'savings', currency: 'SGD', archivedAt: null, sortOrder: 1 },
  { id: 'b-idr', name: 'Valas · IDR', parentId: 'v', kind: 'asset', subtype: 'savings', currency: 'IDR', archivedAt: null, sortOrder: 2 },
  { id: 'd-jpy', name: 'Valas · JPY', parentId: 'v', kind: 'asset', subtype: 'savings', currency: 'JPY', archivedAt: '2026-01-01', sortOrder: 3 },
  { id: 'fx', name: 'Currency exchange', parentId: null, kind: 'equity', subtype: 'equity', currency: null, systemKey: 'currency_exchange', archivedAt: null, sortOrder: 0 },
] as AccountRow[];
const [, usd, sgd, idr] = accounts as [AccountRow, AccountRow, AccountRow, AccountRow];
const rates = { USD: 16_250, SGD: 12_680 };
const typing = (text: string) => [...text].map((_, i) => text.slice(0, i + 1));

describe('the pockets of an account', () => {
  it('are its open children in the order they were added', () => {
    expect(pocketsOf('v', accounts).map((a) => a.currency)).toEqual(['USD', 'SGD', 'IDR']);
  });

  it('add up to the mockup’s total, or to none when a rate is missing', () => {
    const balances = { 'c-usd': 240_000, 'a-sgd': 115_000, 'b-idr': 5_400_000 };
    expect(parentTotal(pocketsOf('v', accounts), balances, 'IDR', rates)).toEqual({ totalMinor: 58_982_000, missing: [] });
    expect(parentTotal(pocketsOf('v', accounts), balances, 'IDR', { USD: 16_250 })).toEqual({ totalMinor: null, missing: ['SGD'] });
  });
});

describe('the pockets form', () => {
  it('reads each opening balance in that pocket’s own currency', () => {
    expect(
      readPockets([
        { currency: 'USD', balance: '2,400.00', rate: '' },
        { currency: 'SGD', balance: '1.150,5', rate: '12.110,5' },
        { currency: 'IDR', balance: '5.400.000', rate: '' },
        { currency: 'JPY', balance: '', rate: '' },
      ]),
    ).toEqual([
      { currency: 'USD', openingBalanceMinor: 240_000, typedRate: '' },
      { currency: 'SGD', openingBalanceMinor: 115_050, typedRate: '12.110,5' },
      { currency: 'IDR', openingBalanceMinor: 5_400_000, typedRate: '' },
      { currency: 'JPY', openingBalanceMinor: 0, typedRate: '' },
    ]);
  });

  it('refuses a figure the pocket’s currency cannot hold, rather than rounding it', () => {
    expect(() => readPockets([{ currency: 'IDR', balance: '5400000,50', rate: '' }])).toThrow();
  });

  it('offers the first currency not yet used', () => {
    expect(nextPocketCurrency([{ currency: 'IDR', balance: '', rate: '' }])).toBe('USD');
    expect(nextPocketCurrency([{ currency: 'IDR', balance: '', rate: '' }, { currency: 'USD', balance: '', rate: '' }])).toBe('SGD');
  });
});

describe('moving between pockets', () => {
  const start = moveDraft('book', usd, sgd, '2026-09-21');

  it('reads Leaves in the From pocket’s currency and Arrives in the To pocket’s', () => {
    const view = moveView({ ...start, amount: '500', toAmount: '638' }, accounts, 'IDR', rates);
    expect([view.leaves.currency, view.arrives!.currency]).toEqual(['USD', 'SGD']);
    expect(view.bankRate).toBeCloseTo(1.276, 10);
    expect(view.cost).toEqual({ fromBaseMinor: 8_125_000, toBaseMinor: 8_089_840, costMinor: 35_160 });
  });

  it('shows what it posts at every keystroke of 500 and 638', () => {
    for (const out of typing('500')) {
      for (const into of typing('638')) {
        const draft = { ...start, amount: out, toAmount: into };
        const view = moveView(draft, accounts, 'IDR', rates);
        const post = formToPost(draft, accounts);
        if (post.kind !== 'post') throw new Error('expected a plain posting');
        const left = post.input.lines.find((line) => line.accountId === usd.id)!;
        const arrived = post.input.lines.find((line) => line.accountId === sgd.id)!;
        expect(left).toMatchObject({ currency: view.leaves.currency, amountMinor: -evaluateAmount(view.leaves.value, view.leaves.currency)! });
        expect(arrived).toMatchObject({ currency: view.arrives!.currency, amountMinor: evaluateAmount(view.arrives!.value, view.arrives!.currency)! });
        expect(view.cost!.fromBaseMinor - view.cost!.toBaseMinor).toBe(view.cost!.costMinor);
      }
    }
  });

  it('reads USD → IDR at each side’s own exponent, at every keystroke of 100.50 and 1.630.000', () => {
    // USD and SGD share an exponent, so the case above cannot catch a figure read in the other pocket’s currency.
    const toIdr = moveDraft('book', usd, idr, '2026-09-21');
    for (const out of typing('100.50')) {
      for (const into of typing('1.630.000')) {
        const draft = { ...toIdr, amount: out, toAmount: into };
        const view = moveView(draft, accounts, 'IDR', rates);
        const outMinor = evaluateAmount(view.leaves.value, view.leaves.currency);
        const intoMinor = evaluateAmount(view.arrives!.value, view.arrives!.currency);
        if (outMinor === null || intoMinor === null) {
          expect(view.cost).toBeNull();
          expect(() => formToPost(draft, accounts)).toThrow();
          continue;
        }
        const post = formToPost(draft, accounts);
        if (post.kind !== 'post') throw new Error('expected a plain posting');
        expect(post.input.lines.find((line) => line.accountId === usd.id)).toMatchObject({ currency: 'USD', amountMinor: -outMinor });
        expect(post.input.lines.find((line) => line.accountId === idr.id)).toMatchObject({ currency: 'IDR', amountMinor: intoMinor });
      }
    }
    const done = moveView({ ...toIdr, amount: '100.50', toAmount: '1.630.000' }, accounts, 'IDR', rates);
    expect(done.cost).toEqual({ fromBaseMinor: 1_633_125, toBaseMinor: 1_630_000, costMinor: 3_125 });
  });

  it('clears both figures when a pocket changes, and swaps when the other side is chosen', () => {
    const typed = { ...start, amount: '500', toAmount: '638' };
    expect(withPockets(typed, { toId: idr.id })).toMatchObject({ moneyId: usd.id, toId: idr.id, amount: '', toAmount: '' });
    expect(withPockets(typed, { moneyId: sgd.id })).toMatchObject({ moneyId: sgd.id, toId: usd.id, amount: '', toAmount: '' });
  });

  it('says a cost, a gain and a match in words, with one positive figure', () => {
    const idrFormat = (minor: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(minor);
    expect(spreadLine({ fromBaseMinor: 8_125_000, toBaseMinor: 8_089_840, costMinor: 35_160 }, 'IDR')).toEqual({ title: 'The bank’s rate cost you', figure: idrFormat(35_160) });
    expect(spreadLine({ fromBaseMinor: 8_125_000, toBaseMinor: 8_242_000, costMinor: -117_000 }, 'IDR')).toEqual({ title: 'The bank’s rate gained you', figure: idrFormat(117_000) });
    expect(spreadLine({ fromBaseMinor: 1, toBaseMinor: 1, costMinor: 0 }, 'IDR')!.title).toBe('The bank’s rate matched the day’s rate');
    expect(spreadLine(null, 'IDR')).toBeNull();
  });

  it('writes the bank’s rate to four places', () => {
    expect(bankRateText(1.276, 'USD', 'SGD')).toBe('1 USD = 1,2760 SGD');
    expect(bankRateText(null, 'USD', 'SGD')).toBe('—');
  });
});
```

```ts
// apps/web/src/ui/native/approx.test.ts — the shared parts, in the kit's own words (no pocket or holding here)
import { describe, expect, it } from 'vitest';
import { approxLine, groupedFigure, rateLine } from './approx';

const rupiah = (minor: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(minor);

describe('a foreign figure with its converted value beneath', () => {
  it('converts at the held rate, rounding half away from zero', () => {
    expect(approxLine(240_000, 'USD', 'IDR', { USD: 16_250 })).toBe(`≈ ${rupiah(39_000_000)}`);
    // $1.03 at 15.940,37 = 16.418,58 → 16.419; flooring would print 16.418.
    expect(approxLine(103, 'USD', 'IDR', { USD: 15_940.37 })).toBe(`≈ ${rupiah(16_419)}`);
  });

  it('keeps an overdrawn figure’s sign', () => {
    expect(approxLine(-1_000, 'USD', 'IDR', { USD: 16_000 })).toBe(`≈ ${rupiah(-160_000)}`);
  });

  it('says nothing under the base currency, and names a missing rate', () => {
    expect(approxLine(5_400_000, 'IDR', 'IDR', {})).toBeNull();
    expect(approxLine(115_000, 'SGD', 'IDR', {})).toBe('No SGD rate yet');
  });
});

describe('a rate in words', () => {
  it('reads the way the rest of the app does', () => {
    expect(rateLine(16_250, 'USD', 'IDR')).toBe('16.250 IDR per 1 USD');
    expect(rateLine(12_110.5, 'SGD', 'IDR')).toBe('12.110,5 IDR per 1 SGD');
  });
});

describe('a grouped row’s figure', () => {
  it('is the ≈ total, or the missing rates named — never a partial sum', () => {
    expect(groupedFigure({ totalMinor: 58_982_000, missing: [] }, 'IDR')).toEqual({ text: `≈ ${rupiah(58_982_000)}`, complete: true });
    expect(groupedFigure({ totalMinor: null, missing: ['JPY', 'SGD'] }, 'IDR')).toEqual({ text: 'No JPY, SGD rate yet', complete: false });
  });
});
```

Append to `apps/web/src/features/networth/add-asset.test.ts` (use the file's existing draft builder; the names below are what it must set):

```ts
describe('the rate an asset opens at', () => {
  it('is no longer read by a parser of its own: planNewAsset hands the typed text on untouched', () => {
    // A motorcycle is valued by a figure you type, so its cost is the opening balance (the `draft.cost` branch).
    const plan = planNewAsset({ ...emptyDraft('motorcycle', 'IDR', '2026-09-21'), name: 'Bike bought abroad', currency: 'USD', cost: '1000.00', purchasedOn: '2026-09-01', openingRate: '16.500' }, '2026-09-21');
    // `openingRateFor` reads it with parseRate (16,5, which ratePreview shows before saving) — not 16500 as before.
    expect(plan).not.toHaveProperty('openingRateToBase');
    expect([plan.rateNeededMinor, plan.rateDate]).toEqual([100_000, '2026-09-01']);
  });

  it('needs a rate for the purchases, dated at the earliest one', () => {
    const plan = planNewAsset(
      {
        ...emptyDraft('stock', 'IDR', '2026-09-21'),
        name: 'US shares',
        currency: 'USD',
        purchases: [
          { occurredOn: '2026-05-02', units: '10', cost: '150.25' },
          { occurredOn: '2026-03-01', units: '5', cost: '70.10' },
        ],
      },
      '2026-09-21',
    );
    expect([plan.rateNeededMinor, plan.rateDate]).toEqual([22_035, '2026-03-01']);
  });
});
```

(If `emptyDraft`'s purchase rows or the stock item id differ, match the file's own fixtures; the assertions stay.)

- [ ] **Step 2: Run to see them fail** — `cd apps/web && npx vitest run src/lib src/ui/native/approx.test.ts src/features/accounts src/features/transactions/tx-form.test.ts src/features/networth/add-asset.test.ts`.

- [ ] **Step 3: `lib/queries.ts` — `moneyHolders`**

```ts
import { type AccountRow, categoryIdsOfBook, listAccounts, nativeBalances, pocketParentIds, resolveRates } from '@expanses/db';
// …
/**
 * Every money account that can hold money: `isMoneyAccount` minus pocket parents, which only add their pockets up.
 * Every picker of money is built from this. `isMoneyAccount` itself stays as it is — `TransactionsPage` asks it
 * whether an account's history is owner-wide, and a parent's is.
 */
export function moneyHolders(accounts: readonly AccountRow[]): AccountRow[] {
  const parents = pocketParentIds(accounts);
  return accounts.filter((a) => isMoneyAccount(a) && !parents.has(a.id));
}
```

- [ ] **Step 4: Every picker calls it** — replace, exactly:

| File | Was | Becomes |
|---|---|---|
| `TransactionCard.tsx:43` | `accounts.filter((a) => isMoneyAccount(a) && (!spendableOnly || canPayWith(a, keep)))` | `moneyHolders(accounts).filter((a) => !spendableOnly || canPayWith(a, keep))` |
| `TransactionCard.tsx:129` | `accounts.filter(isMoneyAccount)` | `moneyHolders(accounts)` |
| `EditSheet.tsx:89` | `accounts.filter((a) => isMoneyAccount(a) && canPayWith(a, draft.moneyId))` | `moneyHolders(accounts).filter((a) => canPayWith(a, draft.moneyId))` |
| `QuickRowEditor.tsx:31` | `accounts.filter(isMoneyAccount)` | `moneyHolders(accounts)` |
| `TransactionsPage.tsx:264` | `accounts.filter(isMoneyAccount)` | `moneyHolders(accounts)` |
| `ReviewPage.tsx:32` | `accounts.filter((a) => isMoneyAccount(a) && canPayWith(a))` | `moneyHolders(accounts).filter((a) => canPayWith(a))` |
| `EventDetailPage.tsx:95` | same as ReviewPage | same |
| `ImportPage.tsx:46` | `all.filter(isMoneyAccount)` | `moneyHolders(all)` |
| `GoalForm.tsx:64` | `(accounts.data ?? []).filter((account) => isMoneyAccount(account) && SPENDABLE_SUBTYPES.includes(account.subtype))` | `moneyHolders(accounts.data ?? []).filter((account) => SPENDABLE_SUBTYPES.includes(account.subtype))` |
| `CardHero.tsx:49` | `accounts.filter((a) => isMoneyAccount(a) && SPENDABLE_SUBTYPES.includes(a.subtype) && a.currency === currency)` | `moneyHolders(accounts).filter((a) => SPENDABLE_SUBTYPES.includes(a.subtype) && a.currency === currency)` |
| `StatementPanel.tsx:56` | `accounts.filter((a) => isMoneyAccount(a) && canPayWith(a) && a.kind === 'asset' && a.currency === card.currency)` | `moneyHolders(accounts).filter((a) => canPayWith(a) && a.kind === 'asset' && a.currency === card.currency)` |

These pickers do not go through `isMoneyAccount` but offer a parent all the same (it is an active savings/current/fund account). Each becomes `moneyHolders(<list>).filter(<the same subtype test, without the archivedAt test>)` — `moneyHolders` already drops archived rows and every one of these subtypes is an asset or liability:

| File | Was |
|---|---|
| `LoanDetailPage.tsx:71` and `:215` | `accounts.filter((account) => SPENDABLE_SUBTYPES.includes(account.subtype) && account.archivedAt === null)` |
| `DebtForm.tsx:34` | `accounts.filter((account) => WALLET_SUBTYPES.includes(account.subtype) && account.archivedAt === null)` |
| `PersonCard.tsx:102` | `accounts.filter((account) => SPENDABLE_SUBTYPES.includes(account.subtype) && account.archivedAt === null)` |
| `BusinessSection.tsx:41` | the same `SPENDABLE_SUBTYPES` filter |
| `BillFormPage.tsx:48` | `(accounts.data ?? []).filter((account) => WALLET_SUBTYPES.includes(account.subtype) && account.archivedAt === null)` |
| `PaySheet.tsx:40` | `accounts.filter((account) => WALLET_SUBTYPES.includes(account.subtype) && account.archivedAt === null)` |
| `TradesPage.tsx:41` | `(accounts.data ?? []).filter((account) => SPENDABLE_SUBTYPES.includes(account.subtype) && account.archivedAt === null)` |
| `CardsPage.tsx:47` | `all.filter((a) => a.archivedAt === null && ['bank', 'savings'].includes(a.subtype) && !earning.has(a.id))` — a parent is no bank account a debit card could sit on |

Four of these (`LoanDetailPage`, `DebtForm`, `PersonCard`, `PaySheet`) are also edited by `feat/set-aside`; keep the swap to one expression so the merge is a re-apply (Global Constraints).

Update each file's import; drop `isMoneyAccount` from an import only where no other use remains (`TransactionsPage.tsx:227` keeps it). A parent's currency is the base currency, so without this CardHero and StatementPanel would offer it to pay an IDR card. Do **not** change `DashboardPage`, `BackupBanner`, `networth/queries.ts`: they count or list currencies, and a parent's zero balance changes nothing there. Before committing, `grep -rn "archivedAt === null" apps/web/src/features | grep -E "SPENDABLE|WALLET|'bank'"` must print nothing — a picker left out is a place a parent can be chosen, and only the ledger's refusal would catch it.

- [ ] **Step 5: `lib/rates.ts` — `openingRateFor`, and both old copies call it**

```ts
import { parseRate } from '@expanses/core';
import { type Database, findRate, upsertRate, type WorkspaceContext } from '@expanses/db';

/**
 * The rate an opening balance is posted at: typed (checked, stored as a manual rate for the opening date) or, left
 * blank, resolved for the opening date — stopping, with the currency named, only when none can be found. Nothing
 * for the base currency or an empty balance. One implementation for every form that opens money.
 */
export async function openingRateFor({
  database,
  ws,
  currency,
  openedOn,
  openingBalanceMinor,
  typed,
  resolveRates,
}: {
  database: Database;
  ws: WorkspaceContext;
  currency: string;
  openedOn: string;
  openingBalanceMinor: number;
  typed: string;
  resolveRates: (currencies: string[], onDate: string) => Promise<{ rates: Record<string, number> }>;
}): Promise<number | undefined> {
  if (currency === ws.baseCurrency || openingBalanceMinor === 0) return undefined;
  if (typed.trim()) {
    const rate = parseRate(typed);
    await checkManualRate(database, currency, ws.baseCurrency, openedOn, rate);
    await upsertRate(database, { fromCurrency: currency, toCurrency: ws.baseCurrency, onDate: openedOn, rate, source: 'manual', sourceDate: openedOn });
    return rate;
  }
  const rate = (await resolveRates([currency], openedOn)).rates[currency];
  if (rate === undefined) throw new Error(`No ${currency}→${ws.baseCurrency} rate available. Enter it manually.`);
  return rate;
}
```

In `CashAccountForm.tsx` and `AccountsPage.tsx`'s `AddAccountForm`, the whole `let openingRateToBase … if (foreign && openingBalanceMinor !== 0) { … }` block becomes:

```ts
      const openingRateToBase = await openingRateFor({ database, ws, currency, openedOn, openingBalanceMinor, typed: manualRate, resolveRates });
```

and their now-unused imports (`parseRate` in AccountsPage only if unused, `upsertRate`, `checkManualRate`) are removed. `CashAccountForm` still uses `parseRate` for the interest rate — keep it there.

- [ ] **Step 5b: Add asset calls `openingRateFor` too — its own rate reader goes**

`add-asset.ts:156-158` reads a typed rate with `Number(typed.replace(/\./g, '').replace(',', '.'))` — `16.500` becomes 16500 where `parseRate` (and every other form) reads 16,5 — and a blank foreign rate posts with no rate, which `planPosting` refuses. Both go by routing it through the one function:

- `planNewAsset` stops reading the rate. `NewAssetPlan` loses `openingRateToBase` and gains `rateNeededMinor: number` (the sum of the purchases' `grossMinor` when there are purchases, else the opening balance — the figure that will post in the asset's currency; 0 when nothing posts) and `rateDate: string` (the earliest purchase date, else `openedOn`). Delete lines 156-158.
- `AddAssetForm.submit`, right after `planNewAsset`:

  ```ts
  // One rate for the whole opening, as before: typed (parseRate, checked, stored for that day) or resolved for the day.
  const openingRateToBase = await openingRateFor({ database, ws, currency: plan.account.currency, openedOn: plan.rateDate, openingBalanceMinor: plan.rateNeededMinor, typed: draft.openingRate, resolveRates });
  ```

  and every `plan.openingRateToBase` below it reads `openingRateToBase`. Add `const resolveRates = useResolveRates();` and the imports.
- The Rate row's hint gains the preview every other rate row has: `hint={ratePreview(draft.openingRate, draft.currency, ws.baseCurrency) ?? '<today's sentence>'}`, so `16.500` visibly reads as 16,5 before it is saved; its placeholder `16000` stays.

No new behaviour beyond the two bugs: one rate for all purchases is what the form already did.

- [ ] **Step 6: `tx-form.ts` — `receivedField`, read by the screen and the save**

Widen the union: `which: 'amount' | 'charged' | 'received';`. Add after `postingCurrency`:

```ts
/**
 * A transfer's second figure — what arrived in the To account — with its label and the currency it is read in:
 * always the To account's. Null unless this is a transfer between two different currencies.
 *
 * Decided once, beside `amountFields`, for the same reason: the Transfer tab's Received row, the Move between
 * pockets screen and `transferPostingLines` all read this record, so the figure a screen draws and the figure the
 * ledger moves cannot be read at two different scales.
 */
export function receivedField(draft: FormDraft, accounts: readonly AccountRow[]): MoneyFieldSpec | null {
  if (draft.mode !== 'transfer') return null;
  const from = accountOf(draft, accounts);
  const to = accounts.find((a) => a.id === draft.toId);
  if (!from?.currency || !to?.currency || from.currency === to.currency) return null;
  return { which: 'received', label: `Received amount (${to.currency})`, value: draft.toAmount, currency: to.currency };
}
```

`transferPostingLines`'s `toAmountMinor` line becomes:

```ts
  // Non-null: both accounts have a currency and they differ, which is exactly when `receivedField` answers.
  const received = receivedField(draft, accounts)!;
  return exchangeLines({
    // … unchanged …
    toAmountMinor: positive(received.value, received.currency, 'Received amount'),
    toCurrency: received.currency,
    // …
  });
```

and the goal branch's `toAmountMinor:` becomes:

```ts
          toAmountMinor: (() => {
            const received = receivedField(draft, accounts);
            return received ? positive(received.value, received.currency, 'Received amount') : null;
          })(),
```

`AmountRow` is untouched: its keypad only ever opens `fields.amount` or `fields.charged`.

- [ ] **Step 7: `TransactionCard.tsx` — the Received row reads the record**

Replace `const crossCurrency = draft.mode === 'transfer' && !!account && !!toAccount && account.currency !== toAccount.currency;` with:

```ts
  const received = receivedField(draft, accounts);
  const crossCurrency = received !== null;
```

and the `InputRow` with:

```tsx
              {received && (
                <InputRow label={received.label} value={received.value} onChange={(e) => set({ toAmount: e.target.value })} inputMode="decimal" required />
              )}
```

The label text is unchanged (`Received amount (USD)`), so `add-transaction.spec.ts` keeps passing unchanged.

- [ ] **Step 8: `features/accounts/pockets.ts` — the model**

```ts
import { CURRENCIES, currencyInfo, evaluateAmount, exchangeCost, type ExchangeCost, formatMinor, impliedRate, isoDate, parseMajor, sumToBase } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { amountFields, emptyForm, type FormDraft, type MoneyFieldSpec, receivedField } from '../transactions/tx-form';

type Rates = Readonly<Record<string, number>>;

/**
 * An account's open pockets, in the order they were added: sort_order, then id. Not id alone — pockets opened
 * together share a millisecond, and uuidv7 here has no counter to order them within it.
 */
export const pocketsOf = (parentId: string, accounts: readonly AccountRow[]): AccountRow[] =>
  accounts
    .filter((a) => a.parentId === parentId && a.kind === 'asset' && a.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** The parent's figure: its pockets added up in the base currency, or none, naming what is missing. */
export function parentTotal(pockets: readonly AccountRow[], balances: Readonly<Record<string, number>>, baseCurrency: string, ratesToBase: Rates) {
  return sumToBase({ amounts: pockets.map((p) => ({ minor: balances[p.id] ?? 0, currency: p.currency! })), baseCurrency, ratesToBase });
}

export interface PocketDraft {
  currency: string;
  balance: string;
  rate: string;
}

/**
 * Each opening balance read by `parseMajor` in its own pocket's currency — the reader the account forms use. How
 * many pockets and whether one repeats is the repository's rule (`openPocketedAccount`), not restated here.
 */
export function readPockets(rows: readonly PocketDraft[]): { currency: string; openingBalanceMinor: number; typedRate: string }[] {
  return rows.map((row) => ({ currency: row.currency, openingBalanceMinor: row.balance.trim() ? parseMajor(row.balance, row.currency) : 0, typedRate: row.rate }));
}

export const nextPocketCurrency = (rows: readonly PocketDraft[]): string => CURRENCIES.find((c) => !rows.some((row) => row.currency === c.code))?.code ?? CURRENCIES[0]!.code;

/** An ordinary transfer draft: the Move screen saves through `formToPost` like the Transfer tab. */
export const moveDraft = (bookId: string, from: AccountRow, to: AccountRow, today: string = isoDate()): FormDraft => ({
  ...emptyForm(bookId, today),
  mode: 'transfer',
  moneyId: from.id,
  toId: to.id,
});

/**
 * A new From or To. Both figures were typed in the old pockets' currencies, so both are cleared; choosing the pocket
 * already on the other side swaps the two rather than moving money into itself.
 */
export function withPockets(draft: FormDraft, patch: { moneyId?: string; toId?: string }): FormDraft {
  let moneyId = patch.moneyId ?? draft.moneyId;
  let toId = patch.toId ?? draft.toId;
  if (moneyId === toId) {
    if (patch.moneyId !== undefined) toId = draft.moneyId;
    else moneyId = draft.toId;
  }
  return { ...draft, moneyId, toId, amount: '', toAmount: '' };
}

export interface MoveView {
  leaves: MoneyFieldSpec;
  arrives: MoneyFieldSpec | null;
  bankRate: number | null;
  cost: ExchangeCost | null;
}

/** What the Move screen draws — every figure from the kit's own field records, read by `evaluateAmount`. */
export function moveView(draft: FormDraft, accounts: readonly AccountRow[], baseCurrency: string, ratesToBase: Rates): MoveView {
  const leaves = amountFields(draft, accounts, baseCurrency).amount;
  const arrives = receivedField(draft, accounts);
  const out = evaluateAmount(leaves.value, leaves.currency);
  const into = arrives ? evaluateAmount(arrives.value, arrives.currency) : null;
  if (!arrives || out === null || into === null) return { leaves, arrives, bankRate: null, cost: null };
  const legs = { fromMinor: out, fromCurrency: leaves.currency, toMinor: into, toCurrency: arrives.currency };
  return { leaves, arrives, bankRate: impliedRate(legs), cost: exchangeCost({ ...legs, baseCurrency, ratesToBase }) };
}

export const bankRateText = (rate: number | null, from: string, to: string, locale = 'id-ID') =>
  rate === null ? '—' : `1 ${from} = ${rate.toLocaleString(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${to}`;

/** The spread in words. The sign picks the words; the figure is the cost, negated once when it is a gain. */
export function spreadLine(cost: ExchangeCost | null, baseCurrency: string): { title: string; figure: string } | null {
  if (!cost) return null;
  if (cost.costMinor === 0) return { title: 'The bank’s rate matched the day’s rate', figure: formatMinor(0, baseCurrency) };
  if (cost.costMinor > 0) return { title: 'The bank’s rate cost you', figure: formatMinor(cost.costMinor, baseCurrency) };
  return { title: 'The bank’s rate gained you', figure: formatMinor(-cost.costMinor, baseCurrency) };
}

export const moveDescription = (parent: AccountRow, from: AccountRow, to: AccountRow) => `${parent.name}: ${from.currency} → ${to.currency}`;

export const currencyName = (code: string) => currencyInfo(code).name;
```

- [ ] **Step 8b: The shared parts, in the kit**

`apps/web/src/ui/native/approx.ts` — pure, no pocket words, so securities calls it unchanged:

```ts
import { convertMinor, formatMinor } from '@expanses/core';

type Rates = Readonly<Record<string, number>>;

/** The line under a foreign figure: it converted at the held rate, marked ≈. Null in the base currency. */
export function approxLine(minor: number, currency: string, baseCurrency: string, ratesToBase: Rates): string | null {
  if (currency === baseCurrency) return null;
  const rate = ratesToBase[currency];
  if (rate === undefined || !(rate > 0)) return `No ${currency} rate yet`;
  return `≈ ${formatMinor(convertMinor(minor, currency, baseCurrency, rate), baseCurrency)}`;
}

/** "16.250 IDR per 1 USD" — the wording `chargedHint` already uses for a rate. */
export const rateLine = (rate: number, currency: string, baseCurrency: string, locale = 'id-ID') =>
  `${rate.toLocaleString(locale, { maximumFractionDigits: 4 })} ${baseCurrency} per 1 ${currency}`;

/**
 * A grouped row's figure — a parent that adds its children up and holds nothing itself. The total when every rate
 * is held, else the missing rates named: never the sum of the rest (`sumToBase` already refused it).
 */
export function groupedFigure(total: { totalMinor: number | null; missing: readonly string[] }, baseCurrency: string): { text: string; complete: boolean } {
  if (total.totalMinor === null) return { text: `No ${total.missing.join(', ')} rate yet`, complete: false };
  return { text: `≈ ${formatMinor(total.totalMinor, baseCurrency)}`, complete: true };
}
```

`apps/web/src/ui/native/Grouped.tsx` — built from `InsetRow` and `Figure`, tokens only:

```tsx
import type { ReactNode } from 'react';
import { type GroupChild, InsetRow, type InsetRowProps } from './InsetList';
import { Figure } from './RecordTable';

/** R1: the figure in its own currency, leading; the ≈ line beneath it (nothing beneath in the base currency). */
export function ApproxFigure({ figure, beneath }: { figure: ReactNode; beneath: string | null }) {
  return (
    <span className="block text-right">
      <Figure>{figure}</Figure>
      {beneath && <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{beneath}</span>}
    </span>
  );
}

/**
 * A parent that sums its children and holds nothing itself: one row, its ≈ total (or the missing rate named, in
 * the warning tone), opening to wherever its children are listed. Pockets use it now; securities after them.
 */
export function GroupedRow({
  figure,
  ...row
}: GroupChild & Omit<InsetRowProps, 'value' | 'valueTone'> & { figure: { text: string; complete: boolean } }) {
  return <InsetRow {...row} value={<Figure tone={figure.complete ? 'ink' : 'warn'}>{figure.text}</Figure>} valueTone={figure.complete ? 'ink' : 'warn'} />;
}
```

If `InsetRowProps` already includes `GroupChild`, drop the intersection. Export from `ui/native/index.ts`: `export { ApproxFigure, GroupedRow } from './Grouped';` and `export { approxLine, groupedFigure, rateLine } from './approx';`.

- [ ] **Step 9: Run** — `cd apps/web && npx vitest run src/lib src/ui/native src/features/accounts src/features/transactions src/features/networth`; then the root gate; then `npx playwright test -c playwright.cu.config.ts 'e2e/(add-transaction|card-statements|goals|coretax-pickers|loans|lend-borrow|recurring-bills|business-income|buy-flow)\.spec\.ts$' --workers=2` (the Received row, card payers, goal accounts, the account forms and every picker swapped in Step 4 moved).
- [ ] **Step 10: Commit** — `feat(web): one list of who can hold money, one opening rate, one reading of a transfer's second figure`

---

### Task 5: Opening an account with pockets, the Accounts row, the account page and the pocket page

**Files:**
- Modify: `apps/web/src/features/ownables/CashAccountForm.tsx`, `apps/web/src/features/accounts/AccountsPage.tsx`, `apps/web/src/features/networth/AssetDetailPage.tsx`, `apps/web/src/app/router.tsx`
- Create: `apps/web/src/features/accounts/queries.ts`, `apps/web/src/features/accounts/PocketsPage.tsx`, `apps/web/e2e/pockets.ts`, `apps/web/e2e/currency-pockets.spec.ts`

**Interfaces:**
- Consumes: `openPocketedAccount`, `openingsOf`, `pocketParentIds` (db); Task 4's model and `openingRateFor`; `useStoredRates`, `useAccounts`, `useBalances`, `useResolveRates`, `useInvalidateAll`.
- Produces: `useHeldRates(currencies, onDate?)`, `useOpenings(accountIds)`; route `/accounts/$accountId`; e2e helpers `openWithPockets(page, …)`, `mockRates(page, rates)`.

The pocket rows use the kit's `ApproxFigure` (Task 4 Step 8b); the Accounts page's parent row stays a `RecordTable` record (it carries Rename and Archive) and takes its figure from `groupedFigure`. Nothing here waits for securities.

- [ ] **Step 1: Write the failing e2e**

```ts
// apps/web/e2e/pockets.ts
import { expect, type Page } from '@playwright/test';

/** Frankfurter answers only for the codes given, at the rates given; everything else fails, as offline would. */
export async function mockRates(page: Page, rates: Record<string, number>) {
  await page.route('https://api.frankfurter.dev/**', (route) => {
    const url = new URL(route.request().url());
    const base = url.searchParams.get('base') ?? '';
    const rate = rates[base];
    if (rate === undefined) return route.abort();
    return route.fulfill({ json: [{ date: url.searchParams.get('date'), base, quote: url.searchParams.get('quotes'), rate }] });
  });
}

/** Opens an account with pockets through Add account, typing every figure one key at a time. */
export async function openWithPockets(
  page: Page,
  account: { name: string; kind?: string; bank?: string; pockets: { currency: string; balance: string; rate?: string }[] },
) {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: account.kind ?? 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially(account.name);
  if (account.bank) await page.getByLabel('Bank', { exact: true }).pressSequentially(account.bank);
  await page.getByLabel('Holds more than one currency').check();
  for (let i = 2; i < account.pockets.length; i += 1) await page.getByRole('button', { name: 'Add another currency' }).click();
  for (const [i, pocket] of account.pockets.entries()) {
    await page.getByLabel(`Pocket ${i + 1}`, { exact: true }).selectOption(pocket.currency);
    await page.getByLabel(`Opening ${pocket.currency}`, { exact: true }).pressSequentially(pocket.balance);
    if (pocket.rate) await page.getByLabel(new RegExp(`^Rate: \\w+ per 1 ${pocket.currency}$`)).pressSequentially(pocket.rate);
  }
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: account.name, exact: true })).toBeVisible();
}
```

```ts
// apps/web/e2e/currency-pockets.spec.ts
import { expect, test } from '@playwright/test';
import { mockRates, openWithPockets } from './pockets';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const VALAS = {
  name: 'Valas Plus',
  bank: 'Bank One',
  pockets: [
    { currency: 'USD', balance: '2400.00', rate: '16250' },
    { currency: 'SGD', balance: '1150.00' }, // blank: resolved from the (mocked) daily rate
    { currency: 'IDR', balance: '5400000' },
  ],
};

test('an account with pockets is one row that adds them up, and opens to each pocket', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);

  // P1: one row, the converted total, no pocket rows of their own.
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Valas Plus', exact: true }) });
  await expect(row).toContainText('3 pockets');
  await expect(row).toContainText('58.982.000');
  await expect(page.getByRole('link', { name: 'Valas Plus · USD' })).toHaveCount(0);

  await row.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await expect(page.getByTestId('pocket-USD')).toContainText('2.400,00');
  await expect(page.getByTestId('pocket-USD')).toContainText('39.000.000');
  await expect(page.getByTestId('pocket-SGD')).toContainText('14.582.000');
  // Nothing converted beneath the base-currency pocket.
  await expect(page.getByTestId('pocket-IDR')).not.toContainText('≈');

  // A pocket is an ordinary account page: its code, the rate it opened at, and back to its account.
  await page.getByTestId('pocket-USD').click();
  await expect(page.getByText('Opened at 16.250 IDR per 1 USD')).toBeVisible();
  await expect(page.getByText(/0102/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Valas Plus' }).first().click();
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
});

test('a single-currency account is exactly what it was', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Dollar Saver');
  await page.getByLabel('Balance now').pressSequentially('1800.00');
  await page.getByLabel('Currency').selectOption('USD');
  await page.getByLabel(/^Rate: IDR per 1 USD$/).pressSequentially('15720');
  await page.getByRole('button', { name: 'Add account' }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Dollar Saver', exact: true }) });
  await expect(row).toContainText('1.800,00');
  await expect(row).not.toContainText('pockets');
});
```

- [ ] **Step 2: Run to see it fail** — `cd apps/web && npx playwright test -c playwright.cu.config.ts 'e2e/currency-pockets\.spec\.ts$' --project=chromium`.

- [ ] **Step 3: `features/accounts/queries.ts`**

```ts
import { isoDate } from '@expanses/core';
import { openingsOf } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { useStoredRates } from '../../lib/queries';

/** Rates this device already holds for a day — never fetched just because a screen opened (see `useStoredRates`). */
export function useHeldRates(currencies: readonly string[], onDate: string = isoDate()) {
  const { ws } = useApp();
  const stored = useStoredRates();
  const codes = [...new Set(currencies)].filter((code) => code && code !== ws.baseCurrency).sort();
  return useQuery({ queryKey: ['held-rates', ws.workspaceId, onDate, codes.join(',')], queryFn: () => stored(codes, onDate) });
}

export function useOpenings(accountIds: readonly string[]) {
  const { database, ws } = useApp();
  const ids = [...accountIds].sort();
  return useQuery({ queryKey: ['openings', ws.workspaceId, ids.join(',')], queryFn: () => openingsOf(database, ws, ids) });
}
```

- [ ] **Step 4: `CashAccountForm.tsx` — the switch and the pockets group**

State and derived values, beside the existing ones:

```ts
  const [pocketed, setPocketed] = useState(false);
  const [pockets, setPockets] = useState<PocketDraft[]>([]);
  // The kinds held at an institution, and not a deposit: its terms are per deposit (spec §16.3).
  const canPocket = asks.includes('bank') && !locked;
  const setPocket = (i: number, patch: Partial<PocketDraft>) => setPockets((rows) => rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));
```

In `submit`, before today's single-account path:

```ts
      if (pocketed) {
        const read = readPockets(pockets);
        const settled = [];
        // Every rate is settled before anything is written, so the one transaction below is all or nothing.
        for (const pocket of read) {
          settled.push({
            currency: pocket.currency,
            openingBalanceMinor: pocket.openingBalanceMinor,
            openingRateToBase: await openingRateFor({ database, ws, currency: pocket.currency, openedOn, openingBalanceMinor: pocket.openingBalanceMinor, typed: pocket.typedRate, resolveRates }),
          });
        }
        await openPocketedAccount(database, ws, { item, name, bank: bank.trim() || undefined, openedOn, pockets: settled });
        await invalidate();
        await navigate({ to: '/accounts' });
        return;
      }
```

In the first `InsetGroup`, after the Bank row:

```tsx
        {canPocket && (
          <SwitchRow
            label="Holds more than one currency"
            hint="Off for an account that holds one currency. On for one that keeps several currencies inside it."
            checked={pocketed}
            onChange={(on) => {
              setPocketed(on);
              if (on && pockets.length === 0) {
                const first = { currency: ws.baseCurrency, balance: '', rate: '' };
                setPockets([first, { currency: nextPocketCurrency([first]), balance: '', rate: '' }]);
              }
            }}
          />
        )}
```

Put `!pocketed &&` on each of today's Balance now, Currency and Rate rows **separately** — `{asks.includes('balance') && !pocketed && (<TextRow …/>)}` and so on — never one `<>…</>` around the three: `InsetGroup` reads its children with `Children.toArray` and `cloneElement`s each with its `position`, which does not look inside a fragment, so the three rows would lose their separators and React would warn about `position` on a Fragment. After the group, when `pocketed` (a flat array of rows, for the same reason):

```tsx
      {pocketed && (
        <InsetGroup header="Pockets" footer="Leave a rate blank and the rate for the opening date is used. Fill it in only when you want your own figure.">
          {pockets.flatMap((pocket, i) => [
            <SelectRow key={`c${i}`} label={`Pocket ${i + 1}`} value={pocket.currency} onChange={(e) => setPocket(i, { currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </SelectRow>,
            <TextRow key={`b${i}`} label={`Opening ${pocket.currency}`} value={pocket.balance} onChange={(e) => setPocket(i, { balance: e.target.value })} inputMode="decimal" placeholder="0" />,
            ...(pocket.currency !== ws.baseCurrency
              ? [
                  <TextRow
                    key={`r${i}`}
                    label={`Rate: ${ws.baseCurrency} per 1 ${pocket.currency}`}
                    hint={ratePreview(pocket.rate, pocket.currency, ws.baseCurrency) ?? 'Optional.'}
                    value={pocket.rate}
                    onChange={(e) => setPocket(i, { rate: e.target.value })}
                    inputMode="decimal"
                  />,
                ]
              : []),
          ])}
          <InsetRow title="Add another currency" onClick={() => setPockets((rows) => [...rows, { currency: nextPocketCurrency(rows), balance: '', rate: '' }])} />
          {pockets.length > 2 && <InsetRow title="Remove the last pocket" onClick={() => setPockets((rows) => rows.slice(0, -1))} />}
        </InsetGroup>
      )}
```

Imports: `SwitchRow` from the kit; `openPocketedAccount` from db; `openingRateFor` from lib/rates; `nextPocketCurrency`, `readPockets`, `type PocketDraft` from `../accounts/pockets`.

- [ ] **Step 5: `PocketsPage.tsx` — `/accounts/$accountId`**

```tsx
import { SPENDABLE_SUBTYPES } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { useAccounts, useBalances } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { ApproxFigure, approxLine, Hero, InsetGroup, InsetRow, LargeTitle, rateLine, SCREEN } from '../../ui/native';
import { currencyName, parentTotal, pocketsOf } from './pockets';
import { useHeldRates, useOpenings } from './queries';

/** An account with pockets: what it adds up to, each pocket in its own currency, and the ways to move or add one. */
export function PocketsPage() {
  const { ws } = useApp();
  const { accountId = '' } = useParams({ strict: false }) as { accountId?: string };
  const accounts = useAccounts();
  const balances = useBalances();
  const all = accounts.data ?? [];
  const parent = all.find((a) => a.id === accountId);
  const pockets = pocketsOf(accountId, all);
  const rates = useHeldRates(pockets.map((p) => p.currency!));
  const openings = useOpenings(pockets.map((p) => p.id));
  const held = rates.data?.rates ?? {};
  const stale = new Set(rates.data?.stale ?? []);

  if (accounts.isSuccess && !parent) return <div className={SCREEN}><LargeTitle title="Account" back="Accounts" backTo="/accounts" /><Empty>That account is not in this workspace.</Empty></div>;
  if (!parent) return <div className={SCREEN}>Loading…</div>;

  const total = parentTotal(pockets, balances.data ?? {}, ws.baseCurrency, held);
  const foreign = pockets.filter((p) => p.currency !== ws.baseCurrency && held[p.currency!] !== undefined);
  const spendable = SPENDABLE_SUBTYPES.includes(parent.subtype);

  return (
    <div className={SCREEN}>
      <LargeTitle title={parent.name} back="Accounts" backTo="/accounts" />
      <ErrorBox error={accounts.error ?? balances.error ?? rates.error} />
      {total.totalMinor !== null ? (
        <Hero
          minor={total.totalMinor}
          currency={ws.baseCurrency}
          caption={
            <>
              {foreign.length > 0 && `≈ at ${foreign.map((p) => `${rateLine(held[p.currency!]!, p.currency!, ws.baseCurrency)}${stale.has(p.currency!) ? ' (last known)' : ''}`).join(' · ')}`}
              <span className="mt-[2px] block">
                {pockets.length} pockets · {spendable ? 'can be spent from' : 'cannot be spent from directly'}
              </span>
            </>
          }
        />
      ) : (
        <Empty>No {total.missing.join(', ')} rate yet, so the pockets cannot be added up. Each balance below is exact.</Empty>
      )}
      <InsetGroup header="Pockets" footer="Each pocket keeps its own balance in its own currency. The account only adds them up.">
        {pockets.map((pocket) => {
          const minor = balances.data?.[pocket.id] ?? 0;
          const beneath = approxLine(minor, pocket.currency!, ws.baseCurrency, held);
          const opened = openings.data?.[pocket.id];
          return (
            <InsetRow
              key={pocket.id}
              testId={`pocket-${pocket.currency}`}
              title={currencyName(pocket.currency!)}
              subtitle={opened ? `Opened ${opened.occurredOn}` : undefined}
              value={<ApproxFigure figure={<Money minor={minor} currency={pocket.currency!} />} beneath={beneath} />}
              valueTone="ink"
              to="/net-worth/assets/$accountId"
              params={{ accountId: pocket.id }}
            />
          );
        })}
      </InsetGroup>
      <InsetGroup>
        {pockets.length >= 2 && <InsetRow title="Move between pockets" subtitle="At the bank's rate" to="/accounts/$accountId/move" params={{ accountId }} />}
        <InsetRow title="Add a pocket" subtitle="Another currency this account holds" to="/accounts/$accountId/pocket" params={{ accountId }} />
        <InsetRow title="See their transactions" to="/transactions" search={{ account: accountId }} />
      </InsetGroup>
    </div>
  );
}
```

The two `to=` routes to `/move` and `/pocket` are registered in Tasks 6 and 7; register them now in `router.tsx` pointing at a placeholder `() => null` **only if** the router's types refuse an unregistered path, and replace them in those tasks.

Router: import `PocketsPage` and add, after `/accounts`:

```ts
  createRoute({ getParentRoute: () => rootRoute, path: '/accounts/$accountId', component: PocketsPage }),
```

- [ ] **Step 6: `AccountsPage.tsx` — P1**

In `AccountsPage`, pass the whole list and the rates:

```tsx
  const everything = accounts.data ?? [];
  const parents = pocketParentIds(everything);
  const pocketCurrencies = everything.filter((a) => a.parentId && a.kind === 'asset' && a.archivedAt === null).map((a) => a.currency!);
  const rates = useHeldRates(pocketCurrencies);
  // …
      <AccountList title="Money" accounts={money.filter((a) => a.kind === 'asset' && a.parentId === null)} balances={all} everything={everything} parents={parents} rates={rates.data?.rates ?? {}} />
      <AccountList title="Credit cards & debts" accounts={money.filter((a) => a.kind === 'liability')} balances={all} everything={everything} parents={parents} rates={rates.data?.rates ?? {}} />
```

`AccountList` takes `everything: AccountRow[]; parents: Set<string>; rates: Record<string, number>` and, inside, a helper and branches in the existing cells (desktop keeps all five columns):

```tsx
  const { ws } = useApp(); // already destructured with database
  // The kit's grouped figure: the ≈ total, or the missing rate named — never a partial sum.
  const totalText = (account: AccountRow) => groupedFigure(parentTotal(pocketsOf(account.id, everything), balances, ws.baseCurrency, rates), ws.baseCurrency).text;
  const kindLine = (account: AccountRow) =>
    parents.has(account.id) ? `${SUBTYPE_LABELS[account.subtype]} · ${pocketsOf(account.id, everything).length} pockets` : `${SUBTYPE_LABELS[account.subtype]} · ${account.currency}`;
```

- `shape.subtitle` → `kindLine(account)`; `shape.value` → parents: `<Figure>{totalText(account)}</Figure>`, else today's.
- `name` cell: parents link `to="/accounts/$accountId" params={{ accountId: account.id }}` instead of `/transactions`; the second line is `kindLine(account)` (plus deposit terms as today for non-parents).
- `filed` cell: parents → `<span className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Each pocket files its own row</span>`.
- `balance` cell: parents → `<Figure>{totalText(account)}</Figure>`.
- `points`, `actions`: unchanged (Rename carries to pockets in the repository; Archive's refusal arrives through the existing `window.alert(errorMessage(e))`).

Imports: `groupedFigure` (kit), `pocketParentIds` (db), `parentTotal`, `pocketsOf` (./pockets), `useHeldRates` (./queries).

- [ ] **Step 7: `AssetDetailPage.tsx` — ≈, Opened at, back to the account**

```tsx
  // `ws` is already destructured here (AssetDetailPage.tsx:23). The hooks below go beside the existing ones, before
  // any early return. Imports: `approxLine`, `rateLine` (kit); `useHeldRates`, `useOpenings` (../accounts/queries).
  const parent = account?.parentId ? (accounts.data ?? []).find((row) => row.id === account.parentId) : undefined;
  const foreignMoney = value?.mode === 'derived' && value.currency !== ws.baseCurrency;
  const held = useHeldRates(foreignMoney && value ? [value.currency] : []);
  const openings = useOpenings(foreignMoney ? [accountId] : []);
  const heldRate = value ? held.data?.rates[value.currency] : undefined;
  const opened = openings.data?.[accountId];
```

`LargeTitle`: `back={parent?.name ?? 'All assets'} backTo={parent ? '/accounts/$accountId' : '/net-worth/assets'} backParams={parent ? { accountId: parent.id } : undefined}`.

Inside the hero caption's `<span className="mt-[2px] block">`, before `{METHOD_LABELS[value.mode]}`, add two blocks:

```tsx
                {foreignMoney && (
                  <span className="block">
                    {approxLine(value.valueMinor, value.currency, ws.baseCurrency, held.data?.rates ?? {})}
                    {heldRate !== undefined && ` · at ${rateLine(heldRate, value.currency, ws.baseCurrency)}`}
                  </span>
                )}
                {foreignMoney && opened && <span className="block">Opened at {rateLine(opened.fxRateToBase, value.currency, ws.baseCurrency)}</span>}
```

- [ ] **Step 8: Run** — `cd apps/web && npx playwright test -c playwright.cu.config.ts 'e2e/(currency-pockets|coretax-pickers|account-types|assets)\.spec\.ts$' --workers=2`; `grep -nE "#[0-9a-fA-F]{3,6}|slate-|bg-white" apps/web/src/features/accounts/PocketsPage.tsx apps/web/src/ui/native/Grouped.tsx` must print nothing; root gate.
- [ ] **Step 9: Commit** — `feat(accounts): an account with pockets is one row that adds them up and opens to each`

---

### Task 6: Add a pocket

**Files:**
- Create: `apps/web/src/features/accounts/AddPocketPage.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/e2e/currency-pockets.spec.ts`

**Interfaces:**
- Consumes: `addPocket` (Task 2), `openingRateFor`, `pocketsOf`.
- Produces: route `/accounts/$accountId/pocket`.

- [ ] **Step 1: Append the failing e2e**

```ts
test('a pocket can be added, in a currency with no decimals, at a typed rate', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await page.getByRole('link', { name: /Add a pocket/ }).click();
  // Currencies it already has are not offered.
  await expect(page.getByLabel('Currency').locator('option[value="USD"]')).toHaveCount(0);
  await page.getByLabel('Currency').selectOption('JPY');
  await page.getByLabel('Opening JPY').pressSequentially('30000');
  await page.getByLabel('Rate: IDR per 1 JPY').pressSequentially('108,3');
  await page.getByRole('button', { name: 'Add pocket' }).click();
  // ¥30.000, not ¥300: JPY has no decimals.
  await expect(page.getByTestId('pocket-JPY')).toContainText('30.000');
  await expect(page.getByTestId('pocket-JPY')).toContainText('3.249.000');
});
```

- [ ] **Step 2: Implement**

```tsx
// apps/web/src/features/accounts/AddPocketPage.tsx
import { CURRENCIES, isoDate, parseMajor } from '@expanses/core';
import { addPocket } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { openingRateFor, ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { pocketsOf } from './pockets';

export function AddPocketPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const { accountId = '' } = useParams({ strict: false }) as { accountId?: string };
  const accounts = useAccounts().data ?? [];
  const parent = accounts.find((a) => a.id === accountId);
  const taken = new Set(pocketsOf(accountId, accounts).map((p) => p.currency));
  const offered = CURRENCIES.filter((c) => !taken.has(c.code));
  const [currency, setCurrency] = useState('');
  const [balance, setBalance] = useState('');
  const [openedOn, setOpenedOn] = useState(isoDate());
  const [rate, setRate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const code = currency || offered[0]?.code || '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const openingBalanceMinor = balance.trim() ? parseMajor(balance, code) : 0;
      const openingRateToBase = await openingRateFor({ database, ws, currency: code, openedOn, openingBalanceMinor, typed: rate, resolveRates });
      await addPocket(database, ws, { parentId: accountId, currency: code, openingBalanceMinor, openedOn, openingRateToBase });
      await invalidate();
      await navigate({ to: '/accounts/$accountId', params: { accountId } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title="Add a pocket" back={parent?.name ?? 'Account'} backTo="/accounts/$accountId" backParams={{ accountId }} />
      <form ref={form} onSubmit={submit}>
        <ErrorBox error={error} />
        <InsetGroup footer="Leave the rate blank and the rate for the opening date is used.">
          <SelectRow label="Currency" value={code} onChange={(e) => { setCurrency(e.target.value); setRate(''); }}>
            {offered.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </SelectRow>
          <TextRow label={`Opening ${code}`} value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="0" />
          <TextRow label="Balance as of" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
          {code !== ws.baseCurrency && (
            <TextRow
              label={`Rate: ${ws.baseCurrency} per 1 ${code}`}
              hint={ratePreview(rate, code, ws.baseCurrency) ?? 'Optional.'}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
            />
          )}
        </InsetGroup>
        <InsetGroup>
          <InsetRow title="Add pocket" chevron={false} onClick={() => !busy && form.current?.requestSubmit()} className={busy ? 'opacity-40' : undefined} />
        </InsetGroup>
      </form>
    </div>
  );
}
```

Router: `createRoute({ getParentRoute: () => rootRoute, path: '/accounts/$accountId/pocket', component: AddPocketPage })`.

- [ ] **Step 3: Run** — `cd apps/web && npx playwright test -c playwright.cu.config.ts 'e2e/currency-pockets\.spec\.ts$' --workers=2`; root gate.
- [ ] **Step 4: Commit** — `feat(accounts): add a pocket to an account that has them`

---

### Task 7: Move between pockets

**Files:**
- Create: `apps/web/src/features/accounts/MovePage.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/e2e/currency-pockets.spec.ts`

**Interfaces:**
- Consumes: `moveDraft`, `withPockets`, `moveView`, `bankRateText`, `spreadLine`, `moveDescription`, `pocketsOf`, `currencyName` (Task 4); `formToPost`, `settledAmount` (tx-form); `ratesForSave` (tx-save); `postTransaction` (db); `useHeldRates`.
- Produces: route `/accounts/$accountId/move`.

- [ ] **Step 1: Append the failing e2e**

```ts
test('moving between pockets moves what the screen shows and says what the bank’s rate cost', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await page.getByRole('link', { name: /Move between pockets/ }).click();

  // Options are valued by currency code (one open pocket per currency); `selectOption({ label })` takes no RegExp.
  await page.getByLabel('From').selectOption('USD');
  await page.getByLabel('To').selectOption('SGD');
  await page.getByLabel('Leaves USD').pressSequentially('500');
  await page.getByLabel('Arrives SGD').pressSequentially('638');
  await expect(page.getByText('1 USD = 1,2760 SGD')).toBeVisible();
  await expect(page.getByText('The bank’s rate cost you')).toBeVisible();
  await expect(page.getByTestId('spread')).toContainText('35.160');
  await page.getByRole('button', { name: 'Move it' }).click();

  await expect(page.getByTestId('pocket-USD')).toContainText('1.900,00');
  await expect(page.getByTestId('pocket-SGD')).toContainText('1.788,00');
});
```

- [ ] **Step 2: Implement**

```tsx
// apps/web/src/features/accounts/MovePage.tsx
import { formatMinor, isoDate } from '@expanses/core';
import { type AccountRow, postTransaction } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useBalances, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { formToPost, settledAmount } from '../transactions/tx-form';
import { ratesForSave } from '../transactions/tx-save';
import { bankRateText, currencyName, moveDescription, moveDraft, moveView, pocketsOf, spreadLine, withPockets } from './pockets';
import { useHeldRates } from './queries';

export function MovePage() {
  const { accountId = '' } = useParams({ strict: false }) as { accountId?: string };
  const accounts = useAccounts();
  if (!accounts.isSuccess) return <div className={SCREEN}>Loading…</div>;
  const parent = accounts.data.find((a) => a.id === accountId);
  const pockets = pocketsOf(accountId, accounts.data);
  if (!parent || pockets.length < 2) return <div className={SCREEN}><LargeTitle title="Move between pockets" back="Accounts" backTo="/accounts" /><Empty>This account has fewer than two pockets.</Empty></div>;
  return <MoveBody parent={parent} pockets={pockets} accounts={accounts.data} />;
}

/**
 * An ordinary transfer between two pockets. Nothing here reads a figure or builds a line: `moveView` draws from the
 * kit's field records, and the save is the Transfer tab's own `formToPost` → `ratesForSave` → `postTransaction`.
 */
function MoveBody({ parent, pockets, accounts }: { parent: AccountRow; pockets: AccountRow[]; accounts: AccountRow[] }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const balances = useBalances().data ?? {};
  const [draft, setDraft] = useState(() => moveDraft(ws.bookId ?? '', pockets[0]!, pockets[1]!));
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const from = pockets.find((p) => p.id === draft.moneyId)!;
  const to = pockets.find((p) => p.id === draft.toId)!;
  const held = useHeldRates([from.currency!, to.currency!], draft.occurredOn);
  const view = moveView(draft, accounts, ws.baseCurrency, held.data?.rates ?? {});
  const spread = spreadLine(view.cost, ws.baseCurrency);
  const rateDate = draft.occurredOn > isoDate() ? isoDate() : draft.occurredOn;

  const settle = (which: 'amount' | 'toAmount', value: string, currency: string) => {
    const text = settledAmount(value, currency);
    if (text !== null && text !== value) set({ [which]: text });
  };

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const final = { ...draft, description: moveDescription(parent, from, to) };
      const post = formToPost(final, accounts);
      if (post.kind !== 'post') throw new Error('A move between pockets is a plain transfer');
      const ratesToBase = await ratesForSave({ database, ws, draft: final, post, accounts, rateDate, needsRate, resolveRates, onMissing: setNeedsRate, where: 'Rate' });
      await postTransaction(database, ws, { ...post.input, ratesToBase });
      await invalidate();
      await navigate({ to: '/accounts/$accountId', params: { accountId: parent.id } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // Valued by currency code: an account has one open pocket per currency, so the code names the pocket and a test
  // can choose it without knowing an id. `idOf` turns it back into the pocket the draft holds.
  const option = (p: AccountRow) => (
    <option key={p.id} value={p.currency!}>
      {`${currencyName(p.currency!)} · ${formatMinor(balances[p.id] ?? 0, p.currency!)} available`}
    </option>
  );
  const idOf = (code: string) => pockets.find((p) => p.currency === code)!.id;

  return (
    <div className={SCREEN}>
      <LargeTitle title="Move between pockets" back={parent.name} backTo="/accounts/$accountId" backParams={{ accountId: parent.id }} />
      <ErrorBox error={error} />
      <InsetGroup>
        <SelectRow label="From" value={from.currency!} onChange={(e) => setDraft((d) => withPockets(d, { moneyId: idOf(e.target.value) }))}>
          {pockets.map(option)}
        </SelectRow>
        <SelectRow label="To" value={to.currency!} onChange={(e) => setDraft((d) => withPockets(d, { toId: idOf(e.target.value) }))}>
          {pockets.map(option)}
        </SelectRow>
        <TextRow
          label={`Leaves ${view.leaves.currency}`}
          value={view.leaves.value}
          onChange={(e) => set({ amount: e.target.value })}
          onBlur={() => settle('amount', view.leaves.value, view.leaves.currency)}
          inputMode="decimal"
        />
        {view.arrives && (
          <TextRow
            label={`Arrives ${view.arrives.currency}`}
            value={view.arrives.value}
            onChange={(e) => set({ toAmount: e.target.value })}
            onBlur={() => settle('toAmount', view.arrives!.value, view.arrives!.currency)}
            inputMode="decimal"
          />
        )}
        <ReadOnlyRow label="Bank's rate" value={bankRateText(view.bankRate, view.leaves.currency, view.arrives?.currency ?? view.leaves.currency)} />
        <TextRow label="Date" type="date" value={draft.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} />
        {needsRate && (
          <TextRow label={`Rate: ${ws.baseCurrency} per 1 ${needsRate}`} value={draft.manualRate} onChange={(e) => set({ manualRate: e.target.value })} inputMode="decimal" />
        )}
      </InsetGroup>
      {spread && view.cost && (
        <InsetGroup
          footer={`${formatMinor(evaluateOrZero(view.leaves), view.leaves.currency)} was worth ${formatMinor(view.cost.fromBaseMinor, ws.baseCurrency)} on ${draft.occurredOn}; ${formatMinor(
            evaluateOrZero(view.arrives!),
            view.arrives!.currency,
          )} is worth ${formatMinor(view.cost.toBaseMinor, ws.baseCurrency)}. The gap is the bank's spread, and it is recorded.`}
        >
          <InsetRow testId="spread" title={spread.title} value={spread.figure} valueTone="ink" chevron={false} />
        </InsetGroup>
      )}
      <InsetGroup>
        <InsetRow title="Move it" chevron={false} onClick={() => !busy && void save()} className={busy ? 'opacity-40' : undefined} />
      </InsetGroup>
    </div>
  );
}
```

`evaluateOrZero` is **not** a new reader: define it in the same file as `const evaluateOrZero = (field: MoneyFieldSpec) => evaluateAmount(field.value, field.currency) ?? 0;` (import `evaluateAmount` from core and `type MoneyFieldSpec` from tx-form). It is only reached when `view.cost` is non-null, which `moveView` returns only when both figures were read.

Router: `createRoute({ getParentRoute: () => rootRoute, path: '/accounts/$accountId/move', component: MovePage })`.

- [ ] **Step 3: Run** — `cd apps/web && npx playwright test -c playwright.cu.config.ts 'e2e/currency-pockets\.spec\.ts$' --workers=2`; colour grep on `MovePage.tsx` and `AddPocketPage.tsx` prints nothing; root gate.
- [ ] **Step 4: Commit** — `feat(accounts): move between pockets as a two-legged transfer, with the bank's spread shown and recorded`

---

### Task 8: The Money tile over the Accounts list (user decision 7)

**Files:**
- Modify: `apps/web/src/features/accounts/pockets.ts`, `pockets.test.ts`, `AccountsPage.tsx`, `apps/web/e2e/currency-pockets.spec.ts`

**Interfaces:**
- Consumes: `sumToBase` (Task 1); `pocketParentIds` (Task 2); `pocketsOf`, `useHeldRates` (Tasks 4, 5); `CASH_ITEMS` (core); `Hero`, `Panel` (kit).
- Produces: `moneySummary(accounts, balances, baseCurrency, ratesToBase): { totalMinor: number | null; missing: string[]; accounts: number; currencies: number }`.

The mockup's "Money ≈ Rp 103.882.000 · across 4 accounts · 3 currencies". **Money** is the kinds of account that hold money (`CASH_ITEMS`: cash, current, saving, time deposit, wallet, fund, other cash) — not a holding, whose figure is a valuation, and not a debt. An account with pockets counts as **one** account, its pockets as the amounts. A missing rate gives no figure and names the rate, as every total in this feature does.

- [ ] **Step 1: Failing test** (append to `pockets.test.ts`; add `moneySummary` to the import)

```ts
describe('the Money tile', () => {
  const book = [
    ...accounts,
    { id: 'm', name: 'Dollar Saver', parentId: null, kind: 'asset', subtype: 'savings', currency: 'USD', archivedAt: null, sortOrder: 0 },
    { id: 'k', name: 'Cash', parentId: null, kind: 'asset', subtype: 'cash', currency: 'IDR', archivedAt: null, sortOrder: 0 },
    { id: 'o', name: 'Overdrawn', parentId: null, kind: 'asset', subtype: 'bank', currency: 'IDR', archivedAt: null, sortOrder: 0 },
    { id: 'shares', name: 'US shares', parentId: null, kind: 'asset', subtype: 'investment', currency: 'USD', archivedAt: null, sortOrder: 0 },
    { id: 'visa', name: 'Visa', parentId: null, kind: 'liability', subtype: 'credit_card', currency: 'IDR', archivedAt: null, sortOrder: 0 },
    { id: 'gone', name: 'Old', parentId: null, kind: 'asset', subtype: 'bank', currency: 'EUR', archivedAt: '2026-01-01', sortOrder: 0 },
  ] as AccountRow[];
  const balances = {
    'c-usd': 240_000, // $2.400,00 → 39.000.000
    'a-sgd': 115_000, // S$1.150,00 → 14.582.000
    'b-idr': 5_400_000,
    'd-jpy': 999_999, // archived pocket: not counted
    m: 180_000, // $1.800,00 → 29.250.000 (rounding is pinned in sumToBase's and approxLine's own tests, off .5)
    k: 15_750_000,
    o: -100_000, // overdrawn: lowers the figure
    shares: 1_000_000, // a holding: not money
    visa: -2_000_000, // a debt: not money
  };

  it('adds every money account and every pocket at today’s rates — an account with pockets is one account', () => {
    // 39.000.000 + 14.582.000 + 5.400.000 + 29.250.000 + 15.750.000 − 100.000 — the mockup's Rp 103.882.000.
    // Wrong answers it rules out: Math.abs on the overdrawn account (104.082.000), the holding counted (+16.250.000),
    // the card counted, the archived JPY pocket counted, the parent's own zero counted as an account of its own.
    expect(moneySummary(book, balances, 'IDR', rates)).toEqual({ totalMinor: 103_882_000, missing: [], accounts: 4, currencies: 3 });
  });

  it('gives no figure when a rate is missing, and names it — not the sum of the rest, not raw minor units', () => {
    expect(moneySummary(book, balances, 'IDR', { USD: 16_250 })).toEqual({ totalMinor: null, missing: ['SGD'], accounts: 4, currencies: 3 });
  });
});
```

(Four accounts: Valas, Dollar Saver, Cash, Overdrawn. Three currencies: USD, SGD, IDR.)

- [ ] **Step 2: Implement** in `pockets.ts`:

```ts
const MONEY_KINDS = new Set<string>(CASH_ITEMS.map((item) => item.id));

/**
 * The Money tile: every money account and every pocket in the base currency, or no figure with the missing rate
 * named. An account with pockets is one account; its pockets are the amounts. Holdings and debts are not money here.
 */
export function moneySummary(accounts: readonly AccountRow[], balances: Readonly<Record<string, number>>, baseCurrency: string, ratesToBase: Rates) {
  const parents = pocketParentIds(accounts);
  const tops = accounts.filter((a) => a.kind === 'asset' && a.archivedAt === null && a.parentId === null && MONEY_KINDS.has(a.subtype));
  const held = tops.flatMap((a) => (parents.has(a.id) ? pocketsOf(a.id, accounts) : [a]));
  const amounts = held.map((a) => ({ minor: balances[a.id] ?? 0, currency: a.currency! }));
  return { ...sumToBase({ amounts, baseCurrency, ratesToBase }), accounts: tops.length, currencies: new Set(amounts.map((a) => a.currency)).size };
}
```

Imports: `CASH_ITEMS` (core), `pocketParentIds` (db).

- [ ] **Step 3: Draw it** — in `AccountsPage`, above the Money `AccountList`, only when `summary.accounts > 0`:

```tsx
  const summary = moneySummary(everything, all, ws.baseCurrency, rates.data?.rates ?? {});
  // …
      {summary.accounts > 0 &&
        (summary.totalMinor !== null ? (
          <Hero minor={summary.totalMinor} currency={ws.baseCurrency} caption={`Money ≈ at today's rates · across ${plural(summary.accounts, 'account')} · ${plural(summary.currencies, 'currency', 'currencies')}`} />
        ) : (
          <Panel header="Money">
            <p className="text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
              No {summary.missing.join(', ')} rate yet, so {plural(summary.accounts, 'account')} in {plural(summary.currencies, 'currency', 'currencies')} cannot be added up. Each balance below is exact.
            </p>
          </Panel>
        ))}
```

with `const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;` beside it. `useHeldRates` in `AccountsPage` now asks for every money account's currency, not only the pockets': `useHeldRates(everything.filter((a) => a.kind === 'asset' && a.archivedAt === null).map((a) => a.currency!))`. `AccountsPage` needs `const { ws } = useApp();`.

- [ ] **Step 4: e2e** (append to `currency-pockets.spec.ts`):

```ts
test('the Money tile adds every account and pocket at today’s rates', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await expect(page.getByText(/across 1 account · 3 currencies/)).toBeVisible();
  // Twice: the tile and the account's own row. Without the tile it is once.
  await expect(page.getByText(/58\.982\.000/)).toHaveCount(2);
});
```

- [ ] **Step 5: Run** — `cd apps/web && npx vitest run src/features/accounts`; `npx playwright test -c playwright.cu.config.ts 'e2e/(currency-pockets|account-types)\.spec\.ts$' --workers=2`; root gate.
- [ ] **Step 6: Commit** — `feat(accounts): a Money tile adds every account and pocket at today's rates, or names the rate it lacks`

---

### Task 9: The net-worth Assets list — an account with pockets is one row, and totals are converted (user decision 8)

**Files:**
- Modify: `apps/web/src/features/networth/asset-rows.ts`, `asset-rows.test.ts`, `AssetsPage.tsx`, `apps/web/e2e/currency-pockets.spec.ts`

**Interfaces:**
- Consumes: `sumToBase` (Task 1); `pocketParentIds` (Task 2); `groupedFigure`, `GroupedRow` (Task 4); `useHeldRates` (Task 5).
- Produces: `groupAssets(values, profiles, grouping: { accounts; baseCurrency; ratesToBase })`; `AssetGroup.totalMinor: number | null` and `AssetGroup.missing: string[]`; `AssetRow.pockets: number | null` and `AssetRow.missing: string[]`; `totalOf(groups): { totalMinor: number | null; missing: string[] }`.

**Why the totals change too.** Today `groupAssets` adds `valueMinor` across currencies as if every row were in the first row's currency (`asset-rows.ts:49`, and `AssetsPage` takes `baseCurrency` from `values.data[0].currency`). A USD fund beside rupiah already reads wrong; pockets make it the rule — the Cash group would add $2.400,00, S$1.150,00 and Rp 5.400.000 as 5.755.000. Grouping pockets under a ≈ figure beside a raw group total would show two contradictory numbers, so the group totals and the hero go through `sumToBase` in the same task.

- [ ] **Step 1: Failing tests** — every existing `groupAssets(values, profiles)` in `asset-rows.test.ts` becomes `groupAssets(values, profiles, idrOnly)` with `const idrOnly = { accounts: [], baseCurrency: 'IDR', ratesToBase: {} };`, and `expect(totalOf(...)).toBe(n)` becomes `.toEqual({ totalMinor: n, missing: [] })`. Append:

```ts
describe('an account with pockets, and totals across currencies', () => {
  const liquid = (accountId: string, name: string, currency: string, valueMinor: number) =>
    ({ ...values[0]!, accountId, name, currency, valueMinor, planGroup: 'liquid', mode: 'derived', stale: false, unitsMicro: null }) as AssetValueRow;
  const rows = [liquid('usd', 'Valas · USD', 'USD', 240_000), liquid('sgd', 'Valas · SGD', 'SGD', 115_000), liquid('idr', 'Valas · IDR', 'IDR', 5_400_000), liquid('cash', 'Cash', 'IDR', 1_000_000)];
  const accounts = [
    { id: 'valas', name: 'Valas', parentId: null, kind: 'asset', subtype: 'savings', archivedAt: null },
    { id: 'usd', name: 'Valas · USD', parentId: 'valas', kind: 'asset', subtype: 'savings', archivedAt: null },
    { id: 'sgd', name: 'Valas · SGD', parentId: 'valas', kind: 'asset', subtype: 'savings', archivedAt: null },
    { id: 'idr', name: 'Valas · IDR', parentId: 'valas', kind: 'asset', subtype: 'savings', archivedAt: null },
    { id: 'cash', name: 'Cash', parentId: null, kind: 'asset', subtype: 'cash', archivedAt: null },
  ] as AccountRow[];
  const grouping = { accounts, baseCurrency: 'IDR', ratesToBase: { USD: 16_250, SGD: 12_680 } };

  it('shows the pockets as one row for their account, at the ≈ total', () => {
    const [cash] = groupAssets(rows, [], grouping);
    expect(cash!.rows.map((row) => [row.accountId, row.name, row.valueMinor, row.currency, row.pockets])).toEqual([
      ['valas', 'Valas', 58_982_000, 'IDR', 3],
      ['cash', 'Cash', 1_000_000, 'IDR', null],
    ]);
  });

  it('converts the group total instead of adding minor units of three currencies', () => {
    // Raw addition would say 6.755.000.
    expect(groupAssets(rows, [], grouping)[0]).toMatchObject({ totalMinor: 59_982_000, missing: [] });
    expect(totalOf(groupAssets(rows, [], grouping))).toEqual({ totalMinor: 59_982_000, missing: [] });
  });

  it('gives no total when a rate is missing, and names it', () => {
    const groups = groupAssets(rows, [], { ...grouping, ratesToBase: { USD: 16_250 } });
    expect(groups[0]).toMatchObject({ totalMinor: null, missing: ['SGD'] });
    expect(groups[0]!.rows[0]).toMatchObject({ accountId: 'valas', pockets: 3, missing: ['SGD'] });
    expect(totalOf(groups)).toEqual({ totalMinor: null, missing: ['SGD'] });
  });
});
```

(Import `AccountRow`, `AssetValueRow` types from `@expanses/db`; if the file's `values[0]` is not liquid, the spread still works — every field the test reads is overridden.)

- [ ] **Step 2: Implement** in `asset-rows.ts`:
  - `AssetRow` gains `pockets: number | null` (null for an ordinary asset) and `missing: string[]`; `toRow` sets `pockets: null, missing: []`.
  - `groupAssets(values, profiles, { accounts, baseCurrency, ratesToBase })`: `const parents = pocketParentIds(accounts)`, `const parentOf = new Map(accounts.filter((a) => a.parentId && parents.has(a.parentId)).map((a) => [a.id, a.parentId!]))`. Walking `values` in order, a value whose account is in `parentOf` is gathered under its parent; the parent's row is emitted once, where its first pocket stood: `{ accountId: parentId, name: parent.name, planGroup: firstPocket.planGroup, valueMinor: total.totalMinor ?? 0, currency: baseCurrency, method: 'Pockets', coretax: 'Each pocket files its own row', stale: false, sold: false, pockets: n, missing: total.missing }` with `total = sumToBase({ amounts: its pockets' (valueMinor, currency), baseCurrency, ratesToBase })`. `valueMinor` is display only on this row; nothing sums it.
  - A group's total is `sumToBase` over the group's **underlying** values (pockets individually, sold holdings left out), so the group total never re-adds a rounded parent figure: `totalMinor` and `missing` from that call.
  - `totalOf(groups)`: null with every group's `missing` merged (sorted, unique) when any group has none; else the sum of the group totals.
- [ ] **Step 3: Draw it** in `AssetsPage.tsx`:
  - `const { ws } = useApp();` — `baseCurrency` is `ws.baseCurrency`, no longer the first row's currency.
  - `const accounts = useAccounts(); const held = useHeldRates((values.data ?? []).map((row) => row.currency));` and `groupAssets(values.data, profiles.data, { accounts: accounts.data ?? [], baseCurrency: ws.baseCurrency, ratesToBase: held.data?.rates ?? {} })`, waiting for `accounts.data` as it waits for the other two.
  - `Row`: a row with `pockets !== null` is `<GroupedRow to="/accounts/$accountId" params={{ accountId: row.accountId }} title={row.name} subtitle={`${row.pockets} pockets · each files its own row`} figure={groupedFigure({ totalMinor: row.missing.length ? null : row.valueMinor, missing: row.missing }, baseCurrency)} />`; every other row is today's.
  - `Group`'s trailing figure: `group.totalMinor === null ? <Figure tone="warn">{`No ${group.missing.join(', ')} rate yet`}</Figure> : <Money minor={group.totalMinor} currency={baseCurrency} />`.
  - The hero: `totalOf(groups)` with a total → today's `Hero` in `baseCurrency`; without → `<Empty>No {missing} rate yet, so your assets cannot be added up. Each figure below is exact.</Empty>`.
- [ ] **Step 4: e2e** (append to `currency-pockets.spec.ts`):

```ts
test('net worth’s Assets list shows the account once, at the ≈ total, and opens to its pockets', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.goto('/net-worth/assets');
  await expect(page.getByRole('link', { name: /Valas Plus · USD/ })).toHaveCount(0);
  const row = page.getByRole('link', { name: /^Valas Plus/ });
  await expect(row).toContainText('3 pockets');
  await expect(row).toContainText('58.982.000');
  await row.click();
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
});
```

- [ ] **Step 5: Run** — `cd apps/web && npx vitest run src/features/networth`; `npx playwright test -c playwright.cu.config.ts 'e2e/(currency-pockets|assets|net-worth|asset-reporting)\.spec\.ts$' --workers=2`; colour grep on `AssetsPage.tsx`; root gate.
- [ ] **Step 6: Commit** — `feat(net-worth): an account with pockets is one row on Assets, and every total there is converted`

---

### Task 10: Walk the combinations, on a desktop and on a phone

**Files:**
- Modify: `apps/web/e2e/currency-pockets.spec.ts`
- Create: `apps/web/e2e/phone-currency-pockets.spec.ts`

**Interfaces:** consumes everything above; produces nothing new.

Each test below is one combination nobody else walks. Every money figure is typed with `pressSequentially`.

- [ ] **Step 1: Chromium — append**

```ts
test('a blank rate that cannot be resolved stops the save, names the currency, and leaves nothing behind', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Nowhere Valas');
  await page.getByLabel('Holds more than one currency').check();
  await page.getByLabel('Pocket 2', { exact: true }).selectOption('SGD');
  await page.getByLabel('Opening SGD').pressSequentially('10.00');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('alert')).toContainText('No SGD→IDR rate available. Enter it manually.');
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'Nowhere Valas' })).toHaveCount(0);
});

test('one currency twice is refused in words', async ({ page }) => {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Current account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Twice');
  await page.getByLabel('Holds more than one currency').check();
  await page.getByLabel('Pocket 2', { exact: true }).selectOption('IDR');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('alert')).toContainText('IDR is listed twice');
});

test('the parent is offered nowhere money is chosen; its pockets are, and a pocket pays like any account', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  const payer = page.getByRole('dialog', { name: 'Paid with' });
  await expect(payer.getByRole('button', { name: 'Valas Plus · IDR', exact: true })).toBeVisible();
  await expect(payer.getByRole('button', { name: 'Valas Plus', exact: true })).toHaveCount(0);
  await payer.getByRole('button', { name: 'Valas Plus · IDR', exact: true }).click();
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await expect(form.getByLabel('To', { exact: true }).locator('option', { hasText: /^Valas Plus \(/ })).toHaveCount(0);
});

test('USD → IDR between pockets reads each side at its own exponent, keystroke by keystroke', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await page.getByRole('link', { name: /Move between pockets/ }).click();
  await page.getByLabel('To').selectOption('IDR');
  await page.getByLabel('Leaves USD').pressSequentially('100.50');
  await page.getByLabel('Arrives IDR').pressSequentially('1.630.000');
  await expect(page.getByTestId('spread')).toContainText('3.125');
  await page.getByRole('button', { name: 'Move it' }).click();
  await expect(page.getByTestId('pocket-USD')).toContainText('2.299,50');
  await expect(page.getByTestId('pocket-IDR')).toContainText('7.030.000');
});

test('changing a pocket clears both figures, and choosing the same pocket swaps', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await page.getByRole('link', { name: /Move between pockets/ }).click();
  await page.getByLabel('Leaves USD').pressSequentially('500');
  await page.getByLabel('Arrives SGD').pressSequentially('638');
  await page.getByLabel('To').selectOption('IDR');
  await expect(page.getByLabel('Leaves USD')).toHaveValue('');
  await expect(page.getByLabel('Arrives IDR')).toHaveValue('');
  await page.getByLabel('From').selectOption('IDR');
  await expect(page.getByLabel('Leaves IDR')).toBeVisible();
  await expect(page.getByLabel('Arrives USD')).toBeVisible();
});

test('the Transfer tab between two pockets posts what the Move screen posts', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.goto('/transactions');
  // Driven here rather than through `addTransfer`, which `fill()`s the Received row — the row Task 4 rewired.
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: 'Valas Plus · USD', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).pressSequentially('500');
  await form.getByLabel('To', { exact: true }).selectOption({ label: 'Valas Plus · SGD (SGD)' });
  await form.getByLabel('Received amount (SGD)').pressSequentially('638');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await page.goto('/accounts');
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await expect(page.getByTestId('pocket-USD')).toContainText('1.900,00');
  await expect(page.getByTestId('pocket-SGD')).toContainText('1.788,00');
});

test('the parent archives only after its pockets, and renaming it renames them', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  const alerts: string[] = [];
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'alert') alerts.push(dialog.message());
    if (dialog.type() === 'prompt') return void dialog.accept('Multi Plus');
    return void dialog.accept();
  });
  await page.getByRole('button', { name: 'Archive Valas Plus' }).click();
  await expect.poll(() => alerts.join()).toContain('Valas Plus still has pockets: USD, SGD, IDR');
  await page.getByRole('button', { name: 'Rename Valas Plus' }).click();
  await page.getByRole('link', { name: 'Multi Plus', exact: true }).click();
  await page.getByTestId('pocket-USD').click();
  await expect(page.getByRole('heading', { name: 'Multi Plus · USD' })).toBeVisible();
});
```

The desktop amount input's label is whatever `openAmount`/`fillAmount` in `e2e/add-transaction.ts` target on chromium — read them and use the same locator if it is not `Amount`; keep `pressSequentially`.

- [ ] **Step 2: Phone**

```ts
// apps/web/e2e/phone-currency-pockets.spec.ts
import { expect, test } from '@playwright/test';
import { mockRates, openWithPockets } from './pockets';

test('by thumb: open the account, a pocket, and move between pockets one key at a time', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, {
    name: 'Valas Plus',
    pockets: [
      { currency: 'USD', balance: '2400.00', rate: '16250' },
      { currency: 'SGD', balance: '1150.00' },
    ],
  });
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).tap();
  await expect(page.getByTestId('pocket-USD')).toContainText('39.000.000');
  await page.getByRole('link', { name: /Move between pockets/ }).tap();
  await page.getByLabel('Leaves USD').pressSequentially('500');
  await page.getByLabel('Arrives SGD').pressSequentially('638');
  await expect(page.getByTestId('spread')).toContainText('35.160');
  await page.getByRole('button', { name: 'Move it' }).tap();
  await expect(page.getByTestId('pocket-USD')).toContainText('1.900,00');
  await expect(page.getByTestId('pocket-SGD')).toContainText('1.788,00');
  // No page scrolls sideways at 390px except the Accounts table's own scroller.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the account page reads in the dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Night Valas', pockets: [{ currency: 'USD', balance: '10.00', rate: '16250' }, { currency: 'SGD', balance: '10.00' }] });
  await page.getByRole('link', { name: 'Night Valas', exact: true }).tap();
  const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(ground).not.toBe('rgb(255, 255, 255)');
});
```

- [ ] **Step 3: Run the full gate** — root `npm run typecheck && npm test && npm run build`; `cd apps/web && npx playwright test -c playwright.cu.config.ts --workers=2` (both projects, whole suite — the one run with no filter).
- [ ] **Step 4: Walk the spec** — reread spec §1–§12 against the running app and the table below; any line with no passing test is a failing task, not a note.
- [ ] **Step 5: Commit** — `test(pockets): walk every combination of pockets, rates and moves on desktop and phone`

---

## Spec → task mapping

| Spec section | Task(s) |
|---|---|
| §1 What we are building | 2, 5, 6, 7 |
| §2 One account, one currency at the ledger | 3 (refusal), 2 (pocket rules) |
| §3.1 No migration; parent/pocket rows | 2; Global Constraints (0052 unused) |
| §3.2 What makes a parent | 2 (`pocketParentIds`) |
| §3.3 Names, rename carries | 2 (`pocketName`), 3 (`renameAccount`), 10 (e2e) |
| §3.4 Repository rules | 2 (create rules, count, deposit, duplicate), 3 (posting, archive) |
| §4 Every reader | 3 (`assetValuesAt`, net worth, tax, flows), 4 (`moneyHolders` at every picker, the non-`isMoneyAccount` ones included) |
| §5 Opening with pockets, optional rate, atomic | 4 (`openingRateFor`, `readPockets`), 5 (form), 10 (unresolvable, duplicate) |
| §6 Add a pocket | 2 (`addPocket`), 6 |
| §7 Accounts list P1, missing-rate rule, stored rates, Money tile | 4 (`parentTotal`, `groupedFigure`), 5, 8 (tile) |
| §8 Account page | 5 |
| §9 Pocket page (≈, Opened at, back) | 2 (`openingsOf`), 4 (`ApproxFigure`, `approxLine`), 5 |
| §10.1–10.2 Move rows and currency handling | 4 (`receivedField`, `moveView`, `withPockets`, keystroke tests), 7, 10 |
| §10.3 Bank's rate and spread, recorded | 1, 3 (recorded = shown), 4 (`spreadLine`), 7 |
| §10.4 Saving through the Transfer tab's path | 7 |
| §11 Transfer tab and other pickers | 4, 10 |
| §12 Tax report and net worth; Assets list grouped | 3, 9 |
| §13 Shared parts securities reuses (build-order ruling) | 1 (`sumToBase`), 4 (kit: `approxLine`, `rateLine`, `groupedFigure`, `ApproxFigure`, `GroupedRow`) |
| §14 Testing | 1–10 |
| §16 Decisions taken here | 2 (1, 2, 4), 5 (3, 6), 4 (7, 8), 7 (5) |
| §18 Add asset's rate reader | 4 (Step 5b) |

## Open questions carried from the spec (§17)

1. Converting an existing single-currency account into one with pockets — **out of scope (user, 2026-09-21)**; `addPocket` refuses it.
2. The Accounts summary tile — **built (user decision 7)**, Task 8.
3. Grouping pockets on the net-worth Assets list — **built (user decision 8)**, Task 9, with that page's totals converted.
4. `periodFlows` counts a costly spread between savings pockets against put-away but ignores a gainful one — kept and pinned by Task 3's test, not changed.
5. Still reading raw or partial sums, not touched here: `/net-worth/loans` (mixed-currency loans added as rupiah) and `netWorthAt`/`toBase` (a missing rate counts as 0 on the Overview).
