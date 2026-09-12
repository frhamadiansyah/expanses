# Asset Values and Buy & Sell (Slice 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Format:** fast track, as chosen by the owner. Each task gives files, exact interfaces, and the named test cases that must be written first and fail before implementation. Code is written during execution, not in this document.

**Goal:** Track what every asset is worth — bank balances from the ledger, funds, shares, bonds and gold from units × price, property and vehicles from your own estimate — and record buys, sells and investment income that post correctly to the double-entry ledger.

**Architecture:** `packages/core` gains an `assets` module: unit and price arithmetic in integers, position maths (average cost), ledger postings per trade kind, value-at-a-date, asset presets, and the Coretax field schema. `packages/db` gains migration `0007_assets`, five tables, and repositories that post a trade and its ledger transaction in one database transaction, recomputing later sells whose cost basis changed. `apps/web` gains a Net worth section with an Assets list, asset detail, and a Buy & sell page.

**Tech Stack:** unchanged (TypeScript 7, Vitest 5, Drizzle sqlite-proxy, better-sqlite3 in tests, Vite 8, React 19, TanStack Router/Query, Tailwind 4, Playwright). No new dependencies; charts are hand-written SVG.

**Spec:** `docs/superpowers/specs/2026-09-11-net-worth-coretax-goals-design.md` (§3, §4)

## Global Constraints

- Money stays 64-bit integer minor units. No floats in stored values or arithmetic results.
- Units are `units_micro` integers (units × 1,000,000). Prices are `price_micro` integers (minor units per unit × 1,000,000).
- Rounding uses the existing `roundHalfAwayFromZero` from `@expanses/core`.
- Posting tables use + for a debit and − for a credit.
- Fees and taxes on a buy are part of cost (Biaya perolehan, Pasal 10 UU PPh).
- Sells use average cost over all units held on the trade date.
- The ledger stays immutable: edits void and replace, never update posted transactions.
- No network calls. Prices and estimates are typed by the owner.
- Missing Coretax fields never block saving; they show as "Missing".
- Every task ends green on `npm test` and `npm run typecheck` at the repo root; web tasks also run `npm run e2e`.
- Commits end with the project trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Deviations from spec, recorded

- **No new account subtype.** The spec (§4.1) adds `other_asset` to `accounts.subtype`. `accounts.subtype` has a `CHECK` constraint and migrations run inside `BEGIN IMMEDIATE`, where `PRAGMA foreign_keys` cannot be turned off, so rebuilding `accounts` is unsafe. Instead `asset_profiles.asset_kind` (`fund` | `stock` | `bond` | `gold` | `property` | `vehicle` | `other` | `cash`) drives labels, presets, balance-sheet group and Coretax section. "Other asset" uses subtype `investment` with `valuation_mode = 'snapshot'`.
- **`plan_group` values** are named `liquid` | `invest` | `owed` | `use` in storage, matching the groups in spec §3.1.
- **`positionAfter` returns `byYear`** keyed by 4-digit year string, used later by the Coretax per-year rows (spec §9.2); it ships now because the same walk produces it.

## File Structure

```
packages/core/src/assets/
  units.ts             integer unit and price arithmetic, parsing, formatting
  position.ts          TradeRecord, Position, positionAfter, sellBasisMinor, TradeError
  trades.ts            TradeInput, TradeAccounts, tradePostings, tradeDescription
  value.ts             assetValueAt, isStaleValue, AssetValue
  presets.ts           AssetKind, ASSET_PRESETS
  coretax-fields.ts    CoretaxSection, CORETAX_SECTIONS, validateCoretaxFields
packages/core/test/
  assets-units.test.ts  assets-position.test.ts  assets-trades.test.ts
  assets-value.test.ts  assets-coretax-fields.test.ts

packages/db/migrations/0007_assets.sql
packages/db/src/schema-assets.ts     assetProfiles, investmentTrades, prices, valuations, tradeTemplates
packages/db/src/repos/assets.ts      profile read and write, asset account list
packages/db/src/repos/trades.ts      recordTrade, replaceTrade, deleteTrade, listTrades, positionsFor
packages/db/src/repos/prices.ts      prices and valuations
packages/db/src/repos/asset-values.ts  assetValuesAt, netWorthAt, monthEndNetWorth
packages/db/src/repos/trade-templates.ts  templates and due list
packages/db/test/
  assets.test.ts  trades.test.ts  prices.test.ts  asset-values.test.ts  trade-templates.test.ts

apps/web/src/features/networth/
  AssetsPage.tsx  AssetDetailPage.tsx  TradesPage.tsx
  AddAssetForm.tsx  PriceForm.tsx  ValuationForm.tsx  CoretaxFieldsForm.tsx
  HoldingsTable.tsx  TradeForm.tsx  TemplateList.tsx  UpdatePricesSheet.tsx
  ValueChart.tsx   asset-rows.ts   labels.ts   queries.ts
apps/web/src/features/networth/*.test.ts   web unit tests (asset-rows, labels, due templates)
apps/web/e2e/assets.spec.ts
```

---

### Task 1: Core — integer units and prices

**Files:** Create `packages/core/src/assets/units.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/assets-units.test.ts`.

**Interfaces — Produces:**
```ts
export const UNITS_SCALE = 1_000_000;
export const PRICE_SCALE = 1_000_000;
export class UnitsError extends Error {}
export function parseUnits(text: string): number;                            // "45.678,1234" -> 45_678_123_400
export function formatUnits(unitsMicro: number, maxDecimals?: number): string; // id-ID grouping, trailing zeros trimmed
export function parsePriceMicro(text: string, currency: string): number;      // "1.842,11" IDR -> 1_842_110_000
export function formatPriceMicro(priceMicro: number, currency: string): string;
export function unitsValueMinor(unitsMicro: number, priceMicro: number): number; // round half away from zero
export function priceMicroFrom(grossMinor: number, unitsMicro: number): number;   // average or implied price
```

- [ ] Tests (fail first): `parseUnits reads id-ID grouping and four decimals`; `parseUnits rejects letters, negatives and more than six decimals`; `formatUnits trims trailing zeros and groups thousands`; `parsePriceMicro keeps two decimals of an IDR NAV exactly`; `parsePriceMicro on a USD price keeps cents`; `unitsValueMinor rounds half away from zero`; `unitsValueMinor of 32 g at Rp 1.842.000 is Rp 58.944.000`; `priceMicroFrom returns the average price of a position`; `round trip parseUnits then formatUnits keeps the text`.
- [ ] Implement with integer maths only (`Math.round` on the scaled product, via `roundHalfAwayFromZero`).
- [ ] Export from `packages/core/src/index.ts`; run `npm test -w @expanses/core`; commit `feat(core): integer unit and price arithmetic`.

### Task 2: Core — positions and average cost

**Files:** Create `packages/core/src/assets/position.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/assets-position.test.ts`.

**Interfaces — Consumes:** `unitsValueMinor` (Task 1).

**Interfaces — Produces:**
```ts
export type TradeKind = 'buy' | 'sell' | 'income' | 'unit_change';
export interface TradeRecord {
  id: string; accountId: string; kind: TradeKind; occurredOn: string; createdAt: string;
  unitsMicro: number; grossMinor: number; feeMinor: number; taxMinor: number;
}
export interface Position {
  unitsMicro: number; costMinor: number; realizedMinor: number; incomeMinor: number;
  byYear: Record<string, { unitsMicro: number; costMinor: number }>;
}
export class TradeError extends Error { code: 'OVERSELL' | 'INVALID_UNITS' | 'INVALID_AMOUNT' | 'UNKNOWN_KIND' }
export function positionAfter(trades: TradeRecord[], upTo?: string): Position;
export function sellBasisMinor(position: Position, unitsMicro: number): number;
export function averagePriceMicro(position: Position): number | null;
```

- [ ] Tests (fail first): `two buys give the weighted average cost`; `a partial sell removes cost in proportion and leaves the average unchanged`; `selling everything leaves zero units and zero cost`; `sellBasisMinor rounds and a full sell takes the remaining cost exactly`; `overselling throws TradeError OVERSELL with the held amount in the message`; `trades are walked by occurredOn then createdAt, not input order`; `upTo excludes later trades`; `unit_change scales units by year and never changes cost`; `income adds to incomeMinor net of tax and leaves units and cost alone`; `byYear splits cost by purchase year and a sell reduces every year in proportion`.
- [ ] Implement; run `npm test -w @expanses/core`; commit `feat(core): positions with average cost`.

### Task 3: Core — trade postings

**Files:** Create `packages/core/src/assets/trades.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/assets-trades.test.ts`.

**Interfaces — Consumes:** `Position`, `sellBasisMinor`, `TradeError` (Task 2); existing `PostingLine` from `packages/core/src/ledger/types.ts`.

**Interfaces — Produces:**
```ts
export interface TradeAccounts {
  holdingAccountId: string; holdingCurrency: string;
  cashAccountId: string; cashCurrency: string;
  realizedGainsCategoryId: string; investmentIncomeCategoryId: string; finalTaxCategoryId: string;
}
export interface TradeInput {
  kind: TradeKind; occurredOn: string; unitsMicro: number;
  grossMinor: number; feeMinor: number; taxMinor: number;
}
export function tradePostings(input: TradeInput, position: Position, accounts: TradeAccounts): PostingLine[];
export function tradeDescription(input: TradeInput, holdingName: string): string; // "Bought 2 g Antam gold bars"
```

Posting shape per kind (+ debit, − credit), spec §4.2:

| Kind | Lines |
|---|---|
| buy | holding + (gross + fee + tax); cash − (gross + fee + tax) |
| sell | cash + (gross − fee − tax); final tax + tax; holding − basis; realized gains − (gross − fee − basis) |
| income | cash + (gross − tax); final tax + tax; investment income − gross |
| unit_change | `[]` |

- [ ] Tests (fail first): `a buy debits the holding with fees included and credits cash`; `a sell credits the holding by average cost and books the gain`; `a sell at a loss debits realized gains`; `a sell with withheld tax books the tax line and nets the cash`; `dividend books gross income, tax expense and net cash`; `a coupon on a face-value holding posts like a dividend`; `unit_change returns no lines`; `every posting set sums to zero per currency`; `zero or negative units on a buy throws INVALID_UNITS`; `negative gross, fee or tax throws INVALID_AMOUNT`; `a sell beyond the position throws OVERSELL`.
- [ ] Implement; run `npm test -w @expanses/core`; commit `feat(core): ledger postings for buys, sells and investment income`.

### Task 4: Core — value at a date and staleness

**Files:** Create `packages/core/src/assets/value.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/assets-value.test.ts`.

**Interfaces — Consumes:** `Position` (Task 2), `unitsValueMinor` (Task 1).

**Interfaces — Produces:**
```ts
export type ValuationMode = 'derived' | 'snapshot' | 'market';
export type ValuationBasis = 'estimate' | 'appraisal' | 'listing' | 'njop' | 'purchase';
export interface PriceRow { onDate: string; priceMicro: number }
export interface ValuationRow { asOf: string; valueMinor: number; basis: ValuationBasis }
export interface AssetValueInput {
  accountId: string; mode: ValuationMode; currency: string; ledgerBalanceMinor: number;
  position?: Position; prices?: PriceRow[]; valuations?: ValuationRow[];
}
export interface AssetValue {
  accountId: string; valueMinor: number; costMinor: number;
  source: 'ledger' | 'price' | 'valuation' | 'cost'; asOf: string | null;
}
export function assetValueAt(input: AssetValueInput, date: string): AssetValue;
export function isStaleValue(value: AssetValue, date: string): boolean; // price older than 30 days, valuation older than 365
```

- [ ] Tests (fail first): `derived mode returns the ledger balance`; `market mode multiplies units held on the date by the latest price on or before it`; `market mode with no price returns cost with source cost`; `a price dated after the asked date is ignored`; `snapshot mode returns the latest valuation that is not NJOP`; `snapshot mode ignores an NJOP row even when it is the newest`; `snapshot mode with no valuation returns cost`; `cost is the position cost for market holdings and the ledger balance otherwise`; `isStaleValue marks a price 31 days old and a valuation 366 days old`; `isStaleValue is false for a ledger balance`.
- [ ] Implement; run `npm test -w @expanses/core`; commit `feat(core): value of an asset at a date`.

### Task 5: Core — asset presets and Coretax field schema

**Files:** Create `packages/core/src/assets/presets.ts` and `packages/core/src/assets/coretax-fields.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/assets-coretax-fields.test.ts`.

**Interfaces — Produces:**
```ts
export type AssetKind = 'fund' | 'stock' | 'bond' | 'gold' | 'property' | 'vehicle' | 'other' | 'cash';
export type PlanGroup = 'liquid' | 'invest' | 'owed' | 'use';
export type UnitKind = 'units' | 'shares' | 'grams' | 'face';
export type Risk = 'low' | 'medium' | 'high';
export interface AssetPreset {
  kind: AssetKind; label: string; subtype: 'investment' | 'property' | 'vehicle' | 'bank' | 'cash' | 'savings';
  valuationMode: ValuationMode; unitKind: UnitKind | null; lotSize: number | null; risk: Risk | null;
  planGroup: PlanGroup; coretaxSection: CoretaxSection; coretaxCode: string; priceLabel: string | null;
}
export const ASSET_PRESETS: readonly AssetPreset[];
export function presetFor(kind: AssetKind): AssetPreset;

export type CoretaxSection = 'kas' | 'piutang' | 'investasi' | 'bergerak' | 'tidak_bergerak' | 'lainnya';
export type CoretaxFieldKind = 'text' | 'npwp' | 'country' | 'number' | 'year';
export interface CoretaxField { key: string; label: string; kind: CoretaxFieldKind; required: boolean }
export const CORETAX_SECTIONS: Record<CoretaxSection, { label: string; fields: readonly CoretaxField[] }>;
export function validateCoretaxFields(section: CoretaxSection, fields: Record<string, string>): { key: string; message: string }[];
export function missingCoretaxFields(section: CoretaxSection, fields: Record<string, string>): string[];
```

Presets (spec §4.3): fund → investment, market, units, risk high, invest, investasi `0306`; stock → investment, market, shares, lot 100, high, invest, investasi `0302`; bond → investment, market, face, low, invest, investasi `0304`; gold → investment, market, grams, medium, invest, lainnya `0701`; property → property, snapshot, use, tidak_bergerak `0502`; vehicle → vehicle, snapshot, use, bergerak `0403`; other → investment, snapshot, use, lainnya `0799`; cash → bank, derived, liquid, kas `0102`.

Fields per section follow spec §9.2 columns: `kas` (nomor akun, atas nama required, nama bank required, lokasi required); `investasi` (lokasi required, npwp, institusi required, sid); `bergerak` (merk/model required, nomor polisi required, kepemilikan required); `tidak_bergerak` (lokasi required, luas tanah required, luas bangunan required, sumber kepemilikan required, nomor sertifikat required); `lainnya` (bukti kepemilikan, informasi tambahan required); `piutang` (nama penerima required).

- [ ] Tests (fail first): `every preset names a Coretax section that exists`; `every preset code is four digits`; `presetFor('gold') uses grams, medium risk and the Harta Lainnya section`; `presetFor('stock') uses a lot size of 100`; `validateCoretaxFields rejects an NPWP that is not 16 digits`; `validateCoretaxFields rejects a country that is not a three-letter code`; `validateCoretaxFields accepts empty values and reports them only through missingCoretaxFields`; `missingCoretaxFields lists only required and empty keys`; `unknown keys are reported as unknown`.
- [ ] Implement; run `npm test -w @expanses/core`; commit `feat(core): asset presets and Coretax field schema`.

### Task 6: DB — migration 0007 and asset profiles

**Files:** Create `packages/db/migrations/0007_assets.sql`, `packages/db/src/schema-assets.ts`, `packages/db/src/repos/assets.ts`; modify `packages/db/src/migrations.ts`, `packages/db/src/index.ts`, `packages/db/src/repos/categories.ts`; test `packages/db/test/assets.test.ts`.

**Interfaces — Consumes:** `AssetKind`, `PlanGroup`, `UnitKind`, `Risk`, `CoretaxSection`, `presetFor` (Task 5).

**Interfaces — Produces:**
```ts
export interface AssetProfileRow {
  accountId: string; workspaceId: string; assetKind: AssetKind; planGroup: PlanGroup;
  unitKind: UnitKind | null; lotSize: number | null; risk: Risk | null;
  coretaxSection: CoretaxSection | null; coretaxCode: string | null; acquiredYear: number | null;
  coretaxFields: Record<string, string>; updatedAt: string;
}
export function getAssetProfile(database: Database, ws: WorkspaceContext, accountId: string): Promise<AssetProfileRow | undefined>;
export function listAssetProfiles(database: Database, ws: WorkspaceContext): Promise<AssetProfileRow[]>;
export function saveAssetProfile(database: Database, ws: WorkspaceContext, input: SaveAssetProfileInput): Promise<void>;
export function profileDefaults(kind: AssetKind): Omit<AssetProfileRow, 'accountId' | 'workspaceId' | 'updatedAt'>;
export class AssetError extends Error {}
```

Tables (`0007_assets.sql`, registered as version 7 name `assets`): `asset_profiles` (account_id PK REFERENCES accounts, workspace_id, asset_kind CHECK, plan_group CHECK, unit_kind CHECK NULL, lot_size, risk CHECK NULL, coretax_section CHECK NULL, coretax_code TEXT CHECK 4 digits, acquired_year INTEGER, coretax_fields_json TEXT NOT NULL DEFAULT '{}', updated_at); `investment_trades`; `prices`; `valuations`; `trade_templates` as in spec §4.1, each with `workspace_id` and foreign keys to `accounts`. Indexes: `investment_trades (workspace_id, account_id, occurred_on)`, `prices` UNIQUE `(account_id, on_date)`, `valuations (account_id, as_of)`.

`ensureCategoryKeys` gains `income.realized_gains` "Realized Gains" (income) and `government.final_tax` "Final Tax" (child of Government & Taxes), added to `ADDED_WITH_CATALOGUE`-style constants so existing workspaces get them on open.

- [ ] Tests (fail first): `migrate applies version 7 on a database populated through version 6 and keeps accounts, entries and catalogue rows`; `saveAssetProfile writes defaults from the preset`; `saveAssetProfile stores and reads Coretax fields as JSON`; `coretax_code rejects a three-digit code`; `profile of another workspace is not returned`; `ensureCategoryKeys adds Realized Gains and Final Tax once and is idempotent`.
- [ ] Implement; run `npm test -w @expanses/db`; commit `feat(db): asset profiles and migration 0007`.

### Task 7: DB — trades repository

**Files:** Create `packages/db/src/repos/trades.ts`; modify `packages/db/src/index.ts`; test `packages/db/test/trades.test.ts`.

**Interfaces — Consumes:** `tradePostings`, `tradeDescription` (Task 3), `positionAfter`, `TradeRecord`, `TradeError` (Task 2), `postTransactionTx`, `voidTransaction`, `replaceTransaction` (existing `repos/ledger.ts`).

**Interfaces — Produces:**
```ts
export interface TradeRow extends TradeRecord {
  workspaceId: string; transactionId: string | null; cashAccountId: string | null;
  templateId: string | null; status: 'active' | 'replaced' | 'deleted'; replacesTradeId: string | null;
}
export interface RecordTradeInput {
  accountId: string; kind: TradeKind; occurredOn: string; unitsMicro: number;
  grossMinor: number; feeMinor: number; taxMinor: number; cashAccountId: string | null; templateId?: string | null;
  ratesToBase?: Record<string, number>;
}
export interface TradeResult { tradeId: string; transactionId: string | null; recalculatedSells: { tradeId: string; oldBasisMinor: number; newBasisMinor: number }[] }
export function recordTrade(database: Database, ws: WorkspaceContext, input: RecordTradeInput): Promise<TradeResult>;
export function replaceTrade(database: Database, ws: WorkspaceContext, tradeId: string, input: RecordTradeInput): Promise<TradeResult>;
export function deleteTrade(database: Database, ws: WorkspaceContext, tradeId: string): Promise<TradeResult>;
export function listTrades(database: Database, ws: WorkspaceContext, opts?: { accountId?: string }): Promise<TradeRow[]>;
export function positionsFor(database: Database, ws: WorkspaceContext, upTo?: string): Promise<Record<string, Position>>;
```

Rules: everything runs inside one `database.transaction`; a cash account of `null` means the Opening Balances system account (opening positions); after writing, every active sell of the same holding dated on or after the new trade is recomputed, and any whose basis changed is replaced through `replaceTransaction` and reported in `recalculatedSells`; `unit_change` writes no transaction.

- [ ] Tests (fail first): `recordTrade posts the buy and moves the cash balance`; `an opening position posts against Opening Balances and leaves bank balances alone`; `a sell books the realized gain and leaves the ledger balanced`; `overselling throws and writes nothing`; `a backdated buy lowers the basis of a later sell and reports it in recalculatedSells`; `deleteTrade voids the transaction and recomputes later sells`; `replaceTrade keeps one active row and links replacesTradeId`; `listTrades returns active rows in date order`; `positionsFor returns units and cost per holding`; `a trade in another workspace is invisible`; `checkLedgerIntegrity stays empty after every case`.
- [ ] Implement; run `npm test -w @expanses/db`; commit `feat(db): record, replace and delete investment trades`.

### Task 8: DB — prices, valuations and asset values

**Files:** Create `packages/db/src/repos/prices.ts` and `packages/db/src/repos/asset-values.ts`; modify `packages/db/src/index.ts`; test `packages/db/test/prices.test.ts`, `packages/db/test/asset-values.test.ts`.

**Interfaces — Consumes:** `assetValueAt`, `isStaleValue`, `AssetValue` (Task 4), `positionsFor` (Task 7), `nativeBalances` (existing `repos/ledger.ts`), `parsePriceMicro` (Task 1).

**Interfaces — Produces:**
```ts
export function upsertPrice(database: Database, ws: WorkspaceContext, input: { accountId: string; onDate: string; priceMicro: number }): Promise<void>;
export function listPrices(database: Database, ws: WorkspaceContext, accountId: string): Promise<PriceRow[]>;
export function recordValuation(database: Database, ws: WorkspaceContext, input: { accountId: string; asOf: string; valueMinor: number; basis: ValuationBasis; note?: string | null }): Promise<void>;
export function listValuations(database: Database, ws: WorkspaceContext, accountId: string): Promise<(ValuationRow & { note: string | null })[]>;

export interface AssetValueRow extends AssetValue { name: string; currency: string; planGroup: PlanGroup; stale: boolean }
export function assetValuesAt(database: Database, ws: WorkspaceContext, date: string): Promise<AssetValueRow[]>;
export function netWorthAt(database: Database, ws: WorkspaceContext, date: string, ratesToBase: Record<string, number>): Promise<{ assetsMinor: number; liabilitiesMinor: number; netWorthMinor: number }>;
export function monthEndValues(database: Database, ws: WorkspaceContext, accountId: string, months: string[]): Promise<number[]>;
```

- [ ] Tests (fail first): `upsertPrice replaces the price for the same date`; `listPrices returns newest first`; `recordValuation keeps every row so history stays`; `assetValuesAt uses ledger balances for bank accounts and units times price for holdings`; `assetValuesAt falls back to cost and marks the source when no price exists`; `assetValuesAt marks stale prices and valuations`; `netWorthAt subtracts liabilities and converts a USD holding at the given rate`; `netWorthAt on an earlier date ignores later trades and prices`; `monthEndValues returns one value per month in order`.
- [ ] Implement; run `npm test -w @expanses/db`; commit `feat(db): prices, valuations and asset values`.

### Task 9: DB — monthly buy templates

**Files:** Create `packages/db/src/repos/trade-templates.ts`; modify `packages/db/src/index.ts`; test `packages/db/test/trade-templates.test.ts`.

**Interfaces — Consumes:** `listTrades` (Task 7).

**Interfaces — Produces:**
```ts
export interface TradeTemplateRow {
  id: string; workspaceId: string; accountId: string; cashAccountId: string;
  amountMinor: number | null; unitsMicro: number | null; dayOfMonth: number; active: boolean; createdAt: string;
}
export function listTradeTemplates(database: Database, ws: WorkspaceContext): Promise<TradeTemplateRow[]>;
export function saveTradeTemplate(database: Database, ws: WorkspaceContext, input: Omit<TradeTemplateRow, 'workspaceId' | 'createdAt'> & { id?: string }): Promise<string>;
export function deleteTradeTemplate(database: Database, ws: WorkspaceContext, id: string): Promise<void>;
export function dueTemplates(database: Database, ws: WorkspaceContext, onDate: string): Promise<TradeTemplateRow[]>;
```

`dueTemplates` returns active templates whose `dayOfMonth` is on or before `onDate`'s day, with no active trade carrying that `templateId` in the same calendar month.

- [ ] Tests (fail first): `saveTradeTemplate requires exactly one of amount or units`; `dayOfMonth outside 1..28 is rejected`; `dueTemplates lists a template whose day has passed with nothing recorded`; `dueTemplates skips a template already recorded this month`; `dueTemplates skips inactive templates`; `dueTemplates ignores a trade recorded last month`; `deleteTradeTemplate leaves past trades in place`.
- [ ] Implement; run `npm test -w @expanses/db`; commit `feat(db): monthly buy templates`.

### Task 10: Web — Net worth section and Assets list

**Files:** Create `apps/web/src/features/networth/AssetsPage.tsx`, `asset-rows.ts`, `labels.ts`, `queries.ts`, `asset-rows.test.ts`; modify `apps/web/src/app/router.tsx`, `apps/web/src/app/Layout.tsx`, `apps/web/src/lib/queries.ts`.

**Interfaces — Consumes:** `assetValuesAt`, `listAssetProfiles` (Tasks 6, 8).

**Interfaces — Produces:**
```ts
export interface AssetRow { accountId: string; name: string; planGroup: PlanGroup; valueMinor: number; currency: string; method: string; coretax: string; stale: boolean }
export function groupAssets(values: AssetValueRow[], profiles: AssetProfileRow[]): { group: PlanGroup; label: string; totalMinor: number; rows: AssetRow[] }[];
export const PLAN_GROUP_LABELS: Record<PlanGroup, string>;
export const METHOD_LABELS: Record<ValuationMode, string>;
export function useAssetValues(date?: string): UseQueryResult<AssetValueRow[]>;
```

Routes `/net-worth/assets`, `/net-worth/assets/$accountId`, `/net-worth/trades`; sidebar and mobile nav gain **Net worth** pointing at `/net-worth/assets`; the page shows groups with totals, per-row value, method tag, Coretax code and section, an update badge, a collapsed **Sold** section for holdings with no units, and an **Update prices** button.

- [ ] Tests (fail first, `apps/web/src/features/networth/asset-rows.test.ts`): `groupAssets orders groups liquid, invest, owed, use`; `group totals add the rows`; `a holding with zero units is marked sold and kept out of the totals`; `a stale price sets the badge`; `method label follows the valuation mode`.
- [ ] Implement; run `npm test -w @expanses/web` and `npm run typecheck`; commit `feat(web): net worth section with the assets list`.

### Task 11: Web — Add asset flow

**Files:** Create `apps/web/src/features/networth/AddAssetForm.tsx`; modify `apps/web/src/features/networth/AssetsPage.tsx`, `apps/web/src/features/accounts/AccountsPage.tsx`; test `apps/web/src/features/networth/labels.test.ts`.

**Interfaces — Consumes:** `ASSET_PRESETS`, `presetFor`, `CORETAX_SECTIONS` (Task 5), `createAccount` (existing), `saveAssetProfile` (Task 6), `recordTrade` (Task 7), `recordValuation` (Task 8).

The form asks: what it is (the eight presets), name, currency, then per preset — holdings ask optional past purchases (date, units, total cost) recorded as opening positions with `cashAccountId: null`; property, vehicle and other assets ask purchase date, cost (posted as an opening balance) and an optional estimate; bank, cash and deposit reuse the existing account form and only write a profile. Coretax fields for the chosen section are shown, all optional.

- [ ] Tests (fail first): `preset choice sets subtype, valuation mode, unit kind and Coretax defaults`; `holding presets show the past-purchase rows and property presets show cost and estimate`; `Coretax fields shown are exactly the section's fields`.
- [ ] Implement; run web unit tests and typecheck; commit `feat(web): add assets from presets with opening positions`.

### Task 12: Web — Asset detail

**Files:** Create `apps/web/src/features/networth/AssetDetailPage.tsx`, `PriceForm.tsx`, `ValuationForm.tsx`, `CoretaxFieldsForm.tsx`, `ValueChart.tsx`, `UpdatePricesSheet.tsx`.

**Interfaces — Consumes:** `assetValueAt` inputs through `useAssetValues`, `monthEndValues`, `listPrices`, `listValuations`, `upsertPrice`, `recordValuation` (Task 8), `listTrades` (Task 7), `validateCoretaxFields`, `missingCoretaxFields` (Task 5), `formatUnits`, `formatPriceMicro`, `parsePriceMicro` (Task 1), `archiveAccount` (existing).

**Interfaces — Produces:**
```ts
export function ValueChart({ points, labels, currency }: { points: number[]; labels: string[]; currency: string }): ReactElement; // hand-written SVG, tabular labels, no library
```

Detail shows value, cost and gain; the method line with average cost for holdings; the price form (holdings) or valuation form with a basis select (property, vehicle, other); a 12-month chart from `monthEndValues`; history (trades, valuations or transactions); the Coretax fields form with Missing markers; Archive, enabled only at zero units or zero balance. `UpdatePricesSheet` lists every stale holding with one input each and saves them together.

- [ ] Tests (fail first, `apps/web/src/features/networth/value-chart.test.ts`): `chart scales points into the view box and labels the last value`; `a flat series still renders a line`; `price form parses id-ID input into price_micro`; `valuation form requires a basis`; `archive is disabled while units remain`.
- [ ] Implement; run web unit tests and typecheck; commit `feat(web): asset detail with prices, estimates and Coretax fields`.

### Task 13: Web — Buy & sell page

**Files:** Create `apps/web/src/features/networth/TradesPage.tsx`, `HoldingsTable.tsx`, `TradeForm.tsx`, `TemplateList.tsx`; test `apps/web/src/features/networth/trade-form.test.ts`.

**Interfaces — Consumes:** `recordTrade`, `replaceTrade`, `deleteTrade`, `listTrades`, `positionsFor` (Task 7), `dueTemplates`, `saveTradeTemplate`, `deleteTradeTemplate` (Task 9), `parseUnits`, `parsePriceMicro`, `priceMicroFrom` (Task 1), `sellBasisMinor` (Task 2).

**Interfaces — Produces:**
```ts
export interface TradeDraft { kind: TradeKind; accountId: string; occurredOn: string; units: string; gross: string; fee: string; tax: string; cashAccountId: string }
export function draftToInput(draft: TradeDraft, currency: string): RecordTradeInput;   // throws with a plain message
export function sellPreview(draft: TradeDraft, position: Position, currency: string): { basisMinor: number; realizedMinor: number } | null;
```

Page: holdings table (units, average cost, cost basis, value, unrealized, realized this year, income this year); record form with the price-per-unit check and sell preview; due monthly buys with Record prefilled; template management; history with a holding filter, edit and delete, and a notice naming how many later sells changed.

- [ ] Tests (fail first): `draftToInput parses units and amounts and rejects empty units on a buy`; `draftToInput on a dividend ignores units`; `sellPreview shows basis and gain before saving`; `sellPreview returns null when units exceed the position`; `a date after today is rejected with a plain message`.
- [ ] Implement; run web unit tests and typecheck; commit `feat(web): buy and sell page with holdings and templates`.

### Task 14: Web — other screens, end-to-end tests and docs

**Files:** Modify `apps/web/src/features/transactions/TransactionsPage.tsx`, `apps/web/src/features/accounts/AccountsPage.tsx`, `apps/web/src/features/dashboard/DashboardPage.tsx`; create `apps/web/e2e/assets.spec.ts`; modify `docs/superpowers/plans/2026-09-12-asset-values-and-trades.md` (execution notes) and `README.md` if it lists features.

**Interfaces — Consumes:** everything above.

Transactions page labels trade transactions "Buy · Equity fund" with a link to Buy & sell and blocks editing them there ("Edit this on Buy & sell so units stay in step"). Accounts page shows value first and cost second for market and snapshot accounts, linking to asset detail. Dashboard net worth uses `netWorthAt`.

- [ ] E2E (`apps/web/e2e/assets.spec.ts`, fail first): `add gold with two past purchases, then a buy, then a partial sell: units, average cost, realized gain and the bank balance are right and spending is unchanged`; `update prices sheet saves two prices and the assets list loses its badges`; `a trade transaction cannot be edited from the Transactions page`; `dashboard net worth changes only by the price difference after a price update`.
- [ ] Implement; run `npm test`, `npm run typecheck`, `npm run e2e`; commit `feat(web): assets across transactions, accounts and dashboard`.
- [ ] Record execution notes at the end of this plan (what changed from the plan, anything deferred); commit `docs: record slice 1 execution status`.

---

## Self-review

**Spec coverage (§3, §4):** value modes and `valueAt` (Task 4, 8); units and price storage (Task 1, 6); `asset_profiles` and Coretax fields (Task 5, 6, 12); trades table and postings (Task 3, 7); average cost and backdated recompute (Task 2, 7); opening positions (Task 7, 11); foreign-currency holdings (Task 7 `ratesToBase`, Task 8 `netWorthAt`); prices and valuations (Task 8); staleness badges (Task 4, 10, 12); templates and due list (Task 9, 13); screens (Tasks 10–14); new category keys (Task 6); Transactions, Accounts and Dashboard changes (Task 14).

**Not in this slice, by design:** goal tags, lend and borrow, loan terms, the Coretax report and export. `byYear` ships early as noted in Deviations.

---

## Execution status (2026-09-12)

All 14 tasks done on `feat/net-worth`, one commit each, gate green after every task.

**Changed from the plan during execution**

- `voidTransactionTx` in `packages/db/src/repos/ledger.ts` is now exported, so a trade and the sells it disturbs are voided and reposted inside one database transaction.
- `TradeAccounts` gained `currencyExchangeAccountId` and `TradeInput` gained `cashMinor`: a holding bought from an account in another currency posts through Currency Exchange, with the amount in the cash currency. `TradeErrorCode` gained `CURRENCY_MISMATCH`.
- `AssetValueRow` carries `unitsMicro`, so the assets list can tell a sold holding from one worth nothing.
- `TradeForm` takes `templateId`, so a buy recorded from a monthly template counts as that month's buy.
- New shared component `NetWorthTabs` (Assets · Buy & sell) instead of tabs repeated per page.
- `packages/core/src/assets/value.ts` also exports `PRICE_STALE_DAYS` and `VALUATION_STALE_DAYS`.
- Two existing db tests were updated for the two new default categories: `database.test.ts` expects migrations 1–7, and `categories.test.ts` deletes child categories before their parents (SQLite foreign keys) and lists `government.final_tax` and `income.realized_gains` among the defaults a v0 workspace lacks.
- The `web` unit tests for Task 12 cover `value-chart.ts` (the geometry behind `ValueChart`), since the web test runner only picks up `.test.ts`, not component tests.

**Counts at the end of the slice:** core 192, catalog 52, db 117, web 77, e2e 20.

**Left for later slices, as designed:** goal tags on trades, lend and borrow, loan terms, the Coretax report and its export, and the net worth overview with ratios (slice 2).
