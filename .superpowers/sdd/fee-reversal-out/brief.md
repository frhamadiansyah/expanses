# Brief: a reversed annual fee is left out (feat/fee-reversal-out)

Owner approved option 1 of `docs/mockups/2026-11-22-fee-same-everywhere.html` on 2026-11-22.

## What the owner wants (option 1: "A reversed fee is left out")
A card's annual fee that has been **reversed** (money back for that year's fee on the card) is left out of every
report/Cashflow total — **both the fee charge and its reversal** — shown grey as Rp0 with "⊘ Rp800.000" under it, the
same look the app already uses for excluded rows. As if the fee was never charged. Each month then shows only real
spending (today the fee pushes its month up and the reversal pulls a later month down).

- A fee that is **not** reversed still counts as spending, as now.
- Starting balances are never touched. Card balances / what is owed never change (only report counting).
- Every card looks the same: card A (fee charged after the card was in the app, today: fee counts, reversal
  +Rp800.000 green) and card B (fee charged before the card's start day, today: no fee row, reversal already ⊘ via
  `excludedFromReport: true` in `addFeeReversal`) must both end up with grey ⊘ reversal rows; card A's fee row also grey.
- Fee page ("This year's fee" / earlier years, `apps/web/src/features/cards/FeeYearGroups.tsx`, `fee-line.ts`): the
  before-the-app charged line currently reads "Charged · 12 Aug · before the app". Make it read like any charged line:
  "12 Aug · Rp 800.000", using the card's annual fee amount (feeMinor) when there is no charge row. If no fee amount is
  set, fall back to the current words.
- Existing data must follow the rule with no action from the owner: e.g. her card whose fee and reversal are both
  already recorded and counting must turn grey after the update.
- If the reversal is removed (Reset on the fee page, or the reversal transaction deleted/voided from Cashflow), the fee
  counts again. If the fee charge is deleted, nothing else changes wrongly.

## Where to look
- `packages/db/src/repos/card-fee.ts`: `chargesNear`, `feeYearTx`, `addFeeReversal`, `undoFeeWaived`, `card_fee_refunds`.
- `packages/core/src/points/fee-year.ts` (feeYearLines/feeYearState).
- How reports/Cashflow honour `excluded_from_report`: Cashflow lists and totals, month totals, budgets, Health, Income
  page, category breakdowns, tax report, etc.

## Mechanism: decide deliberately and explain
(a) Stored flag on both transactions, kept right on every path, backfilled, synced; or (b) computed at read time
(reports treat the matched pair as excluded; keep it fast). Pick the simpler, safer one for "data safety first" and
"keep rules simple". One plain rule, no guess-states.

## Rules
- UI copy: no "you"/"your". Invented data only in tests/fixtures (no real figures).
- Tests: unit tests in core/db for the rule (pair excluded; unreversed fee counts; reversal removed → fee counts again;
  before-app card; typed-by-hand refund matched; partial reversal — decide and state). An e2e spec showing both card
  cases grey in Cashflow and the fee page line. Run tsc, the relevant vitest suites, the e2e specs touched plus the
  existing fee/card/cashflow specs. Note pre-existing failures on main separately.
- Screenshot the phone fee page and the Cashflow rows (390 wide) at the end.
- Do not merge or push; the coordinator merges.

## Decisions taken (implementer, 2026-11-22)
- **Computed, never stored.** `feeLeftOutIds` (packages/db/src/repos/fee-left-out.ts) reads each fee card's years with
  the fee page's own reading (`cardFeeYears`) and names the transactions left out; reports, Cashflow totals and rows
  read it beside the stored exclude mark. Nothing is written, so no migration, no backfill, no sync change, no stale
  flag, and the owner's own exclude mark is never touched. Cached per database until anything is written.
- Only a fee given back **in full** (within 1%) is left out with its reversal. A fee given back in part counts as
  before (charge in its month, money back in its month), so the part kept by the bank is still spending.
- Money back with no charge row (before the app, or a charge never recorded) is always left out.
- A fee inside a split charge (or a reversal inside a split) is left as it is: hiding the whole charge would hide the
  other spending in it.
- Only cards with a fee date set (the fee page needs it) follow the rule.

## Scope addition 1 (owner, 2026-11-22): the before-the-app card looks paired
When a fee year's charge date is before the card's start day (no fee row; `beforeApp`) and that fee is reversed, the
app also has a fee charge row for it: dated the fee's charge date, amount = the reversal's, Membership fee,
"Annual fee", on the card, excluded from reports like its reversal. What the card owes must not change (take it off the
starting balance in one database transaction); Settings and every place showing the starting balance still show what
the owner typed; existing before-app reversals get their row once, idempotent, never twice across the household's
phones; Reset / removing the reversal removes the row and puts everything back exactly; decide what deleting the row by
hand does; the fee page reads it as a real charged line ("Open the charge"). Tests: balances and net worth identical
before/after at every date, undo round-trip, backfill run twice = one row.

### Decisions taken
- The fee row is posted **paid off before the app** (the ledger's existing `settledBeforeApp`): a settlement against
  Opening Balances on the same day, in the same database transaction. The owner's typed opening entry is never edited,
  so nothing that shows the starting balance changes; it works the same on a card with only a counted-from day.
  `openingsOf`, `cardStartsOn` and the statement check's opening now skip such settlements (they are no opening).
- Tied to the reversal by `external_ref = fee-before-app:<reversal id>`; made once per reversal (never again once made).
  Ids are `stableId`s of the reversal (row, lines, settlement), so the owner's linked devices that both make it hold one.
  Only a reversal kept against its year on this device (card_fee_refunds; household sharing never carries it) is paired:
  a partner's phone never makes one.
- The ledger voids the row (and its settlement) with its reversal once no edit of the reversal is posted (Reset, delete).
- Deleted by hand: its settlement goes with it (the card owes the same); it is never made again; the reversal reads
  "before the app" again and stays grey.
- Existing data: `pairBeforeAppFees` runs at every open (upkeep, per workspace); asking again makes nothing.

## Scope addition 2 (owner, 2026-11-22): statements treat fee reversals the same on every card
A fee reversal line shows the green ✓ (Settled) on its own on every card, with no Settled mark to tick; the paired
before-app fee row shows ✓ too and changes no statement figure; the normal card's fee charge stays a normal purchase paid
by payments. Test the owner's example (fee 6 Oct 800.000, expense 15 Oct 1.000.000, payment 19 Oct 800.000, expense
28 Oct 508.250, reversal 3 Nov 800.000, payments 12 Nov 200.000 and 508.250 → owes 0, every line ✓).

### Decisions taken
- `StatementLine.feeSettled`: the reversal still counts and is used as credit like any refund (so the cover maths is as
  before); it is only drawn with the paid ✓ and "Settled", and offers no Settled mark (that would post a settlement and
  change what the card owes).
- The paired fee row and its settlement count nothing on statements (they net to nothing): no total, cover or
  "N of M paid" moves; the row is drawn with ✓ "Settled" wherever its date falls.
