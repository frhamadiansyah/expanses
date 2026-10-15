# Withdrawal rate: foreign money is spent at what it cost (first in, first out)

Date: 2026-10-15. Status: agreed with the owner in conversation, awaiting review of this document.

## 1. Purpose

Lira withdrawn at an ATM cost what left the rupiah account. Spending that lira should count, in rupiah, what it cost,
not the market rate on the day it is spent. Then a trip's rupiah total is what really left the bank, and a loss on
changing leftovers back is visible.

Today every entry's base value is `amount × the day's rate` (`entries.fx_rate_to_base`, `amount_base_minor`, set by
`ratesForSave` at save time). The difference between what an exchange really cost and the market rate sits silently in
the `currency_exchange` equity account.

## 2. Decisions taken with the owner

| # | Decision |
|---|---|
| D1 | Applies to **every money account in a currency other than the owner's base**: cash pockets, bank pockets, a standalone foreign account. |
| D2 | **First in, first out**: money going out uses the oldest money still in that account first. |
| D3 | **The past is recalculated** (option A), not only new spending. |
| D4 | An **exchange gain or loss** is booked only when foreign money is exchanged into another currency (realised). Keeping the cash books nothing. |
| D5 | **Stored and recalculated** (approach 1): each entry keeps its cost-based value; a change recalculates that account from the changed date. Every report keeps reading stored values unchanged. |
| D6 | Net worth still values what is held at the day's market rate. |

## 3. Lots: money coming in

Each inflow into a foreign account is a **lot**: `(entryId, date, amountMinor, costBaseMinor)`.

| Inflow | Cost |
|---|---|
| Exchange from the base currency (a transfer with a received amount) | the base amount that left |
| Exchange from another foreign account | the cost of the foreign money that left it (its own lots, §4) |
| Same-currency transfer from another foreign account | the lots it used up there, carried with their costs and dates |
| Income, refund, upward balance correction | the day's rate (as today) |
| Opening balance | the opening rate (`openingRateToBase`), else the day's rate on the opening date |

## 4. Money going out

An outflow consumes the oldest lots first. Its **cost** is the sum of the parts of lots it used.

| Outflow | Base value written |
|---|---|
| Spending (a split, a With bill or a shared-event expense has several other lines; a refund is an inflow) | the money line's base value = −cost; the cost is divided over the transaction's other lines (categories, receivables, an event balance) in proportion to their amounts, the rounding remainder on the largest |
| Exchange into another currency | the foreign line's base value = −cost; the received side keeps its own value; the difference is an **exchange gain or loss line** (§5) |
| Same-currency transfer to another account | −cost here, +cost there (lots move, §3) |
| Paying a card or loan in the same currency | −cost; the liability side gets the same base value; no gain or loss |
| Downward balance correction | −cost |

**Order**: by `occurredOn`; within a day, inflows before outflows; then `day_order`, then creation order.

**Not enough lots** (an outflow larger than what is recorded in): the uncovered part is valued at the day's rate, and
the account records a shortfall `(entryId, uncoveredMinor)` for the screen (§7).

## 5. Exchange gain and loss

Two built-in categories, added like the other built-in keys (`ensureCategoryKeys` style, per book):
`income.exchange_gain` "Exchange gain" and `expense.exchange_loss` "Exchange loss".

- An exchange out of a foreign account gets one more line: received base value − cost. Positive: a gain line on
  Exchange gain; negative: a loss line on Exchange loss. The `currency_exchange` lines balance per currency as today.
- The category line files the transfer into the **Personal** workspace (the book `bookOfCategories` finds). A transfer
  with a zero gain or loss has no such line and stays in no workspace, as today.
- The line's amount changes when a recalculation changes the cost (§6).

## 6. Recalculation

- A pure function in core, `fifoCosts(movements, opening)`, takes one account's ordered movements and returns, per
  outflow entry, its cost and the lots it used, plus the remaining lots and any shortfalls. Property tests: total cost
  out + remaining cost = total cost in; no lot is used beyond its amount; order of entry on the same day does not
  change the result.
- `recalcForeignTx(tx, ws, accountId, fromDate)` in db reads that account's posted entries from the earliest lot still
  open at `fromDate`, runs `fifoCosts`, and writes:
  - `fx_rate_to_base` and `amount_base_minor` of each affected entry, **in place** through one ledger door (like the
    in-place `exact_hundredths` and `day_order` writes), captured for household sync as a money-field change;
  - the gain or loss line of each exchange out (inserted, changed, or removed);
  - the base side of each same-currency transfer into another foreign account, then recalculates that account from
    the transfer's date (a chain; stops when nothing changes);
  - a local cache table `fx_lot_uses (outEntryId, lotEntryId, minor, costBaseMinor)` and `fx_shortfalls (entryId,
    uncoveredMinor)` for the screens. Never synced.
- **Triggers**: every ledger write that touches a foreign money account (post, replace, void, the in-place doors,
  sync apply) calls it for that account from the written date, inside the same db transaction.
- **A transaction in another workspace currency**: when a workspace's base differs from the owner's base, the cost is
  computed in the owner's base and converted to the book currency at the day's rate, as entries are today.
- **Household sync**: only the device that owns the account recalculates; a partner's phone receives the new values
  as an ordinary edit and never recalculates someone else's account (placeholder accounts are skipped).
- **First run after the update**: recalculates every foreign account once from its first entry, then shows once:
  "Foreign-currency spending now uses the withdrawal rate. Past months may change slightly."

## 7. Screens

- **Transfer between currencies**: a Rate row, "Rp 525 per TRY (market 512, +2,5 %)". Out of a foreign account into
  another currency, before saving: Received, Cost, and "Exchange loss Rp 10.000 (recorded as spending)" or
  "Exchange gain …".
- **Spending from a foreign account** (Add screen and receipt): "≈ Rp 236.250 at the withdrawal rate (525)". With a
  shortfall: "≈ Rp 238.900 · ₺ 300 at today's rate (no withdrawal recorded)". The receipt adds "From the 12 Nov
  withdrawal" (or "From 2 withdrawals").
- **Foreign account page**: Cost, Worth today (market rate), and "Withdrawals left": each open lot with date, amount
  left of amount, rate. A shortfall line when there is one.
- Copy never says "you"/"your".

## 8. What does not change

Card statements, points (computed on charged amounts), Coretax year-end valuation (year-end rates), net worth (market
rate), every report's reading of stored base values.

## 9. Out of scope

A fee row on a transfer; average-cost as an option; choosing lots by hand; foreign liabilities (a card in USD keeps
the day's rate on its own side).

## 10. Review focus

1. A back-dated withdrawal not recalculating spending after it (trigger missed on one write path, e.g. sync apply or
   the edit route's replace).
2. A same-currency move between two foreign accounts looping or double-counting cost in the chain.
3. A household partner's phone recalculating an account it only holds as a placeholder.
4. Rounding: cost split across category lines of a split not summing to the money line's cost.
5. The first-run recalculation on a large history blocking app start (must run in batches, with the app usable).
