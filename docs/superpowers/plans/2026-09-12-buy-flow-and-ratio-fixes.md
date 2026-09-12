# Buying Flow, CFP Ratios and Goal Tags on Transfers (Slice 3.5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Format:** fast track, as chosen by the owner. Each task gives files, exact interfaces, and the named test cases that must be written first and fail before implementation. Code is written during execution, not in this document.

**Goal:** Record a purchase the way you actually buy — from the Transactions window, paid by card if that's how you paid — put the ratios back on the published definitions, and let money parked at the broker count toward a goal before it becomes shares.

**Architecture:** `packages/core` corrects the ratio table and gains lot arithmetic. `packages/db` gains migration `0009` (goal on a transaction, purchase category on a card line, template kind), the "put away" figure inside `periodFlows`, card-funded purchases that still earn points, and the auto set-aside that moves value between parked cash and units. `apps/web` turns the transaction form into a purchase when an Investments entry is picked, converts an expense already recorded into a purchase, keeps holdings out of the transfer picker, and updates the ratio cards.

**Tech Stack:** unchanged (TypeScript 7, Vitest 5, Drizzle sqlite-proxy, better-sqlite3 in tests, Vite 8, React 19, TanStack Router/Query, Tailwind 4, Playwright). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-net-worth-coretax-goals-design.md` (§13, with §5.2 superseded by §13.1)

## Global Constraints

- Money stays 64-bit integer minor units; units stay `units_micro` integers. No floats in stored values.
- Ratio formulas and benchmarks come from §13.1 and live in one table in `packages/core/src/assets/health.ts`. Status bands are derived from the benchmark: on track on the good side, watch out to 1,2× it, act beyond.
- The income denominator is take-home pay, and every ratio card says so.
- A goal tag belongs on purchases and on transfers into a holding place, never on an ordinary payment.
- A tagged transfer raises that goal's set-aside; a purchase from that account with the same goal lowers it. Value is never counted twice, and a leftover keeps waiting.
- Buying with a credit card is not spending: the holding rises, the card balance rises, and the card line still earns points.
- Every task ends green on `npm test` and `npm run typecheck` at the repo root; web tasks also run `npm run e2e`.
- Commits end with the project trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File Structure

```
packages/core/src/assets/health.ts      corrected ratios, benchmark-derived bands, putAwayMinor
packages/core/src/assets/units.ts       + formatLots, parseLots, lotsOf
packages/core/test/assets-health.test.ts  assets-units.test.ts

packages/db/migrations/0009_buy_flow.sql
packages/db/src/schema.ts               + transactions.goal_id, entries.spend_category_id
packages/db/src/schema-assets.ts        + trade_templates.kind
packages/db/src/repos/flows.ts          + putAwayMinor
packages/db/src/repos/goal-transfers.ts recordTaggedTransfer, set-aside movement
packages/db/src/repos/trades.ts         card as the money side, set-aside consumption
packages/db/src/repos/assets.ts         setAssetGroup, setLotSize
packages/db/src/repos/convert.ts        convertToPurchase
packages/db/test/flows-putaway.test.ts  goal-transfers.test.ts  trades-card.test.ts  convert.test.ts

apps/web/src/features/transactions/
  TransactionForm.tsx     Investments group, purchase fields, guard rail
  buy-in-form.ts          pure: picker options, draft → RecordTradeInput
  TransactionsPage.tsx    goal on trade rows, "This was a purchase"
apps/web/src/features/networth/
  AssetSettings.tsx       group and lot size on asset detail
  TemplateList.tsx        buy or move
  HealthRatios.tsx        savings ratio, surplus, settings
  overview-rows.ts        idle cash in a broker account
apps/web/src/features/transactions/buy-in-form.test.ts
apps/web/e2e/buy-flow.spec.ts
```

---

### Task 1: Core — ratios back on the published definitions

**Files:** Modify `packages/core/src/assets/health.ts`, `packages/core/src/index.ts`; test `packages/core/test/assets-health.test.ts`.

**Interfaces — Produces:**
```ts
export interface PeriodFlows {
  months: number; incomeMinor: number; spendingMinor: number;
  debtPaymentsMinor: number; nonMortgageDebtPaymentsMinor: number;
  /** Money that actually moved into holdings, savings or loan principal over the period. */
  putAwayMinor: number;
}
export interface RatioSettings {
  /** Adds debt payments to the emergency fund denominator. Default false, the guide's reading. */
  emergencyIncludesDebtPayments?: boolean;
  /** 3500 by the guide; 3000 matches what OJK and Indonesian lenders quote. */
  debtServiceBenchmarkBps?: number;
}
export type RatioKey = 'emergency_fund' | 'savings_ratio' | 'surplus' | 'liquidity' | 'debt_payments'
  | 'consumer_debt_payments' | 'debt_to_assets' | 'solvency' | 'investments_to_net_worth';
export function healthRatios(flows: PeriodFlows, totals: SheetTotals, settings?: RatioSettings): HealthRatio[];
export const WATCH_BAND = 1.2;
```

Rules: `savings_ratio` is `putAwayMinor ÷ income`, benchmark 10, watch band down to 10 ÷ 1,2; `surplus` is the old formula, marked `companion: true` on the row so the screen can place it second; emergency fund divides by monthly spending, plus debt payments only when the setting is on; debt servicing benchmark comes from settings, default 3500 bps; every band is derived from the benchmark rather than written per ratio. `HealthRatio` gains `benchmarkText` ("at least 10%", "at most 35%", "3–6 months") and `companion: boolean`.

- [ ] Tests (fail first): `savings ratio divides what was put away by take-home pay`; `savings ratio of 12,8% is on track and 7% is watch`; `surplus keeps the old formula and is marked as a companion`; `the nine rows come back in screen order with surplus after the savings ratio`; `emergency fund divides by spending alone`; `the setting adds debt payments to the emergency denominator`; `debt servicing is on track at 34% and acts at 43%`; `the 30% setting moves those bands`; `every band comes from its benchmark times 1,2`; `benchmarkText reads "at least 10%" and "at most 35%"`; `zero income still makes the income ratios unknown`.
- [ ] Implement; run `npm test -w @expanses/core`; commit `fix(core): ratios follow the published definitions`.

### Task 2: DB — what you actually put away

**Files:** Modify `packages/db/src/repos/flows.ts`; test `packages/db/test/flows-putaway.test.ts`.

**Interfaces — Consumes:** `PeriodFlows` (Task 1), `listTrades`, `listAssetProfiles`, `BALANCE_SUBTYPES`.

**Interfaces — Produces:** `periodFlows` fills `putAwayMinor`.

Rules: sum, over the range, of purchase cost from active trades (`buy`, cash side not Opening Balances), plus money moved from an account whose group is `liquid` into an account whose group is `invest` (RDN, broker cash) or into a `savings` subtype, minus the reverse direction, plus loan principal paid. A transfer between two `liquid` accounts counts nothing. Selling a holding does not subtract; the money simply lands in cash and the next month's figure reflects what happens to it.

- [ ] Tests (fail first): `a gold purchase counts as put away`; `an opening position does not, since no money moved`; `a transfer from BCA to RDN counts once RDN is grouped as investments`; `a transfer between two bank accounts counts nothing`; `moving money back out of RDN subtracts`; `loan principal counts, interest does not`; `a card-funded purchase counts`; `putAwayMinor is zero for a workspace with no activity`.
- [ ] Implement; run `npm test -w @expanses/db`; commit `feat(db): measure what actually went into savings and investments`.

### Task 3: DB — migration 0009 and asset settings

**Files:** Create `packages/db/migrations/0009_buy_flow.sql`; modify `packages/db/src/schema.ts`, `packages/db/src/schema-assets.ts`, `packages/db/src/migrations.ts`, `packages/db/src/repos/assets.ts`, `packages/db/test/database.test.ts`; test `packages/db/test/assets.test.ts`.

**Interfaces — Produces:**
```ts
export function setAssetGroup(database: Database, ws: WorkspaceContext, accountId: string, planGroup: PlanGroup): Promise<void>;
export function setLotSize(database: Database, ws: WorkspaceContext, accountId: string, lotSize: number | null): Promise<void>;
```

Migration, registered as version 9 named `buy_flow`: `ALTER TABLE transactions ADD COLUMN goal_id TEXT REFERENCES goals(id)`; `ALTER TABLE entries ADD COLUMN spend_category_id TEXT REFERENCES accounts(id)`; `ALTER TABLE trade_templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'buy' CHECK (kind IN ('buy', 'move'))`.

- [ ] Tests (fail first): `migrate applies version 9 on a database populated through version 8 and keeps goals and trades`; `setAssetGroup moves RDN from cash to investments`; `setAssetGroup rejects an unknown group`; `setLotSize stores 100 for an IDX stock and 1 for a US stock`; `setLotSize rejects zero`; `an account from another workspace is refused`.
- [ ] Implement; run `npm test -w @expanses/db`; commit `feat(db): migration 0009 and asset group and lot settings`.

### Task 4: DB — tagged transfers and the set-aside that follows

**Files:** Create `packages/db/src/repos/goal-transfers.ts`; modify `packages/db/src/repos/trades.ts`, `packages/db/src/index.ts`; test `packages/db/test/goal-transfers.test.ts`.

**Interfaces — Consumes:** `saveEarmark`, `listEarmarks`, `removeEarmark` (slice 3), `postTransaction`, `recordTrade`.

**Interfaces — Produces:**
```ts
export interface TaggedTransferInput {
  occurredOn: string; description: string; amountMinor: number;
  fromAccountId: string; toAccountId: string; goalId: string | null; ratesToBase?: Record<string, number>;
}
export function recordTaggedTransfer(database: Database, ws: WorkspaceContext, input: TaggedTransferInput): Promise<{ transactionId: string; setAsideMinor: number }>;
// RecordTradeInput already carries goalId; recordTrade now lowers the set-aside on its cash account for that goal.
```

Rules: the transfer posts as today and stores `goal_id` on the transaction; when the destination account can hold a set-aside (subtype cash, bank or savings, or group `invest`), the goal's set-aside on that account rises by the amount. A purchase funded from an account holding a set-aside for the same goal lowers it by the amount paid, never below zero. Removing or voiding the transfer lowers it again by the same rule.

- [ ] Tests (fail first): `a tagged transfer into RDN raises the goal's set-aside`; `an untagged transfer raises nothing`; `buying from RDN with the same goal lowers the set-aside by what was paid`; `buying more than was set aside floors it at zero`; `a leftover keeps waiting: Rp 1.000.000 parked, Rp 987.500 spent, Rp 12.500 left`; `buying from BCA does not touch an RDN set-aside`; `the goal's value is the same before and after the purchase`; `voiding the transfer takes the set-aside back down`.
- [ ] Implement; run `npm test -w @expanses/db`; commit `feat(db): tagged transfers park money against a goal`.

### Task 5: DB — a card can pay for a purchase, and points still count

**Files:** Modify `packages/db/src/repos/trades.ts`, `packages/db/src/repos/points.ts`; test `packages/db/test/trades-card.test.ts`.

**Interfaces — Produces:**
```ts
// RecordTradeInput gains: spendCategoryId?: string | null; mcc?: string | null
// cardSpendLines includes a card entry that carries spend_category_id, using it as the line's category.
```

Rules: a purchase whose cash account is a credit card posts holding + cost and card − cost, writes `spend_category_id` and the transaction's `mcc`, and never touches an expense category. `cardSpendLines` picks the line up so the points engine sees ordinary card spend. Selling into a card is refused with "Choose a bank or cash account for the proceeds".

- [ ] Tests (fail first): `a gold purchase on a card raises the card balance and spends nothing`; `the card line carries the purchase category and the MCC`; `cardSpendLines returns it so points are computed`; `a purchase with no category on a card still posts, with no points`; `selling into a card is refused`; `checkLedgerIntegrity stays empty`.
- [ ] Implement; run `npm test -w @expanses/db`; commit `feat(db): buy a holding with a credit card and still earn points`.

### Task 6: DB — convert a recorded expense into a purchase

**Files:** Create `packages/db/src/repos/convert.ts`; modify `packages/db/src/index.ts`; test `packages/db/test/convert.test.ts`.

**Interfaces — Consumes:** `voidTransactionTx`, `recordTrade`, `listTransactions`.

**Interfaces — Produces:**
```ts
export interface ConvertToPurchaseInput { transactionId: string; accountId: string; unitsMicro: number; goalId?: string | null; feeMinor?: number }
export function convertToPurchase(database: Database, ws: WorkspaceContext, input: ConvertToPurchaseInput): Promise<{ tradeId: string; transactionId: string }>;
```

Rules: reads the original transaction's date, amount, money account, MCC and category; voids it; records a trade with the same date, amount and money account, carrying the category and MCC when the money account is a card. Refuses a transaction that is already a trade, one that is void, and one whose money side cannot be found.

- [ ] Tests (fail first): `converts an expense into a purchase with units and keeps the date and amount`; `the original transaction is voided, not deleted`; `spending falls by the amount and the holding appears`; `a card purchase keeps its category and MCC for points`; `converting a trade transaction is refused`; `converting a void transaction is refused`; `the goal tag lands on the new trade`.
- [ ] Implement; run `npm test -w @expanses/db`; commit `feat(db): convert a recorded expense into a purchase`.

### Task 7: Core and web — lots, and buying from the transaction form

**Files:** Modify `packages/core/src/assets/units.ts`, `packages/core/src/index.ts`, `apps/web/src/features/transactions/TransactionForm.tsx`, `apps/web/src/features/transactions/draft.ts`; create `apps/web/src/features/transactions/buy-in-form.ts`, `apps/web/src/features/transactions/buy-in-form.test.ts`; test `packages/core/test/assets-units.test.ts`.

**Interfaces — Produces:**
```ts
// core
export function lotsOf(unitsMicro: number, lotSize: number): number;
export function unitsFromLots(lots: number, lotSize: number): number;      // units_micro
export function formatLots(unitsMicro: number, lotSize: number): string;   // "12 lot (1.200 shares)"
// web
export interface BuyChoice { value: string; label: string; accountId: string; mode: 'buy' | 'sell' }
export function buyChoices(values: AssetValueRow[], profiles: AssetProfileRow[]): { buys: BuyChoice[]; sells: BuyChoice[] };
export function purchaseDraftToInput(draft: PurchaseDraft, currency: string, today: string): RecordTradeInput;
export function transferTargets(accounts: AccountRow[], values: AssetValueRow[]): AccountRow[];  // holdings valued by units excluded
```

The form's picker gains "Investments › <holding>" and "Sell › <holding>" groups; choosing one shows units or lots, price, money side (bank, cash, savings **or card**) and goal, and saves through `recordTrade`. The transfer target list drops holdings valued by units, with a line pointing at the purchase flow.

- [ ] Tests (fail first, core): `lotsOf turns 1.200 shares into 12 lots`; `unitsFromLots turns 3 lots into 300 shares`; `formatLots reads "12 lot (1.200 shares)"`; `a lot size of 1 formats as plain shares`. Web: `buyChoices lists every holding valued by units, and nothing else`; `purchaseDraftToInput converts lots into units`; `purchaseDraftToInput carries the goal and the card category`; `a sale into a card is rejected before saving`; `transferTargets drops gold and the equity fund but keeps the house`.
- [ ] Implement; run `npm test -w @expanses/core`, `npm test -w @expanses/web`, `npm run typecheck`; commit `feat(web): record a purchase from the transaction window`.

### Task 8: Web — the rest of the screens, and end to end

**Files:** Modify `apps/web/src/features/transactions/TransactionsPage.tsx`, `apps/web/src/features/networth/HealthRatios.tsx`, `apps/web/src/features/networth/OverviewPage.tsx`, `apps/web/src/features/networth/overview-rows.ts`, `apps/web/src/features/networth/TemplateList.tsx`, `apps/web/src/features/networth/AssetDetailPage.tsx`; create `apps/web/src/features/networth/AssetSettings.tsx`, `apps/web/e2e/buy-flow.spec.ts`.

**Interfaces — Consumes:** everything above.

Transactions rows show the goal on trades and offer "This was a purchase" on an expense paid from a money account. Ratio cards show the savings ratio first with surplus beside it, each with its benchmark text and the take-home note, plus the two settings. Asset detail gains a settings card for group and lot size. Templates choose buy or move, and a move carries a goal. The Overview's attention list gains idle cash: "Rp 1.011.019 has been waiting in RDN since 5 Oct".

- [ ] Tests (fail first, `overview-rows.test.ts`): `idle cash in an investment-grouped account is listed with the date it arrived`; `no idle row when the account is empty`; `no idle row for an ordinary bank account`.
- [ ] E2E (`apps/web/e2e/buy-flow.spec.ts`, fail first): `buy gold from the transaction window: spending unchanged, holding appears`; `pay with the credit card: card balance rises and points are estimated`; `a transfer cannot target a holding`; `convert a recorded expense into a purchase`; `park money in RDN tagged to a goal, then buy a lot and watch the leftover stay`.
- [ ] Implement; run `npm test`, `npm run typecheck`, `npm run e2e`; commit `feat(web): buying flow, corrected ratio cards and asset settings`.
- [ ] Record execution notes at the end of this plan; commit `docs: record slice 3.5 execution status`.

---

## Self-review

**Spec coverage (§13):** ratio corrections and settings (Task 1, 8); put-away figure (Task 2); migration and asset settings (Task 3); tagged transfers with auto set-aside and leftovers (Task 4); card as the money side with points (Task 5); convert an expense (Task 6); lots and the transaction-window purchase with the guard rail (Task 7); screens, idle cash, templates and end-to-end (Task 8). Setoran awal as spending needs no code: it is an ordinary expense.

**Left for later slices, as designed:** lend and borrow, loan terms, and the Coretax report. The emergency-fund denominator setting ships defaulted to the guide's reading; the owner will choose the default later.
