# Transaction Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bank/e-wallet notifications (via iOS Shortcuts), screenshots (Screen scanner on Back Tap / Action Button, share sheet) and receipt photos become drafts in the existing To-review inbox, read entirely on the phone, with per-source account and layout learning, duplicate merging and a picture viewer.

**Architecture:** A pure reader in `@expanses/core` turns a `RawCapture` (text, or text lines with positions from Apple Vision) into a `Reading`. A db layer keeps capture sources (account + learned template), matches and merges, and extends `draft_transactions` with kinds (expense / income / transfer). A first local Capacitor plugin (Swift) does text recognition, the camera, two App Intents and a share extension, handing captures over through an App Group holding area. The existing Review page gains the capture UI.

**Tech Stack:** TypeScript, SQLite/drizzle (`packages/db`), vitest + fast-check, React + native UI kit (`apps/web`), Capacitor 8 iOS (SPM, `apps/web/ios/App`), Swift (Vision, AppIntents, Share extension), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-transaction-capture-design.md` (binding; §n below). Code map: see "Code map" at the end.

## Global Constraints

- The spec is the authority; where code disagrees, code reality wins and the spec is corrected in the same commit with a line saying what changed and why.
- Nothing leaves the phone: no network call anywhere in capture code (D1, §5). No new runtime JS dependency for OCR; recognition is Apple Vision in Swift.
- Country-neutral: no bank, e-wallet or merchant name in code or word lists; language words live only in `packages/core/src/capture/words/{id,en}.ts`.
- Nothing is recorded unconfirmed: every capture becomes a draft (D2).
- Draft amount convention stays as today: `amountMinor` positive = money out of `accountId` (import convention in `repos/drafts.ts`).
- Captures, images, capture sources and templates are local only — never in `SHARED_ENTITIES`, never synced.
- Existing suite green: root `npm test`, `npm run typecheck`; db runs plain and with `vitest.capture.config.ts`.
- Parsing, matching and ledger logic are test-first; amount parsing gets fast-check properties.
- New migrations start at `0062` (registered in `packages/db/src/migrations.ts` after `{ version: 61, name: 'world_gold_price', … }`).
- iOS bundle id `com.cicis.app` is permanent; team `JPMPS53HUZ`; App Group id `group.com.cicis.app`.
- Native UI kit only; phone and desktop both work (desktop simply has no native capture triggers — D8).
- Commit subjects: a plain sentence saying what the user or code now does; trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Implementers never dispatch subagents; no `git stash`; never `pkill`.

## Review Focus

1. **A notification that shows a balance as well as the amount** ("Pembayaran Rp38.000 berhasil. Saldo Rp1.212.000"). Expect 38.000, never the balance. Test: Task 1 `balance line is never the amount`.
2. **Amounts written with dots as thousands and a comma decimal, or shorthand** (`Rp1.250.000`, `Rp 1.250.000,00`, `IDR 1,250,000.00`, `50rb`, `1,2jt`). Expect 1 250 000 / 50 000 / 1 200 000 IDR in minor units. Test: Task 1 property + table.
3. **Two real purchases of the same amount two hours apart** (two coffees). Expect two drafts, not a merge. Test: Task 3 `same amount two hours apart stays two`.
4. **A capture arriving for a workspace/account that was deleted or archived since the source learned it.** Expect a draft that asks "Which account is this?" again, not a crash or a draft on an archived account. Test: Task 4 `learned account archived → asks again`.
5. **The app not opened for days while captures pile up** (20 notifications). Expect all drained in order into drafts, merges applied across the batch, the badge correct. Test: Task 4 `drains a backlog of 20 in capture order`.

---

## Parallel lanes

- **Wave 1 (parallel):** Task 1 (core reader), Task 2 (db: migration, draft kinds, confirm by kind), Task 6 (native plugin: text recognition, camera, holding area, JS bridge). Disjoint files.
- **Wave 2 (parallel):** Lane A: Task 3 (matcher) then Task 4 (sources, learning, ingest) — Task 4 builds on Task 3. Lane B: Task 7 (App Intents, share extension — native only, needs Task 6).
- **Wave 3 (parallel):** Task 5 (Review page UI) and Task 8 (Settings → Capture). Both need Task 4.
- **Wave 4:** Task 9 (e2e, device checklist, final pass).

---

### Task 1: The reader (pure, `@expanses/core`)

**Files:**
- Create: `packages/core/src/capture/types.ts`, `packages/core/src/capture/words/id.ts`, `packages/core/src/capture/words/en.ts`, `packages/core/src/capture/words/index.ts`, `packages/core/src/capture/amount.ts`, `packages/core/src/capture/date.ts`, `packages/core/src/capture/read.ts`, `packages/core/src/capture/fingerprint.ts`
- Modify: `packages/core/src/index.ts` (append exports)
- Test: `packages/core/test/capture-amount.test.ts`, `packages/core/test/capture-amount.property.test.ts`, `packages/core/test/capture-date.test.ts`, `packages/core/test/capture-read.test.ts`, `packages/core/test/capture-corpus.test.ts`, `packages/core/test/capture-fingerprint.test.ts`, fixture `packages/core/test/fixtures/capture-corpus.ts`

**Interfaces (Produces):**
```ts
// types.ts
export type CaptureKind = 'notification' | 'screen' | 'photo' | 'shared-image';
export interface CaptureLine { text: string; box: [number, number, number, number]; height: number } // box: x,y,w,h in 0–1, y from top
export interface RawCapture {
  id: string; kind: CaptureKind; capturedAt: string;           // ISO with offset
  app: string | null; title: string | null; body: string | null;
  lines: CaptureLine[]; imageFile: string | null;
}
export type MoveType = 'spent' | 'received' | 'topup' | 'refund';
export interface Field<T> { value: T; confidence: number; line: number | null } // line = index into lines (images) or null
export interface Reading {
  skipped: null | 'promo' | 'unreadable';
  amount: Field<{ minor: number; currency: string | null }> | null;
  occurredAt: Field<string> | null;      // ISO date-time
  type: Field<MoveType>;
  name: Field<string> | null;           // merchant / recipient / sender
  accountHint: string | null;           // masked digits like "1234" seen as "···· 1234" / "**1234"
}
export interface Anchor { label: string | null; region: [number, number, number, number] | null }
export type Template = Partial<Record<'amount' | 'name' | 'date', Anchor>>;
export interface WordList {
  spent: string[]; received: string[]; topup: string[]; refund: string[];
  promo: string[]; balance: string[]; amountLabels: string[]; nameLabels: string[];
  nameLeadIns: string[];   // ke, to, di, at, dari, from, …
  thousand: string[]; million: string[]; // rb, ribu, k / jt, juta, m
}
// amount.ts
export function findAmounts(text: string, words: WordList): { minor: number; currency: string | null; start: number; end: number }[];
export const CURRENCY_EXPONENT: Record<string, number>; // IDR 2 (app stores IDR with 2 decimals), USD 2, JPY 0 … default 2
// date.ts
export function findDateTime(text: string): string | null; // 'YYYY-MM-DDTHH:mm' local, or 'YYYY-MM-DD'
// read.ts
export function readCapture(capture: RawCapture, words: WordList, template: Template | null): Reading;
// fingerprint.ts
export function fingerprintOf(capture: RawCapture): string[];            // sorted unique lowercase non-numeric words from lines whose box.y < 0.15, plus 'digits:NNNN' if an account hint exists
export function sameSource(a: string[], b: string[]): boolean;           // Jaccard ≥ 0.7
// words/index.ts
export const WORDS: WordList;   // merged id + en
```

Rules (spec §3.3): promo word anywhere → `skipped: 'promo'`. Amount: all figures; a figure on a line (or within the sentence) containing a `balance` word is never chosen; prefer a figure next to an `amountLabels` word; images: then the tallest line; else the first money figure after a spent/received word; else the largest. Currency: printed symbol/code (`Rp`, `IDR`, `$`, `USD`, `€`, `EUR`, `S$`, `SGD`, `RM`, `MYR`, `¥`, `JPY`), else null (caller fills). IDR `.` is a thousands separator when followed by exactly 3 digits; `,` followed by 1–2 digits at the end is a decimal. Type: first matching direction word (refund > topup > received > spent), default spent with confidence 40. Name: text after a `nameLabels` label on the same/next line, else after a `nameLeadIns` word up to punctuation or a money figure. With a template, each anchored field is looked up first (line whose text contains the anchor label → the figure/name on that line or the next; else the line inside the region); found → confidence 95.

- [ ] **Step 1: Write failing amount tests** (`capture-amount.test.ts`):
  ```ts
  import { describe, expect, it } from 'vitest';
  import { findAmounts, WORDS } from '../src/index';
  const one = (t: string) => findAmounts(t, WORDS).map(({ minor, currency }) => ({ minor, currency }));
  describe('findAmounts', () => {
    it.each([
      ['Rp38.000', 3_800_000, 'IDR'],
      ['Rp 1.250.000', 125_000_000, 'IDR'],
      ['Rp 1.250.000,00', 125_000_000, 'IDR'],
      ['IDR 1,250,000.00', 125_000_000, 'IDR'],
      ['50rb', 5_000_000, null],
      ['1,2jt', 120_000_000, null],
      ['$12.50', 1_250, 'USD'],
    ])('%s', (text, minor, currency) => expect(one(text)[0]).toEqual({ minor, currency }));
    it('finds both figures in order', () => expect(one('Bayar Rp38.000, saldo Rp1.212.000').map((a) => a.minor)).toEqual([3_800_000, 121_200_000]));
  });
  ```
- [ ] **Step 2:** `cd packages/core && npx vitest run test/capture-amount.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `types.ts`, `words/*`, `amount.ts`; export from `index.ts`. Word lists (Indonesian `id.ts`): spent `['bayar','pembayaran','transfer ke','kirim','dikirim','debit','belanja','tarik tunai']`, received `['masuk','diterima','dana masuk','terima','kredit','transfer dari','refund']` (refund also in refund), topup `['top up','topup','isi saldo','isi ulang']`, refund `['refund','pengembalian dana']`, promo `['diskon','cashback','voucher','promo','reward','kupon','poin']`, balance `['saldo','sisa saldo']`, amountLabels `['total','total bayar','jumlah','nominal','total pembayaran']`, nameLabels `['merchant','penerima','nama penerima','toko','pengirim']`, nameLeadIns `['ke','di','dari']`, thousand `['rb','ribu']`, million `['jt','juta']`. English `en.ts`: spent `['paid','payment','sent','debit','purchase','spent','withdrawal']`, received `['received','credited','credit','incoming','deposit']`, topup `['top up','top-up','topup','reload']`, refund `['refund','refunded']`, promo `['discount','cashback','voucher','promo','reward','coupon','points']`, balance `['balance','available balance','remaining']`, amountLabels `['total','amount','grand total','total paid']`, nameLabels `['merchant','recipient','payee','to account','sender','store']`, nameLeadIns `['to','at','from']`, thousand `['k']`, million `['m']`. (A promo word on the SAME line as a received word with a money figure — "cashback masuk Rp5.000" — is still a promo in v1; the Skipped list's Bring back covers it.)
- [ ] **Step 4:** Property test (`capture-amount.property.test.ts`, fast-check, 300 runs, seed 20260930): for random integer rupiah 1..10^10 formatted as `Rp` + dot-thousands (and optionally `,00`), `findAmounts` returns exactly that value ×100 with currency IDR; for random USD cents formatted `$` + comma-thousands + `.cc`, returns exactly those cents.
- [ ] **Step 5:** Date tests + `date.ts`: `'29 Sep 2026 08:12'`, `'29/09/2026 08:12'`, `'2026-09-29 08:12:05'`, `'29 September 2026'`, `'Sep 29, 2026, 8:12 PM'`, Indonesian months (`'29 Sept 2026'`, `'29 Okt 2026'`, `'1 Des 2026'`), none → null.
- [ ] **Step 6:** Reader tests (`capture-read.test.ts`) — write first, then `read.ts`:
  - `balance line is never the amount`: notification body `'Pembayaran Rp38.000 ke KOPI KENANGAN berhasil. Saldo Rp1.212.000'` → amount 3_800_000, type spent, name `'KOPI KENANGAN'`.
  - promo: `'Cashback Rp5.000 masuk! Pakai voucher'` → skipped 'promo'.
  - received: `'Dana masuk Rp 5.000.000 dari PT MAJU JAYA'` → received, name `'PT MAJU JAYA'`.
  - topup: `'Top up saldo Rp200.000 berhasil'` → topup.
  - image lines: GoPay-like success screen lines (made up, see corpus) with `'Total Bayar'` then `'Rp38.000'` (tallest) and `'Saldo Rp1.212.000'` → 3_800_000, name from `'Pembayaran ke'` next line.
  - unreadable: image with no money figure → `skipped: 'unreadable'`.
  - template: a template `{ amount: { label: 'Nominal Transfer', region: null } }` on lines where a bigger figure is a fee → the template's figure wins with confidence 95.
  - account hint: `'Rekening **1234'` / `'···· 1234'` → accountHint `'1234'`.
- [ ] **Step 7:** Corpus (`fixtures/capture-corpus.ts` + `capture-corpus.test.ts`): at least 30 made-up samples (no real account numbers, names invented) covering Indonesian and English notifications (bank transfer out, transfer in, QR payment, e-wallet payment, top-up, card purchase, refund, promo, OTP/security message with no amount → unreadable) and 8 image line sets (transfer receipt, e-wallet success, paper receipt with TOTAL and tax lines, invoice). Each has the expected `Reading` fields. Test asserts each.
- [ ] **Step 8:** Fingerprint tests + `fingerprint.ts`: two screenshots of the same app with different amounts share a fingerprint (`sameSource` true); two different apps don't.
- [ ] **Step 9:** `npm test -w @expanses/core`, root typecheck → PASS. Commit: "Captured text becomes a reading — amount, date, type and name — using per-language word lists and a learned layout when there is one".

---

### Task 2: Draft kinds, capture columns, capture sources table (db)

**Files:**
- Create: `packages/db/migrations/0062_transaction_capture.sql`
- Modify: `packages/db/src/migrations.ts`, `packages/db/src/schema-drafts.ts`, `packages/db/src/repos/ledger.ts` (`TransactionSource`), `packages/db/src/repos/drafts.ts` (`DraftRow`, `NewDraft`, `editDraft`, `confirmDraft`), `packages/db/src/schema.ts` (export new table if schema files are aggregated there — follow the existing pattern)
- Create: `packages/db/src/schema-capture.ts`
- Test: `packages/db/test/drafts-kinds.test.ts`

**Interfaces (Produces):**
```sql
-- 0062: SQLite cannot alter a CHECK; rebuild draft_transactions with the wider source CHECK and new columns
-- (copy the table, recreate indexes draft_transactions_pending and draft_transactions_ref exactly as 0030/0037).
source CHECK IN ('manual','csv','voice','receipt','email','notification','screen','photo')
kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','income','transfer')),
to_account_id TEXT, source_id TEXT, capture_ids TEXT, image_file TEXT, reading_json TEXT,
merged_into TEXT   -- a draft that was merged into another keeps a pointer (for Unmerge)
CREATE TABLE capture_sources (id TEXT PRIMARY KEY, workspace_id TEXT, key_kind TEXT NOT NULL CHECK (key_kind IN ('app','fingerprint')),
  key TEXT NOT NULL, label TEXT NOT NULL, account_id TEXT, template_json TEXT, captured_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE capture_skipped (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, reason TEXT NOT NULL CHECK (reason IN ('promo','expenses-only')),
  capture_json TEXT NOT NULL, reading_json TEXT NOT NULL, skipped_at TEXT NOT NULL);
CREATE TABLE capture_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- 'scope' = 'everything' | 'expenses-only'
```
TS: `TransactionSource` adds `'notification' | 'screen' | 'photo'`. `DraftRow`/`NewDraft` gain `kind: 'expense' | 'income' | 'transfer'` (NewDraft optional, default 'expense'), `toAccountId`, `sourceId`, `captureIds: string[]`, `imageFile`, `reading` (parsed `Reading | null`), `mergedInto`. `editDraft` patch gains `kind`, `toAccountId`, `description`. `confirmDraft(database, ws, id, opts: { setAside?; keepPhoto?: boolean })`:
- `expense`: as today (`expenseLines`-shaped, amount out of `accountId`).
- `income`: `incomeLines({ incomeAccountId: categoryAccountId, depositAccountId: accountId, amountMinor: |amount|, currency })`.
- `transfer`: requires `accountId` (from) and `toAccountId`; `transferLines({ fromAccountId, toAccountId, amountMinor: |amount|, currency })`; no category required (`NO_CATEGORY` only for expense/income; new `DraftError('NO_TO_ACCOUNT')`).
- `keepPhoto` and `imageFile` set → returns also `{ keptImage: imageFile }` so the web layer can copy the bytes into photos and `addPhoto` (web owns OPFS). Signature: `Promise<{ transactionId: string; keptImage: string | null }>` — update the one existing caller (ReviewPage) and tests.
- `listDrafts` excludes rows with `merged_into IS NOT NULL`.

- [ ] **Step 1:** Failing tests (`drafts-kinds.test.ts`): (a) migration keeps existing drafts (seed a 0061 db with a pending draft, migrate, row intact with kind 'expense'); (b) confirm income posts incomeLines (deposit account up); (c) confirm transfer moves money A→B and needs no category; (d) transfer without to-account → `NO_TO_ACCOUNT`; (e) new source values accepted; (f) merged drafts hidden from `listDrafts`; (g) `keepPhoto` returns the image file name.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Existing `packages/db/test/drafts.test.ts` still passes (update only for the new return shape). Full db suite (both configs) + root typecheck.
- [ ] **Step 5:** Commit: "Drafts can be income or a transfer between your own accounts, and remember where they were captured from".

---

### Task 3: The matcher (db)

**Files:** Create `packages/db/src/capture/match.ts`; Test `packages/db/test/capture-match.test.ts`.

**Interfaces:**
- Consumes: Task 2 columns; `Reading` (Task 1).
- Produces:
```ts
export type MatchResult =
  | { kind: 'same-draft'; draftId: string }                 // merge into this pending draft
  | { kind: 'recorded'; transactionId: string; draftId: string | null } // same payment already recorded from a capture
  | { kind: 'transfer-pair'; draftId: string }              // opposite direction, other own account → becomes a transfer
  | { kind: 'hand-entered'; transactionId: string }         // offer Link / Keep separate, never auto-merge
  | { kind: 'none' };
export function findMatch(tx: Db, ws: WorkspaceContext, c: { amountMinor: number; currency: string; accountId: string | null; direction: 'out' | 'in'; at: string }): Promise<MatchResult>;
export function mergeInto(tx: Db, ws: WorkspaceContext, targetDraftId: string, incoming: NewDraft & { captureId: string }): Promise<void>; // fills missing fields, appends captureId, keeps first image unless target has none
export function makeTransferPair(tx: Db, ws: WorkspaceContext, existingDraftId: string, incoming: NewDraft & { captureId: string }): Promise<void>; // existing becomes kind transfer; from = the 'out' side's account, to = the 'in' side's
export function unmerge(database: Database, ws: WorkspaceContext, draftId: string): Promise<string>; // splits the last capture back into its own pending draft; returns its id
```
Windows (spec §3.5): same payment ≤ 15 minutes apart, same amount, same account or either null; transfer pair ≤ 24 hours, same amount/currency, opposite directions, both accounts known and different, both the owner's; recorded-from-capture: a confirmed draft within 15 minutes → `recorded`; hand-entered: a posted transaction with `source = 'manual'` same day, same amount and account → `hand-entered`.

- [ ] **Step 1:** Failing tests: notification + screenshot 3 minutes apart → same-draft; **same amount two hours apart stays two** (Review Focus 3); BCA out + GoPay in 40 minutes apart → transfer-pair (draft becomes transfer BCA→GoPay); already confirmed from a capture 5 minutes earlier → recorded; hand-entered same day → hand-entered (never merged); unmerge restores two drafts with their own capture ids; different currency never matches.
- [ ] **Step 2–4:** FAIL → implement → PASS (db suite both configs).
- [ ] **Step 5:** Commit: "A payment seen twice becomes one draft, a top-up seen from both sides becomes one transfer, and a merge can be undone".

---

### Task 4: Capture sources, learning and the ingest pipeline (db)

**Files:** Create `packages/db/src/capture/sources.ts`, `packages/db/src/capture/learn.ts`, `packages/db/src/capture/ingest.ts`, `packages/db/src/capture/skipped.ts`; Modify `packages/db/src/index.ts`; Test `packages/db/test/capture-sources.test.ts`, `packages/db/test/capture-ingest.test.ts`, `packages/db/test/capture-learn.test.ts`.

**Interfaces:**
- Consumes: Task 1 `readCapture`, `fingerprintOf`, `sameSource`, `WORDS`; Task 2 tables; Task 3 matcher.
- Produces:
```ts
export interface CaptureSource { id: string; keyKind: 'app' | 'fingerprint'; key: string; label: string; accountId: string | null; workspaceId: string | null; template: Template | null; capturedCount: number }
export function sourceFor(tx: Db, capture: RawCapture): Promise<CaptureSource>;            // finds by app, or by fingerprint (sameSource), else creates (label = app name, or first top line)
export function setSourceAccount(database: Database, sourceId: string, accountId: string, workspaceId: string): Promise<void>;
export function listSources(database: Database): Promise<CaptureSource[]>;
export function resetSourceTemplate(database: Database, sourceId: string): Promise<void>;
export function deleteSource(database: Database, sourceId: string): Promise<void>;
export function learnFromCorrection(database: Database, draftId: string, field: 'amount' | 'name' | 'date', value: string): Promise<boolean>; // finds the line in the draft's reading/capture that contains value; writes the anchor {label: text of the same line before the value or the previous line, region: that line's box}; true if learned
export function ingestCaptures(database: Database, ws: WorkspaceContext, captures: RawCapture[], opts: { today: string }): Promise<{ drafts: number; merged: number; skipped: number }>; // in capturedAt order; each: source → read (with template) → skip (promo | expenses-only → capture_skipped) → matcher → merge/pair/new draft (source 'notification'|'screen'|'photo'; kind from type: spent→expense, received→income, topup→transfer w/ to=source account; refund→income)
export function getCaptureScope(database: Database): Promise<'everything' | 'expenses-only'>;
export function setCaptureScope(database: Database, scope: 'everything' | 'expenses-only'): Promise<void>;
export function listSkipped(database: Database, ws: WorkspaceContext, today: string): Promise<SkippedRow[]>; // last 7 days
export function bringBack(database: Database, ws: WorkspaceContext, skippedId: string): Promise<string>; // makes the draft, ignoring promo/scope
export function purgeCaptures(database: Database, today: string): Promise<{ skipped: number; images: string[] }>; // deletes skipped > 7 days; returns image files of resolved drafts to delete (web deletes the bytes)
```
Rules: draft `workspace_id` = the source's workspace when set and it still exists, else the current `ws`. A source whose account is archived/deleted → treated as unset (draft asks again) — **Review Focus 4**. Currency null → the source account's currency, else `ws.baseCurrency`. Amount sign: spent → positive, received/refund → negative with `accountId` = source account (import convention), topup → kind transfer with `toAccountId` = source account and `accountId` null (asks "From which account?"). `confidence` = the amount field's confidence. `description` = name, else the notification title, else "Captured payment". `externalRef` = `capture:<capture.id>` (so re-draining the same file never duplicates).

- [ ] **Step 1:** Failing tests: source by app; source by fingerprint across two screenshots; **learned account archived → asks again**; first capture of a new source has `accountId` null; after `setSourceAccount` the next capture fills it; promo → skipped row, not a draft; expenses-only skips a received capture; bring back makes the draft; **drains a backlog of 20 in capture order** with merges across the batch and correct pending count; re-ingesting the same capture id is a no-op; learnFromCorrection then the next capture of that source reads the corrected field with confidence 95; purge deletes skipped older than 7 days.
- [ ] **Step 2–4:** FAIL → implement → PASS (db both configs; capture harness: these tables are local-only — confirm the capture harness ignores them since they are not synced).
- [ ] **Step 5:** Commit: "Captures become drafts on the right account, learn each source's layout from your corrections, and skip promos you can bring back".

---

### Task 5: The Review page for captures (web)

**Files:** Modify `apps/web/src/features/review/ReviewPage.tsx`, `apps/web/src/features/review/DraftSheet.tsx`, `apps/web/src/features/review/queries.ts`; Create `apps/web/src/features/review/capture-view.ts` (+ `capture-view.test.ts`), `apps/web/src/features/review/CaptureViewer.tsx`, `apps/web/src/features/review/SkippedList.tsx`; `apps/web/src/capture/drain.ts` (+ test) — calls `native.drainCaptures()` (Task 6) then `ingestCaptures`, on app start and on `appStateChange` active.

**Interfaces:** Consumes Task 2 (`confirmDraft` new return, `editDraft` patch), Task 3 (`unmerge`), Task 4 (`setSourceAccount`, `learnFromCorrection`, `listSkipped`, `bringBack`, `purgeCaptures`), Task 6 (`native` bridge, `readCaptureImage(file) → Blob`). Produces the pure view-model `capture-view.ts`: `captureRowView(draft, source) → { icon: '🔔'|'📱'|'🧾'|null; subtitle: string; needs: ('account'|'to-account'|'amount')[]; merged: string | null }`, `fieldBoxes(reading) → { field, box, label }[]`.

UI (spec §3.6, mockups ①②③⑤): source icon + "merged" subtitle on rows; swipe right adds, left discards (as today); a row with `needs` opens the sheet; the sheet shows the picture (tap → `CaptureViewer` full screen, pinch zoom, a labelled box per read field, tapping a field on the sheet opens the viewer at that box; a notification shows its original title and text), "Which account is this?" chips for a source without an account (calls `setSourceAccount` and fills the draft), a To-account row for transfers, yellow for fields with confidence < 70, "Keep photo" (default on for `photo`, off for `screen`), "Seen in …" with Unmerge, "Looks like one you added" with Link / Keep separate for `hand-entered`; editing amount/name/date calls `learnFromCorrection`. On Add with `keptImage`: copy bytes into OPFS photos (`apps/web/src/photos/store.ts`) and `addPhoto`. After add/discard, delete the capture image bytes (purge). `SkippedList` at the foot: "Skipped (N)" → rows with Bring back.

- [ ] **Step 1:** Failing view-model tests (`capture-view.test.ts`): icons per source; needs for a new source; merged subtitle; field boxes from a reading.
- [ ] **Step 2–4:** FAIL → implement view-model and components → PASS; web suite + typecheck.
- [ ] **Step 5:** Commit: "The review inbox shows where each capture came from, asks which account a new source is, and lets you see exactly what was read".

---

### Task 6: Native plugin — text recognition, camera, holding area, JS bridge

**Files:**
- Create: `apps/web/ios/App/App/Capture/CapturePlugin.swift`, `apps/web/ios/App/App/Capture/TextRecognizer.swift`, `apps/web/ios/App/App/Capture/HoldingArea.swift`, `apps/web/ios/App/App/App.entitlements` (App Group `group.com.cicis.app`)
- Modify: `apps/web/ios/App/App.xcodeproj/project.pbxproj` (add files, entitlements, App Groups capability), `apps/web/ios/App/App/Info.plist` (`NSCameraUsageDescription` if not present — it is for receipts), register the plugin (Capacitor 8 local plugin: a `CAPBridgedPlugin` class registered via a `CAPBridgeViewController` subclass `MainViewController` overriding `capacitorDidLoad` → `bridge?.registerPluginInstance(CapturePlugin())`, set as the storyboard's view controller)
- Create: `apps/web/src/capture/native.ts` (`registerPlugin<CapturePluginApi>('Capture')` with a web fallback that returns `[]`/throws "Not available here"), `apps/web/src/capture/native.test.ts` (fallback behaviour)

**Interfaces (Produces):**
```ts
export interface CapturePluginApi {
  drainCaptures(): Promise<{ captures: RawCapture[] }>;                 // reads + removes JSON files from the App Group 'captures/' folder; images moved into the app's private 'captures/' folder; unparsable files moved to 'captures/broken/' and reported
  scanReceipt(): Promise<{ capture: RawCapture | null }>;               // camera → Vision → capture (kind 'photo'); null if cancelled
  readCaptureImage(opts: { file: string }): Promise<{ base64: string; mime: string }>;
  deleteCaptureImage(opts: { file: string }): Promise<void>;
  holdingAreaStatus(): Promise<{ pending: number; broken: number }>;
}
```
Swift: `TextRecognizer.recognize(image: CGImage) async throws -> [CaptureLine]` using `VNRecognizeTextRequest` (`.accurate`, `recognitionLanguages = ["id-ID","en-US"]`, `usesLanguageCorrection = false`), box converted to top-left origin 0–1, `height` = box height. `HoldingArea.write(capture:imageData:)` writes `captures/<id>.json` (+ `<id>.jpg`) atomically in the App Group container (used by Task 7's intents and extension).

- [ ] **Step 1:** Write `native.test.ts` (web fallback) → FAIL → implement `native.ts` → PASS.
- [ ] **Step 2:** Swift files; add to the Xcode project; entitlements with the App Group.
- [ ] **Step 3:** Build for the simulator: `cd apps/web && npm run build && npx cap sync ios && xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build -quiet` → BUILD SUCCEEDED.
- [ ] **Step 4:** A tiny Swift test of `TextRecognizer` on a bundled sample PNG (made-up receipt with "TOTAL 126.500") if the project can host a test target cheaply; otherwise record a device-checklist item instead (rule it in the report).
- [ ] **Step 5:** Commit: "The iPhone app can read the text of a receipt photo on the phone and hand captures to the app".

---

### Task 7: App Intents, share extension, the Screen scanner shortcut

**Files:** Create `apps/web/ios/App/App/Capture/LogNotificationIntent.swift`, `ScanScreenIntent.swift`, `CaptureShortcuts.swift` (`AppShortcutsProvider` so the actions appear in Shortcuts), a Share Extension target `apps/web/ios/App/CaptureShare/` (`ShareViewController.swift`, `Info.plist`, `CaptureShare.entitlements` with the same App Group), Modify `project.pbxproj`. (A `.shortcut` file cannot be produced in the repo — Shortcuts signs shared shortcuts through iCloud. The owner builds the Screen scanner shortcut once on the device, shares its iCloud link, and Task 8's guide opens that link; until then the guide lists the two steps to build it by hand: Take Screenshot → Scan screen.)

**Interfaces:** Consumes Task 6 `HoldingArea`, `TextRecognizer`. `LogNotificationIntent(title: String?, body: String?, app: String?, date: Date?)` → writes a `notification` capture, `openAppWhenRun = false`, returns a short dialog "Saved to review". `ScanScreenIntent(image: IntentFile)` → recognizes text in the extension-free intent process, writes a `screen` capture with the image. Share extension: one image → `shared-image` capture → "Saved to review".

- [ ] **Step 1:** Implement; build for simulator (both targets) → BUILD SUCCEEDED.
- [ ] **Step 2:** Device checklist file `docs/superpowers/plans/2026-09-30-transaction-capture-device-checklist.md`: add the notification automation for a chosen app and trigger it; build the Screen scanner shortcut (Take Screenshot → Scan screen) and bind Back Tap; share a screenshot; take a receipt photo; open the app → drafts appear; the owner's iCloud link for the shortcut recorded for Task 8.
- [ ] **Step 3:** Commit: "Shortcuts can send a notification or a screenshot to the app, and the share sheet can send an image, all while the app stays closed".

---

### Task 8: Settings → Capture (web)

**Files:** Create `apps/web/src/features/capture/CaptureSettingsPage.tsx`, `apps/web/src/features/capture/SourcePage.tsx`, `apps/web/src/features/capture/guides.ts` (+ `guides.test.ts`); Modify `apps/web/src/features/workspaces/SettingsPage.tsx` (a Capture row, iPhone only via `isNative()`), `apps/web/src/app/router.tsx` (routes `/settings/capture`, `/settings/capture/sources/$sourceId`), and add a "Scan a receipt" entry where the add-transaction entry points live (calls `native.scanReceipt()` then `ingestCaptures`).

UI (mockup ④): guide rows Notifications / Screen scanner / Scan a receipt, each opening a step list (`guides.ts` holds the steps as data; Notifications: open Shortcuts → Automation → New → "When I receive a notification" → choose apps → action "Log notification" → map Title/Body/App/Date; Screen scanner: open the shortcut link → Add → Settings › Accessibility › Touch › Back Tap, or Action Button → Shortcut; "Open Shortcuts" uses `shortcuts://`); the Everything / Expenses only segmented control (`setCaptureScope`); Capture sources list (label, account, learned/learning) → SourcePage (change account, Reset layout, Delete).

- [ ] **Step 1:** Failing `guides.test.ts` (steps per guide, no bank names in copy) → implement → PASS.
- [ ] **Step 2:** Pages + routes; web suite + typecheck.
- [ ] **Step 3:** Commit: "Settings shows how to set up capture, chooses what to capture, and lists what each source has learned".

---

### Task 9: End to end and the final pass

**Files:** Create `apps/web/e2e/capture.spec.ts`; Create `apps/web/src/capture/test-hook.ts` (only in e2e builds: `import.meta.env.VITE_E2E === '1'` exposes `window.__captureInject(captures: RawCapture[])` which calls `ingestCaptures`); Modify `apps/web/playwright.config.ts` env to set `VITE_E2E=1` for the e2e build only.

- [ ] **Step 1:** E2E (chromium + phone): inject a GoPay-like notification → draft with 🔔, asks account → pick → add → transaction exists; inject a screenshot line set for the same payment 2 minutes later → merged (no second draft); inject BCA-out + GoPay-in → one transfer draft → add → both accounts move; inject a promo → Skipped (1) → Bring back; correct the merchant on a screenshot draft → next screenshot from that source reads it; viewer opens with boxes.
- [ ] **Step 2:** Root `npm run typecheck`, `npm test`, `npm run e2e -- capture.spec.ts` (and `sharing.spec.ts` to guard the Review page change) green.
- [ ] **Step 3:** Commit: "Captures travel from a notification or screenshot to a recorded transaction end to end".

---

## Code map

- Drafts: `packages/db/src/repos/drafts.ts` (`createDraft` L84, `captureDrafts` L116, `listDrafts` L165, `countPendingDrafts` L174, `editDraft` L183, `confirmDraft` L201 — expense/income two lines only, `dismissDraft` L240, `reopenDraft` L255, `purgeExpiredPayloads` L275, `RAW_RETENTION_DAYS` 90); schema `packages/db/src/schema-drafts.ts` (migration 0030, `card_id` 0037); `TransactionSource` `packages/db/src/repos/ledger.ts:36`.
- Line builders: `packages/core/src/ledger/lines.ts` (`expenseLines`, `incomeLines`, `transferLines`); post via `postTransaction`/`postTransactionTx` (`repos/ledger.ts`).
- Review UI: `apps/web/src/features/review/ReviewPage.tsx` (RecordTable, swipe, `swipeRecord`, `record`, `undo`), `DraftSheet.tsx`, `queries.ts` (`useDrafts`, `usePendingDraftCount`).
- Photos: `transaction_photos` (`schema-extras.ts:18`, `transactionId` NOT NULL), OPFS `apps/web/src/photos/store.ts`, attach `repos/transaction-extras.ts` `addPhoto`.
- Keywords: `packages/core/src/text/keywords.ts` `containsKeyword`; merchant memory `resolveMcc` (`core/src/mcc/resolve.ts:46`), `repos/mcc.ts`.
- iOS: SPM (`ios/App/CapApp-SPM/Package.swift`), stock `AppDelegate.swift`/`SceneDelegate.swift`, no entitlements yet, bundle `com.cicis.app`, team `JPMPS53HUZ`; `isNative()` `apps/web/src/lib/pwa.ts:4`; no local plugin yet.
- Settings: `apps/web/src/features/workspaces/SettingsPage.tsx` (`SettingsPage` L208), router `apps/web/src/app/router.tsx` (pattern `/settings/developer` L294).
- Tests: web vitest node env (`apps/web/vitest.config.ts`), Playwright `apps/web/playwright.config.ts` (chromium + phone; WebKit skipped — no OPFS); no test hook exists.
- Migrations: latest `0061_world_gold_price.sql`, `packages/db/src/migrations.ts:61,130`.
