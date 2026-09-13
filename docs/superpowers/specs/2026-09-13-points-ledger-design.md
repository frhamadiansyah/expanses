# Points ledger, expiry, redemptions and fee ROI — design

Approved by the owner on 13 September 2026. Stage 3 of the platform spec, less the parts already built.

## 1. What is already there

`computeCycleEarn` allocates spend across rules, splits at caps, applies cycle bonuses and rounding, and
reports what earned nothing. `cycle_actuals` and `transaction_point_actuals` record what the issuer
really credited, and `explainCycle` names the likely cause when the two disagree. `redemption_options`
and `transfer_partners` hold what points are worth and where they can go, and `recommendCards` values a
purchase at the best of them.

**Cap splits and projected-versus-actual reconciliation are therefore done.** They are on the original
Stage 3 list and need nothing further.

## 2. What is missing, and why it is one thing

There is no stored balance. Earn is recomputed per cycle and never accumulated, so:

- nothing can expire, because no batch of points exists to expire;
- spending points cannot be recorded, because there is nothing to spend from;
- a card-year's earn cannot be valued against its annual fee.

All three hang off the absence of a ledger. `point_entries` from §10 of the platform spec is the missing
table, and this design builds it.

## 3. Where entries come from

The owner's cards differ: Jenius and Mandiri show points per purchase in their app, some issuers print a
cycle total on the statement, others show only a balance, and some show nothing until the points arrive.
Rather than configure a source per card, the ledger takes the best evidence available, per cycle:

| Order | Evidence | Entry | Status |
|---|---|---|---|
| 1 | per-purchase actuals (`transaction_point_actuals`) | one earn per purchase | `posted` |
| 2 | the cycle total (`cycle_actuals`) | one earn per cycle | `posted` |
| 3 | a balance the owner read in the app | one `adjust` for the difference | `posted` |
| 4 | nothing | earn from `computeCycleEarn` | `projected` |

A program may sit at a different level each cycle, and moves up on its own as the owner types figures in.
Every balance says what it is made of: *4.200 posted, 800 estimated*.

**A snapshot writes one adjust entry, never an attempt to correct individual purchases.** A visible
discrepancy is worth more than a tidy number that hides one — the same reasoning the tax report uses for
its gap against the balance sheet. A card whose adjustments keep growing has a rule that needs fixing,
and `explainCycle` already names the likely culprit.

## 4. Data

Migration `0018_point_entries.sql`.

- `point_entries`: `id`, `workspace_id`, `program_id`, `transaction_id` (null unless the entry belongs to
  one purchase), `kind` (`earn` | `redeem` | `expire` | `adjust` | `transfer`), `quantity` (signed: earn
  and positive adjust are positive, redeem, expire and transfer are negative), `occurred_on`,
  `status` (`posted` | `projected`), `source` (`transaction` | `statement` | `snapshot` | `projected` |
  `manual`), `batch_id` (the earn batch a consumption came from, null on earn itself), `expires_on`
  (null when the program has no policy), `note`, `created_at`.
- `reward_programs` gains `expiry_policy` (`none` | `months_from_earn` | `fixed_annual`) and
  `expiry_months`, both null-safe. **The default is `none`**: a wrong expiry warning is worse than none,
  because it burns points that were never dying and teaches the owner to ignore the true warning.
- `point_snapshots`: `id`, `workspace_id`, `program_id`, `balance`, `observed_on`, `created_at` — what the
  owner read, kept apart from the adjust entry it produced so the reading survives a recomputation.

Projected entries are rewritten whenever their cycle is recomputed; posted entries never are.

## 5. Core

`packages/core/src/points/ledger.ts`, pure:

```ts
export type EntryKind = 'earn' | 'redeem' | 'expire' | 'adjust' | 'transfer';
export interface PointEntry { id: string; kind: EntryKind; quantity: number; occurredOn: string;
  status: 'posted' | 'projected'; batchId: string | null; expiresOn: string | null }
export interface Balance { total: number; postedTotal: number; projectedTotal: number;
  expiringSoon: number; nextExpiryOn: string | null }
export function balanceOf(entries: PointEntry[], today: string, soonDays?: number): Balance;

/** FIFO: the oldest batch is consumed first, and a consumption may span several. */
export function consumeFifo(entries: PointEntry[], quantity: number, onDate: string):
  { batchId: string; quantity: number }[];

/** What has expired but has not yet been written off, by batch. */
export function dueToExpire(entries: PointEntry[], today: string): { batchId: string; quantity: number; expiresOn: string }[];

export function expiresOn(earnedOn: string, policy: ExpiryPolicy, months: number | null): string | null;

export interface FeeRoi { pointsEarned: number; valueMinor: number; annualFeeMinor: number;
  netMinor: number; estimated: boolean }
export function feeRoi(input: { entries: PointEntry[]; from: string; to: string;
  valuePerPointMicro: number; annualFeeMinor: number }): FeeRoi;
```

`estimated` is true when any entry inside the window is projected, and the screen says so.

## 6. Slices

1. **The ledger.** `point_entries`, the derivation in §3, `balanceOf`, and a balance on the card page that
   states its provenance. Nothing expires and nothing is spent yet.
2. **Expiry.** The policy on the program, `expires_on` per batch, `dueToExpire`, writing `expire` entries,
   and the 60-day warning on the dashboard, carrying the estimated label when the balance is projected.
3. **Redemptions and fee ROI.** Recording a redemption or a transfer out against FIFO batches, and fee ROI
   per card-year from `card_terms.annual_fee_minor` and the program's best redemption rate.

## 7. Tests

Core: balance splits posted from projected; FIFO spans batches and refuses more than is held; expiry dates
under each policy; nothing expires under `none`; ROI nets the fee and marks itself estimated when any
entry is projected.

DB: derivation prefers per-purchase actuals over the cycle total, and the cycle total over projection; a
snapshot writes exactly one adjust; recomputing a cycle rewrites projected entries and leaves posted ones;
expiry writes one entry per exhausted batch and is idempotent.

E2E: a card shows a balance made of posted and estimated parts; typing per-purchase actuals moves points
from estimated to posted; a redemption reduces the balance oldest-first; a card-year shows its fee ROI.

## 8. Known limits

- A cycle-total card cannot attribute points to a purchase; the cycle's entry carries no `transaction_id`.
- Fee ROI values points at the best redemption rate, which is a ceiling: it assumes the best use.
- Expiry runs when the app opens, not on a schedule; a balance is correct as at the last time it was read.


---

## Execution notes

All three slices are done on `feat/points-ledger`. Gate on the finished tree: `npm test` green (catalog
52, core 497, db 441, web 182), `npm run typecheck` clean, `npm run e2e` 70 passed. Migrations 0018,
0019 and 0020.

**Most of Stage 3 turned out to be built already.** Cap splits and projected-versus-actual
reconciliation were done, and `redemption_options` and transfer partners existed as data. The single
thing missing was a stored balance, and expiry, redemptions and fee ROI all hung off that absence.

**No per-card source setting was needed.** `reward_programs.crediting` already recorded whether an
issuer credits per purchase or per statement, so the ledger takes the best evidence a cycle has —
per-purchase figures, else the statement total, else its own working — and a card moves up on its own
as figures are typed in. Jenius and Mandiri show points per purchase in their apps, which is the best
case, not the awkward one.

**Four defects the tests found in my own work:**

1. `expiry_policy` declared `.notNull()` in drizzle without `.default()`, so drizzle named the column in
   every insert and sent null, the SQL default never applied, and `createProgram` failed outright.
2. Two places build a full program row by hand — `createProgram` and the catalogue — so adding columns
   broke both. The catalogue's four "possibly undefined" errors were cascades of that one assignment.
3. `EntrySource` was not widened for `'system'` after the SQL CHECK and the drizzle enum were.
4. **The ROI panel read an empty ledger.** Asked for in its own query, it raced the derivation and
   reported a year worth nothing until the card was opened again. Folding it into the query that fills
   the ledger removed the whole class of bug rather than that one instance.

**Two test-side findings worth keeping:** the per-purchase input renders only for a card that credits
per purchase, so a hand-made program has to be switched over first — which is also how a real owner
would set up a Jenius card. And asserting on a card's name alone matches its account link as well as
the warning, which strict mode rightly rejects.

**Known limits:**

- ~~**Cycles nobody opened contribute nothing.**~~ Built on 13 September 2026: "Catch up this card"
  derives two years of cycles on demand. It still finds nothing where the purchases were never entered
  — a balance read from the issuer's app is the answer for a card with no history here.
- **A policy change restamps on the next derivation**, so a dashboard visited in the same instant can
  lag by one view. It self-heals, and the ledger is right.
- ~~**Fee ROI values points at the best redemption rate.**~~ Built on 13 September 2026: the card year
  now shows both — the ceiling, and what redemptions have really fetched. The realised rate is taken
  from every redemption that recorded a value, not only the year in view, because how someone redeems
  is a habit rather than a property of one card year.

- ~~**An anchored balance carries no earn date.**~~ Built on 13 September 2026: the batch takes its date
  from the program's policy, and "Earned around" says when those points were earned. Left empty they
  count as earned the day they were typed in — generous, but the only date the app can know unaided.
- **A statement-total card cannot attribute points to a purchase**, so its cycle entry names none.
