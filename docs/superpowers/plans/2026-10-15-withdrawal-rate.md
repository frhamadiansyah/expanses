# Withdrawal Rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Foreign money in the owner's own cash and bank accounts is spent, moved and changed back at what it cost (first in, first out), the past is recalculated, a realised exchange gain or loss is booked, and the screens say so — while net worth, Coretax and card statements keep reading what they read today.

**Architecture:** Two pure functions in `packages/core/src/fx/` do all the arithmetic: `fifoCosts` walks one account's movements and prices every outflow from its oldest lots, and `revalueTransaction` turns one outflow's cost into new base figures for every line of its transaction (spread over the spending lines, carried into another foreign account, or set against what was received with a gain or loss line). `packages/db/src/repos/fx-costs.ts` reads an account, runs both, and rewrites `entries.amount_base_minor` / `fx_rate_to_base` **in place** behind a new capture door, keeping five local cache tables (migration 0071). Every ledger door marks the foreign accounts it touched; the recalculation runs once per account at the end of the db transaction (a capture flush step), or — inside sync apply, where capture is paused — is queued and run after the sync with capture on, so a partner receives the new figures as an ordinary edit.

**Tech Stack:** TypeScript, SQLite via drizzle-orm `sql`, vitest + fast-check, React 19 + TanStack Query/Router, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-withdrawal-rate-design.md` (binding; read it in full before any task). Background: `docs/superpowers/specs/2026-09-26-household-sharing-design.md` (§6.3 capture, §6.4 harness, §7.4 carried base figures) and `docs/superpowers/specs/2026-10-15-shared-events-design.md` (§5.1 derived transactions belong to no workspace).

## Global Constraints

- "Copy never says "you"/"your"." Every string a screen shows and every error a repository throws. Copy uses the app's typographic apostrophe (`’`), as `MovePage` and every other screen already do.
- No bank names and no country names in code, tests or fixtures; every figure, rate, date and name in a fixture is invented (owner's standing rule: change amounts, rates, dates and places). Currency codes (TRY, EUR, IDR, USD, SGD) are codes and are allowed.
- Features stay country-neutral (only `tax-inputs.ts` speaks Coretax).
- "Net worth still values what is held at the day's market rate." (D6) "Card statements, points (computed on charged amounts), Coretax year-end valuation (year-end rates), net worth (market rate), every report's reading of stored base values" do not change (§8). No reader is edited to make that true: they already read native amounts or stored base values.
- `entries.amount_base_minor` keeps meaning **the owner's base currency** (`ws.baseCurrency`), as `book-currency.ts` documents.
- Money is integer minor units. A product that can pass 2^53 (cost × part) is taken through `BigInt` (`shareOf`, `spreadBase`).
- "only the device that owns the account recalculates; a partner's phone receives the new values as an ordinary edit and never recalculates someone else's account (placeholder accounts are skipped)."
- The cache tables `fx_lot_uses`, `fx_shortfalls` (and this plan's `fx_day_values`, `fx_gain_loss`, `fx_recalc_pending`) are local and are **never synced**: none is added to `SHARED_ENTITIES`.
- Migration number: **0071** (0070 is taken by another branch; ruling R1).
- Long why-comments in the repo's voice on every non-obvious rule; names follow the surrounding file.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Rulings on spec gaps (binding for every task)

Each is cited by number in the tasks that implement it.

- **R1 Migration 0071 and five local tables.** `0071_withdrawal_rate.sql` (0070 belongs to another branch; the runner applies whatever is pending in version order, so a later 0070 still runs). Tables: `fx_lot_uses (account_id, out_entry_id, lot_entry_id, minor, cost_base_minor)`, `fx_shortfalls (account_id, entry_id, uncovered_minor)` — the spec's two — plus `fx_day_values (entry_id, base_minor, rate)` (R4), `fx_gain_loss (transaction_id, category_entry_id, exchange_entry_id)` (R8) and `fx_recalc_pending (account_id, from_date)` (R9, R18). The migration seeds `fx_recalc_pending` with every foreign money account that holds entries (from its first entry, `from_date` NULL) and writes `settings('fx.withdrawal_rate_notice','due')` when it seeded any. Readers ask `fxTablesExist(db)` first (the cached exists-check pattern of `dayOrderExists`): a database stopped before 0071 behaves exactly as today.
- **R2 Which accounts hold lots.** `isFxLotAccount`: `kind = 'asset'`, subtype one of `CASH_ITEMS` (`cash, bank, savings, time_deposit, ewallet, fund, other_cash`), currency set and not the owner's base, and **not** a household placeholder (`book_member_accounts`). Liabilities never (§9: "a card in USD keeps the day's rate on its own side"); receivables, payables, event balances and holdings are never lot accounts — they are lines money is spent *on*.
- **R3 Order within a day.** "within a day, inflows before outflows; then `day_order`, then creation order" is read in the direction the list is read in time: the list shows a day newest-first (`compareWithinDay`), so the earlier of two rows is the one shown **lower**. `chronological(a, b)` = date, then inflows first, then `compareWithinDay(b, a)`, then entry id. The property "order of entry on the same day does not change the result" is pinned as two properties: the result never depends on the order the movements are handed in, and a day's total cost and the lots left after it never depend on the order of that day's outflows.
- **R4 "The day's rate" for what no lot covers** is the value the ledger first posted that line at (its own day-rate valuation), kept in `fx_day_values` the first time a recalculation overwrites it. So an account with no withdrawal recorded keeps every figure it has today, to the unit (planPosting's rounding included), and nothing needs a rate lookup. A line first posted by sync apply carries the payer's figure; that is its posted value.
- **R5 "In proportion to their amounts"** means in proportion to the lines' stored base values (their day-rate figures), because lines of a shared-event expense can be in two currencies; amounts are the fallback when those sum to zero. "the rounding remainder on the largest": the whole remainder goes to the line with the largest weight (first on a tie).
- **R6 Exchange out of a foreign account into another currency between the owner's own accounts** (the received side holds a money account or another lot account, in any currency): the foreign line takes −cost, every received line keeps its own value, and the difference is the gain or loss line — §4's row, §7's screen and D4 all say so. §3's row "Exchange from another foreign account → the cost of the foreign money that left it" contradicts them for foreign→foreign; it is ruled to mean that the source's cost reaches the books through the gain or loss line, and the received lot's cost is the received side's own (day-rate) value. Same-currency moves between foreign accounts carry the lots with their costs and **dates** (§3), lot by lot (`parts`), and chain into the receiving account.
- **R7 Spending across currencies is spending.** When every received line is a spending line (category, receivable, payable, event balance, holding — a shared-event expense charged in another currency, a settle-up), the cost is spread over the received lines that are not in the base currency (base-currency lines keep their own figure), the exchange lines are rebalanced per currency, and no gain or loss is booked. When such a transaction's received lines are all in the base currency, the difference is a gain or loss line that is **not** filed in any workspace if the transaction is a shared event's derived one or a partner-transfer posting (shared events §5.1, joint net worth §7.2 stay true).
- **R8 The gain or loss pair.** One category line in the owner's base currency (amount `−G`; Exchange gain when `G > 0`, Exchange loss when `G < 0`) and one `currency_exchange` line `+G`, recorded in `fx_gain_loss`. The two categories are built-in keys `income.exchange_gain` "Exchange gain" and `expense.exchange_loss` "Exchange loss", made in the Personal book on first use by the existing ensure-by-key path (`ensureCategoryByKeyTx`, as Fees & charges is) — not added to `DEFAULT_CATEGORIES`, so a workspace that never holds foreign money never shows them — and given icons and a colour in `visuals.ts`. A transfer that had no book is filed into Personal (`personalBookIdTx`) while it has the pair, and unfiled when the pair goes. `classify` reads a transaction whose only category lines are the pair as a **transfer**, so its row, receipt and edit form stay a transfer; the edit form posts no pair and the recalculation adds it back.
- **R9 When the recalculation runs.** Every ledger door marks the lot accounts it touched (`markForeignDirtyTx`); one flush step per db transaction recalculates each marked account once, from its earliest marked date, before capture resolves lineages — "inside the same db transaction" for every local write. Inside sync apply capture is paused, so the step queues the accounts in `fx_recalc_pending` instead, and `SyncEngine.syncOnce` drains the queue right after the sync with capture on; the owning device's new figures then go out as an ordinary purchase edit. (A paused write that recalculated in place would never be sent, and the partner would keep the old figure.)
- **R10 Replay and the chain.** An account is replayed from its first entry (one indexed read; the lot state at `fromDate` needs the whole history anyway). `fromDate` is what the doors and the chain pass; FIFO is causal, so nothing dated before it changes — a test pins that. A same-currency move into another lot account whose base figure or carried lots changed queues that account from the move's date; the chain stops when a pass changes nothing, and after `MAX_CHAIN = 64` passes the rest goes to `fx_recalc_pending` rather than looping.
- **R11 Inflows.** Money arriving in a lot account through an exchange whose source lines are all base-currency money accounts costs the base amount that left (§3 row 1), written on the lot line and its exchange line. A same-currency move from another lot account costs what that account's recalculation wrote (carried, R6). Everything else — income, refund, upward correction, opening balance, a settle-up received, an exchange from another foreign account (R6) — costs its stored day-rate figure.
- **R12 A workspace in another currency.** Stored figures stay in the owner's base; a converting workspace keeps converting each entry's own amount at the day's rate for display (`bookMoneyFor`, unchanged), so the withdrawal rate shows in owner-currency views. Flagged for the owner.
- **R13 In-place doors.** `day_order` changes the order of a day, so `moveTransactionInDay` and apply's in-place `dayOrder` write mark their transaction; `exact_hundredths` changes no line, so its doors do not.
- **R14 A holding bought from a foreign money account** is a same-currency move (§4: "−cost here, +cost there"): the holding line takes the FIFO cost, so `baseCosts` — and the Coretax acquisition cost read from it — follows the withdrawal rate; year-end values do not change. Flagged for the owner.
- **R15 Screens.** The Rate row ("Rp 525 per TRY (market 512, +2,5 %)") is drawn when one side of a cross-currency transfer is the base currency; foreign↔foreign keeps "1 USD = 1,2760 SGD". Out of a lot account into another currency the Move screen and the Transfer tab show Cost and the exchange result ("Exchange loss Rp 12.500 (recorded as spending)"); the Move screen's old spread group is replaced (its `testId="spread"` row now holds the exchange result, so existing journeys still find it) and its "Recorded" step compares the recorded gain or loss with the one shown. `spreadLine` is deleted.
- **R16 Household.** Placeholders are never lot accounts (R2). The revaluation capture door never refuses a read-only book (a revaluation is this device's own bookkeeping) and sends nothing for one.
- **R17 `fifoCosts(movements, opening)`.** `opening` is the lots open at the start; the db replays from the first entry and passes none. Kept for the spec's signature and pinned in core.
- **R18 First run.** Drained by the app after it has painted, one account per db transaction with a turn for the app between accounts (`recalcInBatches`); `openAppDb` never drains. The notice shows once the queue is empty, only when the migration found a foreign account, and is dismissed for good: "Foreign-currency spending now uses the withdrawal rate. Past months may change slightly."
- **R19 Saving still needs the day's rate.** A foreign spend is first posted at the day's rate exactly as today (`ratesForSave` unchanged); that figure is its day value (R4), then the recalculation replaces it.
- **R20 Previews.** The Add-screen line is drawn for Expense mode paid with a lot account; an edit previews without the transaction being edited (`excludeTransactionId`); the part no lot covers is valued at the rate the device holds for the day, and with none held the line names only the uncovered foreign amount.

## Review Focus

The spec's §10, each pinned by a test in the task that owns the code:

1. A back-dated withdrawal not recalculating spending after it because one write path misses the trigger (post, the edit route's replace, void, a drag within the day, sync apply, a shared event's derivation): every later outflow must move. Tests: Task 7 (`withdrawal-rate-triggers.test.ts`, one per door, and the paused path draining), Task 9 (`sync/withdrawal-rate.test.ts`: a back-dated withdrawal on the payer's phone reaches the partner; a partner's edit comes back costed).
2. A same-currency move between two foreign accounts looping, or counting a lot's cost twice: the chain must end and total cost in must equal cost out plus cost left. Tests: Task 1 (property: conservation, no lot over-used), Task 6 (same-day round trip ends and the two spends add up to the one withdrawal; carried lots keep their dates; `MAX_CHAIN` overflow goes to the queue).
3. A partner's phone recalculating an account it only holds as a placeholder: it must take the payer's figure and write no cache row. Tests: Task 6 (a placeholder is never a lot account), Task 9 (the partner's caches stay empty and its placeholder line is the payer's figure).
4. Rounding: the cost split over a split's category lines not summing to the money line's cost. Tests: Task 2 (property: spending lines add up to the cost exactly, every currency balances in base), Task 6 (a three-way split in the database, remainder on the largest).
5. The first-run recalculation on a long history blocking app start: it must run in batches with the app usable. Tests: Task 7 (`recalcPendingForeign` with `limit`), Task 13 (`openAppDb` leaves the queue alone; `recalcInBatches` gives the app a turn between accounts).

## Waves

Tasks in one wave touch disjoint files and can run in parallel; a wave starts when the previous one is merged.

| Wave | Tasks | Needs |
|---|---|---|
| 1 | Task 1 (core `fifoCosts`, keys), Task 3 (migration 0071, `fx-tables.ts`), Task 4 (capture steps and the revaluation door) | — |
| 2 | Task 2 (core `revalueTransaction`, visuals), Task 5 (gain or loss pair) | Task 1 (both); Tasks 3, 4 (Task 5) |
| 3 | Task 6 (db recalculation `fx-costs.ts`) | Tasks 1–5 |
| 4 | Task 7 (triggers, queue and drain), Task 8 (readers for the screens) | Task 6 |
| 5 | Task 9 (sync drain, household), Task 10 (web texts, hooks, classify, transfer preview) | Task 7 (9); Task 8 (10) |
| 6 | Task 11 (Add screen, Transfer tab, receipt), Task 12 (Move page, account page), Task 13 (first-run runner and notice) | Task 10 (11, 12); Task 9 (13) |
| 7 | Task 14 (end to end) | all |

Disjointness, checked task by task: `packages/core/src/index.ts` is Task 1's in wave 1 and Task 2's in wave 2 (Task 5 does not touch core). `packages/db/src/index.ts` is Task 6's in wave 3, Task 8's in wave 4 (Task 7 does not touch it) and Task 9's in wave 5. `ledger.ts` and `apply.ts` are Task 7's only; `capture.ts` is Task 4's only; `engine.ts` is Task 9's only. In wave 6, `TransactionCard.tsx`, `ReceiptPage.tsx` and `receipt-view.ts` are Task 11's; `MovePage.tsx`, `AccountPage.tsx`, `pockets.ts` and the two currency-pocket journeys are Task 12's; `Layout.tsx` is Task 13's.

Commands used throughout (run from the worktree root unless a `cd` is shown):
- `cd packages/core && npx vitest run <file>`; `npm run test -w @expanses/core`
- `cd packages/db && npx vitest run <file>`; `npm run test -w @expanses/db` (default and capture runs); `npm run test:capture`
- `cd apps/web && npx vitest run <file>`; `npm run test -w @expanses/web`
- `cd apps/web && npx playwright test <spec> --project=chromium`
- `npm run typecheck`

## File map

| File | Responsibility | Task |
|---|---|---|
| `packages/core/src/fx/keys.ts` | lot-account test, the two category keys and names | 1 |
| `packages/core/src/fx/fifo.ts` | `fifoCosts`, `chronological`, `shareOf`, `FxError` | 1 |
| `packages/core/src/fx/revalue.ts` | `revalueTransaction`, `classifyInflow`, `spreadBase` | 2 |
| `packages/core/src/categories/visuals.ts` | icons and colour for the two keys | 2 |
| `packages/db/migrations/0071_withdrawal_rate.sql` | five local tables, the first-run queue and notice | 3 |
| `packages/db/src/repos/fx-tables.ts` | `fxTablesExist`, `queueForeignRecalcTx`, the notice key | 3 |
| `packages/db/src/sync/capture.ts` | flush steps, per-transaction values, paused check, revaluation door | 4 |
| `packages/db/src/repos/fx-gain-loss.ts` | the gain or loss pair, its categories, filing | 5 |
| `packages/db/src/repos/fx-costs.ts` | read an account, replay, write in place, caches, chain | 6 |
| `packages/db/src/repos/fx-pending.ts` | mark at the doors, flush step, queue, drain, notice | 7 |
| `packages/db/src/repos/ledger.ts`, `packages/db/src/sync/apply.ts` | the doors call `markForeignDirtyTx` | 7 |
| `packages/db/src/repos/fx-reads.ts` | preview, open lots, withdrawals used, exchange result | 8 |
| `packages/db/src/sync/engine.ts` | drain after each sync | 9 |
| `apps/web/src/lib/withdrawal-rate.ts`, `apps/web/src/lib/withdrawal-queries.ts` | the screens' words and queries | 10 |
| `apps/web/src/features/transactions/transfer-preview.ts`, `classify.ts` | Rate/Cost/result for a transfer; the pair reads as a transfer | 10 |
| `apps/web/src/features/transactions/WithdrawalLine.tsx`, `TransferRates.tsx`, `TransactionCard.tsx`, `receipt-view.ts`, `ReceiptPage.tsx` | Add screen, Transfer tab, receipt | 11 |
| `apps/web/src/features/accounts/MovePage.tsx`, `AccountPage.tsx`, `WithdrawalsLeft.tsx`, `pockets.ts` | Move page, foreign account page | 12 |
| `apps/web/src/features/accounts/withdrawal-rate-start.ts`, `WithdrawalRateNotice.tsx`, `apps/web/src/app/Layout.tsx` | first run and its notice | 13 |
| `apps/web/e2e/withdrawal-rate.spec.ts` | the journey | 14 |

---
### Task 1: Core — `fifoCosts`, the order of a day, and which accounts hold lots

Spec §3, §4 ("Order", "Not enough lots"), §6's first bullet and its three properties; rulings R2, R3, R4, R17. Pure functions only.

**Files:**
- Create: `packages/core/src/fx/keys.ts`
- Create: `packages/core/src/fx/fifo.ts`
- Modify: `packages/core/src/index.ts` (append one export block at the end)
- Test: `packages/core/test/fx-fifo.test.ts`
- Test: `packages/core/test/fx-fifo.property.test.ts`

**Interfaces:**
- Consumes: `CASH_ITEMS` from `packages/core/src/assets/catalogue.ts`; `compareWithinDay` from `packages/core/src/ledger/day-order.ts`.
- Produces (all exported from `@expanses/core`):
  - `EXCHANGE_GAIN_KEY = 'income.exchange_gain'`, `EXCHANGE_LOSS_KEY = 'expense.exchange_loss'`, `EXCHANGE_GAIN_NAME = 'Exchange gain'`, `EXCHANGE_LOSS_NAME = 'Exchange loss'`
  - `FX_LOT_SUBTYPES: readonly string[]`
  - `isFxLotAccount(account: { kind: string; subtype: string; currency: string | null }, baseCurrency: string): boolean` (placeholders are the db's to leave out, R2)
  - `isExchangeResultKey(key: string | null | undefined): boolean`
  - `class FxError extends Error`
  - `interface FxLotPart { lotId: string; lotDate: string; minor: number; costBaseMinor: number }`
  - `interface FxInflow { kind: 'in'; entryId: string; occurredOn: string; dayOrder: number | null; createdAt: string; minor: number; costBaseMinor: number; parts?: readonly FxLotPart[] }`
  - `interface FxOutflow { kind: 'out'; entryId: string; occurredOn: string; dayOrder: number | null; createdAt: string; minor: number; dayValueBaseMinor: number }`
  - `type FxMovement = FxInflow | FxOutflow`
  - `interface FxLotUse { lotId: string; minor: number; costBaseMinor: number }`
  - `interface FxOutCost { entryId: string; costBaseMinor: number; uses: FxLotUse[]; uncoveredMinor: number; uncoveredBaseMinor: number }`
  - `interface FxOpenLot { lotId: string; lotDate: string; minor: number; costBaseMinor: number; leftMinor: number; leftCostBaseMinor: number }`
  - `interface FxShortfall { entryId: string; uncoveredMinor: number }`
  - `interface FifoResult { outs: FxOutCost[]; open: FxOpenLot[]; shortfalls: FxShortfall[] }`
  - `shareOf(total: number, part: number, whole: number): number`
  - `chronological(a: FxMovement, b: FxMovement): number`
  - `fifoCosts(movements: readonly FxMovement[], opening?: readonly FxLotPart[]): FifoResult`

- [ ] **Step 1: Write the failing example tests**

`packages/core/test/fx-fifo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  chronological,
  EXCHANGE_GAIN_KEY,
  EXCHANGE_LOSS_KEY,
  fifoCosts,
  FxError,
  type FxMovement,
  isExchangeResultKey,
  isFxLotAccount,
  shareOf,
} from '../src/index';

/*
 * Withdrawal rate §3–§4. A lira pocket (TRY, in kuruş) in a rupiah book (IDR has no minor unit here). Every figure is
 * invented: withdrawals at 525 and 540 rupiah per lira against a market rate of 512.
 */

const at = (occurredOn: string, minute = 0) => `${occurredOn}T08:${String(minute).padStart(2, '0')}:00.000Z`;
const inflow = (entryId: string, occurredOn: string, minor: number, costBaseMinor: number, over: Partial<Extract<FxMovement, { kind: 'in' }>> = {}): FxMovement => ({
  kind: 'in',
  entryId,
  occurredOn,
  dayOrder: null,
  createdAt: at(occurredOn),
  minor,
  costBaseMinor,
  ...over,
});
const outflow = (entryId: string, occurredOn: string, minor: number, dayValueBaseMinor: number, over: Partial<Extract<FxMovement, { kind: 'out' }>> = {}): FxMovement => ({
  kind: 'out',
  entryId,
  occurredOn,
  dayOrder: null,
  createdAt: at(occurredOn, 30),
  minor,
  dayValueBaseMinor,
  ...over,
});

describe('fifoCosts', () => {
  it('spends the oldest withdrawal first, at what it cost', () => {
    // ₺1.000 at 525 on 2 Nov, ₺1.000 at 540 on 9 Nov; ₺1.500 spent on 12 Nov (posted at the day's 512: Rp 768.000).
    const result = fifoCosts([inflow('w1', '2026-11-02', 100_000, 525_000), inflow('w2', '2026-11-09', 100_000, 540_000), outflow('s1', '2026-11-12', 150_000, 768_000)]);
    expect(result.outs).toEqual([
      {
        entryId: 's1',
        costBaseMinor: 795_000,
        uses: [
          { lotId: 'w1', minor: 100_000, costBaseMinor: 525_000 },
          { lotId: 'w2', minor: 50_000, costBaseMinor: 270_000 },
        ],
        uncoveredMinor: 0,
        uncoveredBaseMinor: 0,
      },
    ]);
    expect(result.open).toEqual([{ lotId: 'w2', lotDate: '2026-11-09', minor: 100_000, costBaseMinor: 540_000, leftMinor: 50_000, leftCostBaseMinor: 270_000 }]);
    expect(result.shortfalls).toEqual([]);
  });

  it('values what no withdrawal covers at the figure it was posted at, and says so (R4)', () => {
    // ₺200 withdrawn at 525; ₺500 spent, posted at Rp 256.000. ₺300 is uncovered: 3/5 of 256.000.
    const result = fifoCosts([inflow('w1', '2026-11-02', 20_000, 105_000), outflow('s1', '2026-11-03', 50_000, 256_000)]);
    expect(result.outs[0]).toEqual({
      entryId: 's1',
      costBaseMinor: 258_600,
      uses: [{ lotId: 'w1', minor: 20_000, costBaseMinor: 105_000 }],
      uncoveredMinor: 30_000,
      uncoveredBaseMinor: 153_600,
    });
    expect(result.shortfalls).toEqual([{ entryId: 's1', uncoveredMinor: 30_000 }]);
    expect(result.open).toEqual([]);
  });

  it('keeps every figure of an account that never recorded a withdrawal', () => {
    const result = fifoCosts([outflow('s1', '2026-11-03', 45_000, 230_400)]);
    expect(result.outs[0]!.costBaseMinor).toBe(230_400);
    expect(result.shortfalls).toEqual([{ entryId: 's1', uncoveredMinor: 45_000 }]);
  });

  it('takes money in before money out on the same day, whatever order they were recorded in', () => {
    const result = fifoCosts([outflow('s1', '2026-11-02', 10_000, 51_200, { createdAt: at('2026-11-02', 1) }), inflow('w1', '2026-11-02', 100_000, 525_000, { createdAt: at('2026-11-02', 9) })]);
    expect(result.outs[0]).toMatchObject({ costBaseMinor: 52_500, uncoveredMinor: 0 });
  });

  it('reads a day from the bottom of its list up: the row dragged lower happened earlier (R3)', () => {
    // a is shown above b (position 1 before 2), so b came first and takes the older lot.
    const result = fifoCosts([
      inflow('w1', '2026-11-01', 10_000, 50_000, { createdAt: at('2026-11-01', 1) }),
      inflow('w2', '2026-11-01', 10_000, 60_000, { createdAt: at('2026-11-01', 2) }),
      outflow('a', '2026-11-02', 10_000, 51_200, { dayOrder: 1 }),
      outflow('b', '2026-11-02', 10_000, 51_200, { dayOrder: 2 }),
    ]);
    expect(result.outs.map((out) => [out.entryId, out.costBaseMinor])).toEqual([
      ['b', 50_000],
      ['a', 60_000],
    ]);
  });

  it('spends lots moved in from another pocket by their own withdrawal dates, oldest first (§3)', () => {
    const result = fifoCosts([
      inflow('own', '2026-11-05', 10_000, 54_000),
      inflow('moved', '2026-11-08', 10_000, 52_500, { parts: [{ lotId: 'w-old', lotDate: '2026-11-01', minor: 10_000, costBaseMinor: 52_500 }] }),
      outflow('s1', '2026-11-09', 10_000, 51_200),
    ]);
    expect(result.outs[0]!.uses).toEqual([{ lotId: 'w-old', minor: 10_000, costBaseMinor: 52_500 }]);
    expect(result.open.map((lot) => lot.lotId)).toEqual(['own']);
  });

  it('starts from the lots open at the start (R17)', () => {
    const result = fifoCosts([outflow('s1', '2026-11-03', 5_000, 25_600)], [{ lotId: 'before', lotDate: '2026-10-30', minor: 10_000, costBaseMinor: 52_000 }]);
    expect(result.outs[0]!.costBaseMinor).toBe(26_000);
    expect(result.open).toEqual([{ lotId: 'before', lotDate: '2026-10-30', minor: 10_000, costBaseMinor: 52_000, leftMinor: 5_000, leftCostBaseMinor: 26_000 }]);
  });

  it('names one lot once in an outflow, however many pieces of it arrived', () => {
    const result = fifoCosts([
      inflow('m1', '2026-11-02', 5_000, 26_250, { parts: [{ lotId: 'w', lotDate: '2026-11-01', minor: 5_000, costBaseMinor: 26_250 }] }),
      inflow('m2', '2026-11-03', 5_000, 26_250, { parts: [{ lotId: 'w', lotDate: '2026-11-01', minor: 5_000, costBaseMinor: 26_250 }] }),
      outflow('s1', '2026-11-04', 10_000, 51_200),
    ]);
    expect(result.outs[0]!.uses).toEqual([{ lotId: 'w', minor: 10_000, costBaseMinor: 52_500 }]);
  });

  it('refuses a movement that is not a positive whole number, and parts that do not add up', () => {
    expect(() => fifoCosts([outflow('s1', '2026-11-03', 0, 0)])).toThrow(FxError);
    expect(() => fifoCosts([outflow('s1', '2026-11-03', 1.5, 7)])).toThrow(FxError);
    expect(() => fifoCosts([inflow('m', '2026-11-03', 10_000, 52_500, { parts: [{ lotId: 'w', lotDate: '2026-11-01', minor: 9_000, costBaseMinor: 52_500 }] })])).toThrow(FxError);
    expect(() => fifoCosts([inflow('x', '2026-11-03', 10, 52), outflow('x', '2026-11-04', 5, 26)])).toThrow(FxError);
  });
});

describe('shareOf', () => {
  it('gives a lot’s pieces that always add up to its cost', () => {
    expect([shareOf(100, 1, 3), shareOf(100, 2, 3) - shareOf(100, 1, 3), 100 - shareOf(100, 2, 3)]).toEqual([33, 34, 33]);
    expect(shareOf(-100, 1, 3)).toBe(-33);
    expect(shareOf(0, 1, 3)).toBe(0);
  });

  it('keeps every unit of a figure past 2^53 halfway through', () => {
    expect(shareOf(9_007_199_254_740_991, 1, 2)).toBe(4_503_599_627_370_496);
  });
});

describe('chronological', () => {
  it('is date, then money in, then the list read bottom-up, then entry id', () => {
    const rows = [outflow('b', '2026-11-02', 1, 1), inflow('a', '2026-11-02', 1, 1), outflow('c', '2026-11-01', 1, 1)];
    expect([...rows].sort(chronological).map((row) => row.entryId)).toEqual(['c', 'a', 'b']);
  });
});

describe('which accounts hold lots (R2)', () => {
  it('is foreign money of the owner’s own, never a card, a debt or a trip balance', () => {
    expect(isFxLotAccount({ kind: 'asset', subtype: 'cash', currency: 'TRY' }, 'IDR')).toBe(true);
    expect(isFxLotAccount({ kind: 'asset', subtype: 'time_deposit', currency: 'USD' }, 'IDR')).toBe(true);
    expect(isFxLotAccount({ kind: 'asset', subtype: 'bank', currency: 'IDR' }, 'IDR')).toBe(false);
    expect(isFxLotAccount({ kind: 'liability', subtype: 'credit_card', currency: 'TRY' }, 'IDR')).toBe(false);
    expect(isFxLotAccount({ kind: 'asset', subtype: 'receivable', currency: 'TRY' }, 'IDR')).toBe(false);
    expect(isFxLotAccount({ kind: 'asset', subtype: 'event_balance', currency: 'TRY' }, 'IDR')).toBe(false);
    expect(isFxLotAccount({ kind: 'asset', subtype: 'cash', currency: null }, 'IDR')).toBe(false);
  });

  it('knows the two exchange categories by key', () => {
    expect(isExchangeResultKey(EXCHANGE_GAIN_KEY)).toBe(true);
    expect(isExchangeResultKey(EXCHANGE_LOSS_KEY)).toBe(true);
    expect(isExchangeResultKey('income.other')).toBe(false);
    expect(isExchangeResultKey(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/core && npx vitest run test/fx-fifo.test.ts`
Expected: FAIL — `fifoCosts` (and the rest) is not exported from `../src/index`.

- [ ] **Step 3: Write `keys.ts`**

`packages/core/src/fx/keys.ts`:

```ts
import { CASH_ITEMS } from '../assets/catalogue';

/*
 * Withdrawal rate (spec 2026-10-15). Which accounts hold foreign money in lots, and the two categories a realised
 * exchange gain or loss is filed under. Both categories are built-in keys made on first use in the Personal book
 * (ruling R8), so a workspace that never holds foreign money never shows them.
 */

export const EXCHANGE_GAIN_KEY = 'income.exchange_gain';
export const EXCHANGE_LOSS_KEY = 'expense.exchange_loss';
export const EXCHANGE_GAIN_NAME = 'Exchange gain';
export const EXCHANGE_LOSS_NAME = 'Exchange loss';

/** The money kinds (cash, current, saving, deposit, wallet, broker cash, other cash): every one can hold foreign money. */
export const FX_LOT_SUBTYPES: readonly string[] = CASH_ITEMS.map((item) => item.id);

/**
 * Whether an account holds foreign money in lots (D1, ruling R2): one of the owner's own money accounts in a currency
 * other than the base. A card or a loan in another currency keeps the day's rate on its own side (§9), and a receivable,
 * a trip balance or a holding is something money is spent on, not where it waits. A household placeholder has the
 * shape of a money account; the database leaves it out, since only it knows which accounts are placeholders.
 */
export function isFxLotAccount(account: { kind: string; subtype: string; currency: string | null }, baseCurrency: string): boolean {
  return account.kind === 'asset' && FX_LOT_SUBTYPES.includes(account.subtype) && account.currency !== null && account.currency !== baseCurrency;
}

/** Whether a category is one of the two an exchange's gain or loss is filed under. */
export const isExchangeResultKey = (key: string | null | undefined): boolean => key === EXCHANGE_GAIN_KEY || key === EXCHANGE_LOSS_KEY;
```

- [ ] **Step 4: Write `fifo.ts`**

`packages/core/src/fx/fifo.ts`:

```ts
import { compareWithinDay } from '../ledger/day-order';

/*
 * First in, first out (withdrawal rate §3, §4, §6). One foreign account's movements in, every outflow's cost out: the
 * oldest lots still open are used first, and what no lot covers is valued at the figure the line was first posted at
 * (ruling R4) and recorded as a shortfall. No database, no rates: the caller hands in each movement's own figures.
 */

export class FxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxError';
  }
}

/** A piece of a lot: money that came in at one cost on one date. A move between pockets carries several (§3). */
export interface FxLotPart {
  /** The entry the money first arrived on, in whichever account that was: what "From the 12 Nov withdrawal" names. */
  lotId: string;
  lotDate: string;
  minor: number;
  costBaseMinor: number;
}

interface FxMovementBase {
  entryId: string;
  occurredOn: string;
  dayOrder: number | null;
  createdAt: string;
  /** Always positive: the direction is `kind`. */
  minor: number;
}

export interface FxInflow extends FxMovementBase {
  kind: 'in';
  costBaseMinor: number;
  /** The lots it brings, with their own dates and costs; absent, it is one lot of its own, dated the day it arrived. */
  parts?: readonly FxLotPart[];
}

export interface FxOutflow extends FxMovementBase {
  kind: 'out';
  /** What the line was first posted at, in base: the value of whatever no lot covers (R4). Positive. */
  dayValueBaseMinor: number;
}

export type FxMovement = FxInflow | FxOutflow;

export interface FxLotUse {
  lotId: string;
  minor: number;
  costBaseMinor: number;
}

export interface FxOutCost {
  entryId: string;
  /** Lots used plus the uncovered part: what the outflow's money line is worth in base, positive. */
  costBaseMinor: number;
  /** One per lot, oldest first; a lot that arrived in two pieces is named once. */
  uses: FxLotUse[];
  uncoveredMinor: number;
  uncoveredBaseMinor: number;
}

export interface FxOpenLot {
  lotId: string;
  lotDate: string;
  minor: number;
  costBaseMinor: number;
  leftMinor: number;
  leftCostBaseMinor: number;
}

export interface FxShortfall {
  entryId: string;
  uncoveredMinor: number;
}

export interface FifoResult {
  /** In the order the money went out. */
  outs: FxOutCost[];
  /** What is still held, oldest first. */
  open: FxOpenLot[];
  shortfalls: FxShortfall[];
}

/**
 * `total × part / whole`, rounded half up, through BigInt: a lot of ₺90.000.000 at Rp 525 is already past what a
 * double multiplies exactly. Used cumulatively — the cost of the units from `a` to `b` is `shareOf(b) − shareOf(a)` —
 * so a lot's pieces always add up to its cost, however it is cut.
 */
export function shareOf(total: number, part: number, whole: number): number {
  if (!Number.isSafeInteger(whole) || whole <= 0) throw new FxError(`A share is of a positive whole number, got ${whole}`);
  if (!Number.isSafeInteger(part) || part < 0 || part > whole) throw new FxError(`A share is of a part between 0 and ${whole}, got ${part}`);
  if (part === whole) return total;
  if (part === 0 || total === 0) return 0;
  const magnitude = (BigInt(Math.abs(total)) * BigInt(part) * 2n + BigInt(whole)) / (2n * BigInt(whole));
  return total < 0 ? -Number(magnitude) : Number(magnitude);
}

/**
 * The order money moved (spec §4, ruling R3): by date; within a day money in before money out; then as the day's list
 * reads from the bottom up — the list shows a day newest first (`compareWithinDay`), so the row shown lower happened
 * earlier — and last by entry id, so the order is total and never depends on how the rows were handed in.
 */
export function chronological(a: FxMovement, b: FxMovement): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'in' ? -1 : 1;
  const within = compareWithinDay(b, a);
  if (within !== 0) return within;
  return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
}

interface Queued extends FxOpenLot {
  seq: number;
}

const byAge = (a: Queued, b: Queued) => (a.lotDate !== b.lotDate ? (a.lotDate < b.lotDate ? -1 : 1) : a.seq - b.seq);

const wholePositive = (value: number, what: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new FxError(`${what} is a positive whole number of minor units, got ${value}`);
};

/**
 * Every outflow's cost, oldest lot first (§4). Lots wait in a queue ordered by their own date (a lot moved in from
 * another pocket keeps its withdrawal date, §3), then by when they arrived; an outflow can only use what has arrived
 * before it.
 */
export function fifoCosts(movements: readonly FxMovement[], opening: readonly FxLotPart[] = []): FifoResult {
  const seen = new Set<string>();
  for (const movement of movements) {
    wholePositive(movement.minor, `Movement ${movement.entryId}`);
    if (seen.has(movement.entryId)) throw new FxError(`Entry ${movement.entryId} appears twice`);
    seen.add(movement.entryId);
  }
  const queue: Queued[] = [];
  let seq = 0;
  const arrive = (part: FxLotPart) => {
    wholePositive(part.minor, `A piece of lot ${part.lotId}`);
    queue.push({ ...part, leftMinor: part.minor, leftCostBaseMinor: part.costBaseMinor, seq: seq++ });
    queue.sort(byAge);
  };
  opening.forEach(arrive);

  const outs: FxOutCost[] = [];
  const shortfalls: FxShortfall[] = [];
  for (const movement of [...movements].sort(chronological)) {
    if (movement.kind === 'in') {
      const parts = movement.parts && movement.parts.length > 0 ? movement.parts : [{ lotId: movement.entryId, lotDate: movement.occurredOn, minor: movement.minor, costBaseMinor: movement.costBaseMinor }];
      const sum = parts.reduce((total, part) => total + part.minor, 0);
      if (sum !== movement.minor) throw new FxError(`The lots of ${movement.entryId} add up to ${sum}, not ${movement.minor}`);
      parts.forEach(arrive);
      continue;
    }
    let need = movement.minor;
    const uses = new Map<string, FxLotUse>();
    for (const lot of queue) {
      if (need === 0) break;
      if (lot.leftMinor === 0) continue;
      const take = Math.min(need, lot.leftMinor);
      const usedBefore = lot.minor - lot.leftMinor;
      const cost = shareOf(lot.costBaseMinor, usedBefore + take, lot.minor) - shareOf(lot.costBaseMinor, usedBefore, lot.minor);
      lot.leftMinor -= take;
      lot.leftCostBaseMinor = lot.costBaseMinor - shareOf(lot.costBaseMinor, lot.minor - lot.leftMinor, lot.minor);
      need -= take;
      const held = uses.get(lot.lotId);
      if (held) {
        held.minor += take;
        held.costBaseMinor += cost;
      } else uses.set(lot.lotId, { lotId: lot.lotId, minor: take, costBaseMinor: cost });
    }
    const uncoveredBaseMinor = need === 0 ? 0 : shareOf(movement.dayValueBaseMinor, need, movement.minor);
    const used = [...uses.values()];
    outs.push({
      entryId: movement.entryId,
      costBaseMinor: used.reduce((total, use) => total + use.costBaseMinor, 0) + uncoveredBaseMinor,
      uses: used,
      uncoveredMinor: need,
      uncoveredBaseMinor,
    });
    if (need > 0) shortfalls.push({ entryId: movement.entryId, uncoveredMinor: need });
  }
  const open = queue
    .filter((lot) => lot.leftMinor > 0)
    .map((lot): FxOpenLot => ({ lotId: lot.lotId, lotDate: lot.lotDate, minor: lot.minor, costBaseMinor: lot.costBaseMinor, leftMinor: lot.leftMinor, leftCostBaseMinor: lot.leftCostBaseMinor }));
  return { outs, open, shortfalls };
}
```

- [ ] **Step 5: Export from the core index**

Append to the end of `packages/core/src/index.ts`:

```ts
export { EXCHANGE_GAIN_KEY, EXCHANGE_GAIN_NAME, EXCHANGE_LOSS_KEY, EXCHANGE_LOSS_NAME, FX_LOT_SUBTYPES, isExchangeResultKey, isFxLotAccount } from './fx/keys';
export {
  chronological,
  fifoCosts,
  type FifoResult,
  FxError,
  type FxInflow,
  type FxLotPart,
  type FxLotUse,
  type FxMovement,
  type FxOpenLot,
  type FxOutCost,
  type FxOutflow,
  type FxShortfall,
  shareOf,
} from './fx/fifo';
```

- [ ] **Step 6: Run the example tests**

Run: `cd packages/core && npx vitest run test/fx-fifo.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 7: Write the property tests (spec §6's three properties; Review Focus 2)**

`packages/core/test/fx-fifo.property.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fifoCosts, type FxMovement } from '../src/index';

/*
 * §6: total cost out + remaining cost = total cost in; no lot is used beyond its amount; the order of entry on the same
 * day does not change the result (ruling R3's two readings). Invented figures: amounts up to ₺5.000, rates 400–700.
 */
const RUNS = 300;
const SEED = 20261015;

const rowArb = fc.record({
  kind: fc.constantFrom('in' as const, 'out' as const),
  day: fc.integer({ min: 1, max: 9 }),
  minor: fc.integer({ min: 1, max: 500_000 }),
  rate: fc.integer({ min: 400, max: 700 }),
  dayOrder: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
  minute: fc.integer({ min: 0, max: 59 }),
});

const movementsArb = fc.array(rowArb, { minLength: 1, maxLength: 25 }).map((rows) =>
  rows.map((row, i): FxMovement => {
    const occurredOn = `2026-11-0${row.day}`;
    const common = { entryId: `e${String(i).padStart(2, '0')}`, occurredOn, dayOrder: row.dayOrder, createdAt: `${occurredOn}T08:${String(row.minute).padStart(2, '0')}:00.000Z`, minor: row.minor };
    const value = Math.round((row.minor * row.rate) / 100);
    return row.kind === 'in' ? { ...common, kind: 'in', costBaseMinor: value } : { ...common, kind: 'out', dayValueBaseMinor: value };
  }),
);

describe('fifoCosts, properties (§6)', () => {
  it('cost out from lots plus cost left equals cost in', () => {
    fc.assert(
      fc.property(movementsArb, (movements) => {
        const result = fifoCosts(movements);
        const costIn = movements.reduce((sum, m) => sum + (m.kind === 'in' ? m.costBaseMinor : 0), 0);
        const fromLots = result.outs.reduce((sum, out) => sum + out.costBaseMinor - out.uncoveredBaseMinor, 0);
        const left = result.open.reduce((sum, lot) => sum + lot.leftCostBaseMinor, 0);
        expect(fromLots + left).toBe(costIn);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('never uses a lot beyond its amount, and uses and what is left add up to it', () => {
    fc.assert(
      fc.property(movementsArb, (movements) => {
        const result = fifoCosts(movements);
        for (const inflow of movements.filter((m) => m.kind === 'in')) {
          const used = result.outs.flatMap((out) => out.uses).filter((use) => use.lotId === inflow.entryId).reduce((sum, use) => sum + use.minor, 0);
          const left = result.open.find((lot) => lot.lotId === inflow.entryId)?.leftMinor ?? 0;
          expect(used).toBeLessThanOrEqual(inflow.minor);
          expect(used + left).toBe(inflow.minor);
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('does not depend on the order the movements are handed in', () => {
    fc.assert(
      fc.property(
        movementsArb.chain((movements) => fc.tuple(fc.constant(movements), fc.shuffledSubarray(movements, { minLength: movements.length, maxLength: movements.length }))),
        ([movements, shuffled]) => {
          expect(fifoCosts(shuffled)).toEqual(fifoCosts(movements));
        },
      ),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('gives a day the same total cost and leaves the same lots, whatever the order of its money out (R3)', () => {
    fc.assert(
      fc.property(movementsArb, fc.integer({ min: 0, max: 1_000 }), (movements, salt) => {
        // Swap the places (dayOrder, createdAt) of each day's outflows among themselves.
        const reordered = movements.map((m) => ({ ...m }));
        const days = new Set(reordered.map((m) => m.occurredOn));
        for (const day of days) {
          const outs = reordered.filter((m) => m.kind === 'out' && m.occurredOn === day);
          const places = outs.map((m) => ({ dayOrder: m.dayOrder, createdAt: m.createdAt }));
          outs.forEach((m, i) => Object.assign(m, places[(i + salt) % places.length]!));
        }
        const before = fifoCosts(movements);
        const after = fifoCosts(reordered);
        const perDay = (result: ReturnType<typeof fifoCosts>) => {
          const dayOf = new Map(movements.map((m) => [m.entryId, m.occurredOn]));
          const totals: Record<string, number> = {};
          for (const out of result.outs) totals[dayOf.get(out.entryId)!] = (totals[dayOf.get(out.entryId)!] ?? 0) + out.costBaseMinor;
          return totals;
        };
        expect(perDay(after)).toEqual(perDay(before));
        expect(after.open).toEqual(before.open);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});
```

- [ ] **Step 8: Run the properties and the whole core suite**

Run: `cd packages/core && npx vitest run test/fx-fifo.property.test.ts && cd ../.. && npm run test -w @expanses/core && npm run typecheck -w @expanses/core`
Expected: PASS. The fourth property relies on one same-day rule: every inflow of a day comes before every outflow of it, so the outflows draw from one fixed queue. Do not "fix" a failure there by loosening the assertion — a failure means `chronological` is wrong.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/fx/keys.ts packages/core/src/fx/fifo.ts packages/core/src/index.ts packages/core/test/fx-fifo.test.ts packages/core/test/fx-fifo.property.test.ts
git commit -m "Foreign money is spent oldest withdrawal first: fifoCosts prices each outflow from its lots, values what no lot covers at its posted figure, and keeps a day's total whatever the order of its rows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 2: Core — `revalueTransaction`: one outflow's cost into its transaction's lines

Spec §4's table, §5; rulings R5, R6, R7, R8 (visuals), R11. Pure functions only.

**Files:**
- Create: `packages/core/src/fx/revalue.ts`
- Modify: `packages/core/src/index.ts` (append one export block at the end)
- Modify: `packages/core/src/categories/visuals.ts` (two icons, one colour)
- Test: `packages/core/test/fx-revalue.test.ts`
- Test: `packages/core/test/fx-revalue.property.test.ts`
- Modify: `packages/core/test/category-visuals.test.ts` (one test appended)

**Interfaces:**
- Consumes: `FxError` from Task 1 (`packages/core/src/fx/fifo.ts`); `EXCHANGE_GAIN_KEY`, `EXCHANGE_LOSS_KEY` from Task 1 (`keys.ts`).
- Produces (exported from `@expanses/core`):
  - `type FxRole = 'lot' | 'exchange' | 'money' | 'other'` — `lot`: a line on a lot account (R2); `exchange`: the `currency_exchange` system account; `money`: any other asset or liability whose subtype is a money kind or `credit_card`/`loan` (base-currency banks, cards, loans, placeholders); `other`: categories, receivables, payables, event balances, holdings, equity.
  - `interface FxLine { entryId: string; currency: string; amountMinor: number; amountBaseMinor: number; role: FxRole }`
  - `spreadBase(total: number, weights: readonly number[]): number[]`
  - `type InflowCost = { kind: 'stored' } | { kind: 'carried'; fromEntryIds: string[] } | { kind: 'exchanged'; costs: Record<string, number> }`
  - `classifyInflow(lines: readonly FxLine[], entryId: string, baseCurrency: string): InflowCost`
  - `interface RevalueInput { lines: readonly FxLine[]; baseCurrency: string; outCosts?: Readonly<Record<string, number>>; inCosts?: Readonly<Record<string, number>> }`
  - `interface Revalued { bases: Record<string, number>; gainLossBaseMinor: number }`
  - `revalueTransaction(input: RevalueInput): Revalued`

- [ ] **Step 1: Write the failing example tests**

`packages/core/test/fx-revalue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyInflow, FxError, type FxLine, revalueTransaction, spreadBase } from '../src/index';

/*
 * Withdrawal rate §4, §5. Invented figures: lira withdrawn at 525, a market rate of 512, euros at 17.500, a rupiah book.
 * Each line is [entryId, currency, amount, stored base, role].
 */
const line = (entryId: string, currency: string, amountMinor: number, amountBaseMinor: number, role: FxLine['role']): FxLine => ({ entryId, currency, amountMinor, amountBaseMinor, role });

describe('spreadBase', () => {
  it('shares a figure by weight and gives the whole remainder to the largest, first on a tie (R5)', () => {
    expect(spreadBase(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(spreadBase(-7, [2, 5])).toEqual([-2, -5]);
    expect(spreadBase(10, [0, 0])).toEqual([10, 0]);
    expect(() => spreadBase(10, [])).toThrow(FxError);
  });
});

describe('revalueTransaction: spending (§4 row 1)', () => {
  it('puts the cost on the money line and shares it over the categories by their day figures', () => {
    const lines = [line('pocket', 'TRY', -45_000, -230_400, 'lot'), line('food', 'TRY', 30_000, 153_600, 'other'), line('taxi', 'TRY', 15_000, 76_800, 'other')];
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 236_250 } })).toEqual({
      bases: { pocket: -236_250, food: 157_500, taxi: 78_750 },
      gainLossBaseMinor: 0,
    });
  });

  it('adds a split up to the money line exactly, the remainder on the largest line (Review Focus 4)', () => {
    const lines = [line('pocket', 'TRY', -30_000, -153_600, 'lot'), line('a', 'TRY', 10_000, 51_200, 'other'), line('b', 'TRY', 10_000, 51_200, 'other'), line('c', 'TRY', 10_000, 51_200, 'other')];
    const { bases } = revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 100_001 } });
    expect(bases).toEqual({ pocket: -100_001, a: 33_335, b: 33_333, c: 33_333 });
  });

  it('shares a shared event’s expense charged in another currency over its share and trip balance, with no gain or loss (R7)', () => {
    const lines = [
      line('pocket', 'TRY', -90_000, -460_800, 'lot'),
      line('xTRY', 'TRY', 90_000, 460_800, 'exchange'),
      line('share', 'EUR', 1_000, 170_000, 'other'),
      line('trip', 'EUR', 2_000, 340_000, 'other'),
      line('xEUR', 'EUR', -3_000, -510_000, 'exchange'),
    ];
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 472_500 } })).toEqual({
      bases: { pocket: -472_500, xTRY: 472_500, share: 157_500, trip: 315_000, xEUR: -472_500 },
      gainLossBaseMinor: 0,
    });
  });

  it('keeps a base-currency bill at its own figure and books the difference (R7)', () => {
    const lines = [line('pocket', 'TRY', -45_000, -230_400, 'lot'), line('xTRY', 'TRY', 45_000, 230_400, 'exchange'), line('bill', 'IDR', 236_000, 236_000, 'other'), line('xIDR', 'IDR', -236_000, -236_000, 'exchange')];
    const result = revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 236_250 } });
    expect(result.bases).toMatchObject({ bill: 236_000, xIDR: -236_000, xTRY: 236_250 });
    expect(result.gainLossBaseMinor).toBe(-250);
  });
});

describe('revalueTransaction: moves and exchanges', () => {
  it('carries the cost into another lira pocket (§4 row 3)', () => {
    const lines = [line('a', 'TRY', -50_000, -256_000, 'lot'), line('b', 'TRY', 50_000, 256_000, 'lot')];
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { a: 262_500 } }).bases).toEqual({ a: -262_500, b: 262_500 });
  });

  it('pays a lira card at the lira’s cost, with no gain or loss (§4 row 4)', () => {
    const lines = [line('a', 'TRY', -50_000, -256_000, 'lot'), line('card', 'TRY', 50_000, 256_000, 'money')];
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { a: 262_500 } })).toEqual({ bases: { a: -262_500, card: 262_500 }, gainLossBaseMinor: 0 });
  });

  it('changes leftovers back into rupiah: what arrived keeps its figure and the loss is the difference (§5)', () => {
    const lines = [line('pocket', 'TRY', -50_000, -256_000, 'lot'), line('xTRY', 'TRY', 50_000, 256_000, 'exchange'), line('bank', 'IDR', 250_000, 250_000, 'money'), line('xIDR', 'IDR', -250_000, -250_000, 'exchange')];
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 262_500 } })).toEqual({
      bases: { pocket: -262_500, xTRY: 262_500, bank: 250_000, xIDR: -250_000 },
      gainLossBaseMinor: -12_500,
    });
  });

  it('changes lira into euros: the euros keep their own figure, and the difference is booked (R6)', () => {
    const lines = [line('pocket', 'TRY', -100_000, -512_000, 'lot'), line('xTRY', 'TRY', 100_000, 512_000, 'exchange'), line('eur', 'EUR', 2_900, 507_500, 'lot'), line('xEUR', 'EUR', -2_900, -507_500, 'exchange')];
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 525_000 } })).toEqual({
      bases: { pocket: -525_000, xTRY: 525_000, eur: 507_500, xEUR: -507_500 },
      gainLossBaseMinor: -17_500,
    });
  });

  it('writes a withdrawal from rupiah at the rupiah that left (R11)', () => {
    const lines = [line('bank', 'IDR', -5_250_000, -5_250_000, 'money'), line('xIDR', 'IDR', 5_250_000, 5_250_000, 'exchange'), line('pocket', 'TRY', 1_000_000, 5_120_000, 'lot'), line('xTRY', 'TRY', -1_000_000, -5_120_000, 'exchange')];
    const cost = classifyInflow(lines, 'pocket', 'IDR');
    expect(cost).toEqual({ kind: 'exchanged', costs: { pocket: 5_250_000 } });
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', inCosts: (cost as { costs: Record<string, number> }).costs })).toEqual({
      bases: { bank: -5_250_000, xIDR: 5_250_000, pocket: 5_250_000, xTRY: -5_250_000 },
      gainLossBaseMinor: 0,
    });
  });

  it('refuses what is not money leaving or arriving in a foreign account, and both at once', () => {
    const lines = [line('pocket', 'TRY', -45_000, -230_400, 'lot'), line('food', 'TRY', 45_000, 230_400, 'other')];
    expect(() => revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { food: 1 } })).toThrow(FxError);
    expect(() => revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 1 }, inCosts: { pocket: 1 } })).toThrow(FxError);
  });
});

describe('classifyInflow (R11)', () => {
  it('is carried from another lira pocket, stored for income and for euros changed from lira, and stored for a settle-up', () => {
    expect(classifyInflow([line('a', 'TRY', -50_000, -256_000, 'lot'), line('b', 'TRY', 50_000, 256_000, 'lot')], 'b', 'IDR')).toEqual({ kind: 'carried', fromEntryIds: ['a'] });
    expect(classifyInflow([line('salary', 'TRY', -50_000, -256_000, 'other'), line('b', 'TRY', 50_000, 256_000, 'lot')], 'b', 'IDR')).toEqual({ kind: 'stored' });
    const lira = [line('pocket', 'TRY', -100_000, -512_000, 'lot'), line('xTRY', 'TRY', 100_000, 512_000, 'exchange'), line('eur', 'EUR', 2_900, 507_500, 'lot'), line('xEUR', 'EUR', -2_900, -507_500, 'exchange')];
    expect(classifyInflow(lira, 'eur', 'IDR')).toEqual({ kind: 'stored' });
    const settle = [line('trip', 'EUR', -1_000, -170_000, 'other'), line('xEUR', 'EUR', 1_000, 170_000, 'exchange'), line('pocket', 'TRY', 33_000, 168_960, 'lot'), line('xTRY', 'TRY', -33_000, -168_960, 'exchange')];
    expect(classifyInflow(settle, 'pocket', 'IDR')).toEqual({ kind: 'stored' });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/core && npx vitest run test/fx-revalue.test.ts`
Expected: FAIL — `revalueTransaction` is not exported.

- [ ] **Step 3: Write `revalue.ts`**

`packages/core/src/fx/revalue.ts`:

```ts
import { FxError } from './fifo';

/*
 * One transaction's base figures once the money leaving (or arriving in) a foreign account has its cost (withdrawal
 * rate §4, §5). The caller says what each line is (`role`); this says what each line is worth in base, and how big an
 * exchange gain or loss is (positive: a gain). Every currency's lines still add up to zero in base afterwards, and a
 * line in the base currency never changes: its figure is its amount.
 */

export type FxRole = 'lot' | 'exchange' | 'money' | 'other';

export interface FxLine {
  entryId: string;
  currency: string;
  amountMinor: number;
  amountBaseMinor: number;
  role: FxRole;
}

/**
 * `total` shared by `weights`, each part rounded toward zero and the whole remainder on the largest weight (the first
 * of equal ones): "the rounding remainder on the largest" (§4, ruling R5). Weights of zero in all leave it all on the
 * first. BigInt, because a cost times a weight can pass 2^53.
 */
export function spreadBase(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) throw new FxError('Nothing to share a cost over');
  if (!Number.isSafeInteger(total)) throw new FxError(`A cost is a whole number of minor units, got ${total}`);
  const largest = weights.reduce((best, weight, i) => (Math.abs(weight) > Math.abs(weights[best]!) ? i : best), 0);
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  const parts = weights.map(() => 0);
  if (sum === 0) {
    parts[largest] = total;
    return parts;
  }
  weights.forEach((weight, i) => {
    if (!Number.isSafeInteger(weight)) throw new FxError(`A weight is a whole number, got ${weight}`);
    parts[i] = Number((BigInt(total) * BigInt(weight)) / BigInt(sum));
  });
  parts[largest] = parts[largest]! + total - parts.reduce((acc, part) => acc + part, 0);
  return parts;
}

export type InflowCost = { kind: 'stored' } | { kind: 'carried'; fromEntryIds: string[] } | { kind: 'exchanged'; costs: Record<string, number> };

/**
 * What money arriving in a foreign account cost (§3, ruling R11): moved from another of the owner's pockets in the same
 * currency, it is what that pocket's own lots cost (carried — written by that pocket's recalculation); changed from
 * the base currency, it is the base amount that left (exchanged — written here, for every pocket it arrived in); any
 * other way in keeps the figure it was posted at (stored).
 */
export function classifyInflow(lines: readonly FxLine[], entryId: string, baseCurrency: string): InflowCost {
  const arriving = lines.find((l) => l.entryId === entryId);
  if (!arriving || arriving.role !== 'lot' || arriving.amountMinor <= 0) throw new FxError(`${entryId} is not money arriving in a foreign account`);
  const fromPocket = lines.filter((l) => l.role === 'lot' && l.amountMinor < 0 && l.currency === arriving.currency);
  if (fromPocket.length > 0) return { kind: 'carried', fromEntryIds: fromPocket.map((l) => l.entryId) };
  if (!lines.some((l) => l.role === 'exchange' && l.currency === arriving.currency)) return { kind: 'stored' };
  const source = lines.filter((l) => l.role !== 'exchange' && l.currency !== arriving.currency && l.amountMinor < 0);
  if (source.length === 0 || source.some((l) => l.currency !== baseCurrency || l.role !== 'money')) return { kind: 'stored' };
  const pockets = lines.filter((l) => l.role === 'lot' && l.amountMinor > 0 && l.currency === arriving.currency);
  const shares = spreadBase(-source.reduce((sum, l) => sum + l.amountMinor, 0), pockets.map((l) => l.amountMinor));
  return { kind: 'exchanged', costs: Object.fromEntries(pockets.map((l, i) => [l.entryId, shares[i]!])) };
}

export interface RevalueInput {
  lines: readonly FxLine[];
  baseCurrency: string;
  /** Money leaving a foreign account, by entry: its cost in base, positive. */
  outCosts?: Readonly<Record<string, number>>;
  /** Money arriving in a foreign account from the base currency, by entry: what it cost, positive. */
  inCosts?: Readonly<Record<string, number>>;
}

export interface Revalued {
  bases: Record<string, number>;
  /** Positive: an exchange gain; negative: a loss; zero: none. Its line is the caller's to write (R8). */
  gainLossBaseMinor: number;
}

/**
 * Every line's base figure once its foreign money has its cost (§4):
 *
 * - Within one currency (no exchange line): spending, a move to another pocket, a card paid — the cost is shared over the
 *   other lines by their day figures (R5); a pocket on the other side takes it as carried.
 * - Across currencies, between the owner's own accounts (something received is a money account or another pocket): what
 *   was received keeps its own figure, and the gap is the gain or loss (R6).
 * - Across currencies, spending only (a shared event's expense in another currency): the cost is shared over the
 *   received lines not in the base currency; base-currency lines keep their figure, and only a gap they leave is a gain
 *   or loss (R7).
 *
 * The exchange lines of each foreign currency are then set so that currency adds up to zero in base again; the gain or
 * loss is what the exchange account would otherwise be left holding.
 */
export function revalueTransaction(input: RevalueInput): Revalued {
  const { lines, baseCurrency } = input;
  const outCosts = input.outCosts ?? {};
  const inCosts = input.inCosts ?? {};
  const outIds = Object.keys(outCosts);
  const inIds = Object.keys(inCosts);
  if (outIds.length > 0 && inIds.length > 0) throw new FxError('A transaction is revalued for money leaving or for money arriving, not both at once');
  const byId = new Map(lines.map((l) => [l.entryId, l]));
  const bases: Record<string, number> = Object.fromEntries(lines.map((l) => [l.entryId, l.amountBaseMinor]));
  for (const id of outIds) {
    const leaving = byId.get(id);
    if (!leaving || leaving.role !== 'lot' || leaving.amountMinor >= 0) throw new FxError(`${id} is not money leaving a foreign account`);
    bases[id] = -outCosts[id]!;
  }
  for (const id of inIds) {
    const arriving = byId.get(id);
    if (!arriving || arriving.role !== 'lot' || arriving.amountMinor <= 0) throw new FxError(`${id} is not money arriving in a foreign account`);
    bases[id] = inCosts[id]!;
  }

  const exchange = lines.filter((l) => l.role === 'exchange');
  const rebalance = () => {
    for (const currency of new Set(exchange.map((l) => l.currency))) {
      if (currency === baseCurrency) continue;
      const own = exchange.filter((l) => l.currency === currency);
      const rest = lines.filter((l) => l.role !== 'exchange' && l.currency === currency).reduce((sum, l) => sum + bases[l.entryId]!, 0);
      spreadBase(-rest, own.map((l) => l.amountMinor)).forEach((value, i) => (bases[own[i]!.entryId] = value));
    }
  };
  if (outIds.length === 0) {
    rebalance();
    return { bases, gainLossBaseMinor: 0 };
  }

  const leaving = lines.filter((l) => l.role === 'lot' && l.amountMinor < 0);
  const received = lines.filter((l) => l.role !== 'exchange' && !(l.role === 'lot' && l.amountMinor < 0));
  const costOf = (ls: readonly FxLine[]) => ls.reduce((sum, l) => sum - bases[l.entryId]!, 0);
  const share = (targets: readonly FxLine[], total: number) => {
    if (targets.length === 0) throw new FxError('Money left a foreign account with nothing on the other side to carry its cost');
    const stored = targets.map((l) => l.amountBaseMinor);
    const weights = stored.reduce((sum, w) => sum + w, 0) !== 0 ? stored : targets.map((l) => l.amountMinor);
    spreadBase(total, weights).forEach((value, i) => (bases[targets[i]!.entryId] = value));
  };

  if (exchange.length === 0) {
    for (const currency of new Set(leaving.map((l) => l.currency))) {
      share(
        received.filter((l) => l.currency === currency),
        costOf(leaving.filter((l) => l.currency === currency)),
      );
    }
    return { bases, gainLossBaseMinor: 0 };
  }

  const betweenOwnAccounts = received.some((l) => l.role === 'money' || l.role === 'lot');
  if (!betweenOwnAccounts) {
    const free = received.filter((l) => l.currency !== baseCurrency);
    const fixed = received.filter((l) => l.currency === baseCurrency).reduce((sum, l) => sum + bases[l.entryId]!, 0);
    if (free.length > 0) share(free, costOf(leaving) - fixed);
  }
  rebalance();
  return { bases, gainLossBaseMinor: -exchange.reduce((sum, l) => sum + bases[l.entryId]!, 0) };
}
```

- [ ] **Step 4: Export from the core index**

Append to the end of `packages/core/src/index.ts`:

```ts
export { classifyInflow, type FxLine, type FxRole, type InflowCost, revalueTransaction, type Revalued, type RevalueInput, spreadBase } from './fx/revalue';
```

- [ ] **Step 5: Give the two keys their look**

In `packages/core/src/categories/visuals.ts`, add to `CATEGORY_COLOURS` (after `business`):

```ts
  // Exchange loss is a top-level expense (withdrawal rate §5): the transfer slate, since it is what a transfer cost.
  'expense.exchange_loss': '#475569',
```

and to `CATEGORY_ICONS` (after the `'income.other'` entry, on its own line):

```ts
  'income.exchange_gain': 'arrow-left-right', 'expense.exchange_loss': 'arrow-left-right',
```

Append to `packages/core/test/category-visuals.test.ts`, inside the existing `describe('category visuals', …)`:

```ts
  it('draws Exchange gain and Exchange loss as the transfer they come from, gain in the income colour', () => {
    expect(categoryVisual('expense.exchange_loss', 'expense.exchange_loss')).toEqual({ icon: 'arrow-left-right', colour: '#475569' });
    expect(categoryVisual('income.exchange_gain', 'income.exchange_gain')).toEqual({ icon: 'arrow-left-right', colour: CATEGORY_COLOURS.income });
  });
```

- [ ] **Step 6: Run the example tests**

Run: `cd packages/core && npx vitest run test/fx-revalue.test.ts test/category-visuals.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the property tests (Review Focus 4)**

`packages/core/test/fx-revalue.property.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type FxLine, revalueTransaction, spreadBase } from '../src/index';

/* Review Focus 4: a cost shared over a split always adds up to the money line's, and every currency balances in base. */
const RUNS = 300;
const SEED = 20261015;
const dayValue = (minor: number, rate: number) => Math.round((minor * rate) / 100);

describe('revalueTransaction, properties', () => {
  it('shares a cost over any split so the categories add up to it exactly', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 400, max: 700 }),
        fc.integer({ min: 1, max: 900_000_000 }),
        (amounts, rate, cost) => {
          const total = amounts.reduce((a, b) => a + b, 0);
          const categories = amounts.map((amount, i): FxLine => ({ entryId: `c${i}`, currency: 'TRY', amountMinor: amount, amountBaseMinor: dayValue(amount, rate), role: 'other' }));
          const money: FxLine = { entryId: 'm', currency: 'TRY', amountMinor: -total, amountBaseMinor: -categories.reduce((s, l) => s + l.amountBaseMinor, 0), role: 'lot' };
          const { bases, gainLossBaseMinor } = revalueTransaction({ lines: [money, ...categories], baseCurrency: 'IDR', outCosts: { m: cost } });
          expect(categories.reduce((s, l) => s + bases[l.entryId]!, 0)).toBe(cost);
          expect(bases.m).toBe(-cost);
          expect(gainLossBaseMinor).toBe(0);
        },
      ),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('changing back into the base currency books exactly what arrived less the cost, and the foreign side balances', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 900_000_000 }), fc.integer({ min: 1, max: 900_000_000 }), (minor, received, cost) => {
        const stored = dayValue(minor, 512);
        const lines: FxLine[] = [
          { entryId: 'p', currency: 'TRY', amountMinor: -minor, amountBaseMinor: -stored, role: 'lot' },
          { entryId: 'x1', currency: 'TRY', amountMinor: minor, amountBaseMinor: stored, role: 'exchange' },
          { entryId: 'bank', currency: 'IDR', amountMinor: received, amountBaseMinor: received, role: 'money' },
          { entryId: 'x2', currency: 'IDR', amountMinor: -received, amountBaseMinor: -received, role: 'exchange' },
        ];
        const { bases, gainLossBaseMinor } = revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { p: cost } });
        expect(gainLossBaseMinor).toBe(received - cost);
        expect(bases.p! + bases.x1!).toBe(0);
        expect(bases.bank).toBe(received);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('spreadBase always adds up to the total', () => {
    fc.assert(
      fc.property(fc.integer({ min: -900_000_000, max: 900_000_000 }), fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { minLength: 1, maxLength: 8 }), (total, weights) => {
        expect(spreadBase(total, weights).reduce((a, b) => a + b, 0)).toBe(total);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});
```

- [ ] **Step 8: Run the properties, the core suite and the typecheck**

Run: `cd packages/core && npx vitest run test/fx-revalue.property.test.ts && cd ../.. && npm run test -w @expanses/core && npm run typecheck -w @expanses/core`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/fx/revalue.ts packages/core/src/index.ts packages/core/src/categories/visuals.ts packages/core/test/fx-revalue.test.ts packages/core/test/fx-revalue.property.test.ts packages/core/test/category-visuals.test.ts
git commit -m "A foreign outflow's cost reaches every line of its transaction: shared over spending by its day figures, carried into another pocket, and set against what an exchange received as a gain or loss

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 3: Migration 0071 — five local tables, the first-run queue and its notice

Spec §6 ("a local cache table … Never synced", "First run after the update"); rulings R1, R18.

**Files:**
- Create: `packages/db/migrations/0071_withdrawal_rate.sql`
- Modify: `packages/db/src/migrations.ts` (one import after `sharedEvents`, one entry after version 69)
- Create: `packages/db/src/repos/fx-tables.ts`
- Test: `packages/db/test/withdrawal-rate-migration.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - Tables `fx_lot_uses`, `fx_shortfalls`, `fx_day_values`, `fx_gain_loss`, `fx_recalc_pending` (columns below).
  - `fxTablesExist(db: Db): Promise<boolean>` — cached positive answer per handle, like `dayOrderExists`.
  - `queueForeignRecalcTx(db: Db, accountId: string, fromDate: string | null): Promise<void>` — keeps the earliest date; `null` (from the first entry) wins.
  - `WITHDRAWAL_RATE_NOTICE_KEY = 'fx.withdrawal_rate_notice'` (values `'due'` and `'shown'`).

- [ ] **Step 1: Write the failing test**

`packages/db/test/withdrawal-rate-migration.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccount, createDatabase, createWorkspace, type Database, migrate, MIGRATIONS } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { fxTablesExist, queueForeignRecalcTx, WITHDRAWAL_RATE_NOTICE_KEY } from '../src/repos/fx-tables';

/*
 * Migration 0071 (withdrawal rate, rulings R1 and R18). A database from before it: a lira cash account with money in
 * it, an empty euro wallet, a rupiah current account and a lira card. Invented figures.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function before0071(): Promise<Database> {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database, MIGRATIONS.filter((m) => m.version < 71));
  return database;
}

const columns = async (database: Database, table: string) => (await database.db.values<[number, string]>(sql.raw(`SELECT cid, name FROM pragma_table_info('${table}')`))).map((r) => r[1]);

describe('migration 0071 (withdrawal rate)', () => {
  it('is version 71 and named withdrawal_rate', () => {
    expect(MIGRATIONS.find((m) => m.version === 71)).toMatchObject({ name: 'withdrawal_rate' });
  });

  it('makes the five local tables with their columns', async () => {
    const database = await before0071();
    expect(await fxTablesExist(database.db)).toBe(false);
    await migrate(database);
    expect(await fxTablesExist(database.db)).toBe(true);
    expect(await columns(database, 'fx_lot_uses')).toEqual(['account_id', 'out_entry_id', 'lot_entry_id', 'minor', 'cost_base_minor']);
    expect(await columns(database, 'fx_shortfalls')).toEqual(['account_id', 'entry_id', 'uncovered_minor']);
    expect(await columns(database, 'fx_day_values')).toEqual(['entry_id', 'base_minor', 'rate']);
    expect(await columns(database, 'fx_gain_loss')).toEqual(['transaction_id', 'category_entry_id', 'exchange_entry_id']);
    expect(await columns(database, 'fx_recalc_pending')).toEqual(['account_id', 'from_date']);
  });

  it('queues every foreign money account that holds entries, from its first entry, and asks for the notice once', async () => {
    const database = await before0071();
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const lira = await createAccount(database, ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY', openingBalanceMinor: 50_000, openingRateToBase: 512, openedOn: '2026-11-01' });
    await createAccount(database, ws, { name: 'Euro wallet', kind: 'asset', subtype: 'cash', currency: 'EUR' });
    await createAccount(database, ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-11-01' });
    await createAccount(database, ws, { name: 'Lira card', kind: 'liability', subtype: 'credit_card', currency: 'TRY', openingBalanceMinor: 10_000, openingRateToBase: 512, openedOn: '2026-11-01' });
    // A household placeholder in lira, with money on it: another member's, never this phone's to recalculate (R2).
    const placeholder = await createAccount(database, ws, { name: 'Partner · TRY', kind: 'asset', subtype: 'cash', currency: 'TRY', openingBalanceMinor: 20_000, openingRateToBase: 512, openedOn: '2026-11-01' });
    await database.db.run(sql`INSERT INTO book_member_accounts (account_id, book_id, member_id, currency) VALUES (${placeholder.id}, 'book-x', 'member-x', 'TRY')`);
    await migrate(database);
    expect(await database.db.values(sql`SELECT account_id, from_date FROM fx_recalc_pending`)).toEqual([[lira.id, null]]);
    expect(await database.db.values(sql`SELECT value FROM settings WHERE key = ${WITHDRAWAL_RATE_NOTICE_KEY}`)).toEqual([['due']]);
  });

  it('asks for no notice where nothing is held in another currency', async () => {
    const database = await before0071();
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    await createAccount(database, ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-11-01' });
    await migrate(database);
    expect(await database.db.values(sql`SELECT count(*) FROM fx_recalc_pending`)).toEqual([[0]]);
    expect(await database.db.values(sql`SELECT value FROM settings WHERE key = ${WITHDRAWAL_RATE_NOTICE_KEY}`)).toEqual([]);
  });
});

describe('queueForeignRecalcTx', () => {
  it('keeps the earliest date, and from-the-start wins', async () => {
    const database = await before0071();
    await migrate(database);
    const read = () => database.db.values(sql`SELECT from_date FROM fx_recalc_pending WHERE account_id = 'acc-1'`);
    await database.transaction((tx) => queueForeignRecalcTx(tx, 'acc-1', '2026-11-09'));
    await database.transaction((tx) => queueForeignRecalcTx(tx, 'acc-1', '2026-11-12'));
    expect(await read()).toEqual([['2026-11-09']]);
    await database.transaction((tx) => queueForeignRecalcTx(tx, 'acc-1', '2026-11-02'));
    expect(await read()).toEqual([['2026-11-02']]);
    await database.transaction((tx) => queueForeignRecalcTx(tx, 'acc-1', null));
    await database.transaction((tx) => queueForeignRecalcTx(tx, 'acc-1', '2026-11-01'));
    expect(await read()).toEqual([[null]]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/db && npx vitest run test/withdrawal-rate-migration.test.ts`
Expected: FAIL — `../src/repos/fx-tables` cannot be resolved.

- [ ] **Step 3: Write the migration**

`packages/db/migrations/0071_withdrawal_rate.sql`:

```sql
/* Withdrawal rate (spec 2026-10-15 §6, rulings R1 and R18). Foreign money is spent at what it cost, oldest first; each
   entry keeps its cost-based figure in entries.amount_base_minor, rewritten in place by the recalculation. These five
   tables are this phone's own bookkeeping about that and never sync (none is a shared entity):

   - fx_lot_uses: which lots each outflow used, and what they cost (the receipt's "From the 12 Nov withdrawal", and the
     lots a move between pockets carries with their dates).
   - fx_shortfalls: what an outflow spent that no recorded withdrawal covers.
   - fx_day_values: the figure a line was first posted at, kept the first time a recalculation overwrites it; what an
     uncovered part is valued at (ruling R4).
   - fx_gain_loss: the gain or loss pair a recalculation added to an exchange (ruling R8).
   - fx_recalc_pending: accounts waiting to be recalculated — after sync apply (ruling R9), past the chain's limit
     (R10), and every foreign account once, on the first run after this update (R18).

   0070 belongs to another branch; the runner applies whatever is pending in version order. */

CREATE TABLE fx_lot_uses (
  account_id TEXT NOT NULL,
  out_entry_id TEXT NOT NULL,
  lot_entry_id TEXT NOT NULL,
  minor INTEGER NOT NULL CHECK (minor > 0),
  cost_base_minor INTEGER NOT NULL,
  PRIMARY KEY (out_entry_id, lot_entry_id)
);
CREATE INDEX fx_lot_uses_account ON fx_lot_uses (account_id);

CREATE TABLE fx_shortfalls (
  account_id TEXT NOT NULL,
  entry_id TEXT PRIMARY KEY,
  uncovered_minor INTEGER NOT NULL CHECK (uncovered_minor > 0)
);
CREATE INDEX fx_shortfalls_account ON fx_shortfalls (account_id);

CREATE TABLE fx_day_values (
  entry_id TEXT PRIMARY KEY,
  base_minor INTEGER NOT NULL,
  rate REAL NOT NULL
);

CREATE TABLE fx_gain_loss (
  transaction_id TEXT PRIMARY KEY,
  category_entry_id TEXT NOT NULL,
  exchange_entry_id TEXT NOT NULL
);

CREATE TABLE fx_recalc_pending (
  account_id TEXT PRIMARY KEY,
  /* NULL: from the account's first entry. */
  from_date TEXT
);

/* The first run (R18): every foreign money account of the owner's own that holds entries. The money kinds are
   CASH_ITEMS (R2); a household placeholder is another member's. */
INSERT INTO fx_recalc_pending (account_id, from_date)
SELECT a.id, NULL
FROM accounts a
JOIN workspaces w ON w.id = a.workspace_id
WHERE a.kind = 'asset'
  AND a.subtype IN ('cash', 'bank', 'savings', 'time_deposit', 'ewallet', 'fund', 'other_cash')
  AND a.currency IS NOT NULL
  AND a.currency <> w.base_currency
  AND a.id NOT IN (SELECT account_id FROM book_member_accounts)
  AND EXISTS (SELECT 1 FROM entries e WHERE e.account_id = a.id);

INSERT OR IGNORE INTO settings (key, value)
SELECT 'fx.withdrawal_rate_notice', 'due' WHERE EXISTS (SELECT 1 FROM fx_recalc_pending);
```

- [ ] **Step 4: Register it**

In `packages/db/src/migrations.ts`, after `import sharedEvents from '../migrations/0069_shared_events.sql?raw';` add:

```ts
import withdrawalRate from '../migrations/0071_withdrawal_rate.sql?raw';
```

and after `{ version: 69, name: 'shared_events', sql: sharedEvents },` add:

```ts
  // 0070 is another branch's (withdrawal rate ruling R1).
  { version: 71, name: 'withdrawal_rate', sql: withdrawalRate },
```

- [ ] **Step 5: Write `fx-tables.ts`**

`packages/db/src/repos/fx-tables.ts`:

```ts
import { sql } from 'drizzle-orm';
import type { Db } from '../database';

/*
 * Migration 0071's five local tables (withdrawal rate, ruling R1). Every reader and writer asks first: a database stopped
 * before 0071 — a migration test, a half-applied upgrade — posts, lists and syncs exactly as it did, with every foreign
 * entry at the day's rate.
 */

const known = new WeakMap<object, true>();

/** Whether this database has the withdrawal-rate tables. Once seen it is remembered: a table is never taken away. */
export async function fxTablesExist(db: Db): Promise<boolean> {
  if (known.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fx_recalc_pending'`);
  if (rows.length === 0) return false;
  known.set(db, true);
  return true;
}

/** Where the first-run notice waits (R18): 'due' until shown, then 'shown'. A local setting, never synced. */
export const WITHDRAWAL_RATE_NOTICE_KEY = 'fx.withdrawal_rate_notice';

/**
 * Puts an account in the queue to be recalculated later (rulings R9, R10), from the earliest date asked for; `null`,
 * from its first entry, wins over any date. In the caller's transaction, so a write that rolls back queues nothing.
 */
export async function queueForeignRecalcTx(db: Db, accountId: string, fromDate: string | null): Promise<void> {
  await db.run(sql`
    INSERT INTO fx_recalc_pending (account_id, from_date) VALUES (${accountId}, ${fromDate})
    ON CONFLICT (account_id) DO UPDATE SET from_date = CASE
      WHEN fx_recalc_pending.from_date IS NULL OR excluded.from_date IS NULL THEN NULL
      WHEN excluded.from_date < fx_recalc_pending.from_date THEN excluded.from_date
      ELSE fx_recalc_pending.from_date
    END`);
}
```

- [ ] **Step 6: Run the test, then the suites that pin the migration list**

Run: `cd packages/db && npx vitest run test/withdrawal-rate-migration.test.ts test/migration-safety.test.ts && cd ../.. && npm run test -w @expanses/web -- src/db`
Expected: PASS (`migration-safety` and the web bootstrap test read `LATEST_VERSION`, which is now 71).

- [ ] **Step 7: Commit**

```bash
git add packages/db/migrations/0071_withdrawal_rate.sql packages/db/src/migrations.ts packages/db/src/repos/fx-tables.ts packages/db/test/withdrawal-rate-migration.test.ts
git commit -m "Migration 0071: five local tables for the withdrawal rate, every foreign money account queued once for the first run, and the one notice that says so

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Capture — work left for the end of a db transaction, and the revaluation door

Spec §6 ("captured for household sync as a money-field change", "inside the same db transaction", "Household sync"); rulings R9, R16. Only `capture.ts` changes.

**Files:**
- Modify: `packages/db/src/sync/capture.ts` (the `CaptureSession` class; three exported functions added after `withCaptureSuspended`; one door added after `captureReorderingTx`)
- Test: `packages/db/test/sync/capture-steps.test.ts`

**Interfaces:**
- Consumes: the existing `CaptureSession`, `sessionOf`, `lineageOfTransaction`, `lineageRowOf`, `bookOfTransaction`.
- Produces (exported from `packages/db/src/sync/capture.ts`; the repos import them by path, as `ledger.ts` imports `capturePostedTx`):
  - `beforeFlushTx(tx: Db, key: string, step: () => Promise<void>): boolean` — runs `step` once per key at the start of `flush()` (before summaries, before lineages, paused or not); `false` when `tx` has no session.
  - `sessionValueTx<T>(tx: Db, key: string, make: () => T): T | null` — a value kept for the rest of this db transaction; `null` with no session.
  - `capturePausedTx(tx: Db): boolean` — true when this transaction's capture was paused by apply (`withCapturePaused`) or suspended, while capture is on for the database; false when capture is off for the whole database.
  - `captureRevaluingTx(tx: Db, transactionId: string): Promise<void>` — called before a transaction's lines are rewritten in place (and again right after it is filed into a book): touches its lineage when it is in an active shared book, so the flush sends the difference as a purchase `money` change; never throws for a read-only book (R16).

- [ ] **Step 1: Write the failing tests**

`packages/db/test/sync/capture-steps.test.ts`:

```ts
import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, listAccounts, personalBook, postTransaction } from '../../src/index';
import { beforeFlushTx, captureRevaluingTx, capturePausedTx, configureCapture, sessionValueTx, withCapturePaused } from '../../src/sync/capture';
import { setupDb } from '../helpers';
import { clearOutbox, outboxOps, shareBookForTest } from './sync-helpers';

/* Withdrawal rate §6 and ruling R9: the recalculation runs at the end of the db transaction, and what it rewrites in
   place in a shared book goes out like any other change to a purchase. Invented figures. */

describe('a step left for the end of a db transaction', () => {
  it('runs once per key, before COMMIT, inside the same transaction', async () => {
    const { database } = await setupDb();
    const ran: string[] = [];
    await database.transaction(async (tx) => {
      expect(
        beforeFlushTx(tx, 'k', async () => {
          ran.push('k');
          await tx.run(sql`INSERT INTO settings (key, value) VALUES ('test.step', 'written')`);
        }),
      ).toBe(true);
      beforeFlushTx(tx, 'k', async () => void ran.push('again'));
      expect(ran).toEqual([]);
    });
    expect(ran).toEqual(['k']);
    expect(await database.db.values(sql`SELECT value FROM settings WHERE key = 'test.step'`)).toEqual([['written']]);
  });

  it('runs a step another step leaves', async () => {
    const { database } = await setupDb();
    const ran: string[] = [];
    await database.transaction(async (tx) => {
      beforeFlushTx(tx, 'first', async () => {
        ran.push('first');
        beforeFlushTx(tx, 'second', async () => void ran.push('second'));
      });
    });
    expect(ran).toEqual(['first', 'second']);
  });

  it('takes the whole transaction back when a step fails', async () => {
    const { database } = await setupDb();
    await expect(
      database.transaction(async (tx) => {
        await tx.run(sql`INSERT INTO settings (key, value) VALUES ('test.write', 'kept?')`);
        beforeFlushTx(tx, 'k', async () => {
          throw new Error('step failed');
        });
      }),
    ).rejects.toThrow('step failed');
    expect(await database.db.values(sql`SELECT value FROM settings WHERE key = 'test.write'`)).toEqual([]);
  });

  it('keeps a value for the rest of its transaction only', async () => {
    const { database } = await setupDb();
    const seen = await database.transaction(async (tx) => {
      sessionValueTx(tx, 'bag', () => ({ n: 0 }))!.n += 1;
      return sessionValueTx(tx, 'bag', () => ({ n: 0 }))!.n;
    });
    expect(seen).toBe(1);
    expect(await database.transaction(async (tx) => sessionValueTx(tx, 'bag', () => ({ n: 0 }))!.n)).toBe(0);
  });

  it('knows when apply paused capture, and not when capture is off for the whole database', async () => {
    const { database } = await setupDb();
    expect(await database.transaction(async (tx) => capturePausedTx(tx))).toBe(false);
    expect(await database.transaction((tx) => withCapturePaused(tx, async () => capturePausedTx(tx)))).toBe(true);
    configureCapture(database, { enabled: false });
    expect(await database.transaction((tx) => withCapturePaused(tx, async () => capturePausedTx(tx)))).toBe(false);
  });
});

describe('captureRevaluingTx', () => {
  async function liraPurchase() {
    const t = await setupDb();
    const book = await personalBook(t.database, t.ws);
    // The capture run shares every first Personal book from birth; this test shares it itself, as household.ts does.
    await t.database.execScript('DELETE FROM shared_books');
    await shareBookForTest(t.database, book.id);
    const lira = (await createAccount(t.database, t.ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
    const restaurants = (await listAccounts(t.database, t.ws)).find((a) => a.name === 'Restaurants')!.id;
    const id = await postTransaction(t.database, t.ws, {
      occurredOn: '2026-11-03',
      description: 'Dinner',
      lines: expenseLines({ categoryAccountId: restaurants, paymentAccountId: lira, amountMinor: 45_000, currency: 'TRY' }),
      ratesToBase: { TRY: 512 },
    });
    await clearOutbox(t.database);
    return { ...t, lira, restaurants, id };
  }

  it('sends a shared purchase whose base figures were rewritten in place as a money change', async () => {
    const { database, lira, restaurants, id } = await liraPurchase();
    await database.transaction(async (tx) => {
      await captureRevaluingTx(tx, id);
      await tx.run(sql`UPDATE entries SET amount_base_minor = -236250 WHERE transaction_id = ${id} AND account_id = ${lira}`);
      await tx.run(sql`UPDATE entries SET amount_base_minor = 236250 WHERE transaction_id = ${id} AND account_id = ${restaurants}`);
    });
    const ops = (await outboxOps(database)).filter((op) => op.entity === 'purchase');
    expect(ops).toHaveLength(1);
    const fields = (ops[0] as { fields: { money: { lines: { amountBaseMinor: number }[] } } }).fields;
    expect(Object.keys(fields)).toEqual(['money']);
    expect(fields.money.lines.map((line) => line.amountBaseMinor)).toEqual([236_250]);
  });

  it('sends nothing when no figure moved', async () => {
    const { database, id } = await liraPurchase();
    await database.transaction((tx) => captureRevaluingTx(tx, id));
    expect(await outboxOps(database)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/db && npx vitest run test/sync/capture-steps.test.ts`
Expected: FAIL — `beforeFlushTx` is not exported from `capture.ts`.

- [ ] **Step 3: Give `CaptureSession` its steps and values**

In `packages/db/src/sync/capture.ts`, inside `class CaptureSession`, after the field `private readonly dirtyTransactions = new Set<string>();` add:

```ts
  /**
   * Work a write leaves for the end of its db transaction (withdrawal rate, ruling R9): run by `flush` first, before
   * summaries and lineages, paused or not, so what a step writes is captured exactly like the write that asked for it.
   */
  private readonly steps = new Map<string, () => Promise<void>>();
  /** Values kept for the rest of this db transaction, by key (`sessionValueTx`). */
  private readonly values = new Map<string, unknown>();
```

add these two methods after `markTransactionDirty`:

```ts
  addStep(key: string, step: () => Promise<void>): void {
    if (!this.steps.has(key)) this.steps.set(key, step);
  }

  valueOf<T>(key: string, make: () => T): T {
    if (!this.values.has(key)) this.values.set(key, make());
    return this.values.get(key) as T;
  }

  /** Paused by apply or suspended, while capture is on for the database (`capturePausedTx`). */
  get paused(): boolean {
    return this.config.enabled && !this.enabled;
  }
```

and make `flush()` start with the steps — replace its first line `await this.sendDirtySummaries();` with:

```ts
    // Steps first (withdrawal rate R9): a step may leave another, and what any of them writes is captured below.
    while (this.steps.size > 0) {
      const [key, step] = this.steps.entries().next().value as [string, () => Promise<void>];
      this.steps.delete(key);
      await step();
    }
    await this.sendDirtySummaries();
```

- [ ] **Step 4: Export the three helpers**

After `withCaptureSuspended` in `packages/db/src/sync/capture.ts` add:

```ts
/**
 * Runs `step` at the end of this db transaction, before anything in it is captured, once per `key` (withdrawal rate,
 * ruling R9). False when `tx` is not inside `Database.transaction` (there is no end to wait for): the caller runs it now.
 */
export function beforeFlushTx(tx: Db, key: string, step: () => Promise<void>): boolean {
  const session = sessionOf(tx);
  if (!session) return false;
  session.addStep(key, step);
  return true;
}

/** A value kept for the rest of this db transaction under `key`, made by `make` the first time; null outside one. */
export function sessionValueTx<T>(tx: Db, key: string, make: () => T): T | null {
  return sessionOf(tx)?.valueOf(key, make) ?? null;
}

/**
 * Whether this transaction writes with capture paused — apply writing what another device already sent — while capture
 * is on for the database. A recalculation then waits for a transaction of its own (ruling R9): figures rewritten here
 * would never be sent, and the partner would keep the old ones. With capture off for the whole database there is
 * nothing to send, so nothing waits.
 */
export function capturePausedTx(tx: Db): boolean {
  return sessionOf(tx)?.paused ?? false;
}
```

- [ ] **Step 5: Add the revaluation door**

After `captureReorderingTx` in `packages/db/src/sync/capture.ts` add:

```ts
/**
 * The withdrawal rate's in-place door (spec §6): called before a transaction's base figures — and an exchange's gain or
 * loss pair — are rewritten in place, and once more right after the transaction is filed into a book, so a purchase in
 * a shared book goes out with its new figures as a `money` change (or, newly filed, as a new purchase; unfiled, as a
 * void). Every figure is money, so its accounts' summaries are recomputed too. Never refuses a book that is no longer
 * shared (§8.6): a revaluation is this phone's own bookkeeping, kept here and sent nowhere (ruling R16).
 */
export async function captureRevaluingTx(tx: Db, transactionId: string): Promise<void> {
  const session = sessionOf(tx);
  if (!session) return;
  session.markTransactionDirty(transactionId);
  const books = await session.sharedBooks();
  if (books.length === 0) return;
  const bookId = await bookOfTransaction(tx, transactionId);
  const lineageId = await lineageOfTransaction(tx, transactionId);
  const inShared = (bookId && books.some((b) => b.bookId === bookId)) || (await lineageRowOf(tx, lineageId)) !== null;
  if (inShared) await session.touchLineage(lineageId, transactionId);
}
```

- [ ] **Step 6: Run the tests, the sync suite and the capture run**

Run: `cd packages/db && npx vitest run test/sync/capture-steps.test.ts test/sync/capture.test.ts && cd ../.. && npm run test:capture`
Expected: PASS. Nothing calls a step yet, so every existing test is unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/sync/capture.ts packages/db/test/sync/capture-steps.test.ts
git commit -m "Capture runs work left for the end of a db transaction before it captures, knows when apply paused it, and sends a purchase whose base figures were rewritten in place as a money change

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 5: The exchange gain or loss pair

Spec §5; rulings R7, R8, R16.

**Files:**
- Create: `packages/db/src/repos/fx-gain-loss.ts`
- Test: `packages/db/test/fx-gain-loss.test.ts`

**Interfaces:**
- Consumes: `EXCHANGE_GAIN_KEY`, `EXCHANGE_GAIN_NAME`, `EXCHANGE_LOSS_KEY`, `EXCHANGE_LOSS_NAME` (Task 1); `captureRevaluingTx(tx, transactionId)` (Task 4); `ensureCategoryByKeyTx(tx, ws, { key, name, kind, parentKey? })` from `repos/categories.ts`; `ensureSystemAccountTx(tx, ws, 'currency_exchange')` from `repos/accounts.ts`; `hasBooks`, `personalBookIdTx` from `repos/books.ts`; `eventPostingOfTx` from `repos/event-only.ts`.
- Produces (`packages/db/src/repos/fx-gain-loss.ts`):
  - `interface GainLossPair { categoryEntryId: string; exchangeEntryId: string; amountMinor: number; key: string | null }`
  - `gainLossPairOfTx(db: Db, transactionId: string): Promise<GainLossPair | null>`
  - `exchangeCategoryTx(db: Db, ws: WorkspaceContext, gain: boolean): Promise<string>`
  - `writeGainLossTx(db: Db, ws: WorkspaceContext, transactionId: string, gainLossBaseMinor: number): Promise<boolean>` — `true` when it wrote anything. Calls `captureRevaluingTx` before it writes.

- [ ] **Step 1: Write the failing tests**

`packages/db/test/fx-gain-loss.test.ts`:

```ts
import { transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { checkLedgerIntegrity, createAccount, personalBook, postTransaction } from '../src/index';
import { gainLossPairOfTx, writeGainLossTx } from '../src/repos/fx-gain-loss';
import { setupDb } from './helpers';
import { clearOutbox, outboxOps, shareBookForTest } from './sync/sync-helpers';

/*
 * Withdrawal rate §5, ruling R8. The pair is written onto a plain rupiah transfer here so nothing else touches it: the
 * figures it is given are invented, and which exchange earns them is Task 6's.
 */
async function setup() {
  const t = await setupDb();
  const bank = (await createAccount(t.database, t.ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-11-01' })).id;
  const wallet = (await createAccount(t.database, t.ws, { name: 'Rupiah wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' })).id;
  const id = await postTransaction(t.database, t.ws, { occurredOn: '2026-11-20', description: 'Back to rupiah', lines: transferLines({ fromAccountId: bank, toAccountId: wallet, amountMinor: 250_000, currency: 'IDR' }) });
  const personal = await personalBook(t.database, t.ws);
  const pair = () =>
    t.database.db.values<[string | null, string, number, string, number]>(sql`
      SELECT a.system_key, a.name, e.amount_minor, e.currency, e.amount_base_minor FROM entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = ${id} AND (a.kind IN ('income', 'expense') OR a.system_key = 'currency_exchange') ORDER BY e.amount_minor`);
  const filed = () => t.database.db.values<[string]>(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${id}`);
  const write = (gainLossBaseMinor: number) => t.database.transaction((tx) => writeGainLossTx(tx, t.ws, id, gainLossBaseMinor));
  return { ...t, id, personal, pair, filed, write };
}

describe('writeGainLossTx (§5, R8)', () => {
  it('books a loss on Exchange loss against the exchange account, and files the transfer in Personal', async () => {
    const t = await setup();
    expect(await t.write(-12_500)).toBe(true);
    expect(await t.pair()).toEqual([
      ['currency_exchange', 'Currency Exchange', -12_500, 'IDR', -12_500],
      ['expense.exchange_loss', 'Exchange loss', 12_500, 'IDR', 12_500],
    ]);
    expect(await t.filed()).toEqual([[t.personal.id]]);
    expect(await checkLedgerIntegrity(t.database, t.ws)).toEqual([]);
    const [category] = await t.database.db.values<[string]>(sql`SELECT bc.book_id FROM accounts a JOIN book_categories bc ON bc.category_account_id = a.id WHERE a.system_key = 'expense.exchange_loss'`);
    expect(category).toEqual([t.personal.id]);
  });

  it('writes nothing for the same figure, replaces the pair for a new one, and moves it to Exchange gain for a gain', async () => {
    const t = await setup();
    await t.write(-12_500);
    expect(await t.write(-12_500)).toBe(false);
    await t.write(-10_000);
    expect((await t.pair()).map((row) => row[2])).toEqual([-10_000, 10_000]);
    await t.write(7_500);
    expect(await t.pair()).toEqual([
      ['income.exchange_gain', 'Exchange gain', -7_500, 'IDR', -7_500],
      ['currency_exchange', 'Currency Exchange', 7_500, 'IDR', 7_500],
    ]);
    expect(await t.database.db.values(sql`SELECT count(*) FROM fx_gain_loss WHERE transaction_id = ${t.id}`)).toEqual([[1]]);
    expect((await t.database.transaction((tx) => gainLossPairOfTx(tx, t.id)))?.key).toBe('income.exchange_gain');
  });

  it('takes the pair away at zero, and the transfer back out of every workspace', async () => {
    const t = await setup();
    await t.write(-12_500);
    expect(await t.write(0)).toBe(true);
    expect(await t.pair()).toEqual([]);
    expect(await t.filed()).toEqual([]);
    expect(await t.write(0)).toBe(false);
  });

  it('makes each category once, by its key', async () => {
    const t = await setup();
    for (const figure of [-1, 1, -2, 2]) await t.write(figure);
    expect(await t.database.db.values(sql`SELECT system_key, count(*) FROM accounts WHERE system_key IN ('income.exchange_gain', 'expense.exchange_loss') GROUP BY system_key ORDER BY system_key`)).toEqual([
      ['expense.exchange_loss', 1],
      ['income.exchange_gain', 1],
    ]);
  });

  it('keeps a shared event’s own transaction out of every workspace, pair and all (R7)', async () => {
    const t = await setup();
    await t.database.db.run(sql`INSERT INTO event_postings (book_id, record_id, kind, transaction_id) VALUES ('ev-book', 'rec-1', 'expense', ${t.id})`);
    await t.write(-500);
    expect((await t.pair()).length).toBe(2);
    expect(await t.filed()).toEqual([]);
  });

  it('in a shared Personal book, sends the newly filed transfer as a purchase and its unfiling as a void', async () => {
    const t = await setup();
    // The capture run shares every first Personal book from birth; this test shares it itself, as household.ts does.
    await t.database.execScript('DELETE FROM shared_books');
    await shareBookForTest(t.database, t.personal.id);
    await clearOutbox(t.database);
    await t.write(-12_500);
    const sent = (await outboxOps(t.database)).filter((op) => op.entity === 'purchase' && op.id === t.id);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain('12500');
    await clearOutbox(t.database);
    await t.write(0);
    expect((await outboxOps(t.database)).filter((op) => op.entity === 'purchase' && op.id === t.id).map((op) => (op as { fields: unknown }).fields)).toEqual([{ void: true }]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/db && npx vitest run test/fx-gain-loss.test.ts`
Expected: FAIL — `../src/repos/fx-gain-loss` cannot be resolved.

- [ ] **Step 3: Write `fx-gain-loss.ts`**

`packages/db/src/repos/fx-gain-loss.ts`:

```ts
import { EXCHANGE_GAIN_KEY, EXCHANGE_GAIN_NAME, EXCHANGE_LOSS_KEY, EXCHANGE_LOSS_NAME, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { entries } from '../schema';
import { captureRevaluingTx } from '../sync/capture';
import { ensureSystemAccountTx } from './accounts';
import { hasBooks, personalBookIdTx } from './books';
import { ensureCategoryByKeyTx } from './categories';
import { eventPostingOfTx } from './event-only';

/*
 * The exchange gain or loss (withdrawal rate §5, ruling R8): one line on Exchange gain or Exchange loss in the owner's
 * base currency, and one on the exchange account that balances it, recorded in `fx_gain_loss` so the recalculation can
 * find, change or take away exactly its own two lines and never one an exchange was posted with. The transfer it sits
 * on is filed in Personal while it has the pair (the book `bookOfCategories` would find for that category), unless it
 * is a shared event's own transaction or a partner transfer's posting, which belong to no workspace (R7).
 */

export interface GainLossPair {
  categoryEntryId: string;
  exchangeEntryId: string;
  /** The category line's amount: negative for a gain (income is credited), positive for a loss. */
  amountMinor: number;
  key: string | null;
}

export async function gainLossPairOfTx(db: Db, transactionId: string): Promise<GainLossPair | null> {
  const [row] = await db.values<[string, string, number, string | null]>(sql`
    SELECT g.category_entry_id, g.exchange_entry_id, e.amount_minor, a.system_key
    FROM fx_gain_loss g JOIN entries e ON e.id = g.category_entry_id JOIN accounts a ON a.id = e.account_id
    WHERE g.transaction_id = ${transactionId}`);
  return row ? { categoryEntryId: row[0], exchangeEntryId: row[1], amountMinor: Number(row[2]), key: row[3] } : null;
}

/** Personal's Exchange gain or Exchange loss, made there the first time one is needed (the ensure-by-key path, R8). */
export function exchangeCategoryTx(db: Db, ws: WorkspaceContext, gain: boolean): Promise<string> {
  const personal: WorkspaceContext = { workspaceId: ws.workspaceId, baseCurrency: ws.baseCurrency };
  return ensureCategoryByKeyTx(
    db,
    personal,
    gain ? { key: EXCHANGE_GAIN_KEY, name: EXCHANGE_GAIN_NAME, kind: 'income' } : { key: EXCHANGE_LOSS_KEY, name: EXCHANGE_LOSS_NAME, kind: 'expense' },
  );
}

/** A shared event's derived transaction, or this phone's side of a transfer with a partner: in no workspace, ever. */
async function inNoWorkspaceTx(db: Db, transactionId: string): Promise<boolean> {
  if (await eventPostingOfTx(db, transactionId)) return true;
  const table = await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'member_transfer_postings'`);
  if (table.length === 0) return false;
  return (await db.values(sql`SELECT 1 FROM member_transfer_postings WHERE transaction_id = ${transactionId}`)).length > 0;
}

/**
 * Makes `transactionId` carry exactly this gain (positive) or loss (negative), or no pair at zero. Returns whether it
 * wrote anything. The capture door is called before the first write, and again once the transaction is filed: a
 * transfer newly in a shared Personal book goes out as a purchase, and one leaving it as a void (Task 4).
 */
export async function writeGainLossTx(db: Db, ws: WorkspaceContext, transactionId: string, gainLossBaseMinor: number): Promise<boolean> {
  if (!Number.isSafeInteger(gainLossBaseMinor)) throw new Error(`An exchange gain or loss is a whole number of minor units, got ${gainLossBaseMinor}`);
  const pair = await gainLossPairOfTx(db, transactionId);
  const key = gainLossBaseMinor > 0 ? EXCHANGE_GAIN_KEY : EXCHANGE_LOSS_KEY;
  if (!pair && gainLossBaseMinor === 0) return false;
  if (pair && gainLossBaseMinor !== 0 && pair.amountMinor === -gainLossBaseMinor && pair.key === key) return false;

  await captureRevaluingTx(db, transactionId);
  if (pair) {
    await db.run(sql`DELETE FROM entries WHERE id IN (${pair.categoryEntryId}, ${pair.exchangeEntryId})`);
    await db.run(sql`DELETE FROM fx_gain_loss WHERE transaction_id = ${transactionId}`);
  }
  if (gainLossBaseMinor === 0) {
    // Back to a plain transfer: filed nowhere once it has no category line left, as the ledger would have filed it.
    const [category] = await db.values(sql`
      SELECT 1 FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${transactionId} AND a.kind IN ('income', 'expense') LIMIT 1`);
    if (!category && (await hasBooks(db))) await db.run(sql`DELETE FROM book_transactions WHERE transaction_id = ${transactionId}`);
    return true;
  }

  const categoryId = await exchangeCategoryTx(db, ws, gainLossBaseMinor > 0);
  const exchangeId = await ensureSystemAccountTx(db, ws, 'currency_exchange');
  const categoryEntryId = uuidv7();
  const exchangeEntryId = uuidv7();
  const line = (id: string, accountId: string, amountMinor: number) => ({
    id,
    workspaceId: ws.workspaceId,
    transactionId,
    accountId,
    amountMinor,
    currency: ws.baseCurrency,
    fxRateToBase: 1,
    amountBaseMinor: amountMinor,
    memo: null,
    spendCategoryId: null,
  });
  await db.insert(entries).values([line(categoryEntryId, categoryId, -gainLossBaseMinor), line(exchangeEntryId, exchangeId, gainLossBaseMinor)]);
  await db.run(sql`INSERT INTO fx_gain_loss (transaction_id, category_entry_id, exchange_entry_id) VALUES (${transactionId}, ${categoryEntryId}, ${exchangeEntryId})`);

  if ((await hasBooks(db)) && !(await inNoWorkspaceTx(db, transactionId))) {
    const [filed] = await db.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${transactionId}`);
    const personal = filed ? null : await personalBookIdTx(db, ws.workspaceId);
    if (personal) {
      await db.run(sql`INSERT INTO book_transactions (transaction_id, workspace_id, book_id) VALUES (${transactionId}, ${ws.workspaceId}, ${personal})`);
      await captureRevaluingTx(db, transactionId);
    }
  }
  return true;
}
```

- [ ] **Step 4: Run the tests and the capture run**

Run: `cd packages/db && npx vitest run test/fx-gain-loss.test.ts && npx vitest run --config vitest.capture.config.ts test/fx-gain-loss.test.ts`
Expected: PASS in both runs (`event_postings` takes the four-column insert: its other columns are nullable in 0069).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repos/fx-gain-loss.ts packages/db/test/fx-gain-loss.test.ts
git commit -m "An exchange's gain or loss is one line on Personal's Exchange gain or Exchange loss and one on the exchange account, filing the transfer in Personal while it has them

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6: The recalculation — `recalcForeignTx`

Spec §3–§6 ("`recalcForeignTx(tx, ws, accountId, fromDate)` … reads that account's posted entries …, runs `fifoCosts`, and writes"); rulings R2, R4–R7, R10, R11, R14, R16, R17. This task writes the recalculation and calls it by hand in its tests; Task 7 wires it to every door.

**Files:**
- Create: `packages/db/src/repos/fx-costs.ts`
- Modify: `packages/db/src/index.ts` (three export lines after `export * from './repos/fx';`)
- Test: `packages/db/test/withdrawal-rate.test.ts`

**Interfaces:**
- Consumes: `fifoCosts`, `classifyInflow`, `revalueTransaction`, `isFxLotAccount`, `FX_LOT_SUBTYPES`, `FxError`, types `FxLine`, `FxLotPart`, `FxMovement`, `FxRole`, `FifoResult` (Tasks 1–2); `fxTablesExist`, `queueForeignRecalcTx` (Task 3); `captureRevaluingTx` (Task 4); `writeGainLossTx` (Task 5); `dayOrderExists` (`day-order-column.ts`); `sharingTablesExist` (`sync/placeholder.ts`).
- Produces (`packages/db/src/repos/fx-costs.ts`, all re-exported from `@expanses/db`):
  - `MAX_CHAIN = 64`
  - `interface FxTxLine extends FxLine { transactionId: string; accountId: string; occurredOn: string; dayOrder: number | null; createdAt: string; fxRateToBase: number }`
  - `isLotAccountTx(db: Db, ws: WorkspaceContext, accountId: string): Promise<{ currency: string } | null>`
  - `linesTouchingTx(db: Db, ws: WorkspaceContext, accountId: string, opts?: { excludeTransactionId?: string | null }): Promise<FxTxLine[]>` — every line of every posted transaction touching the account, gain or loss pairs left out, each with its role.
  - `movementsOfTx(db: Db, ws: WorkspaceContext, accountId: string, lines: readonly FxTxLine[]): Promise<{ movements: FxMovement[]; inCosts: Map<string, Record<string, number>>; byTransaction: Map<string, FxTxLine[]> }>`
  - `recalcAccountTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<{ changedTransactions: string[]; chain: { accountId: string; fromDate: string }[] }>`
  - `recalcForeignTx(tx: Db, ws: WorkspaceContext, accountId: string, fromDate: string | null, opts?: { maxSteps?: number }): Promise<{ steps: number; changedTransactions: string[] }>`

- [ ] **Step 1: Write the failing tests**

`packages/db/test/withdrawal-rate.test.ts`:

```ts
import { exchangeLines, expenseLines, splitExpenseLines, transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { checkLedgerIntegrity, createAccount, isLotAccountTx, listAccounts, MAX_CHAIN, personalBook, postTransaction, recalcForeignTx, systemAccountId } from '../src/index';
import { setupDb } from './helpers';
import { clearOutbox, outboxOps, shareBookForTest } from './sync/sync-helpers';

/*
 * Withdrawal rate §3–§6. A rupiah book with lira cash, a lira wallet and euro cash; the day's rates are invented (512
 * rupiah a lira, 17.500 a euro), and so is every withdrawal (525, 540).
 */
const RATES = { TRY: 512, EUR: 17_500 };

async function trip() {
  const t = await setupDb();
  const all = await listAccounts(t.database, t.ws);
  const category = (name: string) => all.find((a) => a.name === name && a.kind === 'expense')!.id;
  const bank = (await createAccount(t.database, t.ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-10-01' })).id;
  const lira = (await createAccount(t.database, t.ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
  const wallet = (await createAccount(t.database, t.ws, { name: 'Lira wallet', kind: 'asset', subtype: 'ewallet', currency: 'TRY' })).id;
  const euros = (await createAccount(t.database, t.ws, { name: 'Euro cash', kind: 'asset', subtype: 'cash', currency: 'EUR' })).id;
  const exchange = await systemAccountId(t.database.db, t.ws, 'currency_exchange');
  const post = (occurredOn: string, description: string, lines: Parameters<typeof postTransaction>[2]['lines']) => postTransaction(t.database, t.ws, { occurredOn, description, lines, ratesToBase: RATES });
  /** Rupiah into lira at an ATM: `idr` left the bank, `kurus` arrived. */
  const withdraw = (occurredOn: string, idr: number, kurus: number, into = lira) =>
    post(occurredOn, 'ATM', exchangeLines({ fromAccountId: bank, fromAmountMinor: idr, fromCurrency: 'IDR', toAccountId: into, toAmountMinor: kurus, toCurrency: 'TRY', exchangeAccountId: exchange }));
  const spend = (occurredOn: string, kurus: number, from = lira, name = 'Restaurants') =>
    post(occurredOn, 'Dinner', expenseLines({ categoryAccountId: category(name), paymentAccountId: from, amountMinor: kurus, currency: 'TRY' }));
  const move = (occurredOn: string, kurus: number, from: string, to: string) => post(occurredOn, 'Between pockets', transferLines({ fromAccountId: from, toAccountId: to, amountMinor: kurus, currency: 'TRY' }));
  const recalc = (accountId = lira, fromDate: string | null = null, maxSteps?: number) =>
    t.database.transaction((tx) => recalcForeignTx(tx, t.ws, accountId, fromDate, maxSteps === undefined ? {} : { maxSteps }));
  /** A spend's two figures by account (an exchange has two lines on the exchange account: read those with `exchangeBase`). */
  const bases = async (transactionId: string) =>
    Object.fromEntries((await t.database.db.values<[string, number]>(sql`SELECT account_id, amount_base_minor FROM entries WHERE transaction_id = ${transactionId}`)).map(([a, b]) => [a, Number(b)]));
  const exchangeBase = async (transactionId: string) =>
    Number((await t.database.db.values<[number]>(sql`SELECT coalesce(sum(amount_base_minor), 0) FROM entries WHERE transaction_id = ${transactionId} AND account_id = ${exchange}`))[0]![0]);
  const resultLine = (transactionId: string) =>
    t.database.db.values<[string, number]>(sql`
      SELECT a.system_key, e.amount_minor FROM entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = ${transactionId} AND a.system_key IN ('income.exchange_gain', 'expense.exchange_loss')`);
  const revalued = async () => Number((await t.database.db.values<[number]>(sql`SELECT count(*) FROM audit_log WHERE action = 'revalue'`))[0]![0]);
  return { ...t, category, bank, lira, wallet, euros, exchange, post, withdraw, spend, move, recalc, bases, exchangeBase, resultLine, revalued };
}

describe('recalcForeignTx: spending (§4)', () => {
  it('spends lira withdrawn at 525 at 525, not at the day’s 512, and the withdrawal costs the rupiah that left', async () => {
    const t = await trip();
    const atm = await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const dinner = await t.spend('2026-11-03', 45_000);
    await t.recalc();
    expect(await t.bases(dinner)).toEqual({ [t.lira]: -236_250, [t.category('Restaurants')]: 236_250 });
    expect((await t.bases(atm))[t.lira]).toBe(5_250_000);
    expect(await t.exchangeBase(atm)).toBe(0);
    expect(await t.database.db.values(sql`SELECT fx_rate_to_base FROM entries WHERE transaction_id = ${dinner} AND account_id = ${t.lira}`)).toEqual([[525]]);
  });

  it('adds a three-way split up to the money line exactly, the remainder on the largest line (Review Focus 4)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const market = await t.post(
      '2026-11-03',
      'Market',
      splitExpenseLines({
        paymentAccountId: t.lira,
        currency: 'TRY',
        splits: [
          { categoryAccountId: t.category('Restaurants'), amountMinor: 10_000 },
          { categoryAccountId: t.category('Groceries'), amountMinor: 10_000 },
          { categoryAccountId: t.category('Hotels'), amountMinor: 10_001 },
        ],
      }),
    );
    await t.recalc();
    const b = await t.bases(market);
    expect(b[t.lira]).toBe(-157_505);
    expect([b[t.category('Restaurants')], b[t.category('Groceries')], b[t.category('Hotels')]]).toEqual([52_499, 52_499, 52_507]);
  });

  it('spends the oldest withdrawal first', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 52_500, 10_000);
    await t.withdraw('2026-11-09', 54_000, 10_000);
    const dinner = await t.spend('2026-11-12', 15_000);
    await t.recalc();
    expect((await t.bases(dinner))[t.lira]).toBe(-79_500);
  });

  it('values what no withdrawal covers at its posted figure, and records the shortfall (R4)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 105_000, 20_000);
    const dinner = await t.spend('2026-11-03', 50_000);
    await t.recalc();
    expect((await t.bases(dinner))[t.lira]).toBe(-258_600);
    expect(await t.database.db.values(sql`SELECT uncovered_minor FROM fx_shortfalls WHERE account_id = ${t.lira}`)).toEqual([[30_000]]);
  });

  it('keeps every figure of an account that never recorded a withdrawal (R4)', async () => {
    const t = await trip();
    const dinner = await t.spend('2026-11-03', 45_000);
    const before = await t.bases(dinner);
    const audits = await t.revalued();
    await t.recalc();
    expect(await t.bases(dinner)).toEqual(before);
    expect(before[t.lira]).toBe(-230_400);
    expect(await t.revalued()).toBe(audits);
    expect(await t.database.db.values(sql`SELECT uncovered_minor FROM fx_shortfalls WHERE account_id = ${t.lira}`)).toEqual([[45_000]]);
  });

  it('never moves a figure dated before the change (R10)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 52_500, 10_000);
    await t.spend('2026-11-03', 2_000);
    await t.spend('2026-11-05', 3_000);
    await t.recalc();
    const snapshot = async () => t.database.db.values<[string, string, number]>(sql`SELECT e.id, t.occurred_on, e.amount_base_minor FROM entries e JOIN transactions t ON t.id = e.transaction_id ORDER BY e.id`);
    const earlier = (await snapshot()).filter(([, on]) => on < '2026-11-04');
    await t.withdraw('2026-11-04', 54_000, 10_000);
    const later = await t.spend('2026-11-10', 10_000);
    await t.recalc(t.lira, '2026-11-04');
    expect((await snapshot()).filter(([, on]) => on < '2026-11-04')).toEqual(earlier);
    // ₺50 left of the 2 Nov withdrawal (26.250), then ₺50 of the 4 Nov one (27.000).
    expect((await t.bases(later))[t.lira]).toBe(-53_250);
  });
});

describe('recalcForeignTx: exchanges (§5)', () => {
  it('changing leftovers back books an exchange loss as spending, filed in Personal', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const back = await t.post('2026-11-20', 'Back to rupiah', exchangeLines({ fromAccountId: t.lira, fromAmountMinor: 50_000, fromCurrency: 'TRY', toAccountId: t.bank, toAmountMinor: 250_000, toCurrency: 'IDR', exchangeAccountId: t.exchange }));
    await t.recalc();
    expect(await t.resultLine(back)).toEqual([['expense.exchange_loss', 12_500]]);
    expect(await t.exchangeBase(back)).toBe(0);
    const personal = await personalBook(t.database, t.ws);
    expect(await t.database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${back}`)).toEqual([[personal.id]]);
    expect(await checkLedgerIntegrity(t.database, t.ws)).toEqual([]);
  });

  it('a better rate the other way is an exchange gain', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const back = await t.post('2026-11-20', 'Back to rupiah', exchangeLines({ fromAccountId: t.lira, fromAmountMinor: 50_000, fromCurrency: 'TRY', toAccountId: t.bank, toAmountMinor: 270_000, toCurrency: 'IDR', exchangeAccountId: t.exchange }));
    await t.recalc();
    expect(await t.resultLine(back)).toEqual([['income.exchange_gain', -7_500]]);
  });

  it('lira changed into euros: the euros keep their own figure and the difference is a loss (R6)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const change = await t.post('2026-11-06', 'Lira to euros', exchangeLines({ fromAccountId: t.lira, fromAmountMinor: 100_000, fromCurrency: 'TRY', toAccountId: t.euros, toAmountMinor: 2_900, toCurrency: 'EUR', exchangeAccountId: t.exchange }));
    await t.recalc();
    expect((await t.bases(change))[t.euros]).toBe(507_500);
    expect(await t.resultLine(change)).toEqual([['expense.exchange_loss', 17_500]]);
  });
});

describe('recalcForeignTx: moving lira between pockets (§3, Review Focus 2)', () => {
  it('carries the withdrawals into the other pocket with their own dates, oldest spent first', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 52_500, 10_000);
    await t.withdraw('2026-11-05', 54_000, 10_000, t.wallet);
    await t.move('2026-11-08', 10_000, t.lira, t.wallet);
    const first = await t.spend('2026-11-09', 10_000, t.wallet);
    const second = await t.spend('2026-11-10', 10_000, t.wallet);
    await t.recalc(t.lira);
    expect((await t.bases(first))[t.wallet]).toBe(-52_500);
    expect((await t.bases(second))[t.wallet]).toBe(-54_000);
  });

  it('ends a same-day round trip between two pockets, and the two spends add up to the one withdrawal', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 105_000, 20_000);
    await t.move('2026-11-05', 10_000, t.lira, t.wallet);
    await t.move('2026-11-05', 5_000, t.wallet, t.lira);
    const fromLira = await t.spend('2026-11-06', 15_000, t.lira);
    const fromWallet = await t.spend('2026-11-06', 5_000, t.wallet);
    const { steps } = await t.recalc(t.lira);
    await t.recalc(t.wallet);
    expect(steps).toBeLessThan(MAX_CHAIN);
    expect((await t.bases(fromLira))[t.lira]).toBe(-78_750);
    expect((await t.bases(fromWallet))[t.wallet]).toBe(-26_250);
    expect(await t.database.db.values(sql`SELECT count(*) FROM fx_recalc_pending`)).toEqual([[0]]);
  });

  it('leaves the rest of a chain past its limit to the queue (R10)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 52_500, 10_000);
    await t.move('2026-11-08', 10_000, t.lira, t.wallet);
    // Forget what the lira's outflows used, so this pass sees the move's lots as new and chains (whether or not the
    // doors already recalculated: Task 7 wires them).
    await t.database.db.run(sql`DELETE FROM fx_lot_uses`);
    await t.database.db.run(sql`DELETE FROM fx_recalc_pending`);
    await t.recalc(t.lira, null, 1);
    expect(await t.database.db.values(sql`SELECT account_id, from_date FROM fx_recalc_pending`)).toEqual([[t.wallet, '2026-11-08']]);
  });
});

describe('recalcForeignTx: whose account, and how often', () => {
  it('never takes a household placeholder for a lira account of this phone’s (Review Focus 3, R2)', async () => {
    const t = await trip();
    const partner = (await createAccount(t.database, t.ws, { name: 'Partner · TRY', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
    await t.database.db.run(sql`INSERT INTO book_member_accounts (account_id, book_id, member_id, currency) VALUES (${partner}, 'book-x', 'member-x', 'TRY')`);
    const dinner = await t.spend('2026-11-03', 45_000, partner);
    const before = await t.bases(dinner);
    await t.recalc(partner);
    expect(await t.bases(dinner)).toEqual(before);
    expect(await t.database.transaction((tx) => isLotAccountTx(tx, t.ws, partner))).toBeNull();
    expect(await t.database.db.values(sql`SELECT count(*) FROM fx_shortfalls WHERE account_id = ${partner}`)).toEqual([[0]]);
  });

  it('writes nothing the second time', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    await t.spend('2026-11-03', 45_000);
    await t.recalc();
    const audits = await t.revalued();
    await t.recalc();
    expect(await t.revalued()).toBe(audits);
  });

  it('in a shared Personal book, the spend goes out at the withdrawal rate', async () => {
    const t = await trip();
    const personal = await personalBook(t.database, t.ws);
    // The capture run shares every first Personal book from birth; this test shares it itself, as household.ts does.
    await t.database.execScript('DELETE FROM shared_books');
    await shareBookForTest(t.database, personal.id);
    await clearOutbox(t.database);
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const dinner = await t.spend('2026-11-03', 45_000);
    await t.recalc();
    const sent = (await outboxOps(t.database)).filter((op) => op.entity === 'purchase' && op.id === dinner && op.op === 'upsert') as { fields: { money?: { lines: { amountBaseMinor: number }[] } } }[];
    const latest = [...sent].reverse().find((op) => op.fields.money);
    expect(latest?.fields.money?.lines.map((line) => line.amountBaseMinor)).toEqual([236_250]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/db && npx vitest run test/withdrawal-rate.test.ts`
Expected: FAIL — `recalcForeignTx` is not exported from `../src/index`.

- [ ] **Step 3: Write `fx-costs.ts`**

`packages/db/src/repos/fx-costs.ts`:

```ts
import {
  classifyInflow,
  currencyInfo,
  fifoCosts,
  type FifoResult,
  FX_LOT_SUBTYPES,
  FxError,
  type FxLine,
  type FxLotPart,
  type FxMovement,
  type FxRole,
  isFxLotAccount,
  type Revalued,
  revalueTransaction,
  uuidv7,
} from '@expanses/core';
import { sql, type SQL } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { auditLog } from '../schema';
import { captureRevaluingTx } from '../sync/capture';
import { sharingTablesExist } from '../sync/placeholder';
import { dayOrderExists } from './day-order-column';
import { writeGainLossTx } from './fx-gain-loss';
import { fxTablesExist, queueForeignRecalcTx } from './fx-tables';

/*
 * The withdrawal rate's recalculation (spec §6). One foreign account is replayed from its first entry (ruling R10): its
 * movements go through `fifoCosts`, each transaction it paid out of goes through `revalueTransaction`, and every base
 * figure that moved is rewritten in place — behind the capture door, so a shared purchase goes out with it — with the
 * gain or loss pair of an exchange and the account's two cache tables. A move into another foreign pocket queues that
 * pocket from the move's date: the chain.
 */

/** How many accounts one recalculation may chain through before the rest waits in the queue (R10). */
export const MAX_CHAIN = 64;

/** The kinds a line on another of the owner's accounts is "money" for (R6): a pocket, a bank, a card, a loan. */
const MONEY_SUBTYPES = new Set<string>([...FX_LOT_SUBTYPES, 'credit_card', 'loan']);

export interface FxTxLine extends FxLine {
  transactionId: string;
  accountId: string;
  occurredOn: string;
  dayOrder: number | null;
  createdAt: string;
  fxRateToBase: number;
}

function roleOf(account: { kind: string; subtype: string; currency: string | null; systemKey: string | null; placeholder: boolean }, baseCurrency: string): FxRole {
  if (account.systemKey === 'currency_exchange') return 'exchange';
  if (!account.placeholder && isFxLotAccount(account, baseCurrency)) return 'lot';
  if ((account.kind === 'asset' || account.kind === 'liability') && MONEY_SUBTYPES.has(account.subtype)) return 'money';
  return 'other';
}

const placeholderSql = async (db: Db, column: SQL) => ((await sharingTablesExist(db)) ? sql`(${column} IN (SELECT account_id FROM book_member_accounts))` : sql`0`);

/** The account, when it holds lots on this phone (R2): the owner's own foreign money, never a placeholder. */
export async function isLotAccountTx(db: Db, ws: WorkspaceContext, accountId: string): Promise<{ currency: string } | null> {
  const placeholder = await placeholderSql(db, sql`id`);
  const [row] = await db.values<[string, string, string | null, number]>(sql`SELECT kind, subtype, currency, ${placeholder} FROM accounts WHERE id = ${accountId} AND workspace_id = ${ws.workspaceId}`);
  if (!row || Number(row[3]) === 1 || !isFxLotAccount({ kind: row[0], subtype: row[1], currency: row[2] }, ws.baseCurrency)) return null;
  return { currency: row[2]! };
}

type LineRow = [string, string, string, string, number, number, number, string, string, string | null, string | null, string, number | null, string, number];

/**
 * Every line of every posted transaction that touches `accountId`, in the order they were written, each with its role;
 * an exchange's gain or loss pair is left out (it is the recalculation's own output, R8).
 */
export async function linesTouchingTx(db: Db, ws: WorkspaceContext, accountId: string, opts: { excludeTransactionId?: string | null } = {}): Promise<FxTxLine[]> {
  const placed = await dayOrderExists(db);
  const placeholder = await placeholderSql(db, sql`e.account_id`);
  const rows = await db.values<LineRow>(sql`
    SELECT e.id, e.transaction_id, e.account_id, e.currency, e.amount_minor, e.amount_base_minor, e.fx_rate_to_base,
           a.kind, a.subtype, a.currency, a.system_key, t.occurred_on, ${placed ? sql`t.day_order` : sql`NULL`}, t.created_at, ${placeholder}
    FROM entries e
    JOIN accounts a ON a.id = e.account_id
    JOIN transactions t ON t.id = e.transaction_id
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'
      AND e.transaction_id IN (SELECT transaction_id FROM entries WHERE account_id = ${accountId})
      AND e.id NOT IN (SELECT category_entry_id FROM fx_gain_loss UNION ALL SELECT exchange_entry_id FROM fx_gain_loss)
      ${opts.excludeTransactionId ? sql`AND t.id <> ${opts.excludeTransactionId}` : sql``}
    ORDER BY e.rowid`);
  return rows.map(([entryId, transactionId, lineAccount, currency, amountMinor, amountBaseMinor, fxRateToBase, kind, subtype, accountCurrency, systemKey, occurredOn, dayOrder, createdAt, isPlaceholder]) => ({
    entryId,
    transactionId,
    accountId: lineAccount,
    currency,
    amountMinor: Number(amountMinor),
    amountBaseMinor: Number(amountBaseMinor),
    fxRateToBase: Number(fxRateToBase),
    occurredOn,
    dayOrder: dayOrder === null ? null : Number(dayOrder),
    createdAt,
    role: roleOf({ kind, subtype, currency: accountCurrency, systemKey, placeholder: Number(isPlaceholder) === 1 }, ws.baseCurrency),
  }));
}

/** What each outflow line was first posted at, positive (R4); absent for a line never rewritten. */
async function dayValuesOfTx(db: Db, entryIds: readonly string[]): Promise<Map<string, number>> {
  if (entryIds.length === 0) return new Map();
  const rows = await db.values<[string, number]>(sql`SELECT entry_id, base_minor FROM fx_day_values WHERE entry_id IN ${entryIds}`);
  return new Map(rows.map(([id, base]) => [id, -Number(base)]));
}

/** The lots each of these outflows used, with each lot's own date: what a move carries into the next pocket (§3). */
async function partsOfTx(db: Db, outEntryIds: readonly string[]): Promise<Map<string, FxLotPart[]>> {
  const parts = new Map<string, FxLotPart[]>();
  if (outEntryIds.length === 0) return parts;
  const rows = await db.values<[string, string, number, number, string]>(sql`
    SELECT u.out_entry_id, u.lot_entry_id, u.minor, u.cost_base_minor, t.occurred_on
    FROM fx_lot_uses u JOIN entries e ON e.id = u.lot_entry_id JOIN transactions t ON t.id = e.transaction_id
    WHERE u.out_entry_id IN ${outEntryIds} ORDER BY t.occurred_on, u.lot_entry_id`);
  for (const [out, lotId, minor, cost, lotDate] of rows) {
    const list = parts.get(out) ?? [];
    list.push({ lotId, lotDate, minor: Number(minor), costBaseMinor: Number(cost) });
    parts.set(out, list);
  }
  return parts;
}

/**
 * The account's movements as `fifoCosts` takes them (R4, R11): an outflow at the figure it was first posted at; an
 * inflow at its cost — written here for money changed from the base currency (`inCosts`), carried as the source pocket's
 * lots for a move, else as stored.
 */
export async function movementsOfTx(
  db: Db,
  ws: WorkspaceContext,
  accountId: string,
  lines: readonly FxTxLine[],
): Promise<{ movements: FxMovement[]; inCosts: Map<string, Record<string, number>>; byTransaction: Map<string, FxTxLine[]> }> {
  const byTransaction = new Map<string, FxTxLine[]>();
  for (const line of lines) byTransaction.set(line.transactionId, [...(byTransaction.get(line.transactionId) ?? []), line]);
  const own = lines.filter((line) => line.accountId === accountId && line.amountMinor !== 0);
  const dayValues = await dayValuesOfTx(db, own.filter((line) => line.amountMinor < 0).map((line) => line.entryId));
  const movements: FxMovement[] = [];
  const inCosts = new Map<string, Record<string, number>>();
  const carriedFrom = new Map<string, string>();
  for (const line of own) {
    const common = { entryId: line.entryId, occurredOn: line.occurredOn, dayOrder: line.dayOrder, createdAt: line.createdAt, minor: Math.abs(line.amountMinor) };
    if (line.amountMinor < 0) {
      movements.push({ ...common, kind: 'out', dayValueBaseMinor: dayValues.get(line.entryId) ?? -line.amountBaseMinor });
      continue;
    }
    const cost = classifyInflow(byTransaction.get(line.transactionId)!, line.entryId, ws.baseCurrency);
    if (cost.kind === 'exchanged') {
      inCosts.set(line.transactionId, { ...(inCosts.get(line.transactionId) ?? {}), [line.entryId]: cost.costs[line.entryId]! });
      movements.push({ ...common, kind: 'in', costBaseMinor: cost.costs[line.entryId]! });
      continue;
    }
    if (cost.kind === 'carried' && cost.fromEntryIds.length === 1) carriedFrom.set(line.entryId, cost.fromEntryIds[0]!);
    movements.push({ ...common, kind: 'in', costBaseMinor: line.amountBaseMinor });
  }
  // A move's lots, as the source pocket used them; whatever they do not cover (a shortfall there) arrives as a lot of
  // its own on the move's date. A stale or partial record is left as one lot: the source's next pass corrects it.
  const parts = await partsOfTx(db, [...carriedFrom.values()]);
  for (const movement of movements) {
    if (movement.kind !== 'in') continue;
    const used = parts.get(carriedFrom.get(movement.entryId) ?? '');
    if (!used) continue;
    const coveredMinor = used.reduce((sum, part) => sum + part.minor, 0);
    const coveredCost = used.reduce((sum, part) => sum + part.costBaseMinor, 0);
    const restMinor = movement.minor - coveredMinor;
    const restCost = movement.costBaseMinor - coveredCost;
    if (restMinor < 0 || (restMinor === 0 && restCost !== 0) || restCost < 0) continue;
    movement.parts = [...used, ...(restMinor > 0 ? [{ lotId: movement.entryId, lotDate: movement.occurredOn, minor: restMinor, costBaseMinor: restCost }] : [])];
  }
  return { movements, inCosts, byTransaction };
}

function rateFor(line: FxTxLine, base: number, baseCurrency: string): number {
  if (line.currency === baseCurrency) return 1;
  if (base === 0) return line.fxRateToBase;
  return Math.abs(base / line.amountMinor) * 10 ** (currencyInfo(line.currency).exponent - currencyInfo(baseCurrency).exponent);
}

const usesKey = (uses: readonly { lotId: string; minor: number; costBaseMinor: number }[]) =>
  JSON.stringify([...uses].sort((a, b) => (a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0)).map((use) => [use.lotId, use.minor, use.costBaseMinor]));

async function usesOfAccountTx(db: Db, accountId: string): Promise<Map<string, string>> {
  const rows = await db.values<[string, string, number, number]>(sql`SELECT out_entry_id, lot_entry_id, minor, cost_base_minor FROM fx_lot_uses WHERE account_id = ${accountId}`);
  const byOut = new Map<string, { lotId: string; minor: number; costBaseMinor: number }[]>();
  for (const [out, lotId, minor, cost] of rows) byOut.set(out, [...(byOut.get(out) ?? []), { lotId, minor: Number(minor), costBaseMinor: Number(cost) }]);
  return new Map([...byOut].map(([out, uses]) => [out, usesKey(uses)]));
}

async function writeCachesTx(db: Db, accountId: string, result: FifoResult | null): Promise<void> {
  await db.run(sql`DELETE FROM fx_lot_uses WHERE account_id = ${accountId}`);
  await db.run(sql`DELETE FROM fx_shortfalls WHERE account_id = ${accountId}`);
  if (!result) return;
  for (const out of result.outs) {
    for (const use of out.uses) {
      await db.run(sql`INSERT INTO fx_lot_uses (account_id, out_entry_id, lot_entry_id, minor, cost_base_minor) VALUES (${accountId}, ${out.entryId}, ${use.lotId}, ${use.minor}, ${use.costBaseMinor})`);
    }
  }
  for (const shortfall of result.shortfalls) {
    await db.run(sql`INSERT INTO fx_shortfalls (account_id, entry_id, uncovered_minor) VALUES (${accountId}, ${shortfall.entryId}, ${shortfall.uncoveredMinor})`);
  }
}

/** One account's pass: what it rewrote, and which pockets its moves carried lots into (the chain). */
export async function recalcAccountTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<{ changedTransactions: string[]; chain: { accountId: string; fromDate: string }[] }> {
  if (!(await isLotAccountTx(tx, ws, accountId))) {
    await writeCachesTx(tx, accountId, null);
    return { changedTransactions: [], chain: [] };
  }
  const lines = await linesTouchingTx(tx, ws, accountId);
  const { movements, inCosts, byTransaction } = await movementsOfTx(tx, ws, accountId, lines);
  const result = fifoCosts(movements);
  const transactionOf = new Map(lines.map((line) => [line.entryId, line.transactionId]));
  const outCosts = new Map<string, Record<string, number>>();
  for (const out of result.outs) {
    const transactionId = transactionOf.get(out.entryId)!;
    outCosts.set(transactionId, { ...(outCosts.get(transactionId) ?? {}), [out.entryId]: out.costBaseMinor });
  }
  const oldUses = await usesOfAccountTx(tx, accountId);
  const newUses = new Map(result.outs.map((out) => [out.entryId, usesKey(out.uses)]));
  const changedTransactions: string[] = [];
  const chain: { accountId: string; fromDate: string }[] = [];

  for (const [transactionId, txLines] of byTransaction) {
    const out = outCosts.get(transactionId);
    const into = inCosts.get(transactionId);
    if (!out && !into) continue;
    let revalued: Revalued;
    try {
      revalued = revalueTransaction({ lines: txLines, baseCurrency: ws.baseCurrency, ...(out ? { outCosts: out } : {}), ...(into ? { inCosts: into } : {}) });
    } catch (error) {
      // A transaction no screen could have made (a pocket paying out with nothing on the other side) keeps the figures
      // it was posted at; one bad row must never stop every other write to this account.
      if (error instanceof FxError) {
        console.warn(`Withdrawal rate: left ${transactionId} at its posted figures`, error.message);
        continue;
      }
      throw error;
    }
    const changed = txLines.filter((line) => revalued.bases[line.entryId] !== line.amountBaseMinor);
    if (changed.length > 0) {
      await captureRevaluingTx(tx, transactionId);
      for (const line of changed.filter((l) => l.role === 'lot')) {
        await tx.run(sql`INSERT OR IGNORE INTO fx_day_values (entry_id, base_minor, rate) VALUES (${line.entryId}, ${line.amountBaseMinor}, ${line.fxRateToBase})`);
      }
      for (const line of changed) {
        const base = revalued.bases[line.entryId]!;
        await tx.run(sql`UPDATE entries SET amount_base_minor = ${base}, fx_rate_to_base = ${rateFor(line, base, ws.baseCurrency)} WHERE id = ${line.entryId}`);
      }
    }
    const pairWritten = await writeGainLossTx(tx, ws, transactionId, revalued.gainLossBaseMinor);
    if (changed.length > 0 || pairWritten) {
      changedTransactions.push(transactionId);
      await tx.insert(auditLog).values({
        id: uuidv7(),
        workspaceId: ws.workspaceId,
        action: 'revalue',
        entity: 'transaction',
        entityId: transactionId,
        payloadJson: JSON.stringify({ accountId, bases: Object.fromEntries(changed.map((line) => [line.entryId, revalued.bases[line.entryId]])), gainLossBaseMinor: revalued.gainLossBaseMinor }),
        createdAt: new Date().toISOString(),
      });
    }
    // The chain (§6, R10): a same-currency move into another pocket whose figure, or whose lots, changed.
    for (const line of txLines) {
      if (line.role !== 'lot' || line.accountId === accountId || line.amountMinor <= 0) continue;
      const source = txLines.find((l) => l.accountId === accountId && l.amountMinor < 0 && l.currency === line.currency);
      if (!source) continue;
      const moved = revalued.bases[line.entryId] !== line.amountBaseMinor || (oldUses.get(source.entryId) ?? '[]') !== (newUses.get(source.entryId) ?? '[]');
      if (moved) chain.push({ accountId: line.accountId, fromDate: line.occurredOn });
    }
  }
  await writeCachesTx(tx, accountId, result);
  return { changedTransactions, chain };
}

const earlier = (held: string | null | undefined, next: string | null): string | null => (held === undefined ? next : held === null || next === null ? null : held < next ? held : next);

/**
 * Recalculates `accountId` and every pocket its moves carry lots into, each once per change, until a pass changes
 * nothing (§6). `fromDate` is where the change that asked for it begins: FIFO is causal, so nothing dated before it
 * moves (R10); the account is still replayed whole, because its lots at `fromDate` are its whole history. Past
 * `maxSteps` passes the rest is queued in `fx_recalc_pending` rather than looping. Nothing on a database before 0071.
 */
export async function recalcForeignTx(
  tx: Db,
  ws: WorkspaceContext,
  accountId: string,
  fromDate: string | null,
  opts: { maxSteps?: number } = {},
): Promise<{ steps: number; changedTransactions: string[] }> {
  if (!(await fxTablesExist(tx))) return { steps: 0, changedTransactions: [] };
  const maxSteps = opts.maxSteps ?? MAX_CHAIN;
  const queue = new Map<string, string | null>([[accountId, fromDate]]);
  const changed = new Set<string>();
  let steps = 0;
  while (queue.size > 0) {
    const [next, from] = queue.entries().next().value as [string, string | null];
    queue.delete(next);
    if (steps >= maxSteps) {
      await queueForeignRecalcTx(tx, next, from);
      continue;
    }
    steps += 1;
    const pass = await recalcAccountTx(tx, ws, next);
    pass.changedTransactions.forEach((id) => changed.add(id));
    for (const link of pass.chain) queue.set(link.accountId, earlier(queue.has(link.accountId) ? queue.get(link.accountId)! : undefined, link.fromDate));
  }
  return { steps, changedTransactions: [...changed] };
}
```

- [ ] **Step 4: Export from the db index**

In `packages/db/src/index.ts`, after `export * from './repos/fx';` add:

```ts
export * from './repos/fx-tables';
export * from './repos/fx-gain-loss';
export * from './repos/fx-costs';
```

- [ ] **Step 5: Run the tests, the db suite, the capture run and the typecheck**

Run: `cd packages/db && npx vitest run test/withdrawal-rate.test.ts && cd ../.. && npm run test -w @expanses/db && npm run typecheck`
Expected: PASS. Nothing calls `recalcForeignTx` outside these tests yet, so no other test changes.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repos/fx-costs.ts packages/db/src/index.ts packages/db/test/withdrawal-rate.test.ts
git commit -m "recalcForeignTx: a foreign account replayed oldest withdrawal first, every base figure that moved rewritten in place behind the capture door, exchanges given their gain or loss, and lots moved between pockets carried on with their dates

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 7: Every door recalculates — the triggers, the queue and the drain

Spec §6 ("Triggers: every ledger write that touches a foreign money account (post, replace, void, the in-place doors, sync apply) calls it for that account from the written date, inside the same db transaction"; "First run after the update"); rulings R9, R13, R18. Review Focus 1 and 5.

**Files:**
- Create: `packages/db/src/repos/fx-pending.ts`
- Modify: `packages/db/src/repos/ledger.ts` (one import; one call in `postTransactionTx`, one in `markVoidTx`, one in `moveTransactionInDay`)
- Modify: `packages/db/src/sync/apply.ts` (one import; one call in `applyPurchase`'s in-place `dayOrder` branch)
- Test: `packages/db/test/withdrawal-rate-triggers.test.ts`
- Modify: existing tests whose figures the withdrawal rate changes (Step 7's rule; list them in the commit message)

**Interfaces:**
- Consumes: `recalcForeignTx(tx, ws, accountId, fromDate)` (Task 6); `fxTablesExist`, `queueForeignRecalcTx`, `WITHDRAWAL_RATE_NOTICE_KEY` (Task 3); `beforeFlushTx`, `sessionValueTx`, `capturePausedTx` (Task 4); `isFxLotAccount` (Task 1).
- Produces (`packages/db/src/repos/fx-pending.ts`; Task 9 re-exports it from `@expanses/db`):
  - `markForeignDirtyTx(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<void>` — what every door calls.
  - `interface ForeignDrain { done: number; left: number }`
  - `recalcPendingForeign(database: Database, opts?: { limit?: number }): Promise<ForeignDrain>` — one account per db transaction, capture on; an account that fails stays queued and is skipped for the rest of the run.
  - `withdrawalRateNoticeDue(database: Database): Promise<boolean>` — `'due'` and nothing left in the queue.
  - `dismissWithdrawalRateNotice(database: Database): Promise<void>`

- [ ] **Step 1: Write the failing tests (Review Focus 1 and 5)**

`packages/db/test/withdrawal-rate-triggers.test.ts`:

```ts
import { exchangeLines, expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  coretaxInputsFor,
  createAccount,
  listAccounts,
  moveTransactionInDay,
  netWorthAt,
  openEventBookTx,
  ownerScope,
  postEventRecordTx,
  postTransaction,
  postTransactionTx,
  replaceTransaction,
  saveEvent,
  setPaidFromTx,
  systemAccountId,
  upsertRate,
  voidTransaction,
} from '../src/index';
import { dismissWithdrawalRateNotice, recalcPendingForeign, withdrawalRateNoticeDue } from '../src/repos/fx-pending';
import { queueForeignRecalcTx, WITHDRAWAL_RATE_NOTICE_KEY } from '../src/repos/fx-tables';
import { withCapturePaused } from '../src/sync/capture';
import { setupDb } from './helpers';
import { shareBookForTest } from './sync/sync-helpers';

/*
 * Review Focus 1: a withdrawal recorded late, dated before the spending, moves that spending through every door — post,
 * the edit route's replace, void, a drag within the day, a shared event's derivation, and sync apply (queued, then
 * drained). Review Focus 5: the queue drains in batches. Invented figures: lira at 525 and 540, the day's 512.
 */
const RATES = { TRY: 512 };
const pause = () => new Promise((resolve) => setTimeout(resolve, 3));

async function trip() {
  const t = await setupDb();
  const all = await listAccounts(t.database, t.ws);
  const restaurants = all.find((a) => a.name === 'Restaurants')!.id;
  const bank = (await createAccount(t.database, t.ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-10-01' })).id;
  const lira = (await createAccount(t.database, t.ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
  const exchange = await systemAccountId(t.database.db, t.ws, 'currency_exchange');
  const withdrawal = (occurredOn: string, idr: number, kurus: number) => ({
    occurredOn,
    description: 'ATM',
    lines: exchangeLines({ fromAccountId: bank, fromAmountMinor: idr, fromCurrency: 'IDR', toAccountId: lira, toAmountMinor: kurus, toCurrency: 'TRY', exchangeAccountId: exchange }),
    ratesToBase: RATES,
  });
  const dinner = (occurredOn: string, kurus: number) => ({
    occurredOn,
    description: 'Dinner',
    lines: expenseLines({ categoryAccountId: restaurants, paymentAccountId: lira, amountMinor: kurus, currency: 'TRY' }),
    ratesToBase: RATES,
  });
  const withdraw = (occurredOn: string, idr: number, kurus: number) => postTransaction(t.database, t.ws, withdrawal(occurredOn, idr, kurus));
  const spend = async (occurredOn: string, kurus: number) => {
    await pause();
    return postTransaction(t.database, t.ws, dinner(occurredOn, kurus));
  };
  /** What the lira line of a transaction's latest version is worth in base. */
  const liraBase = async (transactionId: string) =>
    Number((await t.database.db.values<[number]>(sql`SELECT amount_base_minor FROM entries WHERE transaction_id = ${transactionId} AND account_id = ${lira}`))[0]![0]);
  return { ...t, restaurants, bank, lira, exchange, withdrawal, dinner, withdraw, spend, liraBase };
}

describe('every door recalculates the lira it touched (Review Focus 1)', () => {
  it('post: a withdrawal recorded after the spending, dated before it, moves the spending', async () => {
    const t = await trip();
    const meal = await t.spend('2026-11-03', 45_000);
    expect(await t.liraBase(meal)).toBe(-230_400);
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    expect(await t.liraBase(meal)).toBe(-236_250);
  });

  it('replace: editing the withdrawal moves the spending, and moving it after the spending leaves the spending uncovered', async () => {
    const t = await trip();
    const atm = await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const meal = await t.spend('2026-11-03', 45_000);
    const edited = await replaceTransaction(t.database, t.ws, atm, t.withdrawal('2026-11-02', 5_400_000, 1_000_000));
    expect(await t.liraBase(meal)).toBe(-243_000);
    await replaceTransaction(t.database, t.ws, edited, t.withdrawal('2026-11-04', 5_400_000, 1_000_000));
    expect(await t.liraBase(meal)).toBe(-230_400);
  });

  it('void: deleting the withdrawal puts the spending back at its posted figure, as a shortfall', async () => {
    const t = await trip();
    const atm = await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const meal = await t.spend('2026-11-03', 45_000);
    await voidTransaction(t.database, t.ws, atm);
    expect(await t.liraBase(meal)).toBe(-230_400);
    expect(await t.database.db.values(sql`SELECT uncovered_minor FROM fx_shortfalls WHERE account_id = ${t.lira}`)).toEqual([[45_000]]);
  });

  it('a drag within the day changes which spending took the older withdrawal (R13)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-01', 50_000, 10_000);
    await t.withdraw('2026-11-02', 60_000, 10_000);
    const a = await t.spend('2026-11-03', 10_000);
    const b = await t.spend('2026-11-03', 10_000);
    // b is newer, so on top of its day: a came first and took the 1 Nov lira.
    expect([await t.liraBase(a), await t.liraBase(b)]).toEqual([-50_000, -60_000]);
    await moveTransactionInDay(t.database, t.ws, b, [a, b]);
    expect([await t.liraBase(a), await t.liraBase(b)]).toEqual([-60_000, -50_000]);
  });

  it('a shared event’s expense paid from lira costs what the lira cost, and stays in no workspace', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    // The derivation reads the day's rate from the stored rates (as shared events do), not from a form.
    await upsertRate(t.database, { fromCurrency: 'TRY', toCurrency: 'IDR', onDate: '2026-11-01', rate: 512, source: 'manual', sourceDate: '2026-11-01' });
    const ws = ownerScope(t.ws);
    const eventId = await saveEvent(t.database, ws, { name: 'Coast week', startsOn: '2026-11-05', endsOn: '2026-11-12' });
    await shareBookForTest(t.database, 'ev-book', 'p-rina');
    await t.database.execScript(`
      INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-11-05', '2026-11-12', 'TRY', NULL);
      INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', 'p-rina', 'Rina', 'p-rina', NULL), ('ev-book', 'p-andi', 'Andi', 'p-andi', NULL), ('ev-book', 'p-budi', 'Budi', NULL, NULL);
      INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at) VALUES ('ev-book', 'cat-dinners', 'Dinners', NULL, 0, NULL);
      INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
        VALUES ('ev-book', 'exp-1', '2026-11-06', 90000, 'TRY', '1', 'p-rina', 'p-rina', NULL);
      INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by)
        VALUES ('ev-book', 'exp-1', NULL, 'cat-dinners', 'equal', '["p-rina","p-andi","p-budi"]', 'p-rina', NULL);
    `);
    const tripBalance = await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Coast week', currency: 'TRY' }));
    await t.database.transaction((tx) => setPaidFromTx(tx, 'ev-book', 'exp-1', 'expense', { accountId: t.lira, amountMinor: null }));
    await t.database.transaction((tx) => postEventRecordTx(tx, 'ev-book', 'expense', 'exp-1', null));
    const [[transactionId]] = await t.database.db.values<[string]>(sql`SELECT transaction_id FROM event_postings WHERE book_id = 'ev-book' AND record_id = 'exp-1'`);
    // ₺900 at 525: Rp 472.500, a third on the share and two thirds on the trip balance.
    expect(await t.liraBase(transactionId)).toBe(-472_500);
    expect(Number((await t.database.db.values<[number]>(sql`SELECT amount_base_minor FROM entries WHERE transaction_id = ${transactionId} AND account_id = ${tripBalance}`))[0]![0])).toBe(315_000);
    expect(await t.database.db.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${transactionId}`)).toEqual([]);
  });

  it('sync apply: what a paused write touched waits in the queue, and the drain recalculates it (R9)', async () => {
    const t = await trip();
    const meal = await t.spend('2026-11-03', 45_000);
    await t.database.transaction((tx) => withCapturePaused(tx, () => postTransactionTx(tx, t.ws, t.withdrawal('2026-11-02', 5_250_000, 1_000_000))));
    expect(await t.liraBase(meal)).toBe(-230_400);
    expect(await t.database.db.values(sql`SELECT account_id, from_date FROM fx_recalc_pending`)).toEqual([[t.lira, '2026-11-02']]);
    expect(await recalcPendingForeign(t.database)).toEqual({ done: 1, left: 0 });
    expect(await t.liraBase(meal)).toBe(-236_250);
  });
});

describe('the queue (Review Focus 5, R18)', () => {
  it('drains in batches, and an account it cannot find is simply let go', async () => {
    const t = await trip();
    const euros = (await createAccount(t.database, t.ws, { name: 'Euro cash', kind: 'asset', subtype: 'cash', currency: 'EUR' })).id;
    await t.database.transaction(async (tx) => {
      await queueForeignRecalcTx(tx, t.lira, null);
      await queueForeignRecalcTx(tx, euros, null);
      await queueForeignRecalcTx(tx, 'no-such-account', null);
    });
    expect(await recalcPendingForeign(t.database, { limit: 1 })).toEqual({ done: 1, left: 2 });
    expect(await recalcPendingForeign(t.database)).toEqual({ done: 2, left: 0 });
  });

  it('net worth and the tax report read the same before and after the recalculation (§8, D6)', async () => {
    const t = await trip();
    const paused = (input: ReturnType<typeof t.withdrawal>) => t.database.transaction((tx) => withCapturePaused(tx, () => postTransactionTx(tx, t.ws, input)));
    await paused(t.withdrawal('2026-11-02', 5_250_000, 1_000_000));
    await paused(t.dinner('2026-11-03', 45_000));
    const before = { worth: await netWorthAt(t.database, t.ws, '2026-12-31', RATES), tax: await coretaxInputsFor(t.database, t.ws, 2026) };
    await recalcPendingForeign(t.database);
    expect(await t.liraBase((await t.database.db.values<[string]>(sql`SELECT id FROM transactions WHERE description = 'Dinner'`))[0]![0])).toBe(-236_250);
    expect({ worth: await netWorthAt(t.database, t.ws, '2026-12-31', RATES), tax: await coretaxInputsFor(t.database, t.ws, 2026) }).toEqual(before);
  });

  it('says the notice is due once the queue is empty, and never again once dismissed', async () => {
    const t = await trip();
    expect(await withdrawalRateNoticeDue(t.database)).toBe(false);
    await t.database.db.run(sql`INSERT INTO settings (key, value) VALUES (${WITHDRAWAL_RATE_NOTICE_KEY}, 'due')`);
    await t.database.transaction((tx) => queueForeignRecalcTx(tx, t.lira, null));
    expect(await withdrawalRateNoticeDue(t.database)).toBe(false);
    await recalcPendingForeign(t.database);
    expect(await withdrawalRateNoticeDue(t.database)).toBe(true);
    await dismissWithdrawalRateNotice(t.database);
    expect(await withdrawalRateNoticeDue(t.database)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/db && npx vitest run test/withdrawal-rate-triggers.test.ts`
Expected: FAIL — `../src/repos/fx-pending` cannot be resolved.

- [ ] **Step 3: Write `fx-pending.ts`**

`packages/db/src/repos/fx-pending.ts`:

```ts
import { isFxLotAccount } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { beforeFlushTx, capturePausedTx, sessionValueTx } from '../sync/capture';
import { sharingTablesExist } from '../sync/placeholder';
import { recalcForeignTx } from './fx-costs';
import { fxTablesExist, queueForeignRecalcTx, WITHDRAWAL_RATE_NOTICE_KEY } from './fx-tables';

/*
 * When the withdrawal rate's recalculation runs (spec §6, ruling R9). Every ledger door marks the foreign accounts its
 * transaction touches; at the end of the db transaction each marked account is recalculated once, from the earliest
 * date marked, before capture resolves what changed — so a replace (a void and a post) is one recalculation, and its
 * new figures go out with the edit. Inside sync apply capture is paused: what apply touched waits in
 * `fx_recalc_pending`, and the engine drains it after the sync with capture on, so this phone's new figures reach the
 * partner as an ordinary edit. The first run after the update drains the same queue (R18).
 */

type Dirty = Map<string, { ws: WorkspaceContext; accountId: string; fromDate: string }>;
const DIRTY = 'fx.dirty';
const STEP = 'fx.recalc';

/** A door's one call: the foreign money accounts this transaction touches are recalculated at the end of the db transaction. */
export async function markForeignDirtyTx(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<void> {
  if (!(await fxTablesExist(tx))) return;
  const sharing = await sharingTablesExist(tx);
  const rows = await tx.values<[string, string, string, string | null, string]>(sql`
    SELECT DISTINCT e.account_id, a.kind, a.subtype, a.currency, t.occurred_on
    FROM entries e JOIN accounts a ON a.id = e.account_id JOIN transactions t ON t.id = e.transaction_id
    WHERE e.transaction_id = ${transactionId}
      ${sharing ? sql`AND e.account_id NOT IN (SELECT account_id FROM book_member_accounts)` : sql``}`);
  const lots = rows.filter(([, kind, subtype, currency]) => isFxLotAccount({ kind, subtype, currency }, ws.baseCurrency));
  if (lots.length === 0) return;
  const dirty = sessionValueTx<Dirty>(tx, DIRTY, () => new Map());
  if (!dirty) {
    // Not inside `Database.transaction` (nothing in the app writes that way): there is no end to wait for.
    for (const [accountId, , , , occurredOn] of lots) await recalcForeignTx(tx, ws, accountId, occurredOn);
    return;
  }
  for (const [accountId, , , , occurredOn] of lots) {
    const key = `${ws.workspaceId}\u0000${accountId}`;
    const held = dirty.get(key);
    if (!held || occurredOn < held.fromDate) dirty.set(key, { ws, accountId, fromDate: occurredOn });
  }
  beforeFlushTx(tx, STEP, () => runDirtyTx(tx));
}

async function runDirtyTx(tx: Db): Promise<void> {
  const dirty = sessionValueTx<Dirty>(tx, DIRTY, () => new Map());
  if (!dirty || dirty.size === 0) return;
  const work = [...dirty.values()];
  dirty.clear();
  const paused = capturePausedTx(tx);
  for (const { ws, accountId, fromDate } of work) {
    if (paused) await queueForeignRecalcTx(tx, accountId, fromDate);
    else await recalcForeignTx(tx, ws, accountId, fromDate);
  }
}

export interface ForeignDrain {
  /** Accounts taken off the queue this run. */
  done: number;
  /** Accounts still waiting. */
  left: number;
}

/**
 * Recalculates queued accounts, one per db transaction so the app's own reads and writes go between them (Review
 * Focus 5), up to `limit`. An account that fails stays queued for the next run and is skipped for the rest of this one;
 * one that no longer exists is simply taken off.
 */
export async function recalcPendingForeign(database: Database, opts: { limit?: number } = {}): Promise<ForeignDrain> {
  if (!(await fxTablesExist(database.db))) return { done: 0, left: 0 };
  const limit = opts.limit ?? Number.POSITIVE_INFINITY;
  const failed: string[] = [];
  let done = 0;
  while (done < limit) {
    const [row] = await database.db.values<[string, string | null]>(
      sql`SELECT account_id, from_date FROM fx_recalc_pending ${failed.length > 0 ? sql`WHERE account_id NOT IN ${failed}` : sql``} ORDER BY rowid LIMIT 1`,
    );
    if (!row) break;
    const [accountId, fromDate] = row;
    try {
      await database.transaction(async (tx) => {
        await tx.run(sql`DELETE FROM fx_recalc_pending WHERE account_id = ${accountId}`);
        const [owner] = await tx.values<[string, string]>(sql`SELECT a.workspace_id, w.base_currency FROM accounts a JOIN workspaces w ON w.id = a.workspace_id WHERE a.id = ${accountId}`);
        if (owner) await recalcForeignTx(tx, { workspaceId: owner[0], baseCurrency: owner[1] }, accountId, fromDate);
      });
      done += 1;
    } catch (error) {
      failed.push(accountId);
      console.warn('A foreign account could not be recalculated yet; it waits for the next run', error);
    }
  }
  const [left] = await database.db.values<[number]>(sql`SELECT count(*) FROM fx_recalc_pending`);
  return { done, left: Number(left?.[0] ?? 0) };
}

/** The first run's notice (R18): asked for by the migration, shown once nothing is left to recalculate. */
export async function withdrawalRateNoticeDue(database: Database): Promise<boolean> {
  if (!(await fxTablesExist(database.db))) return false;
  const [row] = await database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${WITHDRAWAL_RATE_NOTICE_KEY}`);
  if (row?.[0] !== 'due') return false;
  const [left] = await database.db.values<[number]>(sql`SELECT count(*) FROM fx_recalc_pending`);
  return Number(left?.[0] ?? 0) === 0;
}

export async function dismissWithdrawalRateNotice(database: Database): Promise<void> {
  await database.db.run(sql`UPDATE settings SET value = 'shown' WHERE key = ${WITHDRAWAL_RATE_NOTICE_KEY}`);
}
```

- [ ] **Step 4: Wire the ledger's doors**

In `packages/db/src/repos/ledger.ts`:

Add the import beside the other repo imports:

```ts
import { markForeignDirtyTx } from './fx-pending';
```

In `postTransactionTx`, immediately before `await capturePostedTx(tx, id, bookId ?? null, input.replacesTransactionId ?? null, input.paidFrom);` add:

```ts
  // Withdrawal rate §6: a foreign money account this touches is recalculated at the end of the db transaction, from
  // this date — before capture reads the figures, so a shared purchase goes out at the withdrawal rate (R9).
  await markForeignDirtyTx(tx, ws, id);
```

In `markVoidTx`, immediately after `await tx.update(transactions).set({ status: 'void' }).where(eq(transactions.id, id));` add:

```ts
  // What this took out of (or put into) a foreign account is no longer there: its later outflows are recalculated (§6).
  await markForeignDirtyTx(tx, ws, id);
```

In `moveTransactionInDay`, inside the `for (const write of planDayOrder(next, transactionId))` loop, after the `UPDATE transactions SET day_order …` line add:

```ts
      // A place in the day is the order money moved in (R3, R13): the day's foreign outflows are priced again.
      await markForeignDirtyTx(tx, ws, write.id);
```

- [ ] **Step 5: Wire apply's in-place place**

In `packages/db/src/sync/apply.ts`, add beside the other repo imports:

```ts
import { markForeignDirtyTx } from '../repos/fx-pending';
```

In `applyPurchase`, inside `if ('dayOrder' in winners) { … }`, after the `UPDATE transactions SET day_order …` line add:

```ts
      // Withdrawal rate R13: a new place in the day reorders a foreign account's outflows. Capture is paused here, so
      // the account waits in the queue and is recalculated after the sync (R9).
      await markForeignDirtyTx(tx, ctx.ws, lineage.head!);
```

(`postTransactionTx`, `replaceTransactionTx` and `voidTransactionTx`, which apply already calls, mark through the ledger.)

- [ ] **Step 6: Run the new tests**

Run: `cd packages/db && npx vitest run test/withdrawal-rate-triggers.test.ts test/withdrawal-rate.test.ts test/fx-gain-loss.test.ts`
Expected: PASS. In the drag test, if `a` and `b` share a millisecond, `pause()` is too short for the machine: raise it to 5 ms (it orders `createdAt`, nothing else).

- [ ] **Step 7: Run every suite and bring the figures the withdrawal rate changes up to date**

Run: `npm run test -w @expanses/db && npm run test -w @expanses/web && npm run test -w @expanses/core`

Every failure is one of two kinds, and only one may be "fixed" by changing the test:

1. **A figure the spec now changes.** The test expected a base figure, a balance of the exchange account, a book filing or a line count for money that left a foreign money account (R2) — a spend, a move, a card paid, an exchange (which now carries the gain or loss pair and is filed in Personal), a shared event's expense charged in another currency (R7), a holding bought from foreign cash (R14). Work the new figure out by hand from §4 and the rulings, put it in the expectation, and add a one-line comment naming the rule (`// withdrawal rate §4: ₺450 at the 525 withdrawal`). Figures of accounts that never recorded an inflow do not change (R4); if one did, it is kind 2.
2. **Anything else** — a refused posting, a figure in a base-currency-only test, a capture-harness miss, an apply skip, a placeholder recalculated — is a bug in Tasks 1–7. Fix the code, never the test.

The db tests that read base figures, the exchange account or book filings beside foreign money today — the first place to look: `accounts.test.ts`, `add-holding.test.ts`, `adjust-balance.test.ts`, `book-currency.test.ts`, `book-currency-reads.test.ts`, `books-keys.test.ts`, `cash-accounts.test.ts`, `foreign-sells.test.ts`, `pockets.test.ts`, `set-aside-rules.test.ts`, `set-aside-matrix.test.ts`, `set-aside-tx.test.ts`, `shared-event-moves.test.ts`, `shared-event-postings.test.ts` (a euro wallet paying a lira event is R7's spread). A household device's `usd` account holds no withdrawal unless a test puts one there, so a spend from it keeps its figures (R4).

Then: `npm run test:capture`
Expected: PASS. A capture miss naming `entries.amount_base_minor` means a write happened without `captureRevaluingTx` before it.

Then: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/repos/fx-pending.ts packages/db/src/repos/ledger.ts packages/db/src/sync/apply.ts packages/db/test/withdrawal-rate-triggers.test.ts
git add -u packages apps
git commit -m "Every ledger door recalculates the foreign money it touched at the end of its db transaction; apply's wait in a queue the sync drains with capture on; figures the withdrawal rate changes are brought up to date

Updated expectations (withdrawal rate §4/§5): one line per test changed in Step 7 — file, test name, the rule it now follows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 8: Readers for the screens — preview, lots left, withdrawals used, exchange result

Spec §7; rulings R15, R20. Read-only: nothing here writes.

**Files:**
- Create: `packages/db/src/repos/fx-reads.ts`
- Modify: `packages/db/src/index.ts` (one export line after the three Task 6 added)
- Test: `packages/db/test/withdrawal-rate-reads.test.ts`

**Interfaces:**
- Consumes: `isLotAccountTx`, `linesTouchingTx`, `movementsOfTx`, `recalcForeignTx` (Task 6); `gainLossPairOfTx` (Task 5); `fxTablesExist` (Task 3); `fifoCosts`, `FxOpenLot`, `FxMovement`, `convertMinor`, `currencyInfo` from `@expanses/core`.
- Produces (re-exported from `@expanses/db`):
  - `interface ForeignCostPreview { currency: string; costBaseMinor: number | null; coveredMinor: number; coveredCostBaseMinor: number; uncoveredMinor: number; ratePerUnit: number | null; lots: { lotId: string; lotDate: string; minor: number }[] }`
  - `foreignCostPreview(database: Database, ws: WorkspaceContext, input: { accountId: string; amountMinor: number; occurredOn: string; excludeTransactionId?: string | null; dayRate?: number | null }): Promise<ForeignCostPreview | null>` — null for an account that holds no lots or an amount that is not above zero. The previewed outflow is the newest row of its day (a new row lands on top of its day).
  - `interface ForeignLotsView { accountId: string; currency: string; open: FxOpenLot[]; costBaseMinor: number; shortfallMinor: number }`
  - `foreignLots(database: Database, ws: WorkspaceContext, accountId: string): Promise<ForeignLotsView | null>`
  - `interface WithdrawalUse { lotId: string; lotDate: string; minor: number; costBaseMinor: number }`
  - `interface WithdrawalsUsed { accountId: string; currency: string; minor: number; costBaseMinor: number; uncoveredMinor: number; ratePerUnit: number | null; uses: WithdrawalUse[] }`
  - `withdrawalsUsedBy(database: Database, ws: WorkspaceContext, transactionId: string): Promise<WithdrawalsUsed | null>`
  - `exchangeResultOf(database: Database, transactionId: string): Promise<number>` — the gain (positive) or loss (negative) the transaction carries; 0 for none.
  - `ratePerUnit(costBaseMinor: number, minor: number, currency: string, baseCurrency: string): number`

- [ ] **Step 1: Write the failing tests**

`packages/db/test/withdrawal-rate-reads.test.ts`:

```ts
import { exchangeLines, expenseLines, transferLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { createAccount, exchangeResultOf, foreignCostPreview, foreignLots, listAccounts, postTransaction, recalcForeignTx, systemAccountId, withdrawalsUsedBy } from '../src/index';
import { setupDb } from './helpers';

/* Withdrawal rate §7's figures, read. Invented: lira at 525 and 540, the day's 512. */
const RATES = { TRY: 512 };

async function trip() {
  const t = await setupDb();
  const restaurants = (await listAccounts(t.database, t.ws)).find((a) => a.name === 'Restaurants')!.id;
  const bank = (await createAccount(t.database, t.ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-10-01' })).id;
  const lira = (await createAccount(t.database, t.ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
  const wallet = (await createAccount(t.database, t.ws, { name: 'Lira wallet', kind: 'asset', subtype: 'ewallet', currency: 'TRY' })).id;
  const exchange = await systemAccountId(t.database.db, t.ws, 'currency_exchange');
  const post = (occurredOn: string, description: string, lines: Parameters<typeof postTransaction>[2]['lines']) => postTransaction(t.database, t.ws, { occurredOn, description, lines, ratesToBase: RATES });
  const withdraw = (occurredOn: string, idr: number, kurus: number) =>
    post(occurredOn, 'ATM', exchangeLines({ fromAccountId: bank, fromAmountMinor: idr, fromCurrency: 'IDR', toAccountId: lira, toAmountMinor: kurus, toCurrency: 'TRY', exchangeAccountId: exchange }));
  const spend = (occurredOn: string, kurus: number, from = lira) => post(occurredOn, 'Dinner', expenseLines({ categoryAccountId: restaurants, paymentAccountId: from, amountMinor: kurus, currency: 'TRY' }));
  // Whether or not the doors already did it (Task 7 wires them), the figures read here are the recalculated ones.
  const settle = async () => {
    await t.database.transaction((tx) => recalcForeignTx(tx, t.ws, lira, null));
    await t.database.transaction((tx) => recalcForeignTx(tx, t.ws, wallet, null));
  };
  const preview = (amountMinor: number, over: { excludeTransactionId?: string; dayRate?: number | null; accountId?: string } = {}) =>
    foreignCostPreview(t.database, t.ws, { accountId: over.accountId ?? lira, amountMinor, occurredOn: '2026-11-15', excludeTransactionId: over.excludeTransactionId ?? null, dayRate: over.dayRate ?? null });
  return { ...t, restaurants, bank, lira, wallet, exchange, post, withdraw, spend, settle, preview };
}

describe('foreignCostPreview (Add screen, R20)', () => {
  it('prices ₺450 at the withdrawal rate before it is saved', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    await t.settle();
    const seen = await t.preview(45_000);
    expect(seen).toMatchObject({ currency: 'TRY', costBaseMinor: 236_250, coveredMinor: 45_000, coveredCostBaseMinor: 236_250, uncoveredMinor: 0, ratePerUnit: 525 });
    expect(seen!.lots.map((lot) => [lot.lotDate, lot.minor])).toEqual([['2026-11-02', 45_000]]);
  });

  it('values what no withdrawal covers at the day’s rate it is given, and gives no total without one', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 105_000, 20_000);
    await t.settle();
    expect(await t.preview(50_000, { dayRate: 512 })).toMatchObject({ costBaseMinor: 258_600, coveredMinor: 20_000, uncoveredMinor: 30_000 });
    expect(await t.preview(50_000)).toMatchObject({ costBaseMinor: null, uncoveredMinor: 30_000, ratePerUnit: null });
  });

  it('previews an edit without the transaction being edited', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const dinner = await t.spend('2026-11-03', 900_000);
    await t.settle();
    expect(await t.preview(950_000, { excludeTransactionId: dinner })).toMatchObject({ costBaseMinor: 4_987_500, uncoveredMinor: 0 });
    expect(await t.preview(950_000, { dayRate: 512 })).toMatchObject({ coveredMinor: 100_000, uncoveredMinor: 850_000, costBaseMinor: 525_000 + 4_352_000 });
  });

  it('is nothing for money that is not foreign, or no money at all', async () => {
    const t = await trip();
    expect(await t.preview(45_000, { accountId: t.bank })).toBeNull();
    expect(await t.preview(0)).toBeNull();
  });
});

describe('foreignLots and withdrawalsUsedBy (account page, receipt)', () => {
  it('lists the withdrawals left, a moved one under its own date, and what spending used', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 52_500, 10_000);
    await t.withdraw('2026-11-09', 54_000, 10_000);
    await t.post('2026-11-10', 'Between pockets', transferLines({ fromAccountId: t.lira, toAccountId: t.wallet, amountMinor: 5_000, currency: 'TRY' }));
    const dinner = await t.spend('2026-11-12', 10_000);
    await t.settle();
    expect(await foreignLots(t.database, t.ws, t.lira)).toMatchObject({
      currency: 'TRY',
      costBaseMinor: 27_000,
      shortfallMinor: 0,
      open: [{ lotDate: '2026-11-09', minor: 10_000, leftMinor: 5_000, costBaseMinor: 54_000, leftCostBaseMinor: 27_000 }],
    });
    expect((await foreignLots(t.database, t.ws, t.wallet))!.open).toMatchObject([{ lotDate: '2026-11-02', minor: 5_000, leftMinor: 5_000, leftCostBaseMinor: 26_250 }]);
    const used = await withdrawalsUsedBy(t.database, t.ws, dinner);
    expect(used).toMatchObject({ accountId: t.lira, currency: 'TRY', minor: 10_000, costBaseMinor: 53_250, uncoveredMinor: 0, ratePerUnit: 532.5 });
    expect(used!.uses.map((use) => [use.lotDate, use.minor, use.costBaseMinor])).toEqual([
      ['2026-11-02', 5_000, 26_250],
      ['2026-11-09', 5_000, 27_000],
    ]);
  });

  it('is nothing for a transaction that took no foreign money', async () => {
    const t = await trip();
    const market = await postTransaction(t.database, t.ws, { occurredOn: '2026-11-03', description: 'Market', lines: expenseLines({ categoryAccountId: t.restaurants, paymentAccountId: t.bank, amountMinor: 50_000, currency: 'IDR' }) });
    expect(await withdrawalsUsedBy(t.database, t.ws, market)).toBeNull();
  });
});

describe('exchangeResultOf (Move page, R15)', () => {
  it('is the loss an exchange back into rupiah carries, and nothing for a spend', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const back = await t.post('2026-11-20', 'Back to rupiah', exchangeLines({ fromAccountId: t.lira, fromAmountMinor: 50_000, fromCurrency: 'TRY', toAccountId: t.bank, toAmountMinor: 250_000, toCurrency: 'IDR', exchangeAccountId: t.exchange }));
    const dinner = await t.spend('2026-11-03', 45_000);
    await t.settle();
    expect(await exchangeResultOf(t.database, back)).toBe(-12_500);
    expect(await exchangeResultOf(t.database, dinner)).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/db && npx vitest run test/withdrawal-rate-reads.test.ts`
Expected: FAIL — `foreignCostPreview` is not exported.

- [ ] **Step 3: Write `fx-reads.ts`**

`packages/db/src/repos/fx-reads.ts`:

```ts
import { convertMinor, currencyInfo, fifoCosts, type FxMovement, type FxOpenLot } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { isLotAccountTx, linesTouchingTx, movementsOfTx } from './fx-costs';
import { gainLossPairOfTx } from './fx-gain-loss';
import { fxTablesExist } from './fx-tables';

/*
 * What the screens read about the withdrawal rate (spec §7). The preview and the open lots replay the account in memory
 * through the same reader and `fifoCosts` the recalculation uses, so a figure on screen is the figure a save will
 * write; the receipt reads the cache the recalculation keeps (`fx_lot_uses`, `fx_shortfalls`).
 */

/** Base units per one unit of the foreign currency: what "(525)" says. */
export function ratePerUnit(costBaseMinor: number, minor: number, currency: string, baseCurrency: string): number {
  return costBaseMinor / 10 ** currencyInfo(baseCurrency).exponent / (minor / 10 ** currencyInfo(currency).exponent);
}

export interface ForeignCostPreview {
  currency: string;
  /** Null when part of it no withdrawal covers and no rate for the day is held (R20). */
  costBaseMinor: number | null;
  coveredMinor: number;
  coveredCostBaseMinor: number;
  uncoveredMinor: number;
  ratePerUnit: number | null;
  lots: { lotId: string; lotDate: string; minor: number }[];
}

/** Each lot's own date, by the id `fifoCosts` names it by. */
function lotDates(movements: readonly FxMovement[]): Map<string, string> {
  const dates = new Map<string, string>();
  for (const movement of movements) {
    if (movement.kind !== 'in') continue;
    if (movement.parts && movement.parts.length > 0) movement.parts.forEach((part) => dates.set(part.lotId, part.lotDate));
    else dates.set(movement.entryId, movement.occurredOn);
  }
  return dates;
}

/** What spending `amountMinor` from a foreign account on `occurredOn` would cost, before it is saved. */
export async function foreignCostPreview(
  database: Database,
  ws: WorkspaceContext,
  input: { accountId: string; amountMinor: number; occurredOn: string; excludeTransactionId?: string | null; dayRate?: number | null },
): Promise<ForeignCostPreview | null> {
  const db = database.db;
  if (!(await fxTablesExist(db)) || !(input.amountMinor > 0)) return null;
  const lot = await isLotAccountTx(db, ws, input.accountId);
  if (!lot) return null;
  const lines = await linesTouchingTx(db, ws, input.accountId, { excludeTransactionId: input.excludeTransactionId ?? null });
  const { movements } = await movementsOfTx(db, ws, input.accountId, lines);
  const rate = input.dayRate && input.dayRate > 0 ? input.dayRate : null;
  const dayValue = rate === null ? 0 : convertMinor(input.amountMinor, lot.currency, ws.baseCurrency, rate);
  // The newest row of its day: a new row lands on top of its day, which is last in time (R3).
  const previewed: FxMovement = { kind: 'out', entryId: '\u0000preview', occurredOn: input.occurredOn, dayOrder: null, createdAt: '9999-12-31T23:59:59.999Z', minor: input.amountMinor, dayValueBaseMinor: dayValue };
  const out = fifoCosts([...movements, previewed]).outs.find((o) => o.entryId === previewed.entryId)!;
  const coveredMinor = input.amountMinor - out.uncoveredMinor;
  const coveredCostBaseMinor = out.costBaseMinor - out.uncoveredBaseMinor;
  const costBaseMinor = out.uncoveredMinor > 0 && rate === null ? null : out.costBaseMinor;
  const dates = lotDates(movements);
  return {
    currency: lot.currency,
    costBaseMinor,
    coveredMinor,
    coveredCostBaseMinor,
    uncoveredMinor: out.uncoveredMinor,
    ratePerUnit: costBaseMinor === null ? null : ratePerUnit(costBaseMinor, input.amountMinor, lot.currency, ws.baseCurrency),
    lots: out.uses.map((use) => ({ lotId: use.lotId, lotDate: dates.get(use.lotId) ?? input.occurredOn, minor: use.minor })),
  };
}

export interface ForeignLotsView {
  accountId: string;
  currency: string;
  /** Oldest first. */
  open: FxOpenLot[];
  /** What the money still held cost: the account page's Cost. */
  costBaseMinor: number;
  /** What was spent with no withdrawal recorded. */
  shortfallMinor: number;
}

/** The withdrawals still held in a foreign account, each with what is left of it (§7, account page). */
export async function foreignLots(database: Database, ws: WorkspaceContext, accountId: string): Promise<ForeignLotsView | null> {
  const db = database.db;
  if (!(await fxTablesExist(db))) return null;
  const lot = await isLotAccountTx(db, ws, accountId);
  if (!lot) return null;
  const { movements } = await movementsOfTx(db, ws, accountId, await linesTouchingTx(db, ws, accountId));
  const result = fifoCosts(movements);
  return {
    accountId,
    currency: lot.currency,
    open: result.open,
    costBaseMinor: result.open.reduce((sum, open) => sum + open.leftCostBaseMinor, 0),
    shortfallMinor: result.shortfalls.reduce((sum, shortfall) => sum + shortfall.uncoveredMinor, 0),
  };
}

export interface WithdrawalUse {
  lotId: string;
  lotDate: string;
  minor: number;
  costBaseMinor: number;
}

export interface WithdrawalsUsed {
  accountId: string;
  currency: string;
  minor: number;
  costBaseMinor: number;
  uncoveredMinor: number;
  ratePerUnit: number | null;
  uses: WithdrawalUse[];
}

/** Which withdrawals a transaction's foreign money came from (§7, receipt): its largest foreign outflow's. */
export async function withdrawalsUsedBy(database: Database, ws: WorkspaceContext, transactionId: string): Promise<WithdrawalsUsed | null> {
  const db = database.db;
  if (!(await fxTablesExist(db))) return null;
  const rows = await db.values<[string, string, string, number, number]>(sql`
    SELECT e.id, e.account_id, e.currency, e.amount_minor, e.amount_base_minor FROM entries e
    WHERE e.transaction_id = ${transactionId} AND e.amount_minor < 0 ORDER BY e.amount_minor`);
  for (const [entryId, accountId, currency, amountMinor, amountBaseMinor] of rows) {
    if (!(await isLotAccountTx(db, ws, accountId))) continue;
    const uses = await db.values<[string, number, number, string]>(sql`
      SELECT u.lot_entry_id, u.minor, u.cost_base_minor, t.occurred_on
      FROM fx_lot_uses u JOIN entries e ON e.id = u.lot_entry_id JOIN transactions t ON t.id = e.transaction_id
      WHERE u.out_entry_id = ${entryId} ORDER BY t.occurred_on, u.lot_entry_id`);
    const [short] = await db.values<[number]>(sql`SELECT uncovered_minor FROM fx_shortfalls WHERE entry_id = ${entryId}`);
    const minor = -Number(amountMinor);
    const costBaseMinor = -Number(amountBaseMinor);
    return {
      accountId,
      currency,
      minor,
      costBaseMinor,
      uncoveredMinor: short ? Number(short[0]) : 0,
      ratePerUnit: ratePerUnit(costBaseMinor, minor, currency, ws.baseCurrency),
      uses: uses.map(([lotId, useMinor, cost, lotDate]) => ({ lotId, lotDate, minor: Number(useMinor), costBaseMinor: Number(cost) })),
    };
  }
  return null;
}

/** The gain (positive) or loss (negative) an exchange carries, or 0 (§5, R15). */
export async function exchangeResultOf(database: Database, transactionId: string): Promise<number> {
  if (!(await fxTablesExist(database.db))) return 0;
  const pair = await gainLossPairOfTx(database.db, transactionId);
  return pair ? -pair.amountMinor : 0;
}
```

- [ ] **Step 4: Export from the db index**

In `packages/db/src/index.ts`, after `export * from './repos/fx-costs';` add:

```ts
export * from './repos/fx-reads';
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `cd packages/db && npx vitest run test/withdrawal-rate-reads.test.ts && cd ../.. && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repos/fx-reads.ts packages/db/src/index.ts packages/db/test/withdrawal-rate-reads.test.ts
git commit -m "Readers for the withdrawal rate's screens: what a spend would cost before it is saved, the withdrawals left in a pocket, which withdrawals a spend came from, and an exchange's gain or loss

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 9: Household — the owner's phone recalculates after every sync, the partner's never does

Spec §6 ("Household sync: only the device that owns the account recalculates; a partner's phone receives the new values as an ordinary edit and never recalculates someone else's account (placeholder accounts are skipped)"); rulings R9, R16. Review Focus 1 (sync apply) and 3.

**Files:**
- Modify: `packages/db/src/sync/engine.ts` (one import; three lines in `syncOnce`)
- Modify: `packages/db/src/index.ts` (one export line after `export * from './repos/fx-reads';`)
- Test: `packages/db/test/sync/withdrawal-rate.test.ts`

**Interfaces:**
- Consumes: `recalcPendingForeign(database, opts?)`, `markForeignDirtyTx` (Task 7, through the ledger and apply); `Household`, `categoryOf` (`test/sync/household.ts`).
- Produces: `SyncEngine.syncOnce(bookId)` drains `fx_recalc_pending` right after the book's own sync and never fails because of it; `@expanses/db` exports `recalcPendingForeign`, `withdrawalRateNoticeDue`, `dismissWithdrawalRateNotice`, `markForeignDirtyTx`, `ForeignDrain`.

- [ ] **Step 1: Write the failing tests**

`packages/db/test/sync/withdrawal-rate.test.ts`:

```ts
import { exchangeLines, expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, listTransactions, postTransaction, replaceTransaction, systemAccountId, upsertRate } from '../../src/index';
import { categoryOf, type Device, Household } from './household';

/*
 * Withdrawal rate §6 in a household of two phones. Fandri holds lira cash and spends it in the shared Personal book;
 * Dewi holds the purchase on a placeholder for Fandri. Invented: lira at 525 and 540, the day's 512.
 */
const DAY = '2026-11-03';
const RATES = { TRY: 512 };

async function pair() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  for (const d of [fandri, dewi]) await upsertRate(d.database, { fromCurrency: 'TRY', toCurrency: 'IDR', onDate: '2026-11-01', rate: 512, source: 'manual', sourceDate: '2026-11-01' });
  const lira = (await createAccount(fandri.database, fandri.ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
  const exchange = await systemAccountId(fandri.database.db, fandri.ws, 'currency_exchange');
  const restaurants = await categoryOf(fandri.database, bookId, 'Restaurants');
  const withdraw = (occurredOn: string, idr: number, kurus: number) =>
    postTransaction(fandri.database, fandri.ws, {
      occurredOn,
      description: 'ATM',
      lines: exchangeLines({ fromAccountId: fandri.bank, fromAmountMinor: idr, fromCurrency: 'IDR', toAccountId: lira, toAmountMinor: kurus, toCurrency: 'TRY', exchangeAccountId: exchange }),
      ratesToBase: RATES,
    });
  const spend = (kurus: number) =>
    postTransaction(fandri.database, fandri.ws, { occurredOn: DAY, description: 'Dinner', lines: expenseLines({ categoryAccountId: restaurants, paymentAccountId: lira, amountMinor: kurus, currency: 'TRY' }), ratesToBase: RATES });
  /** The dinner's category figure on a phone. */
  const dinnerBase = async (d: Device) => {
    const [row] = await d.database.db.values<[number]>(sql`
      SELECT e.amount_base_minor FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE t.status = 'posted' AND t.description = 'Dinner' AND e.account_id = ${restaurants}`);
    return row ? Number(row[0]) : null;
  };
  const cacheRows = async (d: Device) =>
    Number(
      (await d.database.db.values<[number]>(sql`SELECT (SELECT count(*) FROM fx_lot_uses) + (SELECT count(*) FROM fx_shortfalls) + (SELECT count(*) FROM fx_day_values) + (SELECT count(*) FROM fx_recalc_pending)`))[0]![0],
    );
  return { home, fandri, dewi, bookId, lira, restaurants, withdraw, spend, dinnerBase, cacheRows };
}

describe('the withdrawal rate in a household', () => {
  it('the partner’s phone takes the payer’s withdrawal-rate figure and recalculates nothing (Review Focus 3)', async () => {
    const h = await pair();
    await h.withdraw('2026-11-02', 5_250_000, 1_000_000);
    await h.spend(45_000);
    await h.home.settle();
    expect(await h.dinnerBase(h.fandri)).toBe(236_250);
    expect(await h.dinnerBase(h.dewi)).toBe(236_250);
    expect(await h.cacheRows(h.dewi)).toBe(0);
    const [placeholder] = await h.dewi.database.db.values<[number]>(sql`
      SELECT e.amount_base_minor FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE t.status = 'posted' AND t.description = 'Dinner' AND e.account_id IN (SELECT account_id FROM book_member_accounts)`);
    expect(Number(placeholder![0])).toBe(-236_250);
  });

  it('a withdrawal back-dated on the payer’s phone reaches the partner as a new figure (Review Focus 1)', async () => {
    const h = await pair();
    await h.spend(45_000);
    await h.home.settle();
    expect(await h.dinnerBase(h.dewi)).toBe(230_400);
    await h.withdraw('2026-11-02', 5_250_000, 1_000_000);
    await h.home.settle();
    expect(await h.dinnerBase(h.fandri)).toBe(236_250);
    expect(await h.dinnerBase(h.dewi)).toBe(236_250);
  });

  it('an amount the partner changed comes back costed by the payer’s phone, after the sync (R9)', async () => {
    const h = await pair();
    await h.withdraw('2026-11-02', 5_250_000, 1_000_000);
    await h.spend(45_000);
    await h.home.settle();
    const [theirs] = (await listTransactions(h.dewi.database, h.dewi.ws, { from: DAY, to: DAY })).filter((tx) => tx.description === 'Dinner');
    const placeholder = theirs!.entries.find((entry) => entry.accountKind === 'asset')!.accountId;
    await replaceTransaction(h.dewi.database, h.dewi.ws, theirs!.id, {
      occurredOn: DAY,
      description: 'Dinner',
      lines: [
        { accountId: h.restaurants, amountMinor: 50_000, currency: 'TRY' },
        { accountId: placeholder, amountMinor: -50_000, currency: 'TRY' },
      ],
      ratesToBase: RATES,
    });
    await h.home.settle();
    await h.home.settle();
    // ₺500 at 525 on the payer's phone, sent back to the partner's.
    expect(await h.dinnerBase(h.fandri)).toBe(262_500);
    expect(await h.dinnerBase(h.dewi)).toBe(262_500);
    expect(await h.cacheRows(h.dewi)).toBe(0);
  });

  it('never fails a sync over an account it cannot recalculate', async () => {
    const h = await pair();
    await h.fandri.database.db.run(sql`INSERT INTO fx_recalc_pending (account_id, from_date) VALUES ('no-such-account', NULL)`);
    await expect(h.fandri.engine.syncOnce(h.bookId)).resolves.toBeDefined();
    expect(await h.fandri.database.db.values(sql`SELECT count(*) FROM fx_recalc_pending`)).toEqual([[0]]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/db && npx vitest run test/sync/withdrawal-rate.test.ts`
Expected: FAIL in the third test (the payer's phone queues the recalculation in apply and nothing drains it, so the partner keeps 256.000) and the fourth (the row is never drained). The first two may already pass: the payer's own writes recalculate inline (Task 7).

- [ ] **Step 3: Drain after every sync**

In `packages/db/src/sync/engine.ts`, add beside the other repo imports:

```ts
import { recalcPendingForeign } from '../repos/fx-pending';
```

In `syncOnce`, immediately after `const result = await this.syncBook(bookId, seen);` add:

```ts
    // Withdrawal rate (R9): what apply just put on this phone's own foreign accounts was queued, since capture was
    // paused; recalculated now, with capture on, so the new figures go to the household as an ordinary edit (sent on
    // the next sync). Never fails the sync: what cannot be recalculated waits for the next one.
    try {
      await recalcPendingForeign(this.database);
    } catch (error) {
      console.warn('Synced; a foreign account could not be recalculated yet', error);
    }
```

- [ ] **Step 4: Export the queue's functions**

In `packages/db/src/index.ts`, after `export * from './repos/fx-reads';` add:

```ts
export * from './repos/fx-pending';
```

- [ ] **Step 5: Run the household tests, the sync suite and the capture run**

Run: `cd packages/db && npx vitest run test/sync/withdrawal-rate.test.ts && npx vitest run test/sync && cd ../.. && npm run test:capture && npm run typecheck`
Expected: PASS. The third test needs both `settle()` calls: the first carries Dewi's edit to Fandri (queued, then drained into the outbox), the second carries Fandri's figure back.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/sync/engine.ts packages/db/src/index.ts packages/db/test/sync/withdrawal-rate.test.ts
git commit -m "The phone that owns a foreign account recalculates it after every sync and sends the figures on as an ordinary edit; a partner's phone takes them and recalculates nothing

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 10: Web — the screens' words, their queries, and a gain or loss read as a transfer

Spec §7 (every quoted line of copy); rulings R8 (classify), R15, R20. Pure functions and hooks; no screen changes yet.

**Files:**
- Create: `apps/web/src/lib/withdrawal-rate.ts`
- Test: `apps/web/src/lib/withdrawal-rate.test.ts`
- Create: `apps/web/src/lib/withdrawal-queries.ts`
- Create: `apps/web/src/features/transactions/transfer-preview.ts`
- Test: `apps/web/src/features/transactions/transfer-preview.test.ts`
- Modify: `apps/web/src/features/transactions/classify.ts`
- Modify: `apps/web/src/features/transactions/classify.test.ts` (one test appended)

**Interfaces:**
- Consumes: `foreignCostPreview`, `foreignLots`, `withdrawalsUsedBy`, types `ForeignCostPreview`, `ForeignLotsView`, `WithdrawalsUsed` (Task 8, from `@expanses/db`); `isFxLotAccount`, `isExchangeResultKey` (Task 1); `formatMinor`, `convertMinor`, `currencyInfo`, `evaluateAmount` (core); `shortDate` (`features/transactions/quick-row.ts`); `amountFields`, `receivedField`, `FormDraft` (`tx-form.ts`); `useHeldRates` (`features/accounts/queries.ts`).
- Produces:
  - `apps/web/src/lib/withdrawal-rate.ts`:
    - `foreignMoney(minor: number, currency: string): string` — "₺ 300", "₺ 12,50"
    - `withdrawalRateLine(cost: { costBaseMinor: number | null; uncoveredMinor: number; ratePerUnit: number | null }, currency: string, baseCurrency: string): string | null`
    - `transferRateText(input: { fromMinor: number; fromCurrency: string; toMinor: number; toCurrency: string; baseCurrency: string; ratesToBase: Readonly<Record<string, number>> }): string | null`
    - `exchangeOutPreview(input: { costBaseMinor: number | null; receivedMinor: number; receivedCurrency: string; baseCurrency: string; ratesToBase: Readonly<Record<string, number>> }): { receivedBaseMinor: number; gainLossBaseMinor: number } | null`
    - `interface ExchangeResultLine { title: string; figure: string; note: string }`, `exchangeResultLine(gainLossBaseMinor: number, baseCurrency: string): ExchangeResultLine`, `exchangeResultText(line: ExchangeResultLine): string`
    - `fromWithdrawalsText(uses: readonly { lotId: string; lotDate: string }[], today: string): string | null`
    - `interface WithdrawalsLeftView { costText: string; rows: { key: string; title: string; value: string }[]; shortfallText: string | null }`, `withdrawalsLeftView(lots: ForeignLotsView, baseCurrency: string, today: string): WithdrawalsLeftView`
    - `WITHDRAWAL_RATE_NOTICE = 'Foreign-currency spending now uses the withdrawal rate. Past months may change slightly.'`
  - `apps/web/src/lib/withdrawal-queries.ts`: `useForeignCostPreview(input: { accountId: string; amountMinor: number | null; occurredOn: string; excludeTransactionId?: string | null; dayRate?: number | null })`, `useForeignLots(accountId: string | null)`, `useWithdrawalsUsed(transactionId: string | null)` — TanStack queries, disabled until they have what they need.
  - `apps/web/src/features/transactions/transfer-preview.ts`: `interface TransferPreview { rateText: string | null; costText: string | null; result: ExchangeResultLine | null; stale: boolean; gainLossBaseMinor: number | null }`, `transferPreviewOf(input: { fromMinor: number | null; fromCurrency: string; toMinor: number | null; toCurrency: string; fromHoldsLots: boolean; baseCurrency: string; ratesToBase: Readonly<Record<string, number>>; stale: boolean; cost: ForeignCostPreview | null }): TransferPreview`, `useTransferPreview(draft: FormDraft, accounts: readonly AccountRow[], editingId: string | null): TransferPreview`.
  - `classify(tx)`: a transaction whose only category lines are the exchange gain or loss reads as a `transfer`.

- [ ] **Step 1: Write the failing tests for the words**

`apps/web/src/lib/withdrawal-rate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { exchangeOutPreview, exchangeResultLine, exchangeResultText, foreignMoney, fromWithdrawalsText, transferRateText, withdrawalRateLine, withdrawalsLeftView } from './withdrawal-rate';

/* Withdrawal rate §7's copy, word for word (with the app's ’). Invented figures. Intl writes a no-break space after Rp. */
const plain = (text: string | null) => text?.replace(/ /g, ' ') ?? null;

describe('the withdrawal rate’s words (§7)', () => {
  it('writes foreign money with its symbol, cents only when there are any', () => {
    expect(foreignMoney(30_000, 'TRY')).toBe('₺ 300');
    expect(foreignMoney(1_250, 'TRY')).toBe('₺ 12,50');
    expect(foreignMoney(955_000, 'TRY')).toBe('₺ 9.550');
  });

  it('says what spending costs at the withdrawal rate, and what no withdrawal covers', () => {
    expect(plain(withdrawalRateLine({ costBaseMinor: 236_250, uncoveredMinor: 0, ratePerUnit: 525 }, 'TRY', 'IDR'))).toBe('≈ Rp 236.250 at the withdrawal rate (525)');
    expect(plain(withdrawalRateLine({ costBaseMinor: 238_900, uncoveredMinor: 30_000, ratePerUnit: 530.9 }, 'TRY', 'IDR'))).toBe('≈ Rp 238.900 · ₺ 300 at today’s rate (no withdrawal recorded)');
    expect(withdrawalRateLine({ costBaseMinor: null, uncoveredMinor: 30_000, ratePerUnit: null }, 'TRY', 'IDR')).toBe('₺ 300 has no withdrawal recorded and no rate for today yet');
  });

  it('writes a transfer’s Rate against the market when one side is the base currency (R15)', () => {
    const rates = { TRY: 512 };
    expect(plain(transferRateText({ fromMinor: 5_250_000, fromCurrency: 'IDR', toMinor: 1_000_000, toCurrency: 'TRY', baseCurrency: 'IDR', ratesToBase: rates }))).toBe('Rp 525 per TRY (market 512, +2,5 %)');
    expect(plain(transferRateText({ fromMinor: 50_000, fromCurrency: 'TRY', toMinor: 250_000, toCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: rates }))).toBe('Rp 500 per TRY (market 512, −2,3 %)');
    expect(plain(transferRateText({ fromMinor: 5_250_000, fromCurrency: 'IDR', toMinor: 1_000_000, toCurrency: 'TRY', baseCurrency: 'IDR', ratesToBase: {} }))).toBe('Rp 525 per TRY');
    expect(transferRateText({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: rates })).toBeNull();
  });

  it('works out an exchange out of a foreign account, and says the gain or loss (§5, §7)', () => {
    expect(exchangeOutPreview({ costBaseMinor: 262_500, receivedMinor: 250_000, receivedCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: {} })).toEqual({ receivedBaseMinor: 250_000, gainLossBaseMinor: -12_500 });
    expect(exchangeOutPreview({ costBaseMinor: 8_125_000, receivedMinor: 63_800, receivedCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: { SGD: 12_680 } })).toEqual({ receivedBaseMinor: 8_089_840, gainLossBaseMinor: -35_160 });
    expect(exchangeOutPreview({ costBaseMinor: 1, receivedMinor: 1, receivedCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: {} })).toBeNull();
    expect(exchangeOutPreview({ costBaseMinor: null, receivedMinor: 1, receivedCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: {} })).toBeNull();
    expect(plain(exchangeResultText(exchangeResultLine(-12_500, 'IDR')))).toBe('Exchange loss Rp 12.500 (recorded as spending)');
    expect(plain(exchangeResultText(exchangeResultLine(7_500, 'IDR')))).toBe('Exchange gain Rp 7.500 (recorded as income)');
    expect(exchangeResultLine(0, 'IDR').title).toBe('No exchange gain or loss');
  });

  it('names the withdrawals a spend came from', () => {
    expect(fromWithdrawalsText([{ lotId: 'w1', lotDate: '2026-11-12' }], '2026-11-20')).toBe('From the 12 Nov withdrawal');
    expect(fromWithdrawalsText([{ lotId: 'w1', lotDate: '2025-11-12' }], '2026-11-20')).toBe('From the 12 Nov 2025 withdrawal');
    expect(fromWithdrawalsText([{ lotId: 'w1', lotDate: '2026-11-02' }, { lotId: 'w2', lotDate: '2026-11-09' }], '2026-11-20')).toBe('From 2 withdrawals');
    expect(fromWithdrawalsText([], '2026-11-20')).toBeNull();
  });

  it('lists the withdrawals left in a pocket, and a shortfall in words', () => {
    const view = withdrawalsLeftView(
      {
        accountId: 'lira',
        currency: 'TRY',
        costBaseMinor: 5_013_750,
        shortfallMinor: 30_000,
        open: [{ lotId: 'w1', lotDate: '2026-11-02', minor: 1_000_000, costBaseMinor: 5_250_000, leftMinor: 955_000, leftCostBaseMinor: 5_013_750 }],
      },
      'IDR',
      '2026-11-20',
    );
    expect(plain(view.costText)).toBe('Rp 5.013.750');
    expect(view.rows).toEqual([{ key: 'w1-0', title: '2 Nov', value: '₺ 9.550 of ₺ 10.000 · Rp 525' }]);
    expect(view.shortfallText).toBe('₺ 300 spent with no withdrawal recorded, valued at the day’s rate');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && npx vitest run src/lib/withdrawal-rate.test.ts`
Expected: FAIL — `./withdrawal-rate` cannot be resolved.

- [ ] **Step 3: Write `withdrawal-rate.ts`**

`apps/web/src/lib/withdrawal-rate.ts`:

```ts
import { convertMinor, currencyInfo, formatMinor } from '@expanses/core';
import type { ForeignLotsView } from '@expanses/db';
import { shortDate } from '../features/transactions/quick-row';

/*
 * The withdrawal rate's words (spec §7), worked out away from the screens that show them so every figure can be tested
 * without a browser. Copy never says "you" or "your".
 */

type Rates = Readonly<Record<string, number>>;

const number = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 2 });

/** "₺ 300", "₺ 12,50": the currency's own symbol, cents only when there are some. */
export function foreignMoney(minor: number, currency: string): string {
  const { exponent, symbol } = currencyInfo(currency);
  const whole = minor % 10 ** exponent === 0;
  const digits = whole ? 0 : exponent;
  return `${symbol} ${(minor / 10 ** exponent).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** "Rp 525": base units per one foreign unit, with the base currency's symbol. */
const unitPrice = (costBaseMinor: number, minor: number, currency: string, baseCurrency: string) =>
  `${currencyInfo(baseCurrency).symbol} ${number(costBaseMinor / 10 ** currencyInfo(baseCurrency).exponent / (minor / 10 ** currencyInfo(currency).exponent))}`;

/**
 * The Add screen's and the receipt's line (§7): "≈ Rp 236.250 at the withdrawal rate (525)"; with money no withdrawal
 * covers, "≈ Rp 238.900 · ₺ 300 at today’s rate (no withdrawal recorded)"; with no rate for today, only the shortfall.
 */
export function withdrawalRateLine(cost: { costBaseMinor: number | null; uncoveredMinor: number; ratePerUnit: number | null }, currency: string, baseCurrency: string): string | null {
  if (cost.uncoveredMinor === 0) {
    if (cost.costBaseMinor === null || cost.ratePerUnit === null) return null;
    return `≈ ${formatMinor(cost.costBaseMinor, baseCurrency)} at the withdrawal rate (${number(cost.ratePerUnit)})`;
  }
  const uncovered = foreignMoney(cost.uncoveredMinor, currency);
  if (cost.costBaseMinor === null) return `${uncovered} has no withdrawal recorded and no rate for today yet`;
  return `≈ ${formatMinor(cost.costBaseMinor, baseCurrency)} · ${uncovered} at today’s rate (no withdrawal recorded)`;
}

/**
 * A cross-currency transfer's Rate row (§7, R15): "Rp 525 per TRY (market 512, +2,5 %)" — the foreign currency priced
 * in the base, against the day's rate held for it. Null when neither side is the base currency: that pair keeps its
 * plain "1 USD = 1,2760 SGD".
 */
export function transferRateText(input: { fromMinor: number; fromCurrency: string; toMinor: number; toCurrency: string; baseCurrency: string; ratesToBase: Rates }): string | null {
  const { fromMinor, fromCurrency, toMinor, toCurrency, baseCurrency, ratesToBase } = input;
  if (!(fromMinor > 0) || !(toMinor > 0) || fromCurrency === toCurrency) return null;
  const fromBase = fromCurrency === baseCurrency;
  if (!fromBase && toCurrency !== baseCurrency) return null;
  const foreign = fromBase ? toCurrency : fromCurrency;
  const baseMinor = fromBase ? fromMinor : toMinor;
  const foreignMinor = fromBase ? toMinor : fromMinor;
  const price = baseMinor / 10 ** currencyInfo(baseCurrency).exponent / (foreignMinor / 10 ** currencyInfo(foreign).exponent);
  const head = `${currencyInfo(baseCurrency).symbol} ${number(price)} per ${foreign}`;
  const market = ratesToBase[foreign];
  if (market === undefined || !(market > 0)) return head;
  const percent = (price / market - 1) * 100;
  const sign = percent > 0 ? '+' : percent < 0 ? '−' : '±';
  return `${head} (market ${number(market)}, ${sign}${Math.abs(percent).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %)`;
}

/**
 * An exchange out of a foreign account before it is saved (§5, §7): what arrived, at its own value — its amount in the
 * base currency, else the day's rate held for it (R6) — less what the foreign money cost. Null without a cost or a rate.
 */
export function exchangeOutPreview(input: { costBaseMinor: number | null; receivedMinor: number; receivedCurrency: string; baseCurrency: string; ratesToBase: Rates }): { receivedBaseMinor: number; gainLossBaseMinor: number } | null {
  if (input.costBaseMinor === null) return null;
  let receivedBaseMinor = input.receivedMinor;
  if (input.receivedCurrency !== input.baseCurrency) {
    const rate = input.ratesToBase[input.receivedCurrency];
    if (rate === undefined || !(rate > 0)) return null;
    receivedBaseMinor = convertMinor(input.receivedMinor, input.receivedCurrency, input.baseCurrency, rate);
  }
  return { receivedBaseMinor, gainLossBaseMinor: receivedBaseMinor - input.costBaseMinor };
}

export interface ExchangeResultLine {
  title: string;
  figure: string;
  note: string;
}

/** "Exchange loss Rp 10.000 (recorded as spending)" in its three parts (§7). */
export function exchangeResultLine(gainLossBaseMinor: number, baseCurrency: string): ExchangeResultLine {
  if (gainLossBaseMinor < 0) return { title: 'Exchange loss', figure: formatMinor(-gainLossBaseMinor, baseCurrency), note: 'recorded as spending' };
  if (gainLossBaseMinor > 0) return { title: 'Exchange gain', figure: formatMinor(gainLossBaseMinor, baseCurrency), note: 'recorded as income' };
  return { title: 'No exchange gain or loss', figure: formatMinor(0, baseCurrency), note: 'nothing recorded' };
}

export const exchangeResultText = (line: ExchangeResultLine) => `${line.title} ${line.figure} (${line.note})`;

/** The receipt's "From the 12 Nov withdrawal" or "From 2 withdrawals" (§7). */
export function fromWithdrawalsText(uses: readonly { lotId: string; lotDate: string }[], today: string): string | null {
  const lots = new Map(uses.map((use) => [use.lotId, use.lotDate]));
  if (lots.size === 0) return null;
  if (lots.size > 1) return `From ${lots.size} withdrawals`;
  return `From the ${shortDate([...lots.values()][0]!, today)} withdrawal`;
}

export interface WithdrawalsLeftView {
  costText: string;
  rows: { key: string; title: string; value: string }[];
  shortfallText: string | null;
}

/** The foreign account page's Cost and "Withdrawals left" (§7): each open lot as "₺ 9.550 of ₺ 10.000 · Rp 525". */
export function withdrawalsLeftView(lots: ForeignLotsView, baseCurrency: string, today: string): WithdrawalsLeftView {
  return {
    costText: formatMinor(lots.costBaseMinor, baseCurrency),
    rows: lots.open.map((lot, i) => ({
      key: `${lot.lotId}-${i}`,
      title: shortDate(lot.lotDate, today),
      value: `${foreignMoney(lot.leftMinor, lots.currency)} of ${foreignMoney(lot.minor, lots.currency)} · ${unitPrice(lot.costBaseMinor, lot.minor, lots.currency, baseCurrency)}`,
    })),
    shortfallText: lots.shortfallMinor > 0 ? `${foreignMoney(lots.shortfallMinor, lots.currency)} spent with no withdrawal recorded, valued at the day’s rate` : null,
  };
}

/** The first run's one notice (§6, R18). */
export const WITHDRAWAL_RATE_NOTICE = 'Foreign-currency spending now uses the withdrawal rate. Past months may change slightly.';
```

- [ ] **Step 4: Run the word tests**

Run: `cd apps/web && npx vitest run src/lib/withdrawal-rate.test.ts`
Expected: PASS. If `currencyInfo('IDR').symbol` is not `Rp` or `currencyInfo('TRY').symbol` is not `₺`, read `packages/core/src/money/currencies.ts` — they are (`symbol: 'Rp'`, `symbol: '₺'`).

- [ ] **Step 5: Write the queries**

`apps/web/src/lib/withdrawal-queries.ts`:

```ts
import { foreignCostPreview, foreignLots, withdrawalsUsedBy } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../app/context';

/*
 * The withdrawal rate's reads (spec §7). Every write ends in `useInvalidateAll`, which invalidates every query, so these
 * keys need no list of their own to be refreshed by.
 */

/** What spending `amountMinor` from a foreign account would cost, before Save (R20). Idle until there is an amount. */
export function useForeignCostPreview(input: { accountId: string; amountMinor: number | null; occurredOn: string; excludeTransactionId?: string | null; dayRate?: number | null }) {
  const { database, ws } = useApp();
  const enabled = !!input.accountId && input.amountMinor !== null && input.amountMinor > 0;
  return useQuery({
    queryKey: ['fx-preview', ws.workspaceId, input.accountId, input.amountMinor, input.occurredOn, input.excludeTransactionId ?? null, input.dayRate ?? null],
    enabled,
    queryFn: () =>
      foreignCostPreview(database, ws, { accountId: input.accountId, amountMinor: input.amountMinor!, occurredOn: input.occurredOn, excludeTransactionId: input.excludeTransactionId ?? null, dayRate: input.dayRate ?? null }),
  });
}

/** The withdrawals still held in a foreign account (the account page). */
export function useForeignLots(accountId: string | null) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['fx-lots', ws.workspaceId, accountId], enabled: !!accountId, queryFn: () => foreignLots(database, ws, accountId!) });
}

/** Which withdrawals a transaction's foreign money came from (the receipt). */
export function useWithdrawalsUsed(transactionId: string | null) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['fx-used', ws.workspaceId, transactionId], enabled: !!transactionId, queryFn: () => withdrawalsUsedBy(database, ws, transactionId!) });
}
```

- [ ] **Step 6: Write the failing test for the transfer preview**

`apps/web/src/features/transactions/transfer-preview.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { transferPreviewOf } from './transfer-preview';

/* §7's transfer between currencies, before Save. Invented figures. */
const plain = (text: string | null | undefined) => text?.replace(/ /g, ' ') ?? null;
const cost = (costBaseMinor: number | null) => ({ currency: 'TRY', costBaseMinor, coveredMinor: 50_000, coveredCostBaseMinor: costBaseMinor ?? 0, uncoveredMinor: 0, ratePerUnit: 525, lots: [] });

describe('transferPreviewOf', () => {
  it('into a foreign pocket from the base currency: only the Rate row', () => {
    const preview = transferPreviewOf({ fromMinor: 5_250_000, fromCurrency: 'IDR', toMinor: 1_000_000, toCurrency: 'TRY', fromHoldsLots: false, baseCurrency: 'IDR', ratesToBase: { TRY: 512 }, stale: false, cost: null });
    expect(plain(preview.rateText)).toBe('Rp 525 per TRY (market 512, +2,5 %)');
    expect(preview.result).toBeNull();
    expect(preview.costText).toBeNull();
  });

  it('out of a foreign pocket: Rate, Cost and the exchange result', () => {
    const preview = transferPreviewOf({ fromMinor: 50_000, fromCurrency: 'TRY', toMinor: 250_000, toCurrency: 'IDR', fromHoldsLots: true, baseCurrency: 'IDR', ratesToBase: { TRY: 512 }, stale: false, cost: cost(262_500) });
    expect(plain(preview.costText)).toBe('Rp 262.500');
    expect(preview.result?.title).toBe('Exchange loss');
    expect(preview.gainLossBaseMinor).toBe(-12_500);
  });

  it('nothing before both figures are typed', () => {
    expect(transferPreviewOf({ fromMinor: null, fromCurrency: 'TRY', toMinor: 250_000, toCurrency: 'IDR', fromHoldsLots: true, baseCurrency: 'IDR', ratesToBase: {}, stale: false, cost: null })).toEqual({ rateText: null, costText: null, result: null, stale: false, gainLossBaseMinor: null });
  });
});
```

- [ ] **Step 7: Write `transfer-preview.ts`**

`apps/web/src/features/transactions/transfer-preview.ts`:

```ts
import { evaluateAmount, formatMinor, isFxLotAccount } from '@expanses/core';
import type { AccountRow, ForeignCostPreview } from '@expanses/db';
import { useApp } from '../../app/context';
import { useForeignCostPreview } from '../../lib/withdrawal-queries';
import { exchangeOutPreview, exchangeResultLine, type ExchangeResultLine, transferRateText } from '../../lib/withdrawal-rate';
import { useHeldRates } from '../accounts/queries';
import { amountFields, type FormDraft, receivedField } from './tx-form';

/*
 * A transfer between currencies before Save (withdrawal rate §7, ruling R15), for the Transfer tab and the Move screen
 * alike: the Rate row, and — out of a foreign pocket — what the money cost and the gain or loss Save will record.
 */

export interface TransferPreview {
  rateText: string | null;
  costText: string | null;
  result: ExchangeResultLine | null;
  /** Read at rates held for an earlier day: the save fetches the day's own, so this is an estimate. */
  stale: boolean;
  gainLossBaseMinor: number | null;
}

const NOTHING: TransferPreview = { rateText: null, costText: null, result: null, stale: false, gainLossBaseMinor: null };

export function transferPreviewOf(input: {
  fromMinor: number | null;
  fromCurrency: string;
  toMinor: number | null;
  toCurrency: string;
  fromHoldsLots: boolean;
  baseCurrency: string;
  ratesToBase: Readonly<Record<string, number>>;
  stale: boolean;
  cost: ForeignCostPreview | null;
}): TransferPreview {
  const { fromMinor, toMinor } = input;
  if (fromMinor === null || toMinor === null || fromMinor <= 0 || toMinor <= 0) return NOTHING;
  const rateText = transferRateText({ fromMinor, fromCurrency: input.fromCurrency, toMinor, toCurrency: input.toCurrency, baseCurrency: input.baseCurrency, ratesToBase: input.ratesToBase });
  if (!input.fromHoldsLots || !input.cost) return { ...NOTHING, rateText, stale: input.stale };
  const out = exchangeOutPreview({ costBaseMinor: input.cost.costBaseMinor, receivedMinor: toMinor, receivedCurrency: input.toCurrency, baseCurrency: input.baseCurrency, ratesToBase: input.ratesToBase });
  return {
    rateText,
    costText: input.cost.costBaseMinor === null ? null : formatMinor(input.cost.costBaseMinor, input.baseCurrency),
    result: out ? exchangeResultLine(out.gainLossBaseMinor, input.baseCurrency) : null,
    stale: input.stale,
    gainLossBaseMinor: out?.gainLossBaseMinor ?? null,
  };
}

/** The same, read from a transfer draft: the two figures by the readers the save uses (`amountFields`, `receivedField`). */
export function useTransferPreview(draft: FormDraft, accounts: readonly AccountRow[], editingId: string | null): TransferPreview {
  const { ws } = useApp();
  const from = accounts.find((a) => a.id === draft.moneyId);
  const received = receivedField(draft, accounts);
  const leaves = amountFields(draft, accounts, ws.baseCurrency).amount;
  const fromMinor = received ? evaluateAmount(leaves.value, leaves.currency) : null;
  const toMinor = received ? evaluateAmount(received.value, received.currency) : null;
  const held = useHeldRates(received && from?.currency ? [from.currency, received.currency] : [], draft.occurredOn);
  const rates = held.data?.rates ?? {};
  const fromHoldsLots = !!from && !!received && isFxLotAccount(from, ws.baseCurrency);
  const cost = useForeignCostPreview({
    accountId: fromHoldsLots ? from!.id : '',
    amountMinor: fromMinor,
    occurredOn: draft.occurredOn,
    excludeTransactionId: editingId,
    dayRate: from?.currency ? (rates[from.currency] ?? null) : null,
  });
  if (!received || !from?.currency) return NOTHING;
  return transferPreviewOf({
    fromMinor,
    fromCurrency: from.currency,
    toMinor,
    toCurrency: received.currency,
    fromHoldsLots,
    baseCurrency: ws.baseCurrency,
    ratesToBase: rates,
    stale: (held.data?.stale ?? []).length > 0,
    cost: cost.data ?? null,
  });
}
```

- [ ] **Step 8: Read a gain or loss as part of a transfer (R8)**

In `apps/web/src/features/transactions/classify.ts`, change the import line to:

```ts
import { isExchangeResultKey } from '@expanses/core';
import type { TransactionView } from '@expanses/db';
```

and the two filters in `classify` to:

```ts
  // An exchange's gain or loss (withdrawal rate §5, R8) is booked on the transfer it came from; it never makes the
  // transfer read as spending or income, open in the wrong form, or show the wrong figure on its row.
  const expenses = tx.entries.filter((e) => e.accountKind === 'expense' && !isExchangeResultKey(e.accountSystemKey));
  const incomes = tx.entries.filter((e) => e.accountKind === 'income' && !isExchangeResultKey(e.accountSystemKey));
```

Append to `apps/web/src/features/transactions/classify.test.ts`:

```ts
describe('an exchange with its gain or loss (withdrawal rate R8)', () => {
  it('is still a transfer, out of the pocket and into the bank', () => {
    const entry = (id: string, accountKind: 'asset' | 'expense' | 'equity', amountMinor: number, currency: string, accountSystemKey: string | null = null, accountName = id) => ({
      id,
      accountId: id,
      accountName,
      accountKind,
      accountSystemKey,
      amountMinor,
      currency,
      fxRateToBase: 1,
      amountBaseMinor: amountMinor,
      memo: null,
      spendCategoryId: null,
    });
    const tx: TransactionView = {
      id: 'back',
      occurredOn: '2026-11-20',
      description: 'Back to rupiah',
      source: 'manual',
      status: 'posted',
      externalRef: null,
      originalCurrency: null,
      originalAmountMinor: null,
      mcc: null,
      cardId: null,
      goalId: null,
      createdAt: '2026-11-20T00:00:00Z',
      entries: [
        entry('lira', 'asset', -50_000, 'TRY', null, 'Lira cash'),
        entry('fx', 'equity', 50_000, 'TRY', 'currency_exchange'),
        entry('bank', 'asset', 250_000, 'IDR', null, 'Rupiah current'),
        entry('fx', 'equity', -250_000, 'IDR', 'currency_exchange'),
        entry('loss', 'expense', 12_500, 'IDR', 'expense.exchange_loss', 'Exchange loss'),
        entry('fx', 'equity', -12_500, 'IDR', 'currency_exchange'),
      ],
    };
    expect(classify(tx)).toMatchObject({ type: 'transfer', amountMinor: 250_000, currency: 'IDR', categoryIds: [], moneyAccountNames: ['Lira cash', 'Rupiah current'] });
  });
});
```

- [ ] **Step 9: Run the web tests and the typecheck**

Run: `cd apps/web && npx vitest run src/lib/withdrawal-rate.test.ts src/features/transactions/transfer-preview.test.ts src/features/transactions/classify.test.ts && cd ../.. && npm run test -w @expanses/web && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/withdrawal-rate.ts apps/web/src/lib/withdrawal-rate.test.ts apps/web/src/lib/withdrawal-queries.ts apps/web/src/features/transactions/transfer-preview.ts apps/web/src/features/transactions/transfer-preview.test.ts apps/web/src/features/transactions/classify.ts apps/web/src/features/transactions/classify.test.ts
git commit -m "The withdrawal rate's words and reads for the screens: the Add screen's line, a transfer's Rate against the market, an exchange's cost and gain or loss, the withdrawals left; an exchange with its gain or loss still reads as a transfer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 11: Web — the Add screen's line, the Transfer tab's Rate and result, the receipt

Spec §7 ("Transfer between currencies", "Spending from a foreign account (Add screen and receipt)"); rulings R15, R20.

**Files:**
- Create: `apps/web/src/features/transactions/WithdrawalLine.tsx`
- Create: `apps/web/src/features/transactions/TransferRates.tsx`
- Modify: `apps/web/src/features/transactions/TransactionCard.tsx` (two imports; one line after `<AmountRow …/>`; one line after the transfer card's `</FormRows>`)
- Modify: `apps/web/src/features/transactions/receipt-view.ts` (two optional inputs; two lines after Total)
- Modify: `apps/web/src/features/transactions/ReceiptPage.tsx` (one hook; two fields in the `receiptLines` call)
- Modify: `apps/web/src/features/transactions/receipt-view.test.ts` (one `describe` appended)

**Interfaces:**
- Consumes: `withdrawalRateLine`, `fromWithdrawalsText`, `exchangeResultText` (Task 10, `lib/withdrawal-rate.ts`); `useForeignCostPreview`, `useWithdrawalsUsed` (Task 10, `lib/withdrawal-queries.ts`); `useTransferPreview` (Task 10, `transfer-preview.ts`); `WithdrawalsUsed` (Task 8); `amountFields`, `FormDraft` (`tx-form.ts`); `useHeldRates` (`features/accounts/queries.ts`); `isFxLotAccount`, `evaluateAmount` (core).
- Produces:
  - `WithdrawalLine({ draft, accounts, editingId }: { draft: FormDraft; accounts: readonly AccountRow[]; editingId: string | null })` — `data-testid="withdrawal-rate"`.
  - `TransferRates({ draft, accounts, editingId }: { draft: FormDraft; accounts: readonly AccountRow[]; editingId: string | null })` — `data-testid="transfer-rate"`, `"exchange-cost"`, `"exchange-result"`.
  - `ReceiptInput.withdrawal?: WithdrawalsUsed | null`, `ReceiptInput.today?: string`; receipt lines "Cost" and "Withdrawn".

- [ ] **Step 1: Write the failing receipt test**

Append to `apps/web/src/features/transactions/receipt-view.test.ts`:

```ts
describe('a spend from foreign cash (withdrawal rate §7)', () => {
  const lira = [
    { id: 'acct-lira', name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' },
    { id: 'cat-restaurants', name: 'Restaurants', kind: 'expense', subtype: 'category', currency: null },
  ] as AccountRow[];
  const meal = {
    id: 'tx-lira',
    occurredOn: '2026-11-13',
    description: 'Fish by the harbour',
    status: 'posted',
    cardId: null,
    entries: [
      { accountId: 'acct-lira', accountKind: 'asset', amountMinor: -45_000, amountBaseMinor: -236_250, currency: 'TRY' },
      { accountId: 'cat-restaurants', accountKind: 'expense', amountMinor: 45_000, amountBaseMinor: 236_250, currency: 'TRY' },
    ],
  } as TransactionView;
  const used = (uses: { lotId: string; lotDate: string }[], uncoveredMinor = 0) => ({
    accountId: 'acct-lira',
    currency: 'TRY',
    minor: 45_000,
    costBaseMinor: 236_250,
    uncoveredMinor,
    ratePerUnit: 525,
    uses: uses.map((use) => ({ ...use, minor: 45_000 / uses.length, costBaseMinor: 236_250 / uses.length })),
  });

  it('says what it cost at the withdrawal rate, and which withdrawal it came from', () => {
    const lines = receiptLines({ tx: meal, accounts: lira, cards: [], currency: 'IDR', points: null, owed: [], withdrawal: used([{ lotId: 'w1', lotDate: '2026-11-12' }]), today: '2026-11-20' });
    expect(valueOf(lines, 'Cost')).toBe('≈ Rp 236.250 at the withdrawal rate (525)');
    expect(valueOf(lines, 'Withdrawn')).toBe('From the 12 Nov withdrawal');
  });

  it('counts two withdrawals, and says nothing for money that was not foreign', () => {
    const two = receiptLines({ tx: meal, accounts: lira, cards: [], currency: 'IDR', points: null, owed: [], withdrawal: used([{ lotId: 'w1', lotDate: '2026-11-02' }, { lotId: 'w2', lotDate: '2026-11-09' }]), today: '2026-11-20' });
    expect(valueOf(two, 'Withdrawn')).toBe('From 2 withdrawals');
    const none = receiptLines({ tx: meal, accounts: lira, cards: [], currency: 'IDR', points: null, owed: [], withdrawal: null });
    expect(none.map((line) => line.label)).not.toContain('Cost');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd apps/web && npx vitest run src/features/transactions/receipt-view.test.ts`
Expected: FAIL — no line labelled `Cost` (and a type error on `withdrawal`).

- [ ] **Step 3: Add the receipt's two lines**

In `apps/web/src/features/transactions/receipt-view.ts`:

Change the first import line to bring the type in, and add the words' import:

```ts
import type { AccountRow, CardRow, PersonDebtRow, PurchasePayer, TransactionView, WithdrawalsUsed } from '@expanses/db';
import { fromWithdrawalsText, withdrawalRateLine } from '../../lib/withdrawal-rate';
```

Add to `interface ReceiptInput`, after `payer?: PurchasePayer | null;`:

```ts
  /**
   * Which withdrawals a spend from foreign money came from, and what it cost at them (withdrawal rate §7). Null or
   * absent for anything that did not take foreign money; `currency` above is the base it is read in.
   */
  withdrawal?: WithdrawalsUsed | null;
  /** Today, for "From the 12 Nov withdrawal" (a withdrawal in another year names its year). */
  today?: string;
```

In `receiptLines`, immediately after `if (paid) lines.push({ label: 'Total', … });` add:

```ts
  // Withdrawal rate §7: what the foreign money cost, and which withdrawals it came from.
  if (input.withdrawal) {
    const cost = withdrawalRateLine(input.withdrawal, input.withdrawal.currency, input.currency);
    if (cost) lines.push({ label: 'Cost', value: cost });
    const from = fromWithdrawalsText(input.withdrawal.uses, input.today ?? tx.occurredOn);
    if (from) lines.push({ label: 'Withdrawn', value: from });
  }
```

In `apps/web/src/features/transactions/ReceiptPage.tsx`, add the import:

```ts
import { useWithdrawalsUsed } from '../../lib/withdrawal-queries';
```

after the `fromEvent` line (before any early `return`) add:

```ts
  // Withdrawal rate §7: the withdrawals a spend from foreign money came from.
  const withdrawal = useWithdrawalsUsed(tx?.id ?? null).data ?? null;
```

and add `withdrawal,` and `today,` to the `receiptLines({ … })` call, after `payer: payerOf(tx.id),`.

- [ ] **Step 4: Run the receipt test**

Run: `cd apps/web && npx vitest run src/features/transactions/receipt-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the Add screen's line**

`apps/web/src/features/transactions/WithdrawalLine.tsx`:

```tsx
import { evaluateAmount, isFxLotAccount } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { useApp } from '../../app/context';
import { useForeignCostPreview } from '../../lib/withdrawal-queries';
import { withdrawalRateLine } from '../../lib/withdrawal-rate';
import { useHeldRates } from '../accounts/queries';
import { amountFields, type FormDraft } from './tx-form';

/**
 * Spending from foreign cash (withdrawal rate §7, R20): what it comes to in the base currency at what that money cost,
 * oldest withdrawal first — "≈ Rp 236.250 at the withdrawal rate (525)" — under the amount, before Save. The figure that
 * posts is the one `amountFields` reads (the charged one when there are two). Nothing for any other account.
 */
export function WithdrawalLine({ draft, accounts, editingId }: { draft: FormDraft; accounts: readonly AccountRow[]; editingId: string | null }) {
  const { ws } = useApp();
  const account = accounts.find((a) => a.id === draft.moneyId);
  const foreign = !!account?.currency && draft.mode === 'expense' && isFxLotAccount(account, ws.baseCurrency);
  const fields = amountFields(draft, accounts, ws.baseCurrency);
  const field = fields.charged ?? fields.amount;
  const minor = foreign ? evaluateAmount(field.value, field.currency) : null;
  const held = useHeldRates(foreign ? [account!.currency!] : [], draft.occurredOn);
  const preview = useForeignCostPreview({
    accountId: foreign ? account!.id : '',
    amountMinor: minor !== null && minor > 0 ? minor : null,
    occurredOn: draft.occurredOn,
    excludeTransactionId: editingId,
    dayRate: foreign ? (held.data?.rates[account!.currency!] ?? null) : null,
  });
  if (!foreign || !preview.data) return null;
  const text = withdrawalRateLine(preview.data, account!.currency!, ws.baseCurrency);
  if (!text) return null;
  return (
    <p data-testid="withdrawal-rate" className="px-4 pt-1 pb-2 text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
      {text}
    </p>
  );
}
```

- [ ] **Step 6: Write the Transfer tab's Rate and result**

`apps/web/src/features/transactions/TransferRates.tsx`:

```tsx
import type { AccountRow } from '@expanses/db';
import { exchangeResultText } from '../../lib/withdrawal-rate';
import type { FormDraft } from './tx-form';
import { useTransferPreview } from './transfer-preview';

/**
 * Under a transfer between currencies (withdrawal rate §7, R15): the Rate against the market, and — out of foreign cash
 * — what that money cost and the gain or loss Save will record. Nothing until both figures are typed.
 */
export function TransferRates({ draft, accounts, editingId }: { draft: FormDraft; accounts: readonly AccountRow[]; editingId: string | null }) {
  const preview = useTransferPreview(draft, accounts, editingId);
  if (!preview.rateText && !preview.result) return null;
  return (
    <div className="space-y-1 px-4 pt-1 pb-2 text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
      {preview.rateText && <p data-testid="transfer-rate">Rate {preview.rateText}</p>}
      {preview.costText && <p data-testid="exchange-cost">Cost {preview.costText}</p>}
      {preview.result && (
        <p data-testid="exchange-result">
          {exchangeResultText(preview.result)}
          {preview.stale ? ' at the last-known rate' : ''}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Put both on the card**

In `apps/web/src/features/transactions/TransactionCard.tsx`, add beside the other local imports:

```ts
import { TransferRates } from './TransferRates';
import { WithdrawalLine } from './WithdrawalLine';
```

Immediately after the line `<AmountRow draft={draft} accounts={accounts} set={set} unsure={finish?.amountUnsure} selectOnOpen={!!duplicateOf} noRefund={!!finish} />` add:

```tsx
            {/* Withdrawal rate §7: what this foreign spend comes to at what the money cost. */}
            {draft.mode === 'expense' && <WithdrawalLine draft={draft} accounts={accounts} editingId={initial?.id ?? null} />}
```

In the transfer's second card — the block that ends

```tsx
          {received && (
            <InputRow label={received.label} value={received.value} onChange={(e) => set({ toAmount: e.target.value })} inputMode="decimal" required />
          )}
        </FormRows>
      )}
```

add right after that closing `)}`:

```tsx
      {/* Withdrawal rate §7, R15: the Rate against the market, and out of foreign cash its cost and gain or loss. */}
      {draft.mode === 'transfer' && crossCurrency && <TransferRates draft={draft} accounts={accounts} editingId={initial?.id ?? null} />}
```

- [ ] **Step 8: Run the web suite and the typecheck**

Run: `npm run test -w @expanses/web && npm run typecheck`
Expected: PASS. The screens themselves are walked in Task 14's journey; if an existing card test now finds an extra paragraph, it is one of these two (they render nothing for an account in the base currency, so an existing test only meets them if it pays from foreign cash).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/transactions/WithdrawalLine.tsx apps/web/src/features/transactions/TransferRates.tsx apps/web/src/features/transactions/TransactionCard.tsx apps/web/src/features/transactions/receipt-view.ts apps/web/src/features/transactions/ReceiptPage.tsx apps/web/src/features/transactions/receipt-view.test.ts
git commit -m "The Add screen says what a foreign spend comes to at the withdrawal rate, the Transfer tab gives the Rate against the market and an exchange's cost and gain or loss, and the receipt names the withdrawal the money came from

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 12: Web — the Move page and the foreign account page

Spec §7 ("Transfer between currencies", "Foreign account page: Cost, Worth today (market rate), and 'Withdrawals left' … A shortfall line when there is one"); ruling R15.

**Files:**
- Modify: `apps/web/src/features/accounts/MovePage.tsx`
- Create: `apps/web/src/features/accounts/WithdrawalsLeft.tsx`
- Modify: `apps/web/src/features/accounts/AccountPage.tsx` (one import; one line after `<SetAsidePanel …/>`)
- Modify: `apps/web/src/features/accounts/pockets.ts` (delete `spreadLine`; drop `ExchangeCost` from its import if unused)
- Modify: `apps/web/src/features/accounts/pockets.test.ts` (delete the `spreadLine` test and its import)
- Modify: `apps/web/e2e/currency-pockets.spec.ts` (three journeys' expectations)

**Interfaces:**
- Consumes: `useTransferPreview` (Task 10); `exchangeResultLine`, `withdrawalsLeftView` (Task 10); `useForeignLots` (Task 10); `exchangeResultOf(database, transactionId)` (Task 8); `approxLine`, `InsetGroup`, `InsetRow` (`ui/native`); `isFxLotAccount`, `isoDate` (core).
- Produces: `WithdrawalsLeft({ account, balanceMinor, rates }: { account: AccountRow; balanceMinor: number; rates: { rates: Record<string, number>; stale: string[] } | undefined })` with `data-testid` `fx-cost`, `fx-worth`, `lot-<lotId>-<i>`, `fx-shortfall`. The Move page's `testId="spread"` row now holds the exchange result (kept so the journeys that read it still do), `testId="exchange-cost"` its cost, `testId="recorded-spread"` the recorded result.

- [ ] **Step 1: Update the Move journeys to what the screen will say (they fail until Step 3)**

In `apps/web/e2e/currency-pockets.spec.ts`:

In `test('moving between pockets moves what the screen shows and says what the bank’s rate cost', …)` replace

```ts
  await expect(page.getByText('The bank’s rate cost extra')).toBeVisible();
  await expect(page.getByTestId('spread')).toContainText('35.160');
```

with

```ts
  // Withdrawal rate §5: the dollars cost 16.250 each when they came in; the dollars changed are 8.125.000 of that, and
  // the 638 SGD that arrived are worth 8.089.840 at the day's 12.680 — a loss, recorded as spending.
  await expect(page.getByTestId('exchange-cost')).toContainText('8.125.000');
  await expect(page.getByTestId('spread')).toContainText('Exchange loss');
  await expect(page.getByTestId('spread')).toContainText('35.160');
```

In `test('a spread shown at last-known rates says so, and the move shows the spread it recorded at the day’s rates (I1)', …)` replace

```ts
  // 500 × 16.400 − 638 × 12.800: what the ledger records, at the rates the save fetched.
  await expect(page.getByTestId('recorded-spread')).toContainText('33.600');
```

with

```ts
  // What the ledger records (withdrawal rate §5): the dollars still cost 8.125.000 — the day's 16.400 changes nothing
  // about what they cost — and 638 SGD at the day's 12.800 are 8.166.400: a gain of 41.400.
  await expect(page.getByTestId('recorded-spread')).toContainText('Exchange gain');
  await expect(page.getByTestId('recorded-spread')).toContainText('41.400');
```

(`test('USD → IDR between pockets …')` keeps `toContainText('3.125')`: 100,50 dollars cost 1.633.125 and 1.630.000 arrived — the same figure, now a loss. `phone-currency-pockets.spec.ts` keeps its `35.160`.)

- [ ] **Step 2: Write the foreign account page's block**

`apps/web/src/features/accounts/WithdrawalsLeft.tsx`:

```tsx
import { isoDate } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { useApp } from '../../app/context';
import { useForeignLots } from '../../lib/withdrawal-queries';
import { withdrawalsLeftView } from '../../lib/withdrawal-rate';
import { approxLine, InsetGroup, InsetRow } from '../../ui/native';

/**
 * A foreign pocket's page (withdrawal rate §7): what the money held cost, what it is worth at today's market rate, and
 * each withdrawal still in it — date, what is left of it, the rate it came at — with a line for money spent before any
 * withdrawal was recorded.
 */
export function WithdrawalsLeft({ account, balanceMinor, rates }: { account: AccountRow; balanceMinor: number; rates: { rates: Record<string, number>; stale: string[] } | undefined }) {
  const { ws } = useApp();
  const lots = useForeignLots(account.id);
  if (!lots.data) return null;
  const view = withdrawalsLeftView(lots.data, ws.baseCurrency, isoDate());
  const worth = approxLine(balanceMinor, account.currency!, ws.baseCurrency, rates?.rates ?? {});
  return (
    <>
      <InsetGroup header="What it cost">
        <InsetRow testId="fx-cost" title="Cost" value={view.costText} valueTone="ink" chevron={false} />
        <InsetRow testId="fx-worth" title="Worth today" value={worth ?? '—'} valueTone="ink" chevron={false} />
      </InsetGroup>
      {(view.rows.length > 0 || view.shortfallText) && (
        <InsetGroup header="Withdrawals left">
          {view.rows.map((row) => (
            <InsetRow key={row.key} testId={`lot-${row.key}`} title={row.title} value={row.value} chevron={false} />
          ))}
          {view.shortfallText && <InsetRow testId="fx-shortfall" title="No withdrawal" value={view.shortfallText} chevron={false} />}
        </InsetGroup>
      )}
    </>
  );
}
```

In `apps/web/src/features/accounts/AccountPage.tsx` add the imports:

```ts
import { isFxLotAccount } from '@expanses/core';
import { WithdrawalsLeft } from './WithdrawalsLeft';
```

(merge `isFxLotAccount` into the existing `import { isoDate, takesPockets } from '@expanses/core';`), and right after `<SetAsidePanel accountId={account.id} />` add:

```tsx
      {/* Withdrawal rate §7: what the foreign money held cost, and the withdrawals still in it. */}
      {!pockets && isFxLotAccount(account, ws.baseCurrency) && <WithdrawalsLeft account={account} balanceMinor={minor} rates={rates.data} />}
```

- [ ] **Step 3: Give the Move page the Rate row and the exchange result**

In `apps/web/src/features/accounts/MovePage.tsx`:

Replace the imports from `@expanses/core`, `@expanses/db` and `./pockets` with:

```ts
import { evaluateAmount, formatMinor, isoDate } from '@expanses/core';
import { type AccountRow, exchangeResultOf, postTransaction } from '@expanses/db';
import { exchangeResultLine } from '../../lib/withdrawal-rate';
import { useTransferPreview } from '../transactions/transfer-preview';
import { bankRateText, currencyName, moveDescription, moveDraft, moveView, pocketsOf, withPockets } from './pockets';
```

Inside `MoveBody`:

- replace `const [recorded, setRecorded] = useState<ExchangeCost | null>(null);` and its comment with

```ts
  /** The gain or loss the ledger recorded, kept only when it is not the one the screen showed (R15, spec §10.3 of pockets). */
  const [recorded, setRecorded] = useState<number | null>(null);
```

- replace `const spread = spreadLine(view.cost, ws.baseCurrency);` with

```ts
  // Withdrawal rate §7: the Rate against the market, and out of a foreign pocket its cost and gain or loss.
  const preview = useTransferPreview(draft, accounts, null);
```

- in `save()`, replace

```ts
      await postTransaction(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice });
      await invalidate();
      // The posting converts at the rates the save resolved, which need not be the ones on screen. When the spread
      // the ledger now holds differs from the one shown, say so instead of leaving the screen's figure standing.
      const posted = moveView(final, accounts, ws.baseCurrency, ratesToBase).cost;
      if (posted && posted.costMinor !== view.cost?.costMinor) {
        setRecorded(posted);
        return;
      }
```

with

```ts
      const id = await postTransaction(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice });
      await invalidate();
      // What arrived is valued at the day's rate the save fetched, which need not be the one on screen. When the gain or
      // loss the ledger now holds differs from the one shown, say so instead of leaving the screen's figure standing.
      if (preview.gainLossBaseMinor !== null) {
        const gainLoss = await exchangeResultOf(database, id);
        if (gainLoss !== preview.gainLossBaseMinor) {
          setRecorded(gainLoss);
          return;
        }
      }
```

- replace the `if (recorded) { … }` screen with

```tsx
  if (recorded !== null) {
    const line = exchangeResultLine(recorded, ws.baseCurrency);
    return (
      <div className={SCREEN}>
        <LargeTitle title="Moved" back={parent.name} backTo="/accounts/$accountId" backParams={{ accountId: parent.id }} />
        <InsetGroup header="Recorded" footer={`The move was recorded at the rates for ${rateDate}, not the ones the screen showed, so this is the result the ledger holds.`}>
          <InsetRow testId="recorded-spread" title={line.title} value={`${line.figure} (${line.note})`} valueTone="ink" chevron={false} />
        </InsetGroup>
        <InsetGroup>
          <InsetRow title="Done" chevron={false} onClick={() => void navigate({ to: '/accounts/$accountId', params: { accountId: parent.id } })} />
        </InsetGroup>
      </div>
    );
  }
```

- replace the `Bank's rate` row with

```tsx
        <ReadOnlyRow label="Rate" value={preview.rateText ?? bankRateText(view.bankRate, view.leaves.currency, view.arrives?.currency ?? view.leaves.currency)} />
```

- replace the whole `{spread && view.cost && ( <InsetGroup …> … </InsetGroup> )}` block with

```tsx
      {preview.result && (
        <InsetGroup
          footer={
            preview.stale
              ? `At the last-known ${[view.leaves.currency, view.arrives?.currency].filter(Boolean).join(', ')} rates: moving it fetches the day’s rates and records the result at those, which may differ.`
              : `Cost is what ${formatMinor(evaluateOrZero(view.leaves), view.leaves.currency)} cost when it came in, oldest first; what arrives is valued at the day’s rate.`
          }
        >
          <InsetRow testId="exchange-cost" title="Cost" value={preview.costText ?? '—'} valueTone="ink" chevron={false} />
          <InsetRow
            testId="spread"
            title={preview.stale ? `${preview.result.title} (last known)` : preview.result.title}
            value={`${preview.result.figure} (${preview.result.note})`}
            valueTone="ink"
            chevron={false}
          />
        </InsetGroup>
      )}
```

- delete the now-unused `lastKnown` constant and the `ExchangeCost` import. Keep `evaluateOrZero` (the footer uses it).

- [ ] **Step 4: Delete `spreadLine`**

In `apps/web/src/features/accounts/pockets.ts`, delete `spreadLine` and its doc comment, and drop `type ExchangeCost` from the core import if nothing else in the file uses it (`MoveView.cost` does — keep it then). In `apps/web/src/features/accounts/pockets.test.ts`, delete the test that calls `spreadLine` and remove `spreadLine` from the import list.

- [ ] **Step 5: Run the unit tests, the typecheck, and the Move journeys**

Run: `npm run test -w @expanses/web && npm run typecheck && cd apps/web && npx playwright test e2e/currency-pockets.spec.ts e2e/phone-currency-pockets.spec.ts`
Expected: PASS. `getByText('1 USD = 1,2760 SGD')` still holds: neither side of USD → SGD is the base currency, so the Rate row keeps `bankRateText` (R15).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/accounts/MovePage.tsx apps/web/src/features/accounts/WithdrawalsLeft.tsx apps/web/src/features/accounts/AccountPage.tsx apps/web/src/features/accounts/pockets.ts apps/web/src/features/accounts/pockets.test.ts apps/web/e2e/currency-pockets.spec.ts
git commit -m "The Move page rates a move against the market and says what an exchange out of a foreign pocket cost and gained or lost; a foreign pocket's page shows its cost, its worth today and the withdrawals left in it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 13: Web — the first run after the update, in batches, and its one notice

Spec §6 ("First run after the update: recalculates every foreign account once from its first entry, then shows once: …"); §10.5; ruling R18. Review Focus 5.

**Files:**
- Create: `apps/web/src/features/accounts/withdrawal-rate-start.ts`
- Create: `apps/web/src/features/accounts/WithdrawalRateNotice.tsx`
- Modify: `apps/web/src/app/Layout.tsx` (two imports; one hook call; one element after `<AfterUpdateCard />`)
- Test: `apps/web/src/features/accounts/withdrawal-rate-start.test.ts`

**Interfaces:**
- Consumes: `recalcPendingForeign(database, { limit })`, `withdrawalRateNoticeDue`, `dismissWithdrawalRateNotice` (Task 7, exported by Task 9); `WITHDRAWAL_RATE_NOTICE` (Task 10); `openAppDb` (`apps/web/src/db/bootstrap.ts`).
- Produces:
  - `recalcInBatches(database: Database, opts?: { yieldTo?: () => Promise<void>; stopped?: () => boolean }): Promise<number>` — one account per call to the db, a turn for the app between; returns how many accounts it took off the queue.
  - `useForeignRecalcAtStart(): void` — started by `Layout` after the first paint.
  - `WithdrawalRateNotice()` — `role="status"`, `data-testid="withdrawal-rate-notice"`, an OK button that dismisses it for good.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/accounts/withdrawal-rate-start.test.ts`:

```ts
import { expenseLines } from '@expanses/core';
import { createAccount, createDatabase, createWorkspace, listAccounts, MemoryKeyStore, migrate, MIGRATIONS, postTransaction, withdrawalRateNoticeDue } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openAppDb } from '../../db/bootstrap';
import { recalcInBatches } from './withdrawal-rate-start';

/*
 * The first run after the update (withdrawal rate §6, R18; Review Focus 5). Three foreign cash accounts from before
 * migration 0071, each opened at one rate and spent from at a later day's: invented figures throughout.
 */
async function beforeTheUpdate() {
  const database = createDatabase(createNodeExecutor());
  await migrate(database, MIGRATIONS.filter((m) => m.version < 71));
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const restaurants = (await listAccounts(database, ws)).find((a) => a.name === 'Restaurants')!.id;
  for (const [name, currency, opened, spent] of [
    ['Lira cash', 'TRY', 512, 530],
    ['Euro cash', 'EUR', 17_500, 17_800],
    ['Dollar cash', 'USD', 16_250, 16_400],
  ] as const) {
    const id = (await createAccount(database, ws, { name, kind: 'asset', subtype: 'cash', currency, openingBalanceMinor: 100_000, openingRateToBase: opened, openedOn: '2026-11-01' })).id;
    await postTransaction(database, ws, {
      occurredOn: '2026-11-03',
      description: `Dinner in ${currency}`,
      lines: expenseLines({ categoryAccountId: restaurants, paymentAccountId: id, amountMinor: 4_500, currency }),
      ratesToBase: { [currency]: spent },
    });
  }
  return { database, ws };
}

const queued = async (database: Awaited<ReturnType<typeof beforeTheUpdate>>['database']) => Number((await database.db.values<[number]>(sql`SELECT count(*) FROM fx_recalc_pending`))[0]![0]);

describe('the first run after the update (R18)', () => {
  it('opens the app without recalculating anything: the work waits for the screen (Review Focus 5)', async () => {
    const { database } = await beforeTheUpdate();
    await openAppDb(database, undefined, { keyStore: new MemoryKeyStore() });
    expect(await queued(database)).toBe(3);
    expect(await withdrawalRateNoticeDue(database)).toBe(false);
  });

  it('recalculates one account at a time, giving the app a turn between, then the notice is due', async () => {
    const { database } = await beforeTheUpdate();
    await migrate(database);
    const turns: number[] = [];
    const done = await recalcInBatches(database, { yieldTo: async () => void turns.push(await queued(database)) });
    expect(done).toBe(3);
    expect(turns).toEqual([2, 1]);
    expect(await withdrawalRateNoticeDue(database)).toBe(true);
    // ₺45 spent from lira opened at 512: Rp 23.040, not the Rp 23.850 it was posted at on a 530 day.
    const [[base]] = await database.db.values<[number]>(sql`
      SELECT e.amount_base_minor FROM entries e JOIN transactions t ON t.id = e.transaction_id JOIN accounts a ON a.id = e.account_id
      WHERE t.description = 'Dinner in TRY' AND a.kind = 'expense'`);
    expect(Number(base)).toBe(23_040);
  });

  it('stops between accounts when the screen goes away', async () => {
    const { database } = await beforeTheUpdate();
    await migrate(database);
    let stop = false;
    const done = await recalcInBatches(database, { yieldTo: async () => void (stop = true), stopped: () => stop });
    expect(done).toBe(1);
    expect(await queued(database)).toBe(2);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && npx vitest run src/features/accounts/withdrawal-rate-start.test.ts`
Expected: FAIL — `./withdrawal-rate-start` cannot be resolved.

- [ ] **Step 3: Write the runner**

`apps/web/src/features/accounts/withdrawal-rate-start.ts`:

```ts
import { type Database, recalcPendingForeign } from '@expanses/db';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApp } from '../../app/context';

/*
 * The first run after the withdrawal-rate update (spec §6, R18), and anything apply left queued (R9). Never part of
 * opening the app: it starts once the shell has painted, takes one account per db transaction, and gives the app a turn
 * between accounts, so a long history never stands between a person and the screen they opened.
 */

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Drains the queue one account at a time; how many accounts it took off. Stops early when `stopped` says so. */
export async function recalcInBatches(database: Database, opts: { yieldTo?: () => Promise<void>; stopped?: () => boolean } = {}): Promise<number> {
  const yieldTo = opts.yieldTo ?? nextTurn;
  let total = 0;
  for (;;) {
    if (opts.stopped?.()) return total;
    const { done, left } = await recalcPendingForeign(database, { limit: 1 });
    total += done;
    if (done === 0 || left === 0) return total;
    await yieldTo();
  }
}

/** Started by the shell after its first paint; every figure on screen is read again once something was recalculated. */
export function useForeignRecalcAtStart(): void {
  const { database } = useApp();
  const queryClient = useQueryClient();
  useEffect(() => {
    let stopped = false;
    void recalcInBatches(database, { stopped: () => stopped })
      .then((done) => {
        if (!stopped && done > 0) void queryClient.invalidateQueries();
      })
      .catch((error: unknown) => console.warn('Foreign accounts could not be recalculated yet; trying again at the next open', error));
    return () => {
      stopped = true;
    };
  }, [database, queryClient]);
}
```

- [ ] **Step 4: Write the notice**

`apps/web/src/features/accounts/WithdrawalRateNotice.tsx`:

```tsx
import { dismissWithdrawalRateNotice, withdrawalRateNoticeDue } from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { WITHDRAWAL_RATE_NOTICE } from '../../lib/withdrawal-rate';

/** Said once, after the first run has recalculated every foreign account (§6, R18). OK puts it away for good. */
export function WithdrawalRateNotice() {
  const { database } = useApp();
  const queryClient = useQueryClient();
  const due = useQuery({ queryKey: ['withdrawal-rate-notice'], queryFn: () => withdrawalRateNoticeDue(database) });
  if (!due.data) return null;
  const dismiss = async () => {
    await dismissWithdrawalRateNotice(database);
    await queryClient.invalidateQueries({ queryKey: ['withdrawal-rate-notice'] });
  };
  return (
    <div role="status" data-testid="withdrawal-rate-notice" className="mb-4 flex items-start gap-3 rounded-[12px] bg-[var(--ph-surface)] p-4 text-[15px] leading-5 text-[var(--ph-ink)]">
      <p className="flex-1">{WITHDRAWAL_RATE_NOTICE}</p>
      <button type="button" onClick={() => void dismiss()} className="shrink-0 text-[15px] font-medium text-[var(--ph-tint)]">
        OK
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Start both from the shell**

In `apps/web/src/app/Layout.tsx` add the imports:

```ts
import { useForeignRecalcAtStart } from '../features/accounts/withdrawal-rate-start';
import { WithdrawalRateNotice } from '../features/accounts/WithdrawalRateNotice';
```

After `useICloudBackupAtStart(database);` add:

```ts
  // Withdrawal rate (R18): foreign accounts recalculated behind whatever is on screen, one at a time.
  useForeignRecalcAtStart();
```

After `<AfterUpdateCard />` add:

```tsx
          <WithdrawalRateNotice />
```

- [ ] **Step 6: Run the tests, the web suite and the typecheck**

Run: `cd apps/web && npx vitest run src/features/accounts/withdrawal-rate-start.test.ts && cd ../.. && npm run test -w @expanses/web && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/accounts/withdrawal-rate-start.ts apps/web/src/features/accounts/WithdrawalRateNotice.tsx apps/web/src/app/Layout.tsx apps/web/src/features/accounts/withdrawal-rate-start.test.ts
git commit -m "The first run after the update recalculates foreign accounts one at a time behind the screen, never while the app opens, and then says once that foreign spending now uses the withdrawal rate

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 14: End to end — the journey, and every journey still green

Spec §7 as a person walks it; Review Focus 1 and 4 seen on screen. Invented figures throughout (lira at 525 against a market 512).

**Files:**
- Create: `apps/web/e2e/withdrawal-rate.spec.ts`
- Modify: any other journey whose figures the withdrawal rate changes (Step 3's rule; list them in the commit message)

**Interfaces:**
- Consumes: everything above; e2e helpers `mockRates`, `openWithPockets` (`e2e/pockets.ts`), `addForm`, `choosePayment`, `openAmount`, `fillAmount`, `saveButton` (`e2e/add-transaction.ts`).
- Produces: nothing new.

- [ ] **Step 1: Write the journey**

`apps/web/e2e/withdrawal-rate.spec.ts`:

```ts
import { expect, type Page, test } from '@playwright/test';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';
import { mockRates, openWithPockets } from './pockets';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/* Withdrawal rate §7. A travel account with a rupiah pocket and an empty lira pocket; every figure invented. */
const TRAVEL = { name: 'Travel Money', pockets: [{ currency: 'IDR', balance: '10000000' }, { currency: 'TRY', balance: '' }] };

async function move(page: Page, from: string, to: string, leaves: string, arrives: string) {
  await page.goto('/accounts');
  await page.getByRole('link', { name: 'Travel Money', exact: true }).click();
  await page.getByRole('link', { name: 'Move', exact: true }).click();
  await page.getByLabel('From').selectOption(from);
  await page.getByLabel('To').selectOption(to);
  await page.getByLabel(`Leaves ${from}`).pressSequentially(leaves);
  await page.getByLabel(`Arrives ${to}`).pressSequentially(arrives);
}

async function spendLira(page: Page, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, 'Travel Money · TRY');
  await openAmount(form);
  await fillAmount(page, form, amount);
  return form;
}

async function saveAs(page: Page, form: ReturnType<typeof addForm>, note: string) {
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill(note);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
}

async function openLiraPocket(page: Page) {
  await page.goto('/accounts');
  await page.getByRole('link', { name: 'Travel Money', exact: true }).click();
  await page.getByTestId('pocket-TRY').click();
}

test('lira withdrawn at 525 is spent at 525, the receipt names the withdrawal, and changing leftovers back says what was lost', async ({ page }) => {
  await mockRates(page, { TRY: 512 });
  await openWithPockets(page, TRAVEL);

  // The withdrawal: Rp 5.250.000 for ₺10.000. The device holds no lira rate before its first save, so the Rate row
  // has no market to compare with yet; the move back below has one.
  await move(page, 'IDR', 'TRY', '5250000', '10000');
  await expect(page.getByText(/^Rp 525 per TRY/)).toBeVisible();
  await page.getByRole('button', { name: 'Move it' }).click();
  await expect(page.getByTestId('pocket-TRY')).toContainText('10.000,00');

  // ₺450 for dinner: Rp 236.250 at the withdrawal rate, not the market's Rp 230.400.
  const form = await spendLira(page, '450');
  await expect(form.getByTestId('withdrawal-rate')).toHaveText('≈ Rp 236.250 at the withdrawal rate (525)');
  await saveAs(page, form, 'Fish by the harbour');

  // The receipt: the same figure, and the withdrawal it came from.
  await page.getByRole('link', { name: 'Receipt for Fish by the harbour' }).click();
  await expect(page.getByText('≈ Rp 236.250 at the withdrawal rate (525)')).toBeVisible();
  await expect(page.getByText(/^From the \d{1,2} [A-Z][a-z]{2}( \d{4})? withdrawal$/)).toBeVisible();

  // The pocket: what the ₺9.550 left cost, and the withdrawal it is what is left of.
  await openLiraPocket(page);
  await expect(page.getByTestId('fx-cost')).toContainText('5.013.750');
  await expect(page.locator('[data-testid^="lot-"]')).toContainText('₺ 9.550 of ₺ 10.000 · Rp 525');

  // ₺500 changed back for Rp 250.000 (the day's 512 is held now): they cost Rp 262.500, so Rp 12.500 is lost, recorded
  // as spending.
  await move(page, 'TRY', 'IDR', '500', '250000');
  await expect(page.getByText('Rp 500 per TRY (market 512, −2,3 %)')).toBeVisible();
  await expect(page.getByTestId('exchange-cost')).toContainText('262.500');
  await expect(page.getByTestId('spread')).toContainText('Exchange loss');
  await expect(page.getByTestId('spread')).toContainText('12.500');
  await expect(page.getByTestId('spread')).toContainText('recorded as spending');
  await page.getByRole('button', { name: 'Move it' }).click();
  await expect(page.getByTestId('pocket-TRY')).toContainText('9.050,00');
});

test('lira spent before any withdrawal was recorded says so, on the Add screen, the receipt and the pocket', async ({ page }) => {
  await mockRates(page, { TRY: 512 });
  await openWithPockets(page, TRAVEL);

  // Nothing came into the lira pocket, and the device holds no lira rate yet: only the uncovered amount is named.
  const form = await spendLira(page, '450');
  await expect(form.getByTestId('withdrawal-rate')).toHaveText('₺ 450 has no withdrawal recorded and no rate for today yet');
  await saveAs(page, form, 'Street snack');

  // Saved at the day's 512 (fetched on Save): the receipt values it there, and says no withdrawal covered it.
  await page.getByRole('link', { name: 'Receipt for Street snack' }).click();
  await expect(page.getByText('≈ Rp 230.400 · ₺ 450 at today’s rate (no withdrawal recorded)')).toBeVisible();
  await expect(page.getByText(/^From the .* withdrawal$/)).toHaveCount(0);

  await openLiraPocket(page);
  await expect(page.getByTestId('fx-shortfall')).toContainText('₺ 450 spent with no withdrawal recorded, valued at the day’s rate');
});
```

- [ ] **Step 2: Run the journey**

Run: `cd apps/web && npx playwright test e2e/withdrawal-rate.spec.ts --project=chromium`
Expected: PASS. If the payer sheet names the pocket differently, read the names it offers in `e2e/currency-pockets.spec.ts` (`'Valas Plus · IDR'`): a pocket is offered as `<account> · <code>`.

- [ ] **Step 3: Run every journey and bring the figures the withdrawal rate changes up to date**

Run: `cd apps/web && npx playwright test`

The same rule as Task 7 Step 7: a journey that read a base-currency figure, a spread or a filing for money leaving a foreign money account gets the §4/§5 figure worked out by hand, with a one-line comment naming the rule; anything else (a refused save, a missing row, a figure in a base-currency-only journey, a sideways scroll at 390 px) is a bug in Tasks 1–13 and is fixed there.

- [ ] **Step 4: Run every unit suite, the capture run and the typecheck once more**

Run: `npm run test && npm run test:capture && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/withdrawal-rate.spec.ts
git add -u apps/web/e2e
git commit -m "Journey: lira withdrawn at 525 is spent at 525 on the Add screen, the receipt and the pocket page, a spend with no withdrawal says so, and changing leftovers back shows the loss recorded as spending

Updated journeys (withdrawal rate §4/§5): one line per journey changed in Step 3 — spec, test name, the rule it now follows — or 'none'

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
