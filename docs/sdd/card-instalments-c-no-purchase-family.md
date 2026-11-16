# A plan with no purchase in Family Cashflow (design note, not built)

TF 136: the owner's 21-of-24 plan has no purchase. It was bought before the card's records start, so auto-link set it
to Each month with no purchase. Its instalments now count under Uncategorised in **Personal** only, because a plan
with no purchase never travels. The owner reads Family, and wants it to show where the card's spending shows.

## Options

**(a) A Family category on the plan, and the plan's instalments travel. Recommended.**
- The Category row offers every workspace the owner records into: Personal, Family, Business.
- The plan counts in that category's workspace.
- When that workspace is shared, a new row entity `plan_spread` goes to the other phone, keyed by plan id. It is
  scoped by `category_account_id IN book_categories(book)` and carries `description, totalMinor, monthlyMinor,
  months, firstBilledMonth, statementDay, recordsFrom, categoryId`.
- The other phone keeps it in a new table, `plan_spreads` (migration 0123). `plansWithStatementDays` reads it as a
  received Each month plan with its own `recordsFrom`. Both phones then call the same `instalmentSpendingLines` with
  the same inputs, so they agree to the rupiah.
- Debt payments stay the payer's alone, as they are now.
- Needs:
  - migration 0123: the receiver table, and dropping stale clocks;
  - a new `SHARED_ENTITIES` row (capture plus apply);
  - a version gate `PLAN_SPREAD_MIN_APP_VERSION = '0.5.6'` with a hold and an R9 resend, exactly as R7/R8. 0.5.5 is in
    TF 136, so the app version goes to 0.5.6.
- Risk: low. It is the same shape as the purchase `spread`, without a purchase to hang from.

**(b) A linked "Past purchase" in the chosen workspace and category, at the plan's purchase date.**
- Rejected. The past purchase is a card charge plus a balancing settlement. On the statements that pair and the
  opening balance would both hold the unbilled months. That needs special cases in `billedLines`, cover and
  statement check.
- The purchase's `spread` would also have to carry the card's records start. Otherwise the other phone counts every
  instalment from February 2025, including the months before the records. That means a new column on
  `purchase_spreads` (a migration) and a change to the `spread` payload all the same.
- It also puts a purchase the owner never recorded into their lists, receipts and search.

**(c) Leave it in Personal.**
- What 0122 does today. No sync is needed, but it is not what the owner asked for.

## What is built now

On `feat/card-instalments-c`, commit f5813bee:
- The plan's instalments appear on the card's statements, from the records start, with nothing counted twice.
- Cashflow, Budget and Health count it in Personal, from the records start.

Waiting for a go on (a) before building migration 0123, the entity, the 0.5.6 gate and R9.
