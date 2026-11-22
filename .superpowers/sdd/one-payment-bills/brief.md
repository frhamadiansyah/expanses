# One payment, several bills — brief and design (2026-11-22)

Owner-approved mockup: `docs/mockups/2026-11-22-one-payment-several-bills.html`.

## Problem
Several recurring bills paid in one marketplace checkout show as ONE line on the card. Today a transaction pays one
bill (`bill_payments.transaction_id` is the primary key) and Pay several records one transaction per bill, so the card
then shows three lines and the statement does not match.

## What is built
1. Bills › Pay several › **One payment** switch (off by default). Shown once 2+ bills are ticked and ONE Payment method
   is picked (not "Each bill's own account"). On: a **Note** row (empty, placeholder "Note"), footer "One transaction on
   the card, split by bill, as the statement shows it.", button "Record 3 bills · Rp 635.000". Record makes one
   transaction on that account, one split part per ticked bill (its category, its amount), dated Paid on, linking every
   ticked bill for its month.
2. Split sheet › each part › **Bill** row: None, or a bill of the purchase's month not paid yet (plus the one it pays).
   Part rows read "Bill: Internet · Nov". Works on a new purchase and on an edit.
3. Every reader of bill links handles a transaction that pays several bills.

## Design decisions
- **Link storage.** `bill_payments` keeps its columns; its primary key becomes (transaction_id, template_id,
  bill_month) — migration 0127 rebuilds the table and copies every row. No column says which split line pays which
  bill: a link is (bill, month) as before, and the part a link belongs to is worked out by one rule in core
  (`matchBillsToLines`): same category and the bill's own amount first, then same category, then any part left. The
  Bills page's "paid Rp …" for each bill and the Split sheet's "Bill:" subtitles both use it. Reason: the ledger
  re-creates every line on an edit, so a stored line id would need carrying through every edit door; the rule needs
  nothing stored, and when two bills of one category have the same amount the paid status is the same either way.
- **One payment is a Pay payment.** The one transaction carries `template_id` = the first ticked bill, like any Pay;
  the other bills are rows beside it. So on every bill's page it reads "Open payment" / "Undo payment" (Undo deletes
  the one transaction, so all its bills are owed again), not "Unlink".
- **Bill month counting.** A Pay payment counts in its bill's month (`attributedOn`). A payment of bills of DIFFERENT
  months counts on the day it was paid (no single month to move it to). A payment of a yearly bill together with
  monthly ones is no longer left out of a month's Cashflow (`notMonthlyBillPaymentIds` now asks that every bill it pays
  is not monthly).
- **One payment needs one account**, and is off for a bill in another currency than that account (a split posts in
  one currency; a foreign bill's own figure has nowhere to live on a part). Sinking funds keep working (the fund is let
  go; "Pay the card from the fund" still moves the money).
- **Edits.** An edit carries every link to the new head (as one link was carried). A split saved from the form says its
  links outright (`billLinks`): a part removed lets its bill go. A bill already paid by another posted transaction is
  refused in words, never paid twice.
- **Household sync.** Purchase field `severalBills` (the whole list, sorted) when a purchase pays 2+ bills; absent
  otherwise, null when it goes back to one. `bill` / `billLink` still carry the first bill, so an older build reads one
  bill paid. Gate `SEVERAL_BILLS_MIN_APP_VERSION = '0.5.7'`: held out of a shared book's log while any other phone is
  older, its clock kept as if sent; repair R10 sends it once every phone is there. Ship order: every build that says
  0.5.7 must contain migration 0127.
- **Linked devices (self channel).** Rows travel by primary key. A newer device's change-sets wait on an older device
  (rule 6). An older device's bill_payments op (key = [transaction_id]) is read on a newer one as "this transaction's
  bill link is now this one" (its other rows are let go, each by the clock rules); 0127 moves the clocks and pending
  marks of every existing row to its new key.
