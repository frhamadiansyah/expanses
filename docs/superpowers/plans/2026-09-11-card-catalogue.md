# Credit Card Points Catalogue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Format:** fast track, as chosen by the owner for v0. Each task gives files, exact interfaces, and the named test cases that must be written first and fail before implementation. Code is written during execution, not in this document.

**Goal:** Users apply a verified bank card entry from a bundled catalogue instead of writing earn rules, with automatic dated updates, tiered cycle bonuses, original-currency bonuses, refunds, and transfer-partner comparisons.

**Architecture:** New `packages/catalog` (entry JSON, validation, planning, diff, description) depends on `@expanses/core`. The points engine in core gains cycle bonuses, refunds, currency and merchant matching, and transfer conversion. `packages/db` gains migration 0004, category keys, bonus and partner repositories, and a catalogue repository that applies plans. `apps/web` adds the catalogue picker, catalogue card page, original-currency entry, and compare-in recommender.

**Tech Stack:** unchanged from v0 (TypeScript 7, Vitest 5, Drizzle sqlite-proxy, better-sqlite3 tests, Vite 8, React 19, TanStack Router/Query, Playwright). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-card-catalogue-design.md`

## Global Constraints

- All v0 global constraints apply (`docs/superpowers/plans/2026-09-11-v0-local-build.md`).
- Catalogue rules reference category **keys**, never account ids.
- Every catalogue terms period, fee period, bonus, and partner becomes rows with `valid_from`/`valid_to`; applying or updating an entry never changes how past cycles compute.
- Every bundled entry must pass `validateEntry` in tests.
- Refund lines are negative `amountMinor` on `SpendLine`; per-rule spend and points never go below zero.
- `CATALOG_REPORT_EMAIL` is `null`; the Report a change button renders only when it is a non-empty string.
- Reports never include transactions, balances, or account names.
- No network calls added.

## Deviations from spec, recorded

- `planCatalogApply`, `diffCatalogEntries`, and `describeEntry` live in `packages/catalog`, not `packages/core` (spec §7.1), so core never depends on the catalogue format.
- The default category tree (names and keys) moves to `packages/core/src/categories/defaults.ts`; `packages/db/src/seed.ts` re-exports it. Catalogue validation needs the keys and db will depend on the catalogue.
- `reward_programs` also gains `catalog_snapshot_json TEXT`: the applied entry, so update diffs compare applied terms with current terms (spec §7.3 assumed a version number was enough).
- `CycleEarn` reports `bonusById` and `eligibleSpendByBonus` keyed by bonus row id (spec §5.3 said `bonusByKey`); keys repeat across terms periods.

## File Structure

```
packages/core/src/
  categories/defaults.ts        DEFAULT_CATEGORIES with keys, DEFAULT_CATEGORY_KEYS
  money/currencies.ts           + TWD
  points/earn.ts                RuleMatch, SpendLine, CycleBonus, computeCycleEarn (bonuses, refunds)
  points/transfer.ts            TransferPartner, convertPoints, estimatePartnerUnits, partnerFor
  points/recommend.ts           CompareTarget, candidates with bonuses and partners
packages/core/test/
  points-catalogue.test.ts      golden tests for engine changes
  transfer.test.ts
  categories.test.ts

packages/catalog/                 new package
  package.json  tsconfig.json  vitest.config.ts
  entries/bca-sq-krisflyer-visa-signature.json
  entries/bca-sq-krisflyer-visa-infinite.json
  entries/bca-unionpay.json
  src/types.ts                  CatalogEntry and nested types
  src/validate.ts               validateEntry
  src/index.ts                  CATALOG, findEntry, termsOn, feeOn, isStale
  src/plan.ts                   planCatalogApply
  src/diff.ts                   diffCatalogEntries
  src/describe.ts               describeEntry (plain-language preview lines)
  test/entries.test.ts  validate.test.ts  plan.test.ts  diff.test.ts  describe.test.ts

packages/db/
  migrations/0004_catalog.sql
  src/schema.ts                 transactions + original_currency, original_amount_minor
  src/schema-points.ts          reward_programs/earn_rules/redemption_options additions, cycleBonuses, transferPartners
  src/seed.ts                   re-export defaults from core; createWorkspace sets category keys
  src/repos/categories.ts       ensureCategoryKeys
  src/repos/ledger.ts           original currency on post/list
  src/repos/points.ts           cardSpendLines refunds + original currency; bonus and partner repos; customised flip
  src/repos/catalog.ts          apply, sync, update, dismiss, reset, state
  test/categories.test.ts  catalog.test.ts  points-bonus.test.ts

apps/web/src/
  db/bootstrap.ts               ensureCategoryKeys + syncLinkedPrograms on open
  lib/catalog-config.ts         CATALOG_REPORT_EMAIL, reportMailto
  lib/catalog-config.test.ts
  features/cards/useCardPoints.ts       load bonuses, partners, catalogue state
  features/cards/CatalogPicker.tsx      search + preview + apply
  features/cards/CatalogPanel.tsx       badge, sources, stale, update banner, reset, notes, report
  features/cards/BonusProgress.tsx
  features/cards/CardDetailPage.tsx     integrate picker, panel, progress, transfer estimates
  features/cards/RecommendPage.tsx      compare-in + original currency
  features/transactions/draft.ts        originalCurrency/originalAmount
  features/transactions/TransactionForm.tsx
  features/transactions/TransactionsPage.tsx
apps/web/e2e/catalogue.spec.ts
```

## Tasks

| # | Task | Drop |
|---|---|---|
| 1 | Core: default categories with keys, TWD | A |
| 2 | Core: original currency and merchant exclusions | A |
| 3 | Core: tiered cycle bonuses | A |
| 4 | Core: refunds | A |
| 5 | Core: transfer conversion and compare-in recommender | A |
| 6 | Catalog: types, entries, validation, lookup | A |
| 7 | Catalog: plan, diff, describe | A |
| 8 | DB: migration 0004, schema, category keys | B |
| 9 | DB: original currency, refund-aware spend lines, bonus and partner repos | B |
| 10 | DB: catalogue repository | B |
| 11 | Web: bootstrap sync and card points loading | C |
| 12 | Web: catalogue picker and preview | C |
| 13 | Web: catalogue card page | C |
| 14 | Web: original currency in transactions | C |
| 15 | Web: compare-in recommender | C |
| 16 | E2E, preview rebuild, docs | C |

---

### Task 1: Core — default categories with keys, TWD

**Files:** Create `packages/core/src/categories/defaults.ts`; modify `packages/core/src/money/currencies.ts`, `packages/core/src/index.ts`, `packages/db/src/seed.ts`, `packages/db/src/repos/workspaces.ts`; test `packages/core/test/categories.test.ts`, `packages/db/test/accounts.test.ts`.

**Interfaces — Produces:**
```ts
export interface DefaultCategory { key: string; name: string; kind: 'expense' | 'income'; children?: { key: string; name: string }[] }
export const DEFAULT_CATEGORIES: readonly DefaultCategory[];      // spec §4 tree, including new Gas, Government & Taxes, Gifts, Donations
export const DEFAULT_CATEGORY_KEYS: ReadonlySet<string>;           // every parent and child key
```

- [ ] Tests (fail first): `every default category and child has a unique key`; `keys include utilities.gas, government, gifts_donations.gifts, gifts_donations.donations`; `TWD has exponent 2`; db `createWorkspace sets system_key on every default category`.
- [ ] Implement; `packages/db/src/seed.ts` re-exports from core and keeps `SYSTEM_ACCOUNTS`.
- [ ] Run core and db tests; commit `feat(core): key default categories and add TWD`.

### Task 2: Core — original currency and merchant exclusions

**Files:** Modify `packages/core/src/points/earn.ts`; test `packages/core/test/points-catalogue.test.ts`.

**Interfaces — Produces:**
```ts
export interface RuleMatch { categoryIds?: string[]; excludeCategoryIds?: string[]; merchantPatterns?: string[]; excludeMerchantPatterns?: string[]; currencies?: string[] }
export interface SpendLine { transactionId: string; entryId: string; occurredOn: string; categoryId: string; description: string; amountMinor: number; currency: string; originalCurrency: string | null }
```
`ruleMatches` compares `currencies` with `line.originalCurrency ?? line.currency` and rejects any `excludeMerchantPatterns` substring match.

- [ ] Tests: `UnionPay double rule matches SGD original currency on an IDR card`; `IDR purchase does not match SGD-only rule`; `excludeMerchantPatterns rejects Prudential case-insensitively`; existing points tests updated with `originalCurrency: null` still pass.
- [ ] Implement; run core tests; commit `feat(core): match rules on original currency and exclude merchants`.

### Task 3: Core — tiered cycle bonuses

**Files:** Modify `packages/core/src/points/earn.ts`; test `packages/core/test/points-catalogue.test.ts`.

**Interfaces — Produces:**
```ts
export interface BonusTier { minSpendMinor: number; bonus: number }
export interface CycleBonus { id: string; key: string; name: string; tiers: BonusTier[]; match: RuleMatch; validFrom: string | null; validTo: string | null }
export interface CycleEarn {
  allocations: EarnAllocation[]; pointsByRule: Record<string, number>; spendByRule: Record<string, number>;
  bonusById: Record<string, number>; eligibleSpendByBonus: Record<string, number>;
  totalPoints: number; unearnedSpendMinor: number;
}
export function computeCycleEarn(lines: SpendLine[], rules: EarnRule[], ancestors: Record<string, string[]>, options?: { bonuses?: CycleBonus[]; cycleEnd?: string }): CycleEarn
export function nextBonusTier(bonus: CycleBonus, eligibleSpendMinor: number): BonusTier | null
```
Eligible spend: lines matching `bonus.match`, each line checked against the bonus validity window by its date; award the highest tier reached once, only if the bonus is valid on `cycleEnd` (or the latest line date when omitted).

- [ ] Tests: `Signature pays 0 at 19.999.999 and 1.000 at 20.000.000`; `Infinite pays 1.000 at 20 juta, 2.000 at 50 juta, 2.000 at 60 juta`; `excluded utilities spend does not count toward the bonus`; `bonus outside its validity window pays nothing`; `nextBonusTier reports the next unreached tier`.
- [ ] Implement; run core tests; commit `feat(core): tiered cycle spend bonuses`.

### Task 4: Core — refunds

**Files:** Modify `packages/core/src/points/earn.ts`; test `packages/core/test/points-catalogue.test.ts`.

**Behaviour:** a negative line runs through matching primary rules by priority, deducting `min(remaining refund, spendByRule)` and points computed with the rule's rate and rounding on the deducted amount; stackable rules deduct independently; never below zero; negative allocations recorded; refunds reduce bonus eligible spend (floored at zero).

- [ ] Tests: `Rp 100.000 purchase then Rp 100.000 refund in the same cycle nets 0 points`; `partial refund deducts proportional rounded points`; `refund alone in a later cycle floors points at 0`; `refund reduces bonus eligible spend below a tier`; `property: totals never negative for random purchases and refunds`.
- [ ] Implement; run core tests; commit `feat(core): deduct refunds from cycle points`.

### Task 5: Core — transfer conversion and compare-in recommender

**Files:** Create `packages/core/src/points/transfer.ts`; modify `packages/core/src/points/recommend.ts`, `packages/core/src/index.ts`; tests `packages/core/test/transfer.test.ts`, `packages/core/test/points.test.ts`.

**Interfaces — Produces:**
```ts
export interface TransferPartner { id: string; key: string; program: string; points: number; partnerUnits: number; incrementPoints: number; validFrom: string | null; validTo: string | null }
export function convertPoints(points: number, partner: Pick<TransferPartner, 'points' | 'partnerUnits' | 'incrementPoints'>): number
export function estimatePartnerUnits(points: number, partner: Pick<TransferPartner, 'points' | 'partnerUnits'>): number
export function partnerFor(partners: TransferPartner[], program: string, onDate: string): TransferPartner | null

export type CompareTarget = { kind: 'value' } | { kind: 'program'; program: string };
export interface CardCandidate { cardAccountId: string; cardName: string; currency: string; programName: string | null; rules: EarnRule[]; bonuses: CycleBonus[]; transferPartners: TransferPartner[]; cycleLines: SpendLine[]; bestRedemption: Redemption | null }
export interface PurchaseQuery { amountMinor: number; currency: string; originalCurrency: string | null; categoryId: string; description: string; occurredOn: string }
export interface Recommendation { cardAccountId: string; cardName: string; eligible: boolean; points: number; valueMinor: number | null; valueCurrency: string | null; effectiveRateBps: number | null; comparable: boolean; compareUnits: number | null; capHeadroom: { ruleId: string; ruleName: string; remainingMinor: number }[] }
export function recommendCards(query: PurchaseQuery, candidates: CardCandidate[], ancestors: Record<string, string[]>, target?: CompareTarget): Recommendation[]
```
Marginal points include bonus tier changes. Program comparison: direct when `programName === target.program`, else `estimatePartnerUnits` via `partnerFor`; not comparable ranks last.

- [ ] Tests: `1.240 UnionPay → KrisFlyer = 620`; `1.240 → GarudaMiles = 820`; `partnerFor respects validity dates`; `compare in KrisFlyer ranks Infinite direct miles against UnionPay converted miles`; `purchase crossing the 20 juta threshold adds the 1.000 bonus to marginal points`; `card without a route to the target is not comparable and ranks last`.
- [ ] Implement; run core tests and web typecheck (RecommendPage adapts in Task 15; pass `{ kind: 'value' }` default meanwhile); commit `feat(core): transfer partners and compare-in recommendations`.

### Task 6: Catalog — types, entries, validation, lookup

**Files:** Create the `packages/catalog` package, the three entry JSON files per spec §9.1, §9.2, §9.3, `src/types.ts`, `src/validate.ts`, `src/index.ts`; tests `test/validate.test.ts`, `test/entries.test.ts`. Add `@expanses/catalog` to root workspaces install.

**Interfaces — Produces:**
```ts
export interface CatalogMatch { categoryKeys?: string[]; excludeCategoryKeys?: string[]; merchantPatterns?: string[]; excludeMerchantPatterns?: string[]; currencies?: string[] }
export interface CatalogRule { key: string; name: string; rateNum: number; rateDen: number; rounding: Rounding; priority: number; stackable: boolean; match: CatalogMatch; capSpendMinor?: number | null; capPoints?: number | null; minTransactionMinor?: number | null }
export interface CatalogCycleBonus { key: string; name: string; tiers: BonusTier[]; match: CatalogMatch }
export interface CatalogTermsPeriod { effectiveFrom: string | null; effectiveTo: string | null; rules: CatalogRule[]; cycleBonuses: CatalogCycleBonus[] }
export interface CatalogFeePeriod { effectiveFrom: string | null; effectiveTo: string | null; annualFeeMinor: number; supplementaryFeeMinor: number | null }
export interface CatalogTransferPartner { key: string; program: string; points: number; partnerUnits: number; incrementPoints: number; effectiveFrom: string | null; effectiveTo: string | null }
export interface CatalogEntry {
  id: string; entryVersion: number; bank: string; name: string; network: string; currency: string;
  program: { unit: 'points' | 'miles' | 'cashback'; name: string; cycleAnchor: 'statement' | 'calendar' };
  fees: CatalogFeePeriod[]; terms: CatalogTermsPeriod[]; transferPartners: CatalogTransferPartner[];
  cashValue: { valueMinor: number; perPoints: number; currency: string } | null;
  welcomeBonus: string | null; notes: string[]; sources: { title: string; url: string }[]; verifiedOn: string;
}
export function validateEntry(entry: unknown, knownCategoryKeys: ReadonlySet<string>): string[];
export const CATALOG: readonly CatalogEntry[];
export function findEntry(id: string): CatalogEntry | undefined;
export function termsOn(entry: CatalogEntry, date: string): CatalogTermsPeriod | null;
export function feeOn(entry: CatalogEntry, date: string): CatalogFeePeriod | null;
export function isStale(entry: CatalogEntry, today: string, maxAgeDays?: number): boolean;
```

- [ ] Tests: `every bundled entry validates against DEFAULT_CATEGORY_KEYS`; rejection cases `missing sources`, `missing verifiedOn`, `overlapping periods`, `unordered periods`, `descending tiers`, `zero rateDen`, `unknown category key`, `duplicate rule key in a period`; `termsOn picks the Prudential period on 2025-09-23 and the earlier one on 2025-09-22`; `feeOn returns Infinite Rp 750.000 on 2026-06-02 and Rp 1.000.000 on 2026-06-03`; `isStale is false at 180 days and true at 181`.
- [ ] Implement entries exactly as spec §9 (KrisFlyer cards: two terms periods split at 2025-09-23; UnionPay: base excluding `fees`, stackable double on `SGD, HKD, CNY, TWD`, four partners with GarudaMiles effective 2025-11-01, cash value Rp 20 per point).
- [ ] Run catalog tests; commit `feat(catalog): verified BCA entries with validation`.

### Task 7: Catalog — plan, diff, describe

**Files:** Create `packages/catalog/src/plan.ts`, `src/diff.ts`, `src/describe.ts`; tests `test/plan.test.ts`, `test/diff.test.ts`, `test/describe.test.ts`.

**Interfaces — Produces:**
```ts
export interface PlannedRule extends Omit<EarnRule, 'id'> { catalogKey: string }
export interface PlannedBonus extends Omit<CycleBonus, 'id'> { catalogKey: string }
export interface PlannedPartner extends Omit<TransferPartner, 'id'> { catalogKey: string }
export interface CatalogPlan {
  program: CatalogEntry['program'];
  rules: PlannedRule[]; bonuses: PlannedBonus[]; transferPartners: PlannedPartner[];
  cashValue: CatalogEntry['cashValue']; annualFeeMinor: number | null; unmappedKeys: string[];
}
export function planCatalogApply(entry: CatalogEntry, categoryIdsByKey: Record<string, string>, today: string): CatalogPlan;
export function diffCatalogEntries(applied: CatalogEntry, current: CatalogEntry): string[];
export function describeEntry(entry: CatalogEntry, today: string): { heading: string; lines: string[] };
```
Plan `catalogKey` format: `<periodEffectiveFrom|start>:<rule or bonus key>` for rules and bonuses, `<partner key>` for partners.

- [ ] Tests: `Signature plan has two base rules dated 2024-08-12..2025-09-22 and 2025-09-23..null`; `category keys map to account ids and unmapped keys are reported`; `UnionPay plan includes four partners and cash value`; `Infinite plan fee on 2026-09-11 is Rp 1.000.000`; diff `reports base rate change 13.500 → 15.000`, `reports added excluded merchant`, `reports new tier`, `reports fee change`, `returns [] for identical entries`; describe `Infinite lines mention both tiers, exclusions with dates, and the current fee`.
- [ ] Implement; run catalog tests; commit `feat(catalog): plan, diff, and describe entries`.

### Task 8: DB — migration 0004, schema, category keys

**Files:** Create `packages/db/migrations/0004_catalog.sql`, `src/repos/categories.ts`; modify `src/migrations.ts`, `src/schema.ts`, `src/schema-points.ts`, `src/index.ts`, `test/database.test.ts`; test `test/categories.test.ts`.

**Migration:** per spec §6 plus `reward_programs.catalog_snapshot_json TEXT`.

**Interfaces — Produces:**
```ts
export async function ensureCategoryKeys(database: Database, ws: WorkspaceContext): Promise<{ keyed: string[]; created: string[] }>;
export async function categoryIdsByKey(database: Database, ws: WorkspaceContext): Promise<Record<string, string>>;
```

- [ ] Tests: `migrate applies [1,2,3,4]`; `ensureCategoryKeys keys an old workspace seeded without keys`; `creates Gas, Government & Taxes, Gifts, Donations`; `skips a renamed default`; `second run changes nothing`; `categoryIdsByKey returns only keyed, active categories`.
- [ ] Implement; run db tests; commit `feat(db): catalogue schema and category keys`.

### Task 9: DB — original currency, refund-aware spend lines, bonus and partner repos

**Files:** Modify `src/repos/ledger.ts`, `src/repos/points.ts`, `src/index.ts`; tests `test/ledger.test.ts`, `test/points-bonus.test.ts`.

**Interfaces — Produces:**
```ts
// ledger
interface PostTransactionInput { /* existing */ originalCurrency?: string | null; originalAmountMinor?: number | null }
interface TransactionView { /* existing */ originalCurrency: string | null; originalAmountMinor: number | null }
// points
export async function cardSpendLines(database, ws, cardAccountId, from, to): Promise<SpendLine[]>; // now includes refunds and originalCurrency
export async function listCycleBonuses(database, ws, programId): Promise<CycleBonus[]>;
export async function saveCycleBonus(database, ws, programId, bonus: Omit<CycleBonus, 'id'> & { id?: string; catalogKey?: string | null }): Promise<string>;
export async function archiveCycleBonus(database, ws, bonusId): Promise<void>;
export async function listTransferPartners(database, ws, programId): Promise<TransferPartner[]>;
export async function saveTransferPartner(database, ws, programId, partner: Omit<TransferPartner, 'id'> & { id?: string; catalogKey?: string | null }): Promise<string>;
export async function archiveTransferPartner(database, ws, partnerId): Promise<void>;
```
`saveEarnRule`, `archiveEarnRule`, `saveRedemptionOption`, `deleteRedemptionOption`, and the new bonus and partner mutations set `catalog_status = 'customised'` when the program is linked, unless called with an internal `{ fromCatalog: true }` option used only by the catalogue repository.

- [ ] Tests: `original currency round-trips through post, replace, and list`; `cardSpendLines returns a card refund as a negative line`; `statement payments still never appear`; `bonus and partner CRUD round-trip with JSON tiers and match`; `editing a rule on a linked program marks it customised`; `catalogue-internal writes keep it linked`.
- [ ] Implement; run db tests; commit `feat(db): original currency, refunds, bonuses, and transfer partners`.

### Task 10: DB — catalogue repository

**Files:** Create `src/repos/catalog.ts`; modify `package.json` (depend on `@expanses/catalog`), `src/index.ts`; test `test/catalog.test.ts`.

**Interfaces — Produces:**
```ts
export interface CatalogState { entryId: string | null; entryVersion: number | null; status: 'linked' | 'customised' | null; dismissedVersion: number | null; snapshot: CatalogEntry | null }
export async function getCatalogState(database, ws, programId): Promise<CatalogState>;
export async function applyCatalogEntry(database, ws, input: { cardAccountId: string; entry: CatalogEntry; today: string; replaceManual: boolean }): Promise<{ programId: string; unmappedKeys: string[] }>;
export async function syncLinkedPrograms(database, ws, catalog: readonly CatalogEntry[], today: string): Promise<string[]>;
export async function applyCatalogUpdate(database, ws, programId: string, entry: CatalogEntry, today: string): Promise<void>;
export async function dismissCatalogVersion(database, ws, programId: string, version: number): Promise<void>;
export async function resetToCatalog(database, ws, programId: string, entry: CatalogEntry, today: string): Promise<void>;
```
Apply creates the program if missing, archives catalogue-keyed rows (and manual rows when `replaceManual`), inserts the plan, writes redemption cash value with `catalog_key`, sets the card's `annual_fee_minor` when card terms exist, stores snapshot, version, and `linked`. Throws when the card has manual rules and `replaceManual` is false.

- [ ] Tests: `apply Signature creates dated rules, bonus, and linked state`; `apply refuses to replace manual rules without consent`; `sync re-applies a linked program with a higher entryVersion and leaves customised ones alone`; `past-cycle points are unchanged after a sync that changes the rate from a later date`; `applyCatalogUpdate keeps user-added rules`; `dismiss stores the version`; `reset removes user rules and relinks`; `apply sets the card annual fee and never the statement day`.
- [ ] Implement; run db tests and typecheck; commit `feat(db): apply and update catalogue entries`.

### Task 11: Web — bootstrap sync and card points loading

**Files:** Modify `apps/web/package.json` (depend on `@expanses/catalog`), `src/db/bootstrap.ts`, `src/features/cards/useCardPoints.ts`, `src/features/cards/RecommendPage.tsx` (pass bonuses and partners); test existing e2e.

**Interfaces — Produces:** `CardPoints` gains `bonuses: CycleBonus[]`, `transferPartners: TransferPartner[]`, `catalog: CatalogState & { entry: CatalogEntry | undefined }`; `CycleResult.earn` includes bonuses.

- [ ] Bootstrap runs `ensureCategoryKeys` then `syncLinkedPrograms(CATALOG, isoDate())` after migrations.
- [ ] Run web typecheck and all e2e (no behaviour change expected); commit `feat(web): sync catalogue on open and load bonuses and partners`.

### Task 12: Web — catalogue picker and preview

**Files:** Create `src/features/cards/CatalogPicker.tsx`; modify `CardDetailPage.tsx`.

**Behaviour:** Step 2 shows "Choose from catalogue" and "Set up manually". Picker filters `CATALOG` by bank or name, shows `describeEntry` lines, sources, verified date, unmapped keys, and "Use these terms". When manual rules exist, a confirm asks to replace them. After apply, the page shows the cycle summary directly.

- [ ] Covered by Task 16 e2e; run typecheck; commit `feat(web): choose card terms from the catalogue`.

### Task 13: Web — catalogue card page

**Files:** Create `src/features/cards/CatalogPanel.tsx`, `src/features/cards/BonusProgress.tsx`, `src/lib/catalog-config.ts`; modify `CardDetailPage.tsx`; test `src/lib/catalog-config.test.ts`.

**Interfaces — Produces:**
```ts
export const CATALOG_REPORT_EMAIL: string | null;
export function reportMailto(email: string, entry: CatalogEntry): string; // subject and body with id, version, verifiedOn, name, blanks
```

**Behaviour:** badge Linked/Customised; sources and verified date; stale warning via `isStale`; update banner with `diffCatalogEntries(snapshot, entry)` when `entry.entryVersion > max(state.entryVersion, dismissedVersion)` and customised; Apply update, Skip this version, Reset to catalogue (confirm); welcome bonus and notes; `BonusProgress` per bonus with `nextBonusTier`; transfer estimates using `convertPoints` for each partner valid today; first edit of a linked card confirms it becomes customised.

- [ ] Tests: `reportMailto encodes subject and body and contains no transaction data fields`; `report button hidden when CATALOG_REPORT_EMAIL is null` (component-free check of the exported predicate `shouldShowReport`).
- [ ] Implement; run web unit tests and typecheck; commit `feat(web): catalogue card page with updates, bonus progress, and transfers`.

### Task 14: Web — original currency in transactions

**Files:** Modify `src/features/transactions/draft.ts`, `draft.test.ts`, `TransactionForm.tsx`, `TransactionsPage.tsx`.

**Interfaces — Produces:** `Draft` gains `originalCurrency: string` (`''` when unused) and `originalAmount: string`; `draftToExtras(draft): { originalCurrency: string | null; originalAmountMinor: number | null }`; `draftFromTransaction` restores both.

- [ ] Tests: `expense on a card with SGD 45,20 round-trips original currency and amount`; `original amount without currency is rejected`; `non-card payment ignores original currency`.
- [ ] Implement form section (card payments only, collapsed) and list display; run web tests and typecheck; commit `feat(web): record original currency on card purchases`.

### Task 15: Web — compare-in recommender

**Files:** Modify `src/features/cards/RecommendPage.tsx`.

**Behaviour:** "Compare in" select lists Rupiah value plus every program name among the user's programs and their transfer partners; optional original currency select; results show native points and `compareUnits` with the program name, or "—" when not comparable.

- [ ] Covered by Task 16 e2e; run typecheck; commit `feat(web): compare cards in a chosen miles program`.

### Task 16: E2E, preview rebuild, docs

**Files:** Create `apps/web/e2e/catalogue.spec.ts`; modify `docs/superpowers/plans/2026-09-11-card-catalogue.md` (execution status).

- [ ] Tests: `apply BCA KrisFlyer Visa Signature, post one Rp 21.000.000 dining purchase on the card, see base miles 1.555 and bonus 1.000 with full progress`; `apply BCA UnionPay, post an SGD 45,20 purchase billed Rp 540.000, see 108 points (54 base + 54 double)`; `editing a catalogue rule shows the Customised badge`; `compare in KrisFlyer lists UnionPay converted miles`.
- [ ] Run all unit tests, typecheck, and all e2e; rebuild preview in `apps/web` with absolute paths and verify the served entry hash; append execution status; commit `test(web): catalogue end-to-end coverage`.

## Self-review

- Spec coverage: §3 format and validation → Tasks 6–7; §4 keys → Tasks 1, 8; §5.1–5.2 → Task 2; §5.3 → Task 3; §5.4 → Task 4; §5.5–5.6 → Task 5, 15; §6 → Task 8–9; §7 → Tasks 7, 10, 11; §8 screens → Tasks 12–15; §9 entries → Task 6; §10 tests → each task and Task 16; §11 limitations need no code; §12 parked entry excluded.
- Golden numbers checked: Rp 21.000.000 / 13.500 = 1.555,5 → 1.555 miles; Rp 540.000 / 10.000 = 54 base + 54 double = 108; 1.240 UnionPay → 620 KrisFlyer and 820 GarudaMiles.

## Addendum tasks (spec §13, approved 2026-09-11)

Inserted before Task 4. Task 6 gains three entries; Tasks 12 and 16 gain cases.

### Task 3a: Core — Real Estate and Business categories

**Files:** modify `packages/core/src/categories/defaults.ts`, `packages/core/test/categories.test.ts`.
- [ ] Tests: `keys include housing.real_estate and business`.
- [ ] Implement; run core and db tests; commit `feat(core): real estate and business default categories`.

### Task 3b: Core — whole-word keywords and origin matching

**Files:** modify `packages/core/src/points/earn.ts`; test `packages/core/test/points-catalogue.test.ts`.

**Interfaces — Produces:**
```ts
export interface RuleMatch { /* existing */ origin?: 'domestic' | 'foreign' }
export function containsKeyword(description: string, keyword: string): boolean; // whole word or phrase, case-insensitive
export function matchesSpend(match: RuleMatch, line: SpendLine, ancestors: Record<string, string[]>, billingCurrency?: string): boolean;
```
`computeCycleEarn` options gain `billingCurrency` (default `'IDR'`); `ruleMatches` passes it through.

- [ ] Tests: `va does not match Java but matches VA BCA`; `grab matches GRAB*FOOD`; `st. regis matches THE ST. REGIS JAKARTA`; `origin foreign matches CNY original currency on an IDR card`; `origin domestic matches IDR and no original currency`.
- [ ] Implement; run core tests; commit `feat(core): whole-word merchant keywords and domestic or foreign origin`.

### Task 3c: Core — per-increment rounding and half points

**Files:** modify `packages/core/src/points/earn.ts`; test `packages/core/test/points-increment.test.ts`.

**Behaviour:** `Rounding` adds `'per_increment'`. Internally points are integer tenths: `pointsTenths = floor(purchaseSpendForRule / rateDen) × round(rateNum × 10)`. `pointsByRule`, allocation points, `totalPoints`, and recommendation points are reported as tenths ÷ 10. Existing modes compute in tenths too (`floor(spend × rateNum / rateDen) × 10`) so whole-point results are unchanged.

- [ ] Tests: `Mandiri domestic Rp 25.000 earns 3`; `Mandiri foreign CNY Rp 40.000 earns 8`; `CIMB domestic Rp 60.000 earns 2,5 and foreign earns 7,5`; `taxi in CNY on Mandiri earns the reduced rate 1 per Rp 100.000 through priority`; `split purchase applies the multiple to the purchase total per rule`; `half points sum exactly across many purchases (0,5 × 7)`; existing golden tests unchanged.
- [ ] Implement; run core tests; commit `feat(core): per-increment earning with half points`.

### Task 6 additions

- [ ] Entries `cimb-niaga-world-all-accor`, `mandiri-world-prioritas`, `mandiri-marriott-bonvoy` exactly as spec §13.6.
- [ ] `CatalogEntry` gains `program.fixedStatementDay?: number`; `CatalogFeePeriod` gains `condition?: string`; `fees` may be empty; `CatalogRule.rounding` accepts `per_increment`; `CatalogMatch` gains `origin`.
- [ ] Validation accepts `rateNum` with at most one decimal and rejects more; rejects `fixedStatementDay` outside 1–31.
- [ ] Tests: `CIMB insurance is excluded on 2025-12-31 and earns on 2026-01-01`; `Marriott bonus pays nothing at exactly Rp 30.000.000 and 2.500 at Rp 30.000.001`.

### Task 9 addition

- [ ] `saveEarnRule` accepts `rateNum` with one decimal; the rule form's Points field accepts one decimal; tests cover `7.5` round-tripping.

### Task 12 addition

- [ ] When the chosen entry has `fixedStatementDay` and the card has no terms, the preview states it and step 1 pre-fills it.

### Task 16 additions

- [ ] `apply Mandiri World Prioritas, post Rp 25.000 domestic, see 3 Livin'poin`; `CNY taxi earns 1 per Rp 100.000 equivalent`; `apply CIMB, post Rp 60.000 domestic, see 2,5 ALL points`.

## Execution status (2026-09-11)

Executed inline on the fast track in three drops on `feat/card-catalogue`, each task written test-first and committed only with core, db, catalog, and web unit tests and typecheck green. Addendum tasks 3a–3c ran before Task 4.

Delivered: Tasks 1–16 with the addendum additions. Six entries are bundled: BCA Singapore Airlines KrisFlyer Visa Signature and Visa Infinite, BCA UnionPay, CIMB Niaga World ALL Accor Live Limitless, Mandiri World Prioritas, and Marriott Bonvoy Mandiri. `bca-sq-pps-club-visa-infinite` stays parked.

Verification at completion: catalog 36, core 83, db 54, web 27 unit tests passing; typecheck clean in all packages; 11 Playwright tests passing against a production build (5 existing, 6 in `e2e/catalogue.spec.ts`). Preview rebuilt into `apps/web/dist-preview` and served on port 4174 with entry `assets/index-BG87MKoq.js`.

Deviations from this plan, recorded:

- The catalogue migration is `0005_catalog`; `0004_increment_rounding` was taken by Task 3c.
- `database.transaction` is not re-entrant, so points writers have transaction-scoped variants (`saveEarnRuleTx`, `saveCycleBonusTx`, `saveTransferPartnerTx`, `saveRedemptionOptionTx`, and the archive and delete variants), and categories gained `categoryIdsByKeyTx`. The catalogue repository applies an entry in one transaction through them.
- `planCatalogApply` leaves out a rule or bonus whose category keys all fail to map, because an empty category list would match every category. The keys are still reported as unmapped.
- `packages/catalog` gained `src/lookup.ts` (terms, fees, staleness) and `src/format.ts` (shared wording for diff and describe).
- The rule form now keeps match conditions it cannot edit (origin, currencies, excluded keywords), offers per-multiple rounding, and parses one-decimal rates via `features/cards/rule-values.ts`.
- The catalogue picker also appears in step 1, as a preview that pre-fills a fixed statement day, and on manually set-up cards, where applying asks before replacing their rules.
- Pure helpers with unit tests were split out of components: `catalog-picker.ts`, `catalog-panel.ts`, `recommend-targets.ts`; transfer estimates live in `TransferEstimates.tsx`; `db/bootstrap.test.ts` checks keys are ensured before linked programs sync.
- `draftToExtras` takes the accounts list, since only card expenses carry an original currency.
- Existing e2e specs select the transaction amount with `getByLabel('Amount', { exact: true })` because the form now also has "Original amount".
- Commit `eb94259` accidentally reformatted `TransactionForm.tsx`; `126d253` restores its layout.

Outstanding:

- Independent code review of the catalogue branch before merging.
- Owner decisions raised during execution: an MCC layer for rules whose issuer terms split one sub-category by MCC (options A, B, C), and per-transaction estimates and actuals for issuers that credit per purchase (proposal D).
- Maybank Visa Platinum, Visa Infinite, BMW, MINI, and Manchester United entries are researched but not written. Decided: marketplace keywords for online spend, a new Sports & Fitness category, and Maybank's own dealer keyword lists. Waiting on the MCC decision for fast food (MCC 5814) and sports MCCs.
- `CATALOG_REPORT_EMAIL` is still null, so Report a change stays hidden.
