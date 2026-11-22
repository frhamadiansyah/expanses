# Past card payments and transfers — brief and decisions (2026-11-22)

## Owner's rule
Card payments (Pay credit card, Edit payment, the statement's Pay for chosen purchases) and plain transfers between own
accounts follow the past purchase's rule for the account the money comes FROM: dated before that account's start day,
its balance does not change (balancing pair against Before the app); on or after, both sides move as today. No new
choice: one plain line on the form ("Before Bank Contoh was added: its balance stays."), a receipt row.

## Decisions
- **Each side follows its own account's start day — but only money accounts** (bank, savings, e-wallet, e-money, cash,
  other cash: the past mark's SPENDABLE_SUBTYPES). A credit card (and a loan, a holding, broker cash) always moves.
  Why: the owner's case — card 4417 added 13 Nov, purchase 15 Oct already moving the card, payment 12 Nov from a bank
  added later — must end owing the rest. The card has no opening entry (it was opened at nothing), so its October
  purchase sits on it; if the card side followed its own start day the payment would vanish from it and the card
  would still owe the whole purchase. A money TO account's starting balance, on the other hand, already holds money
  that arrived before it was added, so a transfer into it stays off it (the same as an old income).
- **Start day** = the past purchase's: opening entry's day, else As of (counted_from), else the day it was added
  (`startDayOfTx`, mirrors the Add form's `useOpeningDay`). One function (`pastSidesOf`) gives the form's line and the
  ledger's posting, so they never disagree.
- **Same pair, same ref**: `before-app:<payment id>`, Before the app against each kept side, line by line. Lists,
  search, activity and Cashflow already hide it; the receipt reads `past` + `pastAccountIds`.
- **Who decides**: the ledger, when the door passes `beforeStart: true` (Add form Transfer/Pay/Edit payment, goal-tagged
  transfer, statement Pay `payCardPurchases`, statement list check transfer rows). Doors that don't pass it (loans,
  goals' automation, deposits, sync apply) are unchanged.
- **Only a move between own accounts**: money leaves a non-card balance account and lands on another. A card's top-up
  of a wallet (money leaves the card), a purchase, an income are never balanced by this rule; a payment takes neither
  purchase mark (setPastPurchase / setSettledBeforeApp refuse it).
- **Edits**: the form passes `beforeStart: true`, so date or From changes decide again; an edit that says nothing
  follows (re-decided at the new figures); `false` takes the pair away. Delete voids the pair; Undo puts it back
  (decided again by the rule).
- **Receipt**: "Past payment" (card) / "Past transfer", value "<account> unchanged" (or "Balances unchanged").
- **As of guard**: a transfer whose pair keeps the other side still counts as moving this side (firstCountedDayTx), and
  the card's records-from only drops a payment whose pair is on the card (never).
- **Sync**: nothing new travels. Linked devices copy the rows (as the past purchase's); household sharing sends neither
  pair (bookkeeping on the owner's own accounts; the joint net worth summary is worked from balances). The next build
  carries 0127 (schema > TF's 0125), so an older linked device holds these changes until it updates — an older build
  would otherwise post a card settlement in place of the pair on editing such a payment. No version gate added.

## Review fixes (22 Nov 2026)
1. **A pair follows an edit only while the row is still its kind** (`pairKindTx`: move between own accounts / card
   purchase / money purchase). A payment with a start day pair edited into a card's top-up of a wallet loses the pair
   (no card settlement); a card purchase paid off before the app edited into a move loses its card settlement and gets
   a start day pair only if asked (`beforeStart`).
2. **Old payments with no pair stay as they were**: an edit that leaves the day, the accounts and the amounts alone
   never adds a pair (`moneyShapeTx` compare in `replaceTransactionTx`), whatever the door says. Changing the day, From,
   To or an amount decides again. The form hides its line in that case too (`moveDecided`).
3. **Goals**: a goal-tagged transfer with a side before its account's start day is refused in plain words ("Money moved
   before an account was added cannot go toward a goal. Leave Goal empty, or change the date."), on post and on edit:
   parking would promise money on a side whose balance never took it, and the simplest safe answer is not to tag it.
   Set-aside: no goal's money is drawn from a From that keeps its balance (that money left before the account was
   added), so the form does not ask, and the ledger skips a draw it is given (post and edit).
