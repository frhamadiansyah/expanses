# Shared events: one trip, several people, who owes whom

Date: 2026-10-15. Status: agreed with the owner in conversation, awaiting review of this document.

## 1. Purpose

A trip with friends (or a household outing) is one event that several people record into. Each person sees every
expense of the trip, who paid it and how it is split; cicis keeps a balance per person in the event's currency and
suggests the fewest payments that settle it. Each person's own books count only their own share, and nothing about
anyone's accounts, balances or workspaces leaves their phone.

Owner's example: a week in Turkey with two friends. Cash lira withdrawn at an ATM, some payments in euro, one friend
without cicis. At the end: "Andi pays Fandrian ₺ 2.900, Budi pays Fandrian ₺ 1.900".

## 2. Decisions taken with the owner

| # | Decision |
|---|---|
| D1 | **An event is its own shared group** (option C), not part of a workspace. People are invited to the event itself. |
| D2 | Spending can be **in the event only** (no workspace), or recorded in a workspace and **tagged** in. Tagging into a *shared* event moves the transaction out of its workspace (only the owner's share is their spending once split). |
| D3 | **People without the app** can be in the event as a name; any member records their payments. They can claim the name later when they install cicis. |
| D4 | **Split and keep balances.** Equal split by default (everyone, or ticked people), or by amount. |
| D5 | **One event currency** (chosen at creation, fixed after the first expense). Each expense keeps its own currency and a rate to the event currency, fixed when recorded and synced. |
| D6 | **Fewest payments** settle-up suggestions. |
| D7 | **Plan is shared**: items, estimates, ticking, Buy it now. |
| D8 | Anyone may edit anything, **except** an expense paid from a member's account: only that member changes its amount, currency, rate, date, or deletes it. |
| D9 | Leaving needs a zero balance; a person is removed only at zero balance and in no expense. |
| D10 | Events that are not shared behave exactly as today. |

## 3. What syncs (the event log)

Each shared event has its **own relay book**, made the way `openGroupLog` makes the net-worth group log
(`packages/db/src/sync/net-worth/group-log.ts`): a `shared_books` row with no `books` row, its own epoch keys, its own
members and devices (`book_members`, `book_devices`). It is not tied to any workspace, so a friend who shares no
workspace with the owner can join. Joining uses the household invite link (`cicis://join/…`, `sync/invite.ts`) and
its claim flow, pointed at the event's relay book.

Row entities added to `SHARED_ENTITIES`, all scoped by the event's local book id:

| Entity | Table | Fields | Writer |
|---|---|---|---|
| `shared_event` | `shared_events` | name, startsOn, endsOn, currency, finishedAt | anyone; `currency` refused once an expense exists |
| `event_person` | `event_people` | name, memberId (null = no app), removedAt | anyone; `memberId` set only by that member's claim |
| `event_category` | `event_categories` | name, icon, sortOrder, archivedAt | anyone |
| `event_expense` | `event_expenses` | occurredOn, amountMinor, currency, rateToEvent, payerPersonId, voidedAt | payer's member when the payer has the app; anyone otherwise |
| `event_expense_detail` | `event_expense_details` (same key) | note, categoryId, splitMode (`equal`/`amounts`), splitJson, recordedBy, updatedBy | anyone |
| `event_settlement` | `event_settlements` | occurredOn, fromPersonId, toPersonId, amountMinor (event currency), voidedAt | `from`'s or `to`'s member; anyone when neither has the app |
| `event_item` | `event_items_shared` | name, quantity, unitPriceMinor (event currency), categoryId, link, note, expenseId, shareMinor, sortOrder | anyone |

The expense is two entities with one key so the payer-only rule (D8) is a whole-row `writer`, which the sync already
supports, instead of a new per-field writer.

`rateToEvent` is a decimal string (the existing rate format). An expense in the event currency has rate `1`.
`splitJson` is `[{personId, minor}]` in the expense's own currency for `amounts`, or `[personId…]` for `equal`.

**Never synced:** which account paid, card, MCC, photos, channel, anyone's workspace, anyone's own-currency figures.

## 4. Pure logic (`packages/core/src/shared-events/`)

- `sharesOf(expense, people)`: equal split in the expense currency's minor units; leftover units go to the payer if
  the payer is in the split, else to the first person in the split. `amounts` must sum to the total (`SPLIT_MISMATCH`).
- `toEvent(minor, currency, rateToEvent, eventCurrency)`: one rounding rule (half away from zero), used everywhere.
  Each share is converted on its own; the payer's "paid" figure is the sum of the converted shares, so every expense
  nets to exactly zero in the event currency.
- `balances(expenses, settlements)`: per person, paid − own shares + settlements paid − settlements received.
  Sum is always zero.
- `fewestPayments(balances)`: greedy largest-debtor-to-largest-creditor; deterministic order (by amount, then person
  id) so every phone suggests the same list.
- `myPostings(expense, me, …)` / `mySettlementPostings(…)`: the lines in §5.

All of these get property tests (fast-check): balances sum to zero; suggestions settle every balance; the split
always sums to the total.

## 5. Each person's own books

Each phone keeps **one local account per shared event**: asset, new subtype `event_balance`, currency = event
currency, named after the event ("Turkey trip"). Positive = the group owes this person; negative = this person owes the
group. It is the "trip balance" (D6), shown on the Debts page with the suggested payments. Net worth counts it like a
receivable (or a payable when negative); the tax report files it as piutang or utang by its sign at year end.

Postings are **derived locally** from the event log and kept in a local table `event_postings (recordId,
transactionId)`, the way `member_transfer_postings` ties a member transfer to its local transaction. When a record
changes, its transaction is replaced (`replaceTransaction`); when it is voided, so is the transaction.

For an expense of X in currency C, my share s (in C), event currency V, rate r:

| Case | Lines on my phone |
|---|---|
| I paid, from my account A (currency C) | A −X; my share category +s; event balance + the sum of the others' converted shares (V); currency exchange balances C against V |
| Someone else paid, I am in the split | my share category +s; event balance −toEvent(s) in V; exchange balances |
| I am not payer and not in the split | nothing |
| I pay a settlement of M (V) from account A | A −(what A paid); event balance +M; exchange balances when A is not in V |
| I receive a settlement into A | A +(what A received); event balance −M; exchange as above |

- **My share category** is a local copy of the event's `event_category`, an expense account that belongs to **no
  book** (no `book_categories` row), so the transaction has no `book_transactions` row: it is in no workspace (D2).
- The rupiah value of my share is read at that day's rate as today (`ratesForSave`). The first-in-first-out
  withdrawal rate is a separate design and will change this one call.
- **An expense I paid from a card keeps everything a card purchase has**: `card_id`, MCC, channel, photos, the
  statement check's match, points. Those are set on the local transaction when I record it and carried by
  `replaceTransaction` when the record changes, exactly as an edit carries them today.
- **Recording**: the Add screen writes the event records and my local transaction in one db transaction; the sync
  sends the records. On other phones, applying the records derives their own lines.

### 5.1 Reads that must ignore event-only transactions

Today a transaction with no `book_transactions` row is visible in every workspace (`ledger.ts` book narrowing). An
event-only transaction must instead appear in **no** workspace list, Cashflow, budget or spending report. It still
appears in the account's own history, the card's statement and points, net worth and the event page. Every reader
that narrows by book gets this rule, with a test per reader.

## 6. Screens

- **Events list**: a shared event shows its people's initials and "Shared with N people".
- **Event page**: header (dates, currency, people; "Spent ₺ 12.600 · Fandrian's share ₺ 4.200"), tabs **Spending**,
  **Balances**, **Plan**. Spending rows show amount in their own currency, who paid, the category, the split and my
  share. ⋯ holds People (invite link, add a name, remove), Currency (until the first expense), Done, Leave.
- **Balances**: one line per person, the suggested payments, **Settle up** (records an `event_settlement`; asks for an
  account when this person pays or receives).
- **Add screen in a shared event**: the event filled in; **Paid by** (this person with an account, or a person's
  name); **Split** ("Equal · 3 people", tap to tick people or type amounts); Category from the event's categories;
  any currency, with the rate to the event currency shown and editable.
- **Tagging into a shared event** (Select or the Event row): "Moves to Turkey trip, shared with 2 people." The
  transaction leaves its workspace and becomes an expense paid by this person with a 100 % own share.
- **Sharing an existing event**: asks once, then moves its tagged transactions the same way and turns its category
  set into the event's categories and its plan into shared items.
- **Joining**: the link opens "Join Turkey trip"; the joiner picks a name ("I'm Budi") or adds their own.
- Copy never says "you"/"your" (the owner's rule); people are named.

## 7. Edge cases

- **Two edits at once**: per-field last writer wins (`sync_field_clocks`); a void beats an edit.
- **Offline**: records queue in `sync_outbox`; a row not yet sent shows "Not sent yet".
- **The payer's money**: only the payer's member changes `event_expense` (D8). A refused write lands in
  `sync_skipped` with its reason, as the net-worth writers do.
- **Changes reaching my books**: a derived transaction replaced because someone else edited the record says "Changed by
  Andi" in its history.
- **Currency**: refused after the first expense (writer check on `shared_event.currency`).
- **Leave**: refused unless this person's balance is zero; their records stay; their devices leave the relay book and
  the others rotate the key (as `leaveNetWorth`). Their own derived transactions stay in their books.
- **Remove a name**: refused unless zero balance and in no expense or settlement.
- **Claim**: a name is claimed once (`memberId` set); a second claim is refused.
- **Lost phone**: another member sends a new invite; the event reloads from the log. All members' phones lost at once:
  only an iCloud backup restores it.
- **Done**: read-only for everyone until reopened.
- **App version**: the household rule (`app_version`, refuse to sync with an older build).

## 8. Out of scope

Different home currencies shown per person beyond each one's own books; receipt photo sync; push notifications;
recurring shared bills; pricing/entitlement of shared events (to be decided with the platform plan).

## 9. Build order

1. Core: splits, conversion, balances, fewest payments, postings — with property tests.
2. DB: tables + migration; `event_balance` subtype; local derivation and `event_postings`; book-less transactions
   and §5.1 reader rule.
3. Sync: event relay book (open, invite, claim, leave, rotate); the seven entities with writers; apply derives postings.
4. Web: event page tabs, Add screen Paid by / Split, Balances and Settle up, People, sharing an existing event,
   tagging moves.
5. E2E: three phones (two with the app, one name-only person), a euro expense in a TRY event, a settle-up in IDR,
   a payer-only refusal, offline record then sync.

## 10. Review focus

1. An event-only transaction leaking into a workspace's Cashflow or budget (§5.1).
2. Rounding: the sum of converted shares not equal to the payer's converted total, leaving a balance off by one unit.
3. A card purchase moved into a shared event losing its card, MCC or points.
4. Two phones suggesting different settle-up lists (non-deterministic order).
5. A friend's edit changing the owner's account balance (payer-only rule bypassed by the detail entity).
