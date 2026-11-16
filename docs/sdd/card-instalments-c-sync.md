# Card instalments C: making both phones agree in a shared workspace

Status: approved 16 Nov 2026 and built on `feat/card-instalments-c`, with the owner's decisions on the open points
(see "Decided" at the end). Tests: `packages/db/test/sync/instalment-spread-sync.test.ts`.

## The problem

A plan's **Count spending** choice lives in `card_installments`, and that table never syncs. In a shared workspace
(Family) the purchase itself does sync: the `purchase` entity in `sync/shared-entities.ts`, written by `capture.ts` and
applied by `apply.ts`. The husband's phone gets the laptop purchase but not the plan. So:

- Owner's phone, plan set to Each month: Family's November shows Rp 0 for the laptop and December shows Rp 1.000.000.
- Husband's phone: Family's November shows Rp 12.000.000 and December shows nothing for it.

Two phones disagreeing on a shared book's figures breaks the data-safety rule. An older build must never be sent
something its database would refuse (the refusal-skip bug: on a phone a refused change stops the pull).

## What has to travel

Only what the other phone needs to work out the same instalment lines **with the same function**
(`instalmentSpendingLines` in `packages/core/src/loans/installments.ts`). It does not need the plan as a debt. The
partner's card is not on their phone; it sits on a placeholder account. So no `card_installments` row is made there.

A new **purchase field** `spread`, sent with the purchase lineage it spreads:

```ts
spread?: {
  months: number;
  firstBilledMonth: string;   // YYYY-MM
  totalMinor: number;         // the plan's total
  monthlyMinor: number;       // the plan's monthly figure (the last instalment carries the rounding)
  statementDay: number;       // the payer's card statement day, 1 when not set
  wholeBaseMinor: number;     // what all of the purchase's category lines add up to, in the book's currency
} | null                      // null: counts At purchase (or no plan any more)
```

- Sent only for a plan on **Each month** that is tied to a purchase. At purchase needs nothing: both phones already
  count the purchase in full on its day.
- `wholeBaseMinor` is there for a purchase split across workspaces (0084). Only the shared part's lines travel, so the
  receiver cannot work out the whole itself. With it, both phones call
  `instalmentSpendingLines(plan, statementDay, parts, whole)` with the same parts (the travelling lines'
  `amount_base_minor`, which already travel in the book's currency, ruling O2) and the same whole. That gives the
  **same rupiah on both phones**, rounding included.
- Month starts on already syncs (0118, R6), so both phones put each statement date in the same month.
- Excluded, excluded lines and the split part already travel, so the filters agree.

## The receiver: `purchase_spreads` (new migration 0121)

```sql
CREATE TABLE purchase_spreads (
  transaction_id TEXT PRIMARY KEY,   -- the local head of the lineage
  workspace_id TEXT NOT NULL,
  months INTEGER NOT NULL,
  first_billed_month TEXT NOT NULL,
  total_minor INTEGER NOT NULL,
  monthly_minor INTEGER NOT NULL,
  statement_day INTEGER NOT NULL,
  whole_base_minor INTEGER NOT NULL
);
-- Clocks an older build kept for a field it dropped (see "Version gate"): the updated phone takes the field again.
DELETE FROM sync_field_clocks WHERE entity = 'purchase' AND field = 'spread';
```

- `apply.ts`: when `spread` wins, write it in place (an `inPlaceOnly` field, like `dayOrder` or `billLink`). Upsert the
  row for the head, or delete it on `null`. It never reposts the purchase, because `spread` is not money.
- `replaceTransactionTx` carries `purchase_spreads.transaction_id` to the replacement, as it now does for
  `card_installments` (commit eaad454a). A repost by apply keeps the spread.
- **Writer:** only the payer's own phone (`money.paidBy`) has the plan, so only its `spread` is taken. A `spread` from
  another member is dropped, and its clock is kept. The payer's own phone never writes `purchase_spreads` for its own
  purchase, because its `card_installments` row is the truth there.
- **Readers:** `plansWithStatementDays` (repos/instalment-spending.ts) adds one pseudo-plan per `purchase_spreads` row
  (`countMode: 'each_month'`, `cardAccountId` = the purchase's money account, the placeholder). Then `reports.ts`,
  `flows.ts` and the Cashflow list pick it up without other changes. They have no debt-side readers
  (`installmentTotals`, Debt-free, statements), so the partner's phone never shows the partner's card debt.

## The sender: capture

- `projectPurchase` adds `spread` from `card_installments` (Each month, tied to the head, statement day from
  `card_terms`) and `wholeBaseMinor` from the head's expense lines. `diffFields` sends it only when it changed.
- These writes touch the purchase's lineage (`CaptureSession.touchLineage`), so the flush diffs the projection:
  `saveInstallment`, `updateInstallment` (both purchases when the link moves from A to B), `setInstallmentCountMode`,
  `deleteInstallment`, and `saveCardTerms` when the statement day changes (for every plan on that card).
- Seeding (`seed.ts`) emits the full projection, so a phone joining later gets every spread.

## Version gate: `INSTALMENT_SPREAD_MIN_APP_VERSION = '0.5.5'` (sync/events/version.ts)

An older build would not refuse the field. Its apply drops a field it does not know, keeps its clock, and reposts the
purchase as it was. That was proved for `billLink` (fix round 2). But it would show the purchase in full while the
owner's phone spreads it, and the repost is churn. So this follows R7 (Debts & savings marks), not R5:

1. **Hold:** in `writeChangeSetsTx`, while any other phone in the book says a version below 0.5.5 (or none is there
   yet), strip `spread` from purchase ops before they go in the outbox. Drop an op left with no fields. Record its
   clocks as if sent. `isSpreadOp` / `spreadWaitsTx` would sit beside `isThirdMark` / `thirdMarkWaitsTx`.
2. **R8 repair (repairs.ts):** once every other phone is at 0.5.5 or later, and again for each phone newly seen there,
   send `spread` for every lineage that has one, at the clock it is held at (never a fresh one, so a later word still
   wins). Keep the devices crossed in `repair.instalment-spreads-crossed.v1.<bookId>`.
3. **Stale clocks:** if an older phone ever took the field (one that joined after spreads went in the log), 0121's
   `DELETE FROM sync_field_clocks … field = 'spread'` drops its clock when it updates. R8 then sends it again.
4. Bump `apps/web/package.json` to **0.5.5**, and `MARKETING_VERSION` with it. Every 0.5.5 build must contain 0120 and
   0121.

Until both phones run 0.5.5 they still disagree on an Each month plan in Family, as today. After that they agree.

## Tests to write when it is built

- capture: Each month plan → purchase op carries `spread`; At purchase → `spread: null`; held while the partner is
  below 0.5.5 (clocks recorded, nothing in the outbox); R8 sends it once both are at 0.5.5; statement-day change
  resends it.
- apply: `spread` from the payer writes `purchase_spreads` in place (no repost); `null` deletes it; one from a
  non-payer is dropped; a repost carries it.
- **Two-phone agreement** (the test that matters): owner and husband in Family, the laptop split 8jt Family / 4jt
  Business. `categoryTotalsIn`, `dailyTotalsIn`, `periodFlows`, the budget sheet and the essential split give the same
  figures for Family on both phones, every month from Nov 2026 to Nov 2027, also with Month starts on 25 and with
  the purchase excluded.
- old-build safety: an op with `spread` applied by a 0.5.4 database is not refused and leaves the purchase as it was.

## Risks and open points

- **Joint card / partner's own plan.** The writer is the payer (`paidBy`). A plan the partner makes on a purchase the
  owner paid (a supplementary card) has nowhere to go. Today plans are made on one's own card only.
- **Book in another currency.** Plans are kept in the owner's currency. `wholeBaseMinor` and the parts are book-currency
  figures. Mixing the two on a book that reads in another currency would not match. Proposal: refuse `spread` (send
  `null`) when the book's currency is not the card's. Both phones then count at purchase.
- **Statement day is device-local.** It has to travel inside `spread`, and a change on the payer's phone has to resend
  it (see Capture).
- **Older phone joining after spreads are in the log** shows the purchase whole until it updates. No halt and nothing
  lost, because the field is only dropped. Same family of hole as R7.
- **The partner sees the purchase with "counts Rp 0 now"** but cannot open the plan (no plan page on their phone). The
  pseudo-plan instalment rows need a non-tappable look there.
- **Plan with no purchase** (Uncategorised) counts in the payer's Personal workspace only and never in a shared book,
  so it needs no sync.
- **Refusal-skip bug:** nothing here writes a column or value an older database lacks, so no older phone can be stopped.

## Decided (owner, 16 Nov 2026) and how it was built

- A book whose currency differs from the card's: the spread is sent as none, so both phones count the purchase at
  purchase (`purchaseSpreadOfTx`).
- The partner's phone: an instalment row that came from the payer cannot be opened (no plan there). The purchase
  keeps its "counts Rp 0 now" caption. Both come from `instalmentSpendingIn` (`received`, `spreadMonths`).
- A joint card, or a plan the partner makes on a purchase the owner paid: out of scope.
- Writer check: a `spread` is taken only from a device of the purchase's payer (`authorMemberOf` = `paidBy`). That
  includes the payer's own second device, which writes `purchase_spreads`. A phone's own plan always comes first.
- Financial health's debt payments are each phone's own (its accounts). The At purchase plan's instalment stays a debt
  payment on the payer's phone only. Spending agrees on both.
