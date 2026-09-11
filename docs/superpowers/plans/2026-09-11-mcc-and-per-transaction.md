# MCC Layer and Per-Transaction Points — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Format:** fast track, as chosen by the owner. Each task gives files, exact interfaces, and named test cases that must be written first and fail before implementation. Code is written during execution.

**Goal:** Every card purchase gets an effective MCC that catalogue rules can match, and cards show estimated and actual points per purchase with hints that explain differences.

**Architecture:** Core gains pure MCC resolution, MCC matching, points per purchase, and difference explanations. The catalog package gains MCC fields, crediting, and a bundled merchant list. Db gains migration 0006 with merchant memory, category MCC overrides, crediting, and per-purchase actuals, and resolves MCC when loading card spend. Web adds MCC entry, a Merchants page, category MCCs, a purchase list with actuals and hints, and estimates in the transaction list.

**Tech Stack:** unchanged (TypeScript 7, Vitest 5, Drizzle sqlite-proxy, better-sqlite3 tests, Vite 8, React 19, TanStack Router/Query, Playwright). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-mcc-and-per-transaction-design.md` (addendum to `docs/superpowers/specs/2026-09-11-card-catalogue-design.md`)

## Global Constraints

- All card catalogue plan constraints apply (`docs/superpowers/plans/2026-09-11-card-catalogue.md`).
- MCC values are four digits; rule entries are four digits or `NNNN-NNNN` with start ≤ end.
- Resolution order: typed → memory → bundled → category default. Patterns match whole words, case-insensitive, longest pattern wins, ties to the earlier entry.
- A memory entry with `mcc: null` disables bundled entries with the same pattern.
- `mccs` include: a line without an MCC never matches. `excludeMccs`: a line without an MCC is never excluded.
- Merchant memory and category overrides apply to past purchases; catalogue terms never rewrite past cycles.
- Crediting is `per_transaction` or `per_statement`; changing it never changes `catalog_status`; sync and update never change it.
- Per-transaction actuals have at most one decimal. For per-transaction programs `cycle_actuals` holds only points credited outside purchases.
- Hints never change data unless the user chooses a fix.
- Bundled merchants are our own research, never copied from IndoMiles.
- Migration name `0006_mcc_points`.
- Gate before every commit: catalog, core, db, web unit tests and typecheck; Drops F and G also run all end-to-end tests.

## File Structure

```
packages/core/src/
  mcc/codes.ts                MCC_NAMES, mccName
  mcc/resolve.ts              MccSource, MerchantMcc, MccSources, resolveMcc, mccInRange, isMccSpec, categoryDefaultMcc
  categories/defaults.ts      + entertainment.sports, DEFAULT_CATEGORY_MCCS
  points/earn.ts              RuleMatch mccs/excludeMccs, SpendLine mcc/mccSource, pointsByTransaction
  points/explain.ts           Suggestion, CycleContext, explainTransaction, explainCycle
  points/recommend.ts         PurchaseQuery.mcc
packages/core/test/  mcc.test.ts  points-mcc.test.ts  points-by-transaction.test.ts  explain.test.ts
packages/catalog/
  merchants/merchants.json    bundled merchant list
  src/merchants.ts            MerchantList, MERCHANTS, validateMerchants
  src/types.ts validate.ts plan.ts format.ts describe.ts diff.ts   MCC fields and crediting
  test/merchants.test.ts  mcc.test.ts
packages/db/
  migrations/0006_mcc_points.sql
  src/schema.ts schema-points.ts
  src/repos/mcc.ts            merchant memory, category MCCs, mccSourcesFor
  src/repos/point-actuals.ts  transaction point actuals, setProgramCrediting
  src/repos/ledger.ts points.ts catalog.ts categories.ts
  test/mcc.test.ts  point-actuals.test.ts
apps/web/src/
  features/merchants/MccPicker.tsx  mcc-search.ts  mcc-search.test.ts  MerchantsPage.tsx
  features/transactions/draft.ts TransactionForm.tsx TransactionsPage.tsx
  features/categories/CategoriesPage.tsx
  features/cards/PurchaseList.tsx  hint-text.ts  hint-text.test.ts  useCardPoints.ts  CardDetailPage.tsx  RecommendPage.tsx
  lib/purchase-points.ts  purchase-points.test.ts
  app/router.tsx
apps/web/e2e/mcc.spec.ts
```

## Tasks

| # | Task | Drop |
|---|---|---|
| 17 | Core: MCC codes, resolution, category defaults, Sports & Fitness | D |
| 18 | Core: MCC matching in the engine | D |
| 19 | Catalog: MCC fields, crediting, bundled merchants, wording | D |
| 20 | Db: migration 0006, MCC storage, spend lines with MCC, crediting on apply | D |
| 21 | Core: points per purchase | E |
| 22 | Core: explain differences | E |
| 23 | Db: per-purchase actuals and crediting | E |
| 24 | Web: MCC on transactions | F |
| 25 | Web: Merchants page and category MCCs | F |
| 26 | Web: card purchase list, actuals, hints, crediting | F |
| 27 | Web: transaction list estimates and recommender MCC | F |
| 27a | Card fees never earn (spec §12) | F |
| 28 | Catalog data: merchants, BCA and Mandiri v2, Maybank entries | G |
| 29 | E2E, preview, execution status | G |

---

### Task 17: Core — MCC codes, resolution, category defaults, Sports & Fitness

**Files:** Create `packages/core/src/mcc/codes.ts`, `packages/core/src/mcc/resolve.ts`, `packages/core/test/mcc.test.ts`; modify `packages/core/src/categories/defaults.ts`, `packages/core/src/index.ts`, `packages/core/test/categories.test.ts`, `packages/db/src/repos/categories.ts` (`ADDED_WITH_CATALOGUE` gains `entertainment.sports`), `packages/db/test/categories.test.ts`.

**Interfaces — Produces:**
```ts
export const MCC_NAMES: Readonly<Record<string, string>>;
export function mccName(code: string): string | null;
export type MccSource = 'typed' | 'memory' | 'bundled' | 'category';
export interface MerchantMcc { pattern: string; mcc: string | null }
export interface MccSources { typed: string | null; memory: MerchantMcc[]; bundled: MerchantMcc[]; categoryDefault: (categoryId: string) => string | null }
export function isMcc(value: string): boolean;                 // four digits
export function isMccSpec(value: string): boolean;             // four digits or NNNN-NNNN, start <= end
export function mccInRange(mcc: string, spec: string): boolean;
export function resolveMcc(description: string, categoryId: string, sources: MccSources): { mcc: string | null; source: MccSource | null };
export const DEFAULT_CATEGORY_MCCS: Readonly<Record<string, string>>;   // spec §3.1
export function categoryDefaultMcc(categoryId: string, categories: { id: string; parentId: string | null; systemKey: string | null }[], overrides: Record<string, string>): string | null;
```

- [ ] Codes: take names from a public-domain ISO 18245 dataset; verify its licence first and record source and licence in the file header; otherwise write names from the public Visa and Mastercard merchant data manuals.
- [ ] Tests: `typed MCC wins over memory, bundled, and category`; `memory wins over bundled`; `longest matching pattern wins and ties go to the earlier entry`; `memory null disables the bundled pattern and falls back to the category`; `no source gives null`; `mccInRange handles single codes and ranges`; `isMccSpec rejects 581, 58120, 3300-3000`; `category default uses override, then key, then parent`; `mccName names 5814 and returns null for 0000`; `keys include entertainment.sports and every DEFAULT_CATEGORY_MCCS key is a default key`; db `ensureCategoryKeys creates Sports & Fitness`.
- [ ] Implement; run core and db tests and typecheck; commit `feat(core): MCC codes, resolution, and category defaults`.

### Task 18: Core — MCC matching in the engine

**Files:** Modify `packages/core/src/points/earn.ts`, `packages/core/src/points/recommend.ts`; test `packages/core/test/points-mcc.test.ts`; update every `SpendLine` literal in core, db, and web tests and `recommend.ts`'s hypothetical line.

**Interfaces — Produces:**
```ts
export interface RuleMatch { /* existing */ mccs?: string[]; excludeMccs?: string[] }
export interface SpendLine { /* existing */ mcc: string | null; mccSource: MccSource | null }
export interface PurchaseQuery { /* existing */ mcc: string | null }
```

- [ ] Tests: `mccs include matches a listed code and a range`; `a line without an MCC never matches mccs`; `excludeMccs excludes a listed code`; `a line without an MCC is not excluded`; `cycle bonus eligibility honours excludeMccs`; `recommendation uses the query MCC`.
- [ ] Implement; run core, db, web tests and typecheck; commit `feat(core): match earn rules by MCC`.

### Task 19: Catalog — MCC fields, crediting, bundled merchants, wording

**Files:** Create `packages/catalog/merchants/merchants.json` (version 1 with the verified starter set: mcdonald 5814, kfc 5814, burger king 5814, pertamina 5541, shell 5541, indomaret 5411, alfamart 5411, grab 4121, gojek 4121, decathlon 5941), `packages/catalog/src/merchants.ts`, `packages/catalog/test/merchants.test.ts`, `packages/catalog/test/mcc.test.ts`; modify `src/types.ts`, `src/validate.ts`, `src/plan.ts`, `src/format.ts`, `src/describe.ts`, `src/diff.ts`, `src/index.ts`.

**Interfaces — Produces:**
```ts
export interface CatalogMatch { /* existing */ mccs?: string[]; excludeMccs?: string[] }
export interface CatalogProgram { /* existing */ crediting?: 'per_transaction' | 'per_statement' }
export interface CatalogPlan { /* existing */ crediting: 'per_transaction' | 'per_statement' }
export interface BundledMerchant { pattern: string; mcc: string; name: string; basis: string }
export interface MerchantList { version: number; verifiedOn: string; merchants: BundledMerchant[] }
export const MERCHANTS: MerchantList;
export function validateMerchants(list: unknown): string[];
```

- [ ] Tests: `validation rejects bad MCC specs in mccs and excludeMccs`; `validation rejects unknown crediting`; `plan copies mccs, excludeMccs, and crediting (default per_statement)`; `describe names excluded MCC 5814 and shows ranges`; `diff reports added excludeMccs and crediting change`; `bundled merchants validate: lowercase unique patterns, four-digit MCCs, basis present`; `validateMerchants rejects duplicates and bad codes`.
- [ ] Implement; run catalog tests and typecheck; commit `feat(catalog): MCC rules, crediting, and bundled merchants`.

### Task 20: Db — migration 0006, MCC storage, spend lines with MCC, crediting on apply

**Files:** Create `packages/db/migrations/0006_mcc_points.sql`, `packages/db/src/repos/mcc.ts`, `packages/db/test/mcc.test.ts`; modify `src/migrations.ts`, `src/schema.ts`, `src/schema-points.ts`, `src/repos/ledger.ts`, `src/repos/points.ts`, `src/repos/catalog.ts`, `src/index.ts`, `test/database.test.ts`, `test/catalog.test.ts`, `test/ledger.test.ts`.

**Migration:** spec §4 (`transactions.mcc`, `merchant_mccs`, `category_mccs`, `reward_programs.crediting`, `transaction_point_actuals`).

**Interfaces — Produces:**
```ts
// ledger
interface PostTransactionInput { /* existing */ mcc?: string | null }
interface TransactionView { /* existing */ mcc: string | null }
// mcc
export interface MerchantMccRow { id: string; pattern: string; mcc: string | null; createdAt: string }
export async function listMerchantMccs(database, ws): Promise<MerchantMccRow[]>;
export async function saveMerchantMcc(database, ws, input: { id?: string; pattern: string; mcc: string | null }): Promise<string>;
export async function archiveMerchantMcc(database, ws, id: string): Promise<void>;
export async function listCategoryMccs(database, ws): Promise<Record<string, string>>;
export async function saveCategoryMcc(database, ws, categoryId: string, mcc: string): Promise<void>;
export async function clearCategoryMcc(database, ws, categoryId: string): Promise<void>;
export async function mccSourcesFor(db: Db, ws): Promise<Omit<MccSources, 'typed'>>;
export async function countMatchingPurchases(database, ws, pattern: string): Promise<number>;
// points
export type RewardProgramRow // gains crediting
```

- [ ] Tests: `migrate applies [1..6] and adds the new tables and columns`; `typed MCC round-trips through post, replace keeps it, and edit can clear it`; `invalid MCC is rejected with LedgerError INVALID_MCC`; `saveMerchantMcc normalises the pattern to lowercase and replaces an active duplicate`; `cardSpendLines resolves typed, memory, bundled, and category MCCs with their sources`; `memory saved later changes past cycle lines`; `category override changes the default`; `countMatchingPurchases counts card and non-card expenses whose description matches`; `apply and reset set crediting from the entry; sync keeps a user-changed crediting`.
- [ ] Implement; run db tests and typecheck; commit `feat(db): store MCCs, merchant memory, and crediting`.

### Task 21: Core — points per purchase

**Files:** Modify `packages/core/src/points/earn.ts`; test `packages/core/test/points-by-transaction.test.ts`.

**Interfaces — Produces:** `CycleEarn` gains `pointsByTransaction: Record<string, number>` and `approximateTransactionIds: string[]`.

- [ ] Tests: `floor and per-increment purchases sum their rule allocations, stackable included`; `split purchase reports one total`; `per_cycle_sum shares rule points by spend and marks the purchases approximate, summing to the rule total`; `refund carries negative points`; `bonuses are not assigned to purchases`; existing tests unchanged.
- [ ] Implement; run core tests; commit `feat(core): points per purchase`.

### Task 22: Core — explain differences

**Files:** Create `packages/core/src/points/explain.ts`; modify `src/index.ts`; test `packages/core/test/explain.test.ts`.

**Interfaces — Produces:**
```ts
export interface CycleContext { lines: SpendLine[]; rules: EarnRule[]; ancestors: Record<string, string[]>; options: EarnOptions }
export type Suggestion =
  | { kind: 'mcc'; transactionId: string; mcc: string; pointsWith: number; moves: number }
  | { kind: 'bonus_threshold'; bonusId: string; eligibleSpendMinor: number; tierMinSpendMinor: number; bonus: number }
  | { kind: 'rounding'; points: number };
export function candidateMccs(rules: EarnRule[], bonuses: CycleBonus[]): string[];
export function explainTransaction(context: CycleContext, transactionId: string, actualPoints: number): Suggestion[];
export function explainCycle(context: CycleContext, actualPoints: number, limit?: number): Suggestion[];
```

- [ ] Tests: `candidateMccs lists single codes and range starts once`; `explainTransaction suggests 5814 when a Maybank-style dinner earned 0`; `typed and memory MCC purchases are never re-guessed`; `explainTransaction returns [] when the actual matches`; `explainCycle ranks the candidate that closes most of the gap first and limits to 5`; `explainCycle reports a bonus threshold when the gap equals a tier bonus near its threshold`; `explainCycle reports rounding for a gap smaller than the purchase count`.
- [ ] Implement; run core tests; commit `feat(core): explain point differences`.

### Task 23: Db — per-purchase actuals and crediting

**Files:** Create `packages/db/src/repos/point-actuals.ts`, `packages/db/test/point-actuals.test.ts`; modify `src/repos/ledger.ts` (move actuals on replace), `src/index.ts`.

**Interfaces — Produces:**
```ts
export interface TransactionPointActual { transactionId: string; actualPoints: number; editedAfterCheck: boolean; recordedAt: string }
export async function listTransactionPointActuals(database, ws, programId: string): Promise<TransactionPointActual[]>;
export async function recordTransactionPointActual(database, ws, input: { programId: string; transactionId: string; actualPoints: number }): Promise<void>;
export async function clearTransactionPointActual(database, ws, programId: string, transactionId: string): Promise<void>;
export async function setProgramCrediting(database, ws, programId: string, crediting: 'per_transaction' | 'per_statement'): Promise<void>;
```

- [ ] Tests: `records, updates, lists, and clears an actual`; `rejects more than one decimal`; `replacing the purchase moves its actual and marks it edited`; `recording again clears the edited mark`; `setProgramCrediting leaves a linked program linked`.
- [ ] Implement; run db tests and typecheck; commit `feat(db): per-purchase point actuals`.

### Task 24: Web — MCC on transactions

**Files:** Create `apps/web/src/features/merchants/mcc-search.ts`, `mcc-search.test.ts`, `MccPicker.tsx`; modify `src/features/transactions/draft.ts`, `draft.test.ts`, `TransactionForm.tsx`.

**Interfaces — Produces:**
```ts
export function searchMccs(query: string, limit?: number): { code: string; name: string }[];
export function suggestPattern(description: string): string;   // lowercase leading merchant words without store numbers or branch codes
// Draft gains mcc: string and rememberPattern: string ('' when unused)
// draftToExtras returns { originalCurrency, originalAmountMinor, mcc } and draftToMemory(draft) => { pattern: string; mcc: string } | null
```

- [ ] Tests: `searchMccs finds 5814 by code and by "fast food"`; `suggestPattern turns "MCDONALD'S SENAYAN 0123" into "mcdonald's senayan"`; draft `MCC round-trips on a card expense`; `bad MCC is rejected`; `remember pattern returns a memory entry instead of a typed MCC`; `non-card expense carries no MCC`.
- [ ] Implement the "Card purchase details" section (original currency, original amount, MCC with guess and source, remember checkbox and pattern); run web tests, typecheck, all e2e; commit `feat(web): record MCCs on card purchases`.

### Task 25: Web — Merchants page and category MCCs

**Files:** Create `src/features/merchants/MerchantsPage.tsx`; modify `src/app/router.tsx` (`/cards/merchants`), `src/features/cards/CardsPage.tsx` (link), `src/features/categories/CategoriesPage.tsx`.

- [ ] Behaviour per spec §7: your merchants with match counts, add, edit, remove; bundled merchants searchable with "Use a different MCC" and "Ignore"; save message with the number of purchases affected; category card MCC with reset.
- [ ] Covered by Task 29 e2e; run typecheck and all e2e; commit `feat(web): merchants page and category MCCs`.

### Task 26: Web — card purchase list, actuals, hints, crediting

**Files:** Create `src/features/cards/PurchaseList.tsx`, `hint-text.ts`, `hint-text.test.ts`; modify `useCardPoints.ts`, `CardDetailPage.tsx`.

**Interfaces — Produces:** `CardPoints` gains `crediting`, `transactionActuals: TransactionPointActual[]`, and `mccSources`; `CycleResult` gains `checked: { count: number; total: number; points: number }`.
```ts
export function describeSuggestion(s: Suggestion, unit: string, currency: string): string;
export function checkedTotals(result: CycleResult, actuals: TransactionPointActual[]): { checked: number; purchases: number; total: number };
```

- [ ] Tests: `describeSuggestion words mcc, bonus threshold, and rounding suggestions`; `checkedTotals adds actuals for checked purchases and estimates for the rest`.
- [ ] Implement purchase list, per-row actuals and hints for per-transaction cards, cycle hint panel for per-statement cards, "Bonus points credited" label, crediting setting; run web tests, typecheck, all e2e; commit `feat(web): check points per purchase with hints`.

### Task 27: Web — transaction list estimates and recommender MCC

**Files:** Create `src/lib/purchase-points.ts`, `purchase-points.test.ts`; modify `src/features/transactions/TransactionsPage.tsx`, `src/features/cards/RecommendPage.tsx`.

**Interfaces — Produces:**
```ts
export function cyclesCovering(dates: string[], anchor: 'statement' | 'calendar', statementDay: number): Cycle[];
```

- [ ] Tests: `cyclesCovering returns each distinct cycle once for dates across two statement cycles`.
- [ ] Implement estimates under card purchase amounts and the recommender's MCC line; run web tests, typecheck, all e2e; commit `feat(web): purchase estimates and MCC in recommendations`.

### Task 27a: Card fees never earn (spec §12, approved 2026-09-11)

**Files:** Create `packages/core/src/points/card-fees.ts`, `packages/core/test/card-fees.test.ts`, `packages/db/test/card-fees.test.ts`; modify `packages/core/src/points/earn.ts`, `packages/core/src/categories/defaults.ts`, `packages/core/src/index.ts`, `packages/db/src/repos/points.ts`, `packages/db/src/repos/categories.ts`, `packages/db/test/categories.test.ts`, `apps/web/src/features/cards/CardDetailPage.tsx`, `hint-text.ts`, `PurchaseList.tsx`.

**Interfaces — Produces:** `CARD_FEE_PHRASES: readonly string[]`; `cardFeeCategoryIds(categories): Set<string>`; `isCardFee(description, categoryId, feeCategoryIds): boolean`; `SpendLine.cardFee?: boolean`; `CycleEarn.cardFeeSpendMinor: number`.

- [ ] Tests: `finds the fees category and everything under it`; `recognises fee categories and issuer charge phrases, but not ordinary merchants`; `never earns or counts toward bonuses, and is reported apart from unmatched spend`; db `marks fee categories and issuer charge descriptions as card fees`; `ensureCategoryKeys creates the four fee sub-categories`.
- [ ] Implement; run all unit tests, typecheck, all e2e; commit `feat: card fees never earn points`.

### Task 28: Catalog data — merchants, BCA and Mandiri v2, Maybank entries

**Files:** Modify `packages/catalog/merchants/merchants.json` (about 80 merchants per spec §5.1), `entries/bca-sq-krisflyer-visa-signature.json`, `entries/bca-sq-krisflyer-visa-infinite.json`, `entries/mandiri-world-prioritas.json`; create `entries/maybank-visa-platinum.json`, `maybank-visa-infinite.json`, `maybank-bmw.json`, `maybank-mini.json`, `maybank-manchester-united.json` per spec §8; modify `src/index.ts`, `test/entries.test.ts`.

- [ ] Tests: `catalogue bundles eleven valid entries`; `BCA v2 excludes MCC 8398 in both periods`; `Mandiri Prioritas v2 credits per transaction`; `Maybank Platinum dinner Rp 60.000 at MCC 5812 earns 3 base plus 6 extra`; `Maybank fast food MCC 5814 earns nothing`; `Maybank utilities above Rp 10.000.000 earn nothing`; `BMW dealer Rp 33.330 earns 10 and caps at 7.500 per cycle`; `MU shoe store MCC 5661 earns 1 plus 2 extra per Rp 20.000`; `merchant list has at least 80 valid entries`.
- [ ] Implement; run all unit tests and typecheck; commit `feat(catalog): Maybank TREATS cards and MCC-based exclusions`.

### Task 29: E2E, preview, execution status

**Files:** Create `apps/web/e2e/mcc.spec.ts`; modify this plan (execution status).

- [ ] Tests: `remembering MCDONALD as 5814 removes the Maybank Platinum dinner extra`; `a per-transaction actual of 0 shows the 5814 hint and applying it remembers the merchant`; `BMW dealer purchase earns 1 per Rp 3.333`; `a shoe store purchase with MCC 5661 earns the Manchester United sports extra`; `a BCA statement total that differs lists cycle hints`.
- [ ] Run all unit tests, typecheck, and all e2e; rebuild `apps/web/dist-preview`, restart the 4174 preview, verify the served entry hash; append execution status; commit `test(web): MCC and per-purchase points end-to-end`.

## Self-review

- Spec coverage: §3 → Tasks 17, 20; §3.1–3.3 → 17; §4 → 20, 23; §5 → 18, 19, 20; §5.1 → 19, 28; §6 → 21, 22; §7 → 24–27; §8 → 28; §9 → every task and 29; §10 → drops; §11 needs no code.
- Golden numbers: Platinum Rp 60.000 at 5812 → 3 base + 6 extra = 9; BMW Rp 33.330 / 3.333 → 10; MU Rp 20.000 at 5661 → 1 + 2 = 3.

## Execution status (2026-09-11)

Executed inline on the fast track on `feat/card-catalogue`, each task written test-first and committed with catalog, core, db, and web unit tests and typecheck green; web tasks also ran every end-to-end test.

Delivered: Tasks 17–29 and Task 27a (card fees never earn, approved during execution). Eleven catalogue entries are bundled: the six from the catalogue plan (BCA KrisFlyer Signature and Infinite now version 2 with Reward BCA MCC exclusions, Mandiri World Prioritas version 2 credited per purchase) and five Maybank TREATS cards (Visa Platinum, Visa Infinite, BMW, MINI, Manchester United). The bundled merchant list has 139 merchants.

Verification at completion: catalog 52, core 113, db 69, web 42 unit tests passing; typecheck clean in all packages; 16 Playwright tests passing against a production build (11 earlier, 5 in `e2e/mcc.spec.ts`). Preview rebuilt into `apps/web/dist-preview` and served on port 4174 with entry `assets/index-BoeS_1rE.js`.

Deviations from this plan, recorded:

- MCC names come from the greggles/mcc-codes dataset, released under The Unlicense; its source and licence are in `packages/core/src/mcc/codes.ts`.
- `containsKeyword` moved to `packages/core/src/text/keywords.ts` so MCC resolution and the engine share it without importing each other.
- Task 23 ran before Tasks 21 and 22; it did not depend on them.
- `draftToMemory` takes the accounts list, like `draftToExtras`, to know whether the payment is a card.
- `CardPoints` did not gain `mccSources`: hints use the resolved spend lines. `CycleResult` gained `context` (the computation inputs) instead of `checked`; `checkedTotals` computes the running total.
- The "this purchase only" fix needed `setTransactionMcc` in `packages/db/src/repos/ledger.ts`, which edits a purchase's MCC in place with an audit entry.
- The bonus threshold hint allows a distance of 1% of the threshold or the cycle's matching refunds, whichever is larger.
- Merchant and category helpers with unit tests: `features/merchants/merchant-rows.ts`, `features/categories/category-mcc.ts`, `lib/purchase-points.ts`.
- The Maybank bonus MCC list for Visa Platinum mixed unrelated codes, so the entry uses standard restaurant and supermarket codes, as the spec records.
- Card fees (spec §12) added `SpendLine.cardFee`, `CycleEarn.cardFeeSpendMinor`, and four Fees & Charges sub-categories.

Outstanding:

- Independent code review of the branch, then finishing it.
