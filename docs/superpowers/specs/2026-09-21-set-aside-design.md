# Money set aside vs free to spend — design

Status: ready for build · 2026-09-21
Decisions: `decisions-set-aside.md` (user, 2026-09-19), plus two rulings given with the dispatch (§9).
Mockup: `set-aside.html` (https://claude.ai/artifact/PA7cjCGznuSXc3bYYJVxsp). Chosen: **B3** (the Accounts list is
unchanged; the split lives on the account's own page) and **E2 + the extra question** (the form says how much is over
what is free, lists the goals it could come from, and asks whether this is what the goal is for).

Migration: **0050**. Branch: `feat/set-aside`.

## 1. What exists today, as read on `main` (28ae694)

- `goal_earmarks (goal_id, account_id, workspace_id, amount_minor > 0)` — migration 0008. A promise: part of an
  account's balance claimed for a goal. The money never moves. One account can serve several goals; one goal can draw
  on several accounts. The amount is in **the account's own currency**.
- `saveEarmark` / `removeEarmark` (`packages/db/src/repos/goals.ts`) set it from the goal form, refuse a subtype outside
  `SPENDABLE_SUBTYPES`, and log each change to `goal_contributions` (migration 0016) through `recordContributionTx`.
- `recordTaggedTransfer` (`goal-transfers.ts`) moves money and, when a goal is named, raises that goal's set-aside on
  the **destination** through `adjustSetAsideTx` — on a spendable account *or* one whose asset profile groups it as
  `invest` (`canHoldSetAside`). `writeTradeTx` (`trades.ts`) lowers the goal's set-aside on the cash account when a buy
  for that goal is paid from it.
- `goalLinksFor` (`goal-funding.ts`) turns each earmark into a `GoalLink` of kind `earmark`, **capped at the account's
  balance one goal at a time**, carries `currency`, and converts to `baseMinor` or leaves it `null` when no rate is
  known. `goalPlan` (`packages/core/src/goals/plan.ts`) sums `baseMinor ?? 0`, so a foreign set-aside with no rate is
  **excluded from the goal total** and named in `earmarkWarning`. The goal form's box is labelled, parsed and written in
  the account's currency (`GoalForm.tsx`, `currencyOf`). **Both of these recent fixes are preserved by this design**
  (§8.4).
- The only signal anywhere is `earmarkWarning` on the Goals page and, through `attentionItems`, on Net worth.

What is missing is **surfacing**: nothing says `free = balance − set aside`, and nothing speaks when money leaves an
account that is promised.

## 2. The rules (binding, from the decision record)

1. **A promise is not a balance.** Net worth, the tax report, the balance sheet, the Accounts list and every total keep
   counting the full balance. Setting money aside changes only what the app calls *free*.
2. **"Funded" is derived, never stored**: a goal is *whole* when what is set aside and covered is at least its target,
   computed fresh every time. It flips back by itself, and forward again when the fund is topped up.
3. **The door rule is one line and silent by default: warn only when the movement would take more than is free on
   that account.** An account with nothing set aside never speaks.
4. **Every door consults the same helper** (`checkOutflow`, §4.2) and decides only how loudly to speak (§6).
5. **A shortfall sits; it never nags.** It is stated once at the moment it happens (the question in the form), then
   lives on the goal and in Net worth's existing attention list. No timer, no banner, no reminder.
6. **A transfer out is its own case**: it offers to move the promise with the money.
7. **"Is this what the goal is for?"** separates success from damage: *No — borrowing* leaves a shortfall and keeps the
   dates the goal stood whole; *Yes — this is what I saved for* makes the goal read **done**, not short, and offers to
   archive it.

## 3. Words

| Word | Meaning | Where it comes from |
|---|---|---|
| **Promised** | The earmark amount for one goal on one account, in the account's currency | `goal_earmarks.amount_minor`, active goals only |
| **Set aside** | The sum promised on an account | Σ promised |
| **Free** | `balance − set aside`, **signed** | derived |
| **Short** (account) | `max(0, set aside − max(0, balance))` | derived |
| **Covered / short** (goal on an account) | The account's shortage shared out across its goals (§4.1) | derived |
| **Borrow** | Money taken from a goal that is to be put back | a `goal_draws` row, `intent = 'borrow'` |
| **Spend** | Money taken from a goal for what it was for | a `goal_draws` row, `intent = 'spend'`; the promise is lowered |
| **Move** | The promise follows a transfer to the destination account | a `goal_draws` row, `intent = 'move'`; promises moved |
| **Whole** | Covered ≥ target (`currentMinor ≥ totalTargetMinor > 0`) and not short on any account | derived |
| **Done** | Every stage of the goal is paid | derived from `goal_stages.paid_on` |

An archived goal promises nothing: every reader here uses `listGoals` (which leaves archived goals out), so archiving
stops the claim without deleting the earmark or its history.

## 4. The model

### 4.1 One account, shared out (pure, `packages/core/src/goals/set-aside.ts`)

`accountSetAside(balanceMinor, claims, borrows)` returns `{ balanceMinor, setAsideMinor, freeMinor, shortMinor, state,
goals[] }` with `state ∈ 'none' | 'covered' | 'short'`.

The account's shortage is shared out, in the account's currency, in this order:

1. **Goals with a borrow on this account first**, the most recent borrow first (`occurredOn`, then `createdAt`). Each
   carries at most the lesser of what it promised and the total it borrowed on this account. This is what makes a
   borrowed-from goal the one that reads short — and it is derived, so when the account is topped back up the shortage
   shrinks and the goal is whole again without anything being written.
2. **Then the rest, lowest priority first** — the highest `rank` number (goals are ranked "the first is funded first").
   Ties by goal id.

Each goal gets `promisedMinor`, `coveredMinor = promised − short`, `shortMinor`, and `borrowedShortMinor` (the part of
its shortfall explained by its own borrows). The goals are returned in priority order.

This **replaces** today's per-goal cap in `goalLinksFor`, which capped each earmark at the whole balance on its own:
two goals promising Rp 30.000.000 and Rp 20.000.000 on a Rp 40.000.000 account counted Rp 50.000.000 between them.
After this they count Rp 40.000.000.

### 4.2 The door check (pure)

`checkOutflow(view, outflowMinor, ownGoalId)` returns one of:

- `{ kind: 'silent' }` — nothing set aside on the account; or nothing leaves it; or the outflow fits in what is free
  (plus, when the movement is *for* a goal, that goal's own covered money on this account — §6.3); or there is no other
  goal it could come from.
- `{ kind: 'already-short', shortMinor }` — the account already holds less than it promises. **Not asked** (ruling A,
  §9). The account page and Net worth say so (§7.1, §7.3).
- `{ kind: 'ask', overMinor, freeMinor, goals }` — the outflow takes `overMinor` more than is free. `goals` is every
  goal promised on this account except the movement's own goal, in priority order, each with what it covers.

Worked examples (the record's, and the tests'): Jenius holds Rp 42.500.000 with Rp 30.000.000 for the Emergency fund
and Rp 7.500.000 for Umrah — Rp 5.000.000 free. A Rp 3.000.000 expense is silent. Rp 5.000.000 is silent. Rp 5.000.001
asks, over by Rp 1. Rp 6.800.000 asks, over by Rp 1.800.000. A transfer of Rp 5.000.000 out is silent; Rp 20.000.000
asks.

`outflowFrom(lines, accountId)` is the one reader of "what left this account": it **sums the signed lines on that
account and then clamps** at nought — never a per-line `Math.abs`. `inflowTo` is its mirror.

### 4.3 What is stored — migration 0050, one side table

```
goal_draws (id, workspace_id, transaction_id, goal_id, account_id,
            intent 'borrow' | 'spend' | 'move', amount_minor > 0,
            to_account_id, to_amount_minor, stage_id, was_whole, whole_since, occurred_on, created_at)
```

No column is added to any existing table. Every read and write goes through `setAsideTablesExist(db)`, a
`WeakMap<Db, boolean>` guard shaped exactly like `extrasTablesExist`; a database stopped before 0050 behaves as today —
no draws, no question answered is written, and the check still works from earmarks and balances alone (it needs no new
table to read).

`was_whole` / `whole_since` are a **snapshot of the moment of a borrow** — a fact about the past, not a flag that decides
anything now. They are what lets the goal say "Fully funded 3 Aug – 19 Sep" after the fact (§7.2).

### 4.4 What each answer does (inside the posting's own database transaction)

The choice rides on the posting as `PostTransactionInput.setAside` and is applied by `postTransactionTx` right after
the entries are written, from the **entries as planned** (the account's own currency):

| Intent | Amount | Effect on promises | Row |
|---|---|---|---|
| borrow | `min(overMinor, outflow)` | none | draw with `was_whole`, `whole_since` |
| spend | `min(outflow, promised)` — the whole payment up to the promise (open question 2) | promise − amount (`adjustSetAsideTx`); the goal's earliest unpaid stage gets `paid_on = occurredOn` | draw with `stage_id` |
| move | `min(overMinor, outflow, promised)` | from-account − amount; to-account + `floor(amount × inflow ÷ outflow)` in **BigInt** | draw with `to_account_id`, `to_amount_minor` |

A choice is refused (`SetAsideError`) when the posting takes nothing from the account named, the goal is archived or
in another workspace, the goal promises nothing on that account, or a move names an account the posting does not pay
into or that cannot hold a set-aside (`canHoldSetAside`, moved to its new home unchanged).

**Voiding reverses it.** `voidTransactionTx` — the sink every delete and every edit goes through — calls
`undoSetAsideTx`: a spend gives its amount back to the promise and clears the stage's `paid_on` if it still holds the
draw's date; a move takes `to_amount_minor` back off the destination and gives `amount_minor` back to the source; then
the transaction's draw rows are deleted. A borrow needs nothing reversed: with the row gone the shortage falls where
§4.1 puts it.

**Editing carries it.** `replaceTransaction` reads the original's choice before voiding. `setAside: undefined` means
"carry the original's" (clamped again against the new lines, and dropped if the replacement no longer takes from that
account or, for a move, no longer pays into the destination); `null` means none; a value is obeyed. Every full edit
form passes an explicit value (§6.1); the desktop's category-only re-file passes nothing and so carries it.

### 4.5 Readers (`packages/db`)

- `setAsideViews(database, ws, { date, excludeTransactionId })` → `Record<accountId, AccountSetAsideRow>` for every
  account something is promised on. `excludeTransactionId` shows the account **as if that transaction had not been
  recorded**: its entries are taken off the balance, its borrows are left out, and its spend/move effects are reversed
  on the promises. That is how an edit asks the right question about itself.
- `accountSetAside(database, ws, accountId, opts)` — one account, or `null`.
- `setAsideChoiceOf(database, ws, transactionId)` — the choice a transaction was saved with, for an edit form to open on.
- `goalWholeness(database, ws, date)` → per goal `{ whole, since }` (§7.2).
- `goalHistory(database, ws, date)` → per goal, the newest six of: set aside / taken back, borrowed, spent, moved, and
  "reached the target".
- `goalContributionEvents(database, ws, range)` — `goalContributionsFor` split into its dated events and a sum over them,
  so the history and the "whole since" walk read the same three sources the monthly figure reads, without a second copy.

### 4.6 What changes in what already exists

- `goalLinksFor`: an earmark link's `valueMinor` is its **covered** amount from §4.1; it gains `promisedMinor` and
  `shortMinor`; `overBalance` becomes `shortMinor > 0`. `currency` and `baseMinor` are untouched — a foreign covered
  amount is still converted or left `null` and excluded (§8.4).
- `goalPlansFor`: the over-balance sentence names the account and the goal's shortfall in the account's currency; a new
  `unconvertedWarning` carries the no-rate sentence alone, so Net worth can take it without the over-balance one (§7.3).
- `recordTaggedTransfer`: when the transfer is for goal G and leaves an account that holds G's own promise, **G's own
  promise follows the money** first — the source promise is lowered by `min(amount, promised)` and the change logged
  with `recordContributionTx`, so a goal moving its own money is not counted twice and the month's contributions for G
  net to nought. Only when the destination can hold a set-aside.
- `writeTradeTx`: the cash account's set-aside for the buy's goal is lowered by what left **the cash account** —
  `input.cashMinor ?? gross + fee + tax` — not by the holding's-currency figure it lowers it by today.
- `idleCash`: an account's idle amount is what is free on it (`max(0, free)`), not its balance — "an idle-cash sweep
  should simply refuse to touch claimed money".

## 5. The question on screen (E2 + the extra question)

Built from the native kit only: two `InsetGroup`s of `InsetRow`s. No new visual treatment.

```
RP 1.800.000 MORE THAN IS FREE                               (group header)
◈ Emergency fund      Rp 30.000.000 set aside     Take from here
◈ Umrah 2027          Rp 7.500.000 set aside      Take from here
Jenius has Rp 5.000.000 free. The rest has to come out of something you set aside.   (footer)

IS THIS WHAT THE GOAL IS FOR?                                 (only once a goal is picked, only with two answers)
No — borrowing from it          The fund shows a shortfall until you top it back up
Yes — this is what I saved for  The goal counts as spent, not broken
```

On a transfer into an account that can hold a set-aside the two answers are **Move the promise to *To*** ("The goal keeps
its money, now in *To*") and **No — borrowing from it**. Picking a goal row marks it "Taking it"; picking an answer
marks it ✓. **Save stays off until the question is answered** — "Pick one and Save lights up". Nothing is ever blocked
beyond that one tap: money that has left the bank can always be recorded (E3 was rejected).

The question is recomputed on every keystroke of the amount (the view is read once per account; the check is pure).
Changing the amount so it fits again removes the question and the answer. Changing the account re-reads the view.

## 6. The doors, and how loudly each speaks

### 6.1 The full question (goal + "Is this what the goal is for?")

| Door | Screen | Repository | Answers |
|---|---|---|---|
| Expense, split with people | `TransactionCard` (add and full edit), `EditSheet` | `postTransaction`, `replaceTransaction`, `splitBill` | borrow · spend |
| Transfer to a card, a debt, or an account that cannot hold a set-aside | `TransactionCard` | `postTransaction` | borrow · spend |
| Card statement payment | `CardHero` pay form, `StatementPanel` pay-now | `postTransaction`, `payCardPurchases` | borrow · spend |
| Recurring bill | `PaySheet`, `PaySeveralSheet` | `recordBillPayments` | borrow · spend |
| Loan instalment, extra payment | `LoanDetailPage` | `recordLoanPayment`, `recordExtraPayment` | borrow · spend |
| Lending to a person; repaying someone you owe | `DebtForm`, `PersonCard` | `recordLoan`, `recordRepayment` | borrow · spend |
| A buy with no goal (cash side) | `TransactionCard` Buy tab, `TradeForm` | `recordTrade`, `replaceTrade` | borrow · spend |
| A purchase on an event | `EventDetailPage` | `postTransaction` | borrow · spend |
| Desktop quick row, add and edit | `TransactionsPage` → `SetAsideSheet` | `postTransaction`, `replaceTransaction` | borrow · spend |
| Confirming a draft | `ReviewPage`, `TransactionsPage` → `SetAsideSheet` | `confirmDraft` | borrow · spend |

`PaySeveralSheet` asks once per paying account and spreads the overage across that account's payments in order
(`spreadOver`): the payment during which the running total crosses what is free takes the part over it, and every later
one from that account is over in full.

### 6.2 A transfer out — move the promise (rule 6)

Untagged transfer into an account that can hold a set-aside (§4.4): **Move the promise to *To*** or **No — borrowing**.
A cross-currency transfer (the app's currency conversion) moves the promise at the transfer's own rate — the landed
amount over the amount that left — floored, in BigInt.

### 6.3 Moving money for a goal

- A **tagged transfer** for goal G, or a **buy tagged to G**, first uses G's own money on that account without asking
  (`ownGoalId`): that is G's money going where G wanted it. Only the part beyond G's own covered money *and* what is free
  is asked about, and the only answer is **borrow** (taking another goal's money for G is borrowing from it). One
  answer, so the second group is not shown.
- The **goal form's set-aside box** (moving money between goals by hand) does not ask; beside each box it says what is
  free on that account for this goal (`free + this goal's current promise there`), and in the warn tone how short the
  account would be when the typed figure is more than that. The box keeps parsing in the account's currency.

### 6.4 Silent doors

- **Already short** (ruling A): every door is silent on an account that already holds less than it promises. Stated on
  the account page and on Net worth; never re-asked.
- **Idle cash** refuses to count claimed money (§4.6).
- **Converting an expense into a purchase** (`convertToPurchase`) carries the expense's borrow onto the purchase when the
  purchase is not for that same goal; a spend or move was reversed by the void and is not re-applied.
- **Import CSV** and **opening balances** never ask: an imported statement line is a fact that already happened, and a
  whole statement of questions would be a nag. The account page shows the result (open question 6).
- **Income**, a **sell**, **money coming back** from a person: nothing leaves, so nothing is asked.

## 7. Where the state lives

### 7.1 The account page (B3)

The per-account screen is `/net-worth/assets/$accountId` (`AssetDetailPage`) — there is no other account detail screen
(the Accounts list says so in its own comment). For an account with something promised on it, under the hero:

- `In the account` is the hero, unchanged — the bank's figure.
- A group: **Set aside** Rp 37.500.000 · **Free to spend** Rp 5.000.000 (signed; in alarm when negative).
- A panel with the share bar — one segment per goal's covered amount, one for what is short, the rest the free track —
  and its legend. The bar is `OverviewPage`'s `ShareBar`, lifted into its own file and reused, not redrawn.
- **Promised to**: one row per goal — name, `Covered` or `Short by Rp X` (warn), the promised figure, `to /goals`.
- When short: the group's footer, in the warn tone: "You have promised more than this account holds. Rp 37.500.000 is set
  aside but only Rp 21.000.000 is here. Move money back, or lower what is set aside."

An account with nothing promised shows nothing new. **The Accounts list is unchanged** (B3).

### 7.2 The goal (the goal's card on `/goals` — there is no per-goal route)

- **Short**: under the hero, "Short by Rp 1.800.000" (warn) per short account link, and on the Funded-by row the
  subtitle "set aside · short by Rp 1.800.000".
- **Borrowed from a whole goal**: "Fully funded 3 Aug – 19 Sep" — or "Fully funded until 19 Sep" when the start is not
  known — then "Rp 1.800.000 went to *Laptop*. Put it back and the fund is complete again." Taken from the goal's latest
  borrow that has `was_whole`. Not framed as failure.
- **Done**: the status reads **Done** (tone good) when every stage is paid; the archive group's footer says "Keeps the
  history, stops it claiming money."
- **History**: the newest six events (§4.5).

*Whole since* (`goalWholeness`): only for a goal funded wholly by base-currency set-asides (no tagged units, nothing
foreign — both move for reasons the log does not record). Walking the goal's dated set-aside events (set-aside changes,
tagged transfers in, spends out) back from today's covered total, the day the total last rose to today's target;
`null` when the walk runs out of records, or passes an earlier borrow on the goal (its repayment date is not recorded).

### 7.3 Net worth

`attentionItems` gains one item **per short account** — "Jenius: Rp 37.500.000 set aside, Rp 21.000.000 here",
action Review, to that account's page — instead of one per goal. Goal items keep only the no-rate sentence
(`unconvertedWarning`). The balance sheet, the net worth figure and the series do not change (rule 1).

## 8. What must not break

1. Net worth, the balance sheet, `netWorthAt`, balances and the tax report are identical with and without set-asides,
   borrows, spends and moves on a figure-for-figure basis — spends and moves change promises, never entries.
2. The Accounts list shows the bank's figure and nothing else new (B3).
3. Every door that exists today still saves exactly what it saved when nothing is promised on its account.
4. **The two recent currency fixes**: a foreign set-aside shows in its own currency, its `baseMinor` is `null` without a
   rate and it is excluded from the goal total and named; the goal form's box parses in the currency it is labelled with.
   Every amount in this feature (promised, covered, short, over, free, draws) is in the **account's** currency and is
   never added to a figure in another currency; the question and the account page print it with the account's currency.
5. Refusals the doors already have (trades, opening balances, another workspace's rows, a transfer's missing received
   amount) are untouched: the question is an extra condition on Save, never a way round one. This feature adds no path
   that edits or deletes a transaction — it rides on the existing ones, and voiding reverses it wherever voiding happens.

## 9. Rulings applied (from the dispatch)

- **A — the already-short account** is its own state: shown on the account page (§7.1) and on Net worth (§7.3), and
  **not re-asked on every transaction** (§6.4).
- **B — the emergency-fund denominator** is settled elsewhere (commit `2e49a12`: loan interest counted once; the months
  matrix in `decisions-health-ratios.md`). This feature consumes `goalPlansFor`'s target as it is and changes nothing
  about it.

## 10. Out of scope

- A per-goal route, a timed reminder, a home-screen banner (rule 5).
- Converting `goal_contributions` deltas to base currency in the monthly figure (§12, finding 4).
- Any change to how the emergency fund's target is worked out (ruling B).

## 11. Open questions (the plan builds the default in brackets; each is one small change if overturned)

1. **Which goal an unexplained shortage lands on.** [Lowest priority first.] The mockup's "stops adding up" panel shows
   the Emergency fund short and Umrah covered, which is the opposite whenever the Emergency fund is ranked first.
2. **How much "Yes — this is what I saved for" takes.** [The whole payment, up to the goal's promise — the free money is
   left free.] The alternative is only the part over what was free.
3. **"Yes" on a goal with several stages, and on an emergency fund.** [It marks the earliest unpaid stage paid; the goal
   reads done when every stage is. For a one-stage goal — the Emergency fund included — that is exactly the record's
   "done, offers to archive".] The mockup's "a standing level, not a finish line" note suggests an emergency fund spent
   on an emergency should stay open to be rebuilt instead.
4. **"Fully funded from" when the app has no record of the day.** [Shown as "Fully funded until 19 Sep".] Set-asides made
   before migration 0016, tagged units and foreign money have no dated trail the start can be read from.
5. **Loudness at doors the record does not name.** [The full question at every outflow door in §6.1; borrow only for
   money moved *for* another goal.]
6. **Import CSV.** [Silent.]

## 12. Findings in today's code (reported, and where noted fixed here)

1. `goalLinksFor` caps each earmark at the whole balance separately, so two goals on one account can count the same money
   twice. **Fixed** by §4.1.
2. A tagged transfer for G out of an account that holds G's own promise leaves that promise behind, so G counts the money
   in both places. **Fixed** in §4.6.
3. `writeTradeTx` lowers the cash account's set-aside by the holding's-currency figure `gross + fee + tax` even when the
   cash account is in another currency (`cashMinor`). **Fixed** in §4.6.
4. `goalContributionsFor` sums `goal_contributions.delta_minor` raw across currencies, so a US$100,03 set-aside adds
   10.003 to an IDR monthly figure — the same class of error fixed on the goal total. **Not fixed here** (§10).
5. `LoanDetailPage`'s extra-payment penalty is read with `Number(penalty.replace(/\./g, ''))`, not `parseMajor`. **Not
   fixed here.**
6. The decision record names `convert.ts` as "a currency conversion". It is `convertToPurchase` (an expense turned into a
   purchase). The app's currency conversion is a cross-currency transfer through `exchangeLines`; both are covered
   (§6.2, §6.4).
7. The record says only spendable accounts can be claimed. `saveEarmark` refuses the rest, but a tagged transfer also
   sets aside on an `invest`-grouped holding (`canHoldSetAside`). The design treats any account with a promise alike.
