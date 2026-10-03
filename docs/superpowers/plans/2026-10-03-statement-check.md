# Statement Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Screenshots of a credit-card statement, read on the phone, are checked against the card's transactions in cicis: matched rows are linked, missing rows are recorded in statement order with categories, extras are flagged, and the closing balance reconciles; Cashflow's donut follows the Paid-with filter; Review is drawn like the Cashflow list.

**Architecture:** A pure statement reader (`packages/core/src/statement/`) turns Vision lines of several images into rows and balances; a pure matcher compares rows with the card's transactions. `packages/db` loads candidates, suggests categories, and records a finished check in one transaction (posts, updates, the "Payments not tracked" adjustment, the check record). The web check screen drives it; a new capture-plugin method reads images picked in the web layer; the share extension can hand over several images as one statement.

**Tech Stack:** TypeScript, vitest + fast-check, SQLite/drizzle, React + native UI kit, Capacitor 8 iOS (Swift, Vision), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-statement-check-design.md` (binding; §n / Sn below).

## Global Constraints

- The spec is the authority; where code disagrees, code reality wins and the spec is corrected in the same commit with a line saying what changed and why.
- Nothing leaves the phone: no network call in statement code (§5). Recognition is Apple Vision through the capture plugin.
- Country-neutral: no bank, wallet or merchant name in code or word lists; words live in data files (`packages/core/src/statement/words.ts`).
- IDR has exponent 0 (`packages/core/src/money/currencies.ts`); amounts are integer minor units of the card's currency.
- Statement text and screenshots are never stored (S6, S8). Only the posted transactions, the check record and its links persist.
- Notes are never used to decide a match, only to break ties (S8); the owner's note is never changed.
- Card payments are not tracked by default (S7): per-card setting `trackPayments` false.
- Ruling (spec §3.5 corrected in Task 3): card terms, postings and settlements are not synced today, so `statement_checks`, `statement_links` and the per-card setting are **device-local, never in SHARED_ENTITIES**. Transactions the check posts are ordinary transactions and sync as usual.
- Migration `0066_statement_checks` registered after `{ version: 65, name: 'transaction_capture', … }` in `packages/db/src/migrations.ts`.
- Existing suites green: root `npm run typecheck`, `npm test`; db also with `vitest.capture.config.ts`.
- Matching, reading and posting are test-first; amount and date parsing get fast-check properties.
- Native UI kit only; copy has no "you"/"your" (house rule); phone and desktop both work.
- Ruling: spec §3.1 step 6 (a card learning its column layout from corrections) is deferred; this plan lets the owner correct a missing row's amount or date by hand (Task 5 Step 6) without learning from it. Cost if wrong: a bank layout the reader gets wrong needs correcting each month until learning is added.
- Commit subjects: plain sentence saying what now works; trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Implementers never dispatch subagents; no `git stash`; never `pkill`.

## Review Focus

1. **A statement spanning December–January** (period 11 Dec 2026 – 10 Jan 2027, rows `15DEC` and `05JAN`). Expect 2026-12-15 and 2027-01-05. Test: Task 1 `places each row's year inside the period`.
2. **Two genuinely identical purchases in one screenshot** (two `KURASU KISSATEN 113,190` rows on 06MAY) vs the same row repeated across two overlapping screenshots. Expect two rows in the first case, one in the second. Test: Task 1 `keeps repeats inside one image, drops the overlap between images`.
3. **Two same-amount candidates for one row** (two Rp55.000 purchases on 31 May and 1 Jun, statement row 31MAY 55,000). Expect the closer date wins; if dates tie and texts tie, the row is `ask`. Test: Task 2 `breaks a tie by date, then text, then asks`.
4. **Checking the same period twice.** Expect nothing posted twice; the second check reuses links. Test: Task 3 `a second check of a period posts nothing again`.
5. **A statement older than the card's start in cicis** with the card's opening balance at a later date. Expect the opening moves to the statement start with the previous balance, and the card's balance today is unchanged after recording the history. Test: Task 3 `moving the card's start keeps today's balance`.

---

## Parallel lanes

- **Wave 1 (parallel, disjoint files):** Task 1 (core reader), Task 2 (core matcher), Task 4 (native: recognise images from the web), Task 7 (donut follows filter), Task 8 (Review list in Cashflow style).
- **Wave 2:** Task 3 (db: schema, candidates, categories, recording, adjustment, move start) — needs Tasks 1–2 types.
- **Wave 3:** Task 5 (web check screen + card entry + e2e hook) — needs Tasks 3, 4.
- **Wave 4 (parallel):** Task 6 (share extension: several images → statement), Task 9 (e2e, final pass).

---

### Task 1: The statement reader (pure, `@expanses/core`)

**Files:**
- Create: `packages/core/src/statement/types.ts`, `packages/core/src/statement/words.ts`, `packages/core/src/statement/read.ts`
- Modify: `packages/core/src/index.ts` (export block after the capture exports, ~:512-517)
- Test: `packages/core/test/statement-read.test.ts`, `packages/core/test/statement-read.property.test.ts`, `packages/core/test/fixtures/statement-corpus.ts`

**Interfaces:**
- Consumes: `CaptureLine` (`packages/core/src/capture/types.ts:14`), `exponentOf` (`capture/amount.ts:11`), `parseNumber` (`capture/amount.ts:68`, export it from amount.ts if not exported).
- Produces:
```ts
export interface StatementPeriod { start: string; end: string } // inclusive ISO dates
export interface StatementRow {
  on: string;              // transaction date, ISO
  postedOn: string | null; // posting date when two dates printed
  description: string;     // as printed, trimmed
  amountMinor: number;     // positive, card currency minor units
  direction: 'out' | 'in';
  isFee: boolean;
  image: number;           // index of the screenshot it came from
}
export interface StatementReading {
  rows: StatementRow[];
  closingMinor: number | null;
  previousMinor: number | null;
  /** Images that gave no row and no balance — "Nothing read from screenshot N". */
  emptyImages: number[];
}
export function readStatement(images: readonly CaptureLine[][], period: StatementPeriod, currency: string): StatementReading;
export function merchantKeyOf(description: string): string; // normalised for "same merchant" (§3.3)
export const STATEMENT_WORDS: StatementWords;
```

- [ ] **Step 1: Word lists** — `words.ts` exports `STATEMENT_WORDS = { closing: ['new balance','closing balance','saldo akhir','tagihan baru','total tagihan','outstanding','current balance'], previous: ['previous balance','saldo sebelumnya','tagihan sebelumnya','last statement balance'], fee: ['fee','biaya','materai','stamp duty','interest','bunga','annual','iuran','late charge','denda'], inMarkers: ['cr','k','kredit','credit'], outMarkers: ['db','d','debit'], months: {jan:1, feb:2, mar:3, apr:4, may:5, mei:5, jun:6, jul:7, aug:8, agu:8, ags:8, sep:9, oct:10, okt:10, nov:11, dec:12, des:12} }` with type `StatementWords`. Lowercase. No bank names.

- [ ] **Step 2: Write the failing corpus tests.** `fixtures/statement-corpus.ts` holds synthetic line sets with invented merchants, built with `const line = (text: string, x: number, y: number, w = 0.2, h = 0.02): CaptureLine => ({ text, box: [x, y, w, h], height: h })`. Columns as separate lines on one y (x 0.05 / 0.15 / 0.25 / 0.85) like Vision returns them. Cases (each with expected `StatementReading`):
  1. *Two-date layout* (owner's HSBC-like): rows `07MAY 06MAY KOPI SENJA JAKARTA SLT ID 127,050`, `08MAY 08MAY 0811000000 JKT ID ID 8,786,844CR`, `03JUN 03JUN STAMP DUTY FEE 10,000`; period 11 May–10 Jun 2026 → `on` 2026-05-06 / 2026-05-08 / 2026-06-03, `postedOn` 2026-05-07…, directions out/in/out, isFee false/false/true, amounts 127050 / 8786844 / 10000.
  2. *One-date Indonesian layout*: `06/05 TOKO BUKU 55.000`, `09/05 PEMBAYARAN - TERIMA KASIH 1.000.000 K` → in for the second.
  3. *Minus marker*: `12 Mei 2026 REFUND TOKO ABC -250.000` → in, 250000.
  4. *Summary image*: lines `Previous Balance` `12,000,000` / `New Balance` `19,214,880` on one y each → previousMinor 12000000, closingMinor 19214880, no rows.
  5. *Dec–Jan*: period 2026-12-11..2027-01-10, rows `15DEC` and `05JAN` → 2026-12-15, 2027-01-05.
  6. *Overlap*: image A rows r1..r5, image B rows r4..r8 → 8 rows; image C containing two identical rows (same date/desc/amount) twice → both kept.
  7. *Noise*: header lines (`HSBC`-free: `CREDIT CARD STATEMENT`, `Card number 4XXX XXXX XXXX 1234`, `Payment due 15JUN`) produce no rows.
  8. *Empty image*: a blurred image's lines `[]` → `emptyImages: [2]`.
  Test file asserts each case with `toEqual`.

- [ ] **Step 3: Run** `cd packages/core && npx vitest run test/statement-read.test.ts` — expect FAIL (module missing).

- [ ] **Step 4: Implement `read.ts`.**
  - Group each image's lines into rows by vertical centre `y + h/2` with tolerance `0.6 × median line height`; sort each group by `x`; row text = parts joined by a space.
  - Dates: regex at the start of the row text, up to two: `(\d{1,2})\s?([A-Za-z]{3,})` (month word via `months`, first 3 letters, case-insensitive) | `(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?`. Two dates → first postedOn, second on. Year: if printed use it; else choose the year that puts `MM-DD` inside `[period.start − 7 days, period.end + 7 days]`, trying `end`'s year then `start`'s year.
  - Amount: last token(s) of the row matching `([-+]?[\d.,]+)\s*(CR|DB|K|D)?$` (case-insensitive, marker may be glued: `8,786,844CR`). Parse with `parseNumber`; reject if null or the number has no thousands separator and fewer than 3 digits (avoids page numbers). Minor = `round(major × 10^exponentOf(currency))`. Direction `in` when marker ∈ inMarkers or leading `-`; else `out`.
  - Description: text between the last date and the amount, whitespace collapsed. A row needs a date AND an amount; otherwise it is not a statement row.
  - Balances: any row (not a statement row) whose text contains a `closing` / `previous` word and ends in an amount → that balance (first found wins; `previous` checked first so "previous balance" does not count as closing).
  - Fee: description contains a `fee` word (word-boundary, case-insensitive).
  - Overlap: for consecutive images A, B, find the longest k ≥ 1 where A's last k rows equal B's first k rows (on, description, amountMinor, direction); drop B's first k.
  - `merchantKeyOf`: lowercase; strip trailing country/city tokens (`\b(id|idn|jakarta( (slt|selat|pusat|barat|timur|utara))?|tangerang( kab)?|bandung|surabaya|bali|sg|my|us)\b` from the END only, repeatedly); remove digits and `*`; collapse spaces. (City list is geography, not brands — allowed.)

- [ ] **Step 5: Property tests** (`statement-read.property.test.ts`, fast-check, `numRuns: 300, seed: 20261003`): (a) any integer rupiah 1..10^10 written `n.toLocaleString('en-US')` with optional `CR` reads back exactly, direction matches marker; (b) any date inside a random 31-day period written `DDMMM` reads back the same ISO date.

- [ ] **Step 6: Run** both test files → PASS. Export from `packages/core/src/index.ts`: `export { readStatement, merchantKeyOf } from './statement/read'; export { STATEMENT_WORDS, type StatementWords } from './statement/words'; export type { StatementPeriod, StatementReading, StatementRow } from './statement/types';`

- [ ] **Step 7: Commit** — "A statement's screenshots are read into rows, dates with their year, money in and out, fees, and the two balances".

---

### Task 2: The matcher (pure, `@expanses/core`)

**Files:**
- Create: `packages/core/src/statement/match.ts`
- Modify: `packages/core/src/index.ts` (one export line)
- Test: `packages/core/test/statement-match.test.ts`

**Interfaces:**
- Consumes: `StatementRow` (Task 1 types — create `types.ts` identically if Task 1 has not landed; the controller reconciles at the wave merge).
- Produces:
```ts
export interface Candidate {
  id: string;               // transaction id or `draft:<id>`
  on: string;               // occurredOn (or postedOn when set)
  amountMinor: number;      // positive
  direction: 'out' | 'in';
  kind: 'purchase' | 'refund' | 'payment'; // payment = transfer into the card
  description: string;
  isDraft: boolean;
}
export type RowOutcome =
  | { row: number; status: 'matched'; candidateIds: string[] }
  | { row: number; status: 'differs'; candidateId: string; statementMinor: number; recordedMinor: number }
  | { row: number; status: 'missing'; as: 'purchase' | 'refund' | 'fee' | 'payment' }
  | { row: number; status: 'ask'; candidateIds: string[] }
  | { row: number; status: 'payment-untracked' };
export interface MatchResult { outcomes: RowOutcome[]; flagged: string[] /* candidate ids inside the period no row took */ }
export function matchStatement(
  rows: readonly StatementRow[],
  candidates: readonly Candidate[],
  opts: { period: StatementPeriod; trackPayments: boolean; refundHints: ReadonlyMap<number, boolean> /* row index → looks like a shop refund */ },
): MatchResult;
export function looksLikeRefund(row: StatementRow, earlierPurchases: readonly { description: string; amountMinor: number }[]): boolean;
```

- [ ] **Step 1: Failing tests** (`statement-match.test.ts`), one `it` each, with small fixtures:
  1. exact match same amount, ±3 days purchase → matched.
  2. 4 days away → missing (purchase).
  3. 126,500 vs recorded 126,000 same day → differs (within 5%); 140,000 vs 126,000 → missing + candidate flagged.
  4. CR row with `trackPayments: false` and not refund → `payment-untracked`; with `true` → matched to a payment candidate within ±5 days; two CR rows 8,786,844 + 240,240 on 08MAY vs one payment candidate 9,027,084 on 09MAY → both rows `matched` with the same candidate id.
  5. CR row refund hint true, no candidate → missing as refund.
  6. Fee row with no candidate → missing as fee.
  7. Tie: two candidates 55,000 on 31 May and 2 Jun, row 31MAY → matched to 31 May; two candidates both 1 Jun (row 31 May), descriptions `NOB CAFE` and `ASA KIOSK`, row `NOB CAFE PLAZA` → the NOB candidate; same but descriptions identical → `ask` with both ids.
  8. A candidate used once only: two rows 55,000 same day, two candidates 55,000 same day → each matched to a different one.
  9. Draft candidate (`isDraft`) matches like a transaction.
  10. Flagged: candidate inside period taken by no row → in `flagged`; candidate after `period.end` → not flagged.
  11. `looksLikeRefund`: CR row `KOPI SENJA JAKARTA SLT ID 113,190CR` with an earlier purchase `KOPI SENJA JAKARTA SLT ID` → true; `0811000000 JKT ID ID` with no matching purchase and no letters other than city codes → false.
- [ ] **Step 2: Run** `cd packages/core && npx vitest run test/statement-match.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Process rows in date order. For each row compute eligible unused candidates: same direction; for out rows kind purchase (or draft); for in rows: refund candidates if `refundHints.get(i)`, else payment candidates when trackPayments (else outcome `payment-untracked` immediately). Window ±3 days (purchases/refunds), ±5 (payments). Exact-amount candidates first; pick nearest date; tie on date → highest token overlap of `merchantKeyOf` texts (Jaccard on words); still tied → `ask`. No exact → candidates within 5% (|a−b| ≤ 0.05·statement) → `differs` with nearest. Payment sum: if no single payment matches, try subsets of in-rows within ±2 days of each other (size ≤ 4) whose sum equals one unused payment candidate within ±5 days → all `matched` to it. Remaining → `missing` with `as` = fee if `isFee`, refund if hint, payment if `in` and trackPayments, else purchase. `flagged` = unused candidates with `period.start ≤ on ≤ period.end`.
- [ ] **Step 4: Run** → PASS. Export `matchStatement, looksLikeRefund, type Candidate, type RowOutcome, type MatchResult` from index.
- [ ] **Step 5: Commit** — "Statement rows are matched to the card's transactions by amount, date and direction, with near amounts, split payments and ties".

---

### Task 3: Recording a check (db)

**Files:**
- Create: `packages/db/migrations/0066_statement_checks.sql`, `packages/db/src/schema-statements.ts`, `packages/db/src/repos/statement-check.ts`
- Modify: `packages/db/src/migrations.ts` (import after :65, entry after :138), `packages/db/src/index.ts` (exports), `packages/db/src/repos/ledger.ts` or list query to hide the payments adjustment from the main list (see Step 6), `docs/superpowers/specs/2026-10-03-statement-check-design.md` §3.5 (local-only ruling line)
- Test: `packages/db/test/statement-check.test.ts`

**Interfaces:**
- Consumes: `readStatement` types, `matchStatement`, `looksLikeRefund`, `merchantKeyOf` (Tasks 1–2); `cardStatement(database, ws, cardAccountId, cycle, today)` (repos/statements.ts:168); `postTransactionTx`, `replaceTransactionTx` (ledger.ts:148, :317); `expenseLines`, `transferLines`, `openingBalanceLines` (core ledger/lines.ts); `systemAccountId(tx, ws, 'opening_balance')` (accounts.ts:128); `guessCategoryFromHistory(database, ws, description)` (repos/entry.ts:18); `categoryIdsByKey(database, ws)` (categories.ts:215) — fees key `'miscellaneous.fees_charges'`; `openingsOf` (pockets.ts:188).
- Produces:
```ts
export interface CheckDraftRow extends StatementRow { index: number; outcome: RowOutcome; categoryId: string | null; categorySource: 'known' | 'same-merchant' | 'fee' | 'owner' | null }
export interface PreparedCheck {
  cardAccountId: string; period: StatementPeriod; currency: string;
  rows: CheckDraftRow[]; flagged: { transactionId: string; on: string; description: string; amountMinor: number }[];
  closingMinor: number | null; previousMinor: number | null; emptyImages: number[];
  untrackedPaymentsMinor: number; untrackedPaymentsCount: number;
  cardBalanceAtEndMinor: number; // cicis's closing for the period before recording
  startsAfterPeriod: boolean;    // S10: the card's opening is later than period.start
  alreadyChecked: boolean;
}
export function prepareStatementCheck(database: Database, ws: WorkspaceContext, input: { cardAccountId: string; period: StatementPeriod; images: CaptureLine[][]; today: string }): Promise<PreparedCheck>;
export function fillSameMerchant(rows: CheckDraftRow[], index: number, categoryId: string): CheckDraftRow[]; // pure; sets owner on index, same-merchant on unanswered rows with equal merchantKeyOf
export interface CheckDecisions { differs: Record<number, 'statement' | 'mine'>; flagged: Record<string, 'keep' | 'delete' | { moveTo: string }>; ask: Record<number, string /* chosen candidate id */>; moveStart: boolean }
export function recordStatementCheck(database: Database, ws: WorkspaceContext, prepared: PreparedCheck, decisions: CheckDecisions): Promise<{ checkId: string; status: 'reconciled' | 'differs' | 'open'; differenceMinor: number }>;
export function getTrackPayments(database: Database, cardAccountId: string): Promise<boolean>;
export function setTrackPayments(database: Database, cardAccountId: string, on: boolean): Promise<void>;
export function listStatementChecks(database: Database, ws: WorkspaceContext, cardAccountId: string): Promise<StatementCheckRow[]>;
```

- [ ] **Step 1: Migration** `0066_statement_checks.sql`:
```sql
/* Statement checks: device-local, never synced (card terms are not synced either). */
CREATE TABLE statement_checks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  card_account_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  closing_minor INTEGER,
  previous_minor INTEGER,
  status TEXT NOT NULL CHECK (status IN ('reconciled', 'differs', 'open')),
  difference_minor INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL
);
CREATE UNIQUE INDEX statement_checks_period ON statement_checks (card_account_id, period_start, period_end);
CREATE TABLE statement_links (
  check_id TEXT NOT NULL REFERENCES statement_checks (id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('matched', 'recorded', 'differs-kept', 'differs-updated', 'payments-untracked')),
  PRIMARY KEY (check_id, transaction_id)
);
CREATE TABLE card_statement_settings (
  card_account_id TEXT PRIMARY KEY,
  track_payments INTEGER NOT NULL DEFAULT 0
);
```
  Drizzle schema in `schema-statements.ts`; register v66; export schema.
- [ ] **Step 2: Failing tests** (`statement-check.test.ts`, setup like `packages/db/test/statements.test.ts:27-45`: IDR workspace, card `createCardAccount(... {name:'Visa', subtype:'credit_card', currency:'IDR', openingBalanceMinor: 0, openedOn:'2026-01-01'})`, `saveCardTerms(... statementDay: 10, dueDay: 25 ...)`, bank account, categories via `listAccounts`):
  1. `prepare` with two images (rows built with the Task 1 corpus helper) where one row matches a recorded purchase and two are missing → outcomes matched/missing; missing row whose merchant has an earlier categorised transaction → `categorySource: 'known'`; fee row → fees category, `'fee'`.
  2. `fillSameMerchant` fills the second same-merchant row, leaves a different merchant null.
  3. `record` posts missing purchases as expenses on the card with their categories (balance of card rises by the sum), refunds as money back (`expenseLines` with the card and category reversed: card debited, category credited — assert the category total goes down), untracked payments as ONE transaction `Payments not tracked (N payments)` from the opening-balance equity account into the card, flagged as excluded (`excludedFromReport: true`), with link kind `payments-untracked`; status `reconciled` when cicis closing equals statement closing; `differs` with the difference otherwise.
  4. `differs` decision `'statement'` replaces the transaction amount (replaceTransactionTx, same category, same note); `'mine'` leaves it; links record which.
  5. Flagged `'delete'` voids; `{ moveTo: otherCardId }` re-posts on the other card; `'keep'` untouched.
  6. **Review Focus 4:** `a second check of a period posts nothing again` — record, then prepare+record the same images → zero new transactions; `alreadyChecked: true` on the second prepare.
  7. **Review Focus 5:** `moving the card's start keeps today's balance` — card opened 2026-08-01 with 5,000,000 owed; statement period May with previousMinor 1,000,000 and rows totalling the May–Jul movement such that after recording May–Jul history (three checks) + `moveStart: true` on the first, `cardStatement(... today)` balance today still equals 5,000,000 plus only post-August activity. Implement as: on the oldest check with `moveStart`, replace the card's opening transaction (identify via `openingsOf`) with one dated `period.start − 1 day` and amount `previousMinor`.
  8. `trackPayments` true: a CR payment row with no transfer → recorded as a transfer from the chosen account? Out of scope for this task — when `trackPayments` is true and a payment is missing, `prepare` marks it `missing as payment` and `record` posts it from the opening-balance equity account like untracked BUT as a visible transfer (not excluded) with description `Card payment`. (Asking for the From account is a UI follow-up; record in the ledger.)
  9. Setting: `getTrackPayments` default false; `setTrackPayments(true)` persists.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement `prepareStatementCheck`.** `readStatement(images, period, card currency)`; candidates = transactions with an entry on the card from `period.start − 7` to `period.end + 7` (`listTransactions` with `accountId`, `from`, `to`, `limit: 2000`) mapped to `Candidate` (direction from the card entry sign: card liability entry negative = charge = out; kind payment when the other entry is a money account (asset) and direction in; refund when the other entry is a category and direction in; `on` = posted date when a `card_postings` row exists) plus pending drafts on that card (`listDrafts`, `isDraft: true`, id `draft:<id>`). Refund hints via `looksLikeRefund` against out rows and candidate purchases. `matchStatement`. Categories: `known` via `guessCategoryFromHistory(row.description)`; fees via key. `cardBalanceAtEndMinor` = `cardStatement(..., {start, end}, today).closingMinor`. `startsAfterPeriod` = opening date (`openingsOf`) > `period.start`. `alreadyChecked` = row in `statement_checks` for card+period.
- [ ] **Step 5: Implement `recordStatementCheck`** in one `database.transaction`: upsert the check row (unique index) and reuse existing links (skip rows whose matched/recorded link already exists); post missing rows with `source: 'csv'`-equivalent? Use `source: 'screen'` (ledgerSourceOf maps it) and `externalRef: statement:<card>:<period.start>:<index>:<amount>` so a re-run is idempotent; apply decisions; post the untracked-payments adjustment (`transferLines` from opening_balance equity to the card, `excludedFromReport: true`, description `Payments not tracked (${n} payments)`); merge matched drafts by confirming them (`confirmDraft`) with the row's category when the draft has none; compute status from `cardStatement` closing after posting vs `closingMinor` (null → 'open').
- [ ] **Step 6: Hide the adjustment from the main list.** In `apps/web/src/features/transactions/list-model.ts` `buildRows`, skip rows whose description starts with `Payments not tracked (` AND which have an entry on the opening-balance equity account (`accountSystemKey === 'opening_balance'`) — the card's StatementPanel keeps showing it (it reads `cardStatementLines`). Add a list-model unit test.
- [ ] **Step 7: Run** db tests (plain and `-c vitest.capture.config.ts`) and the list-model test → PASS. Correct spec §3.5 with the local-only ruling line.
- [ ] **Step 8: Commit** — "A statement check records what was missing, links what matched, reconciles the closing balance, and keeps untracked card payments as one quiet line".

---

### Task 4: Reading pictures the web layer picked (native)

**Files:**
- Modify: `apps/web/ios/App/App/Capture/CapturePlugin.swift` (method list :13-20, new @objc func), `apps/web/src/capture/native.ts` (CapturePluginApi + CaptureWeb stub)
- Test: `apps/web/src/capture/native.test.ts` (web stub behaviour), simulator build

**Interfaces:**
- Produces: `recognizeImage({ base64: string }): Promise<{ lines: CaptureLine[] }>` on `CapturePluginApi`; web stub returns `window.__statementLines?.shift()` in e2e builds (`VITE_E2E==='1'`), else throws `Not available here`.
- [ ] **Step 1:** Swift: `@objc func recognizeImage(_ call: CAPPluginCall)` — decode base64 → `UIImage` → `TextRecognizer.upright` → `cgImage` → `TextRecognizer.recognize(image:)` → resolve `{ lines: [{text, box, height}] }`; reject with "unreadableImage" on decode failure. Register in the plugin's method list as `CAPPluginMethod(name: "recognizeImage", returnType: CAPPluginReturnPromise)`. Nothing written to disk.
- [ ] **Step 2:** TS: add the method to `CapturePluginApi` and `CaptureWeb`; declare `window.__statementLines?: CaptureLine[][]` in the e2e global (test-hook.ts's `declare global`).
- [ ] **Step 3:** Unit test the web stub: with `__statementLines = [[l1], [l2]]` (and `import.meta.env.VITE_E2E` stubbed via `vi.stubEnv('VITE_E2E','1')`) two calls return them in order.
- [ ] **Step 4:** Build: `cd apps/web/ios/App && xcodebuild -project App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' -derivedDataPath <scratch> CODE_SIGNING_ALLOWED=NO build` → BUILD SUCCEEDED.
- [ ] **Step 5: Commit** — "The app can read the text of a picture it was handed, on the phone".

---

### Task 5: The check screen (web)

**Files:**
- Create: `apps/web/src/features/statement-check/CheckStatementPage.tsx`, `CheckResult.tsx`, `MissingRows.tsx`, `check-model.ts` (+ `check-model.test.ts`)
- Modify: `apps/web/src/app/router.tsx` (route `/cards/$cardId/check` on rootRoute, like `/accounts/$accountId/move` :205), `apps/web/src/features/cards/StatementPanel.tsx` (a "Check statement" row in the `Statements` InsetGroup :327-336), `apps/web/src/capture/test-hook.ts` (nothing new beyond Task 4's global)
- Test: `check-model.test.ts`, e2e in Task 9

**Interfaces:**
- Consumes: `prepareStatementCheck`, `fillSameMerchant`, `recordStatementCheck`, `getTrackPayments` (Task 3); `native.recognizeImage` (Task 4); `CategoryIcon` (features/categories/CategoryIcon.tsx:92), `CategoryPicker` (features/transactions/CategoryPicker.tsx:99), `groupByDay` (list-model.ts), `DayHeader` pattern (TransactionsPage.tsx:120 — extract to `features/transactions/DayHeader.tsx` and export, keeping TransactionsPage using it), `cycleBack` (features/cards/statement-dates.ts:12).
- Produces: route `/cards/$cardId/check?start=YYYY-MM-DD&end=YYYY-MM-DD`.
- [ ] **Step 1: `check-model.ts` (pure) + failing tests:** `summaryOf(prepared)` → counts `{matched, differs, missing, flagged, payments}` and headline `{ kind: 'reconciled' } | { kind: 'differs', differenceMinor, likely: string } | { kind: 'no-summary' }` (likely = "the N missing rows" when the missing total equals the difference, "a flagged transaction" when one flagged amount equals it, else "rows not matched"); `canRecordAll(rows)` (every missing row has a category, every ask answered); `missingByDay(rows)` grouped for the Cashflow-style list in statement order.
- [ ] **Step 2: Start screen** (`CheckStatementPage`): LargeTitle "Check statement"; InsetGroup with Card (fixed from route) and Statement period (default `cycleBack(today, statementDay, 1)`, editable two date fields); screenshot thumbnails from `<input type="file" accept="image/*" multiple>` (object URLs; removable); note text from the mockup; Button "Check N screenshots" → for each file `FileReader` → base64 → `native.recognizeImage` (progress line "Reading 2 of 5 on this phone…") → `prepareStatementCheck`. Thumbnails and bytes dropped from memory after reading.
- [ ] **Step 3: History guard:** when `startsAfterPeriod`, a confirm sheet "Start this card on {period.start} with {previous} owed?" (Yes → `moveStart: true`; No → continue without).
- [ ] **Step 4: Result** (`CheckResult`): balance card (✓ Reconciled / Differs by … with likely / "Add the summary to reconcile"); InsetGroup count rows Matched · Amount differs · Missing — record here · Payments not tracked (N, amount; only when > 0) · Recorded, not on this statement; each opens its list in the same page (segmented or stacked sections).
- [ ] **Step 5: Missing list** (`MissingRows`): Cashflow style — per day a card with DayHeader, rows: `CategoryIcon` (null → unknown visual, yellow), title = category name or "Choose category" (warn colour), subtitle = `known · ` / `same merchant · ` + description + ` · ` + card name, amount (alarm colour for out, tint for in). Tabs "All N" / "Needs a category · K". Tap → `CategoryPicker` → `fillSameMerchant`. Footer Button "Record all N" disabled until `canRecordAll`; label "Record all N · K still need a category" when disabled.
- [ ] **Step 6: Other lists:** Missing rows also open a small edit sheet (long-press or ⋯) to correct the amount or date read;  Amount differs rows with two buttons "Use {statement}" / "Keep mine"; Flagged rows with "Move to another card" (sheet listing other credit cards), "Keep", "Delete"; Matched read-only; Ask rows let the owner pick one candidate.
- [ ] **Step 7: Record:** `recordStatementCheck` → toast "May statement checked — ✓ Reconciled" (or difference) → back to the card page.
- [ ] **Step 8: Card entry:** in StatementPanel's Statements group add `InsetRow title="Check statement" subtitle="Compare screenshots of the bank's statement" to="/cards/$cardId/check" search={{ start, end }}` for the cycle on screen; on closed cycles that have a check, the subtitle shows "Checked · ✓ Reconciled" (from `listStatementChecks`).
- [ ] **Step 9: Card setting:** on the card's Card tab, a switch "Track card payments" (default off) with footer "Off: payments on a statement are kept as one line on the card, not as transfers." → `setTrackPayments`.
- [ ] **Step 10:** `cd apps/web && npx vitest run src/features/statement-check src/features/transactions` and `npx tsc -p tsconfig.json --noEmit` → PASS.
- [ ] **Step 11: Commit** — "A card's statement can be checked from screenshots: matched, missing recorded in statement order, extras flagged, the balance reconciled".

---

### Task 6: Several screenshots from Photos (share extension)

**Files:**
- Modify: `apps/web/ios/App/CaptureShare/ShareViewController.swift`, `apps/web/ios/App/App/Capture/HoldingArea.swift`, `apps/web/src/native/deep-link.ts` (+ test), `apps/web/src/app/App.tsx`, `apps/web/src/capture/native.ts`
- Create: `apps/web/src/features/statement-check/PickCardPage.tsx`, route `/statement/shared`

**Interfaces:**
- Produces: deep link `cicis://statement/<batchId>`; `native.takeStatementBatch({ batchId }): Promise<{ images: { lines: CaptureLine[] }[] }>` (reads and deletes the batch from the App Group).
- [ ] **Step 1:** Share extension: when the share holds **2 or more images**, recognise each (TextRecognizer, upright), write `captures/statement-<batchId>/<n>.json` (lines only — no image bytes), open `cicis://statement/<batchId>`. One image keeps today's capture path.
- [ ] **Step 2:** Plugin method `takeStatementBatch` returns and deletes the folder. Web stub returns `{ images: [] }`.
- [ ] **Step 3:** `deep-link.ts`: `statementBatchOf(url): string | null` for `cicis://statement/<id>` + test; `listenForStatementLinks(open)` like `listenForReviewLinks`; App.tsx navigates to `/statement/shared?batch=<id>`.
- [ ] **Step 4:** `PickCardPage`: "Which card is this statement?" list of credit cards → period default from that card's last cycle → continues into the same flow as Task 5's page from the reading step (lines already recognised).
- [ ] **Step 5:** Simulator build green; vitest for deep-link. Commit — "Sharing several statement screenshots from Photos opens the check on the chosen card".

---

### Task 7: Cashflow's donut follows the Paid-with filter

**Files:**
- Modify: `packages/db/src/repos/reports.ts` (`categoryRows` / `categoryTotalsIn` opts `paidAccountId?: string`), `apps/web/src/features/transactions/SpendingReport.tsx` (prop `paidAccountId?`, in queryKey), `apps/web/src/features/transactions/TransactionsPage.tsx` (pass `paidPicked` account id when filter is `acct:`), `apps/web/src/ui/ChipMenu.tsx` (count badge when active)
- Test: `packages/db/test/reports-paid-filter.test.ts`, `apps/web/src/ui/ChipMenu.test.ts` if a test file pattern exists (else a small render-free unit for the badge label)

- [ ] **Step 1: Failing db test:** two accounts (card, bank), expenses Groceries 100 on card, Groceries 50 on bank, Restaurants 30 on card → `categoryTotalsIn(..., { paidAccountId: card })` gives Groceries 100, Restaurants 30; without the option 150/30. A split transaction (card pays 80 of a 100 expense split with bank 20 — via two money entries) counts the card's share (80) in its category.
- [ ] **Step 2: Implement:** in `categoryRows` when `paidAccountId` given, restrict to transactions having an entry on that account and scale each category amount by `(that account's entry abs) / (sum of money-side entries abs)` for the transaction (computed in SQL subquery or in TS after fetching per-transaction rows — follow the function's existing shape).
- [ ] **Step 3: Web:** TransactionsPage passes `paidAccountId` when `filters.paid` starts with `acct:` (for `card:` filters pass the card's account id); SpendingReport adds it to `categoryTotalsIn` opts and the queryKey. ChipMenu: when `active` and `iconOnly`, render a small dark filled background and a count badge (`1`) on the icon — matching mockup option A; no other indicator.
- [ ] **Step 4:** db + web unit tests, typecheck → PASS. Commit — "Cashflow's donut shows only the card or account the list is filtered to".

---

### Task 8: Review drawn like the Cashflow list

**Files:**
- Modify: `apps/web/src/features/review/ReviewPage.tsx` (phone layout), possibly `apps/web/src/features/review/capture-view.ts`
- Create (shared with Task 5): `apps/web/src/features/transactions/DayHeader.tsx` — extract `DayHeader` from TransactionsPage.tsx:120 and export; TransactionsPage imports it. (Task 5 consumes it; if Task 5 starts first it creates it the same way — controller reconciles.)
- Test: e2e `phone-review.spec.ts`, `phone-capture.spec.ts` stay green (update selectors only if needed)

- [ ] **Step 1:** On phone, render drafts grouped by `occurredOn` (newest first) in Cards with `DayHeader` (day total = sum of |amount| out minus in), each row via the same visual as `TransactionRow`: `CategoryIcon` (draft.categoryAccountId; null → unknown visual with yellow tone), title = category name or "Choose category" (warn) — transfers "Transfer"; subtitle = source icon (🔔 📱 🧾) + description + ` · ` + account name or "Which account?" (warn); amount right. Keep `data-testid="draft-row"`, swipe right/left behaviour, tap → the Add-style screen (unchanged). Desktop table unchanged.
- [ ] **Step 2:** Run `E2E_PORT=4201 E2E_RELAY_PORT=8821 npx playwright test phone-review.spec.ts phone-capture.spec.ts capture.spec.ts --workers=2 --output=<scratch>`; adjust only selectors that relied on the old row text, keeping intent. Commit — "Review lists captures like Cashflow: by day, with each category's icon".

---

### Task 9: End to end and the final pass

**Files:** Create `apps/web/e2e/phone-statement-check.spec.ts`, `apps/web/e2e/statement.ts` (helpers: `statementLines(rows)` building column lines; `setStatementImages(page, images)` → `window.__statementLines = images` before pressing Check).

- [ ] **Step 1:** E2E (phone project): open a card with billing date 10 (`openCard` + terms), add two purchases by hand (one matching a statement row exactly, one 126,000 vs statement 126,500), open Activity → Check statement, attach 2 dummy files (`setInputFiles` with small PNG buffers) and set `__statementLines` for 2 images + a summary image (3 files); Check → result shows Matched 1, Amount differs 1, Missing 3 (one fee), Payments not tracked 1; choose "Use 126.500"; choose a category for the unknown merchant (fills its twin "same merchant"); Record all → toast; card page subtitle "Checked · ✓ Reconciled"; Cashflow filtered Paid with = the card shows the categories (donut total equals the card's spending); the payments adjustment is absent from Transaction history.
- [ ] **Step 2:** Root `npm run typecheck`, `npm test`, db `-c vitest.capture.config.ts`, e2e `phone-statement-check.spec.ts phone-review.spec.ts phone-capture.spec.ts capture.spec.ts card-statements.spec.ts transactions-list.spec.ts` green; simulator build green.
- [ ] **Step 3: Commit** — "A statement travels from screenshots to a reconciled month end to end".

---

## Code map

- Cycles: `packages/core/src/points/cycles.ts` (`Cycle`, `statementCycleFor`, `cycleFor`, `previousCycle`); web `cycleBack` `apps/web/src/features/cards/statement-dates.ts:12`.
- Statements: `packages/db/src/repos/statements.ts` (`cardStatement` :168 → `CardStatement {openingMinor, chargesMinor, creditsMinor, closingMinor, lines, …}`, `cardStatementLines` :160); terms `repos/points.ts` (`getCardTerms` :95, `saveCardTerms` :107); schema `schema-cards.ts` (cards.last4, card_postings, card_settlements).
- Ledger: `repos/ledger.ts` (`postTransactionTx` :148, `replaceTransactionTx` :317, `voidTransactionTx` :290, `PostTransactionInput` :68 incl. `excludedFromReport`, `externalRef`, `source`; `listTransactions` :634 opts `{accountId, from, to, limit (default 500)}`; `TransactionView` :469); lines `packages/core/src/ledger/lines.ts`.
- Opening: `accounts.ts` `systemAccountId` :128; openings `pockets.ts` `openingsOf` :188; opening description `Opening balance: ${name}`.
- Categories: `categories.ts` `categoryIdsByKey` :215; fees key `miscellaneous.fees_charges` (`core/src/categories/defaults.ts:32`); history guess `repos/entry.ts` `guessCategoryFromHistory` :18.
- Drafts: `repos/drafts.ts` (`listDrafts` :231, `confirmDraft` :279).
- Capture: `core/src/capture/{types,amount,date}.ts` (`parseNumber` :68, `exponentOf` :11); native bridge `apps/web/src/capture/native.ts:15`; Swift `TextRecognizer` `apps/web/ios/App/App/Capture/TextRecognizer.swift`; share ext `apps/web/ios/App/CaptureShare/ShareViewController.swift`; holding area `HoldingArea.swift`; deep links `apps/web/src/native/deep-link.ts`; e2e hook `apps/web/src/capture/test-hook.ts`.
- Web: day cards `TransactionsPage.tsx:1200` (`DayHeader` :120), `TransactionRow.tsx:27`, `CategoryIcon.tsx:92`, `CategoryPicker.tsx:99`, `list-model.ts` (filters :60/:194, `groupByDay`); `SpendingReport.tsx` (query :271); `reports.ts` `categoryTotalsIn` :103; `ChipMenu.tsx:111`; card page `CardDetailPage.tsx:509`, `StatementPanel.tsx` (Statements group :327-336); router `router.tsx` (`/accounts/$accountId/move` :205 pattern); Review `ReviewPage.tsx` (RecordTable :310).
- Migrations: latest `0065_transaction_capture.sql`; register in `packages/db/src/migrations.ts` after :65 / :138.
- Test helpers: `packages/db/test/helpers.ts` `setupDb`; `packages/db/test/statements.test.ts:27-45` card setup; e2e `openCard` `e2e/accounts.ts:151`, `addTransaction` `e2e/add-transaction.ts:55`, `cardSection` `e2e/card-section.ts:12`.
