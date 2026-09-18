# Add Transaction rebuild, the receipt, and the phone gestures — design

Status: approved · 2026-09-18
Decisions: `decisions-add-transaction.md` (user, 2026-09-17)
Mockups: `add-transaction.html` (Option B — B1–B8, A4 rejected, C1–C3, D1–D4, and the field-map table, which is
binding) and `quick-edit.html` (E1–E4 alternatives; the chosen flow is F1 + F2 + F4 leading to one edit sheet F3).
Chosen: layout **Option B**, extras as **B3** (one row per extra, each its own screen), category picker **B7/B7a**,
receipt **B8**, phone gestures **F1/F2/F4 → F3**, desktop keeps edit-in-place and gains **ⓘ**.

Assumed landed before this: workspaces switching (the switcher, `ws.bookId` narrowing, per-workspace currency), the
Coretax-shaped pickers for accounts/assets/debts, and the data-safety work (staged open, OPFS snapshots).

## 1. What we are building

Today `TransactionForm.tsx` is one flat grid of `<Field>`s: three mode buttons plus a fourth for Buy or sell, then
Date, Description, Paid with, Card, Category, Amount, a cross-currency Received amount, a "Someone owes part of
this" box for exactly one person, a "Card purchase details" `<details>` (original currency, original amount, MCC,
remember-this-merchant, merchant text), split rows, and a manual rate field when a rate is missing. It is the same
on a 390px phone as on a desktop, and on the phone the label-over-field grid runs past the fold before the amount
is reached.

The rebuild gives the same facts a Money Lover shape:

- **One card with four tabs** — Expense · Income · Transfer · Buy or sell (the last only when there are
  investments) — and short rows inside it, each a tap that opens its own screen.
- **An amount row that reads like any other row**, with a round flag for the currency; choosing a currency the
  paying account does not keep adds one row under it, "Charged in *IDR*", which is what the bank actually took. The
  rate is the ratio of the two amounts, so there is no rate field.
- **A keypad on the phone** with no recent amounts and no Save; DONE works out any sum and closes it.
- **"Add more details"** — one row per extra, each showing its value: Event, Split, With, MCC, Channel, Photos,
  Exclude from report, and an exchange-rate row only when a rate is missing.
- **A receipt** after saving, opened by tapping a row.
- **Phone gestures**: tap a row for its receipt, swipe left for Edit or Delete, tap the category icon to fix a
  category; Edit — from either way in — is one bottom sheet.
- **Desktop keeps everything it has**: rows still edit in place, and each row ends with ⓘ for the receipt.

Three facts are new: **Channel** (Online / Offline), **Photos** (on this device only) and **Exclude from report**.
Two things change shape without changing meaning: **Event** moves off the main card into Add more details, and
**"Someone owes part of this"** becomes **With**, which takes any number of people.

Nothing is removed. §2 is the checklist.

## 2. The field map — where every field of today's form lives

Binding, from `add-transaction.html`. Every row below is a field or action the app has today (or a new one marked
**new**); the right column is where it lives after the rebuild. A field may move; none may disappear.

### New with workspaces

| Field | Where it lives in Option B |
|---|---|
| Workspace | First row of Expense and Income; none on Transfer or Buy / sell, which only move your own money (B1, B4) |
| Event | Add more details (B3) |

### New extras

| Field | Where it lives |
|---|---|
| Channel: Online / Offline — **new** | Add more details → Channel (B3, D1); blank unless chosen |
| Photos — **new** | Add more details → Photos (B3, D2); shown on the receipt (B8) |
| Exclude from report — **new** | Add more details, a switch on the row itself (B3, D3) |

### Modes

| Field | Where it lives |
|---|---|
| Expense / Income / Transfer / Buy or sell | Tabs at the top of the card; Buy / sell only when there are investments |

### Everyday

| Field | Where it lives |
|---|---|
| Amount | Amount row, typed on the keypad (B1) |
| Paid with / Received into / From | Row under the workspace (B2, B4, B5) |
| Card (which card on the account) | The Paid with list: each card of an account is its own choice, e.g. "BCA KrisFlyer ···· 1467" (B2). Choosing it never changes the account or card |
| Category | Category row → Select category (B7), with New category (B7a) |
| Description | Note row (B2) |
| Date | Date row with ‹ › (B2) |

### Transfer

| Field | Where it lives |
|---|---|
| To · For goal · Received amount | Transfer card and its second card (B5) |

### Expense extras

| Field | Where it lives |
|---|---|
| Split rows · Split · Total | Add more details → Split (B3, B3a) |
| Someone owes part of this · Who owes you · Their share | Add more details → With (B3, D4): one or more people, each with their share |
| Original currency | The flag on the amount row (C1) |
| Original amount | The amount itself, in the chosen currency (C2) |
| Amount in the account's currency | "Charged in IDR", shown only when the two currencies differ (C2) |
| Rate: IDR per 1 X | Worked out from the two amounts; no field of its own (C2) |
| MCC · Remember MCC · Merchant text | Add more details → MCC (B3) |

### Buy or sell

| Field | Where it lives |
|---|---|
| What you bought or sold · Lots or Units · Cost / Proceeds · Fee · Paid with / Proceeds into · Date | Buy / sell card (B6) |
| For goal / Sell from goal · Category for points · MCC | Second card (B6) |

### Row actions and quick edit (from `quick-edit.html`)

| Action today | Where it lives |
|---|---|
| Click a row to edit in place (desktop) | Unchanged on desktop (`QuickRowEditor`); on a phone: swipe left → Edit → the edit sheet (F2, F3) |
| Row cells: date, description, amount, paid with, category | The edit sheet's rows, and the table's cells, unchanged |
| Save · ✕ cancel | Save button in the sheet; ✕ or swipe down cancels (F3) |
| Open in form | ⋯ in the sheet → **Open in full form** (F3) |
| This was a purchase | ⋯ in the sheet, and on the receipt (F1, B8) |
| Delete this transaction (asks twice) | ⋯ in the sheet, on the receipt, and behind the swipe (F2); still asks twice, still lands under Show deleted |
| Record / Save for later / Discard (a draft row) | Unchanged: a row not recorded yet keeps today's in-place editor on both phone and desktop |
| Paste rows from a spreadsheet, type a row in the table | Unchanged (`TransactionsTable`) |

**Nothing is removed.** The one deliberate omission is a field the app never had: Set location, left out because no
points rule needs it and it would record where the owner has been. The old "Card" row disappears as a *row* only —
the card is chosen inside Paid with, which is the same fact recorded the same way (`transactions.card_id`).

## 3. The Add Transaction card

### 3.1 Shape

One card. A segmented control across its top — Expense · Income · Transfer · Buy / sell — then rows, 48px tall,
each: a leading glyph, a label or value, and a chevron when it opens something. Below the card, "Add more details".
The dock at the foot holds Save; on a phone, while the amount is being typed, the keypad takes the dock instead.

The card is the same component on a phone and on a desktop. On a desktop it sits in a dialog (the page's "Add
transaction" button) at `md:max-w-2xl`, rows the same, with the keyboard doing what the keypad does by thumb. The
form is never narrower in what it can record on one screen than the phone's.

### 3.2 Expense and Income (B1, B2, B4)

Rows, in order:

1. **Workspace** — defaults to the open workspace. Changing it changes the categories offered, and files the
   transaction there (through its categories, exactly as today: `book_transactions` is written from the categories
   the posting touches). Present only on Expense and Income.
2. **Paid with** (Expense) / **Received into** (Income) — one flat list built from `paymentOptions(accounts, cards)`:
   an account with one card or none is one choice showing its digits; an account carrying two or more cards offers
   each card as its own choice, "BCA KrisFlyer ···· 1467". Choosing one sets the account *and* the card. It never
   silently changes either.
3. **Amount** — §3.3.
4. **Category** — opens the picker (§6). Hidden while a Split is in force, as today; the Split screen owns the
   categories then.
5. **Note** — today's Description, same field, same placeholder ("Superindo").
6. **Date** — ‹ *Thu, 17 Sep 2026* ›. The arrows step a day; the middle opens the date input.

Save is enabled when the mode's required facts are there; pressing it with something missing says which row
(the same messages `draftToLines` throws today, shown above Save).

### 3.3 The amount row and currency (C1, C2, C3)

The amount row is the same height and weight as the others: a round flag circle for the currency, the figure in the
label's place, and the currency code under it. It is **not** a giant number.

- It starts on the paying account's currency. An IDR account shows 🇮🇩 IDR; a CNY cash account shows 🇨🇳 CNY (C3).
- Tapping the flag opens a currency sheet: **Recent** first (the paying account's currency, the workspace's own, and
  the last three chosen on this device), then **All currencies**, with a search field. `CURRENCIES` gains a `flag`
  for each entry.
- **When the chosen currency differs from the paying account's**, one row appears directly under the amount:
  "Charged in *IDR*", the leading glyph being the account currency's flag. It is pre-filled with an estimate at that
  day's rate, and is editable to what the bank actually charged. Under it, one quiet line:
  "≈ Rp2.270 per ¥1 · suggested from 17 Sep, change it to what BCA charged". The rate shown is derived from the two
  amounts; there is no rate field, and nothing is stored for it.
- Choosing the account's own currency again removes the row and clears what was in it.

How it is recorded: the typed amount and its currency become `original_currency` / `original_amount_minor` (the
columns that exist today), and "Charged in *IDR*" becomes the posting amount in the account's currency. Today those
two columns are kept only for card expenses; they are now kept for any expense or income whose chosen currency
differs from the paying account's, which loses nothing and lets a foreign purchase from a bank account read
correctly. When the currencies match, both stay null, exactly as today.

The manual **exchange-rate** field is not gone: it appears as a row under "Add more details" — and only there, and
only when `resolveRates` reports a missing rate for the workspace's base currency, which is when today's form shows
it. Its validation (`checkManualRate`, `ratePreview`, `upsertRate`) is unchanged.

### 3.4 The keypad (B1)

On a phone, tapping the amount opens a keypad in the dock: `C ÷ × ⌫ / 7 8 9 − / 4 5 6 + / 1 2 3 DONE / 0 000 00`.

- **No recent amounts.** **No Save key.** Save lives only on the form.
- **DONE** works out whatever was typed — `120000+35000`, `85000×3`, `450000÷4` — writes the result into the amount
  row, and closes the keypad. An expression that cannot be read leaves the row as it was and the keypad open.
- The arithmetic is a pure function in `packages/core`, left to right with × and ÷ before + and −, rounded to the
  currency's minor unit at the end.
- On a desktop there is no keypad: the amount row is a text input, and the same evaluator runs on blur and on Enter,
  so `85000+15000` works with a keyboard too.

### 3.5 Transfer (B5)

Rows: **From** · **Amount** · **To** · **Note** · **Date**. A second card below holds **For goal** and, only when
the two accounts' currencies differ, **Received amount (USD)**. There is **no workspace row**: moving your own money
belongs to no workspace, which is what the ledger already does (a transfer touches no category, so
`book_transactions` gets no row and every workspace sees it).

`recordTaggedTransfer` for a goal, `exchangeLines` through the currency-exchange account for differing currencies —
both unchanged.

### 3.6 Buy or sell (B6)

The tab exists only when `buyChoices(...).buys` is non-empty. Rows: **what you bought or sold** (Bought / Sold) ·
**amount** — the cost or proceeds before fees, in the holding's currency · **units** or **lots** · **fee** ·
**Paid with** / **Proceeds into** · **Date**. Second card: **For goal** / **Sell from goal**, and on a credit card
**Category for points** and **MCC**. No workspace row.

`purchaseDraftToInput` and `recordTrade` are unchanged; only the layout moves. Every message it throws
("Enter how many lots", "Choose a bank or cash account for the proceeds", …) is shown above Save.

## 4. Add more details (B3)

Under the card, a single row "Add more details" opens a second card of one row per extra, each showing its current
value and opening its own screen. A row appears only when it applies.

| Row | Shows | Opens | When it appears |
|---|---|---|---|
| Event | the event's name, or nothing | the event list (`useEvents`), with "No event" at the top | always, on Expense and Income |
| Split | "None", or "2 splits · Total 85.000 IDR" | B3a: a category and amount per split, ✕ per row, + Split, the running total | Expense |
| With | the people, "Andi, Putri, Chika" | D4 (§4.1) | Expense, and only when adding (as today — an edit does not re-split) |
| MCC | "5812" | today's MCC picker, Remember for this merchant, Merchant text | Expense paid by card |
| Channel | "Online", "Offline", or nothing | D1 (§4.2) | Expense and Income |
| Photos | "1 receipt", "3 photos" | D2 (§4.3) | always |
| Exclude from report | a switch, on the row itself | nothing — it is the control | always |
| Exchange rate | the typed rate | the rate field, with today's preview and check | only when a rate is missing |

### 4.1 With (D4) — several people owe part of this

Replaces "Someone owes part of this", which took one name and one amount.

- A search field, "Add a person", over recent people as chips (`listDebtProfiles`, most recently used first). A name
  that is not known yet opens a new person on saving, exactly as today.
- A segmented control: **Split equally** or **Custom amounts**.
  - *Split equally* divides the bill by everyone **including you**; the remainder, when it does not divide evenly,
    goes to your share, so the shares always add back to the bill.
  - *Custom amounts* lets each person's share be typed; **your share is what is left**. A total over the bill is
    refused with "Their shares come to more than the bill".
- A summary: **Bill**, **They owe you**, **Your share**.
- Your share counts in the chosen category. Each person gets their own balance under Lend & borrow. The card is
  charged the full amount, so the statement and the points still match the bank.

Recorded with the existing `splitBill(database, ws, { …, ownShareMinor, shares: [{ person | debtAccountId,
amountMinor }, …] })`, which already accepts several shares; the form has simply never offered more than one. The
share arithmetic (equal split, remainder, your share as the rest) is a pure function in `packages/core`.

### 4.2 Channel (D1)

Two choices with a line each — Online ("Marketplaces, apps, websites") and Offline ("In a shop, at the counter") —
and one explanation: *Some cards earn or spend points only online, or only offline. Optional: leave it blank and
nothing is chosen for you. Tap the chosen one again to clear it.*

- **Blank by default. Never auto-filled, never guessed, never required.**
- When it is set, the points engine uses it: a rule that names a channel will not match a purchase marked the other
  way. When it is blank, nothing changes — keyword detection decides, exactly as today.
- It is a fact about the purchase, so it survives an edit (`replaceTransaction` carries it).

### 4.3 Photos (D2)

- A grid of thumbnails with ✕ on each, a + tile, and two rows: **📷 Take photo** (`<input type="file"
  accept="image/*" capture="environment">`) and **🖼 Choose from library** (the same input without `capture`).
- One line: *Photos stay on this device with the transaction and go into your backups. Tap one to see it full size.*
- One or more per transaction. Tapping one opens it full size.
- **They never leave the device.** No upload, no network call, no third party. They live in OPFS beside the
  database and are written from the main thread (§7.3).
- Reading the amount off a photo is a later feature. Not this one.

### 4.4 Exclude from report (D3)

A switch on the row; nothing opens. When it is on:

| Counts it | Leaves it out |
|---|---|
| Account balances, net worth | The Cashflow chart and its category rings |
| Card statements, cycle totals | Budgets (caps, what is left, the month's spending) |
| Points earned and spent | Category totals and the Categories grouping |
| Lend & borrow balances | The day's total in the list |
| The tax report's figures | |

In every list the row is faded, its amount struck through, and a small **Excluded** pill sits after the category:
"Electronics · KrisFlyer · Excluded". The receipt says so under the date.

This is for a purchase that really happened on your card but is not your own spending — a phone bought for your
mother, repaid outside the app. The statement and the points still match the bank; it simply stays out of what you
spent on yourself.

## 5. Where the form lives

| Surface | What opens |
|---|---|
| Phone: the tab bar's + , the Cashflow header's + | the card as a bottom sheet, titled "Add a transaction" (as today) |
| Desktop: "Add transaction" on the Cashflow page | the card as a dialog |
| "Open in full form", from the edit sheet's ⋯ | `/transactions/new` or `/transactions/$transactionId/edit` — the same card on its own screen, every extra already unfolded |
| A row's Edit, on a phone | the edit sheet (§8) |
| A row, on a desktop | edit in place, as today |

`TransactionForm.tsx` is replaced by this card. The old file is deleted; every caller
(`Layout.tsx`, `TransactionsPage.tsx`, `TransactionsTable.tsx`'s `renderForm`) points at the new one.

## 6. The category picker (B7, B7a)

A screen of its own, not a `<select>`.

- Header: ‹ back · "Select category" · ≡ (reorder and hide, which opens Categories).
- A segmented control, **Expense** / **Income**, following the tab the form is on.
- **+ New category** at the top, in green.
- Each top-level category is a card: the parent as its first row, then its children indented, joined by the elbow
  line that Money Lover draws. **Tapping a parent picks the parent** (today's "(general)" option, without the word).
- A floating search pill at the foot of the screen.
- Only the chosen workspace's categories: `inOpenBook`, or the workspace chosen in the form's first row. Set
  categories stay out, as they do in `CategoryOptions` today — they belong to an event.

**New category (B7a)**: name · Inside (top level, or a parent) · Kind (Expense/Income, fixed by the tab) · Icon
(a grid of the bundled Lucide names in `ICONS`). Saving calls `createAccount(database, ws, { name, kind, subtype:
'category', currency: null, parentId, icon })` — which already files the new category into the open workspace's book
— and returns to the form with it chosen. `CategoryIcon` learns to prefer an account's own `icon` when it has one,
so a category made here draws what was picked rather than its parent's glyph.

## 7. The receipt (B8)

Route `/transactions/$transactionId`. One screen on both phone and desktop.

- ‹ back.
- The category's round icon; the **amount, large**; the description; "Restaurants · Personal" (category ·
  workspace); "Thursday, 17 Sep 2026".
- A card of what came of it, each line shown only when it has something to say:
  **Paid with BCA KrisFlyer ···· 1467** · Total · **Points earned** (`loadPurchasePoints`) · "Andi, Putri, Chika owe
  you" and **Your share** · Event · Channel · Original amount ("¥120 charged as Rp272.400") · "Aug bill" when it
  settles another month's bill.
- When it is excluded: under the date, *Excluded from the chart and budgets. Still counted in balances, statements
  and points.*
- The photo strip; tapping one opens it full size.
- **This was a purchase** (today's `ConvertForm`, when there are holdings), **Edit**, **Delete**.
- **Delete asks twice** and voids (`voidTransaction`); the row then sits under Show deleted.

Edit opens the edit sheet on a phone and the full form on a desktop.

A transaction that cannot be edited — an opening balance, a recorded trade, one filed in another workspace — still
opens its receipt; the actions that do not apply are simply not drawn, and a row from another workspace shows the
existing "open it in *Business* to edit" line.

## 8. The phone gestures (F1–F4) and the one edit sheet (F3)

In every transaction list: the Cashflow history, the category screen, search results, an event's history and a
card's statement. One `TransactionRow` component carries all of it; each list keeps whatever it shows at the end of
the row through a `trailing` slot.

- **F1 — tap the row** → its receipt (§7).
- **F2 — swipe left** → **Edit** (grey) and **Delete** (red), on the existing `SwipeRow`, which gains a `reveal`
  width so two buttons fit. Edit opens the edit sheet straight away, skipping the receipt. Delete turns into
  "Delete?" and needs a second tap. Swiping back, or tapping anywhere else, closes the buttons.
- **F4 — tap the category icon** → the category list only. Picking saves at once (`replaceTransaction` with the new
  category) and closes, with "Moved to Fuel · Undo" for four seconds (the existing `UndoToast`).
- **No long-press.**

**The edit sheet (F3)** — one sheet for every way in. The amount large at the top, then Note, Date, Paid with,
Category, and **More** ("Event, With, Photos…") which opens the same Add more details screens. Save is a full-width
button. ✕ or a swipe down cancels. **⋯** holds **Open in full form**, **This was a purchase** and **Delete this
transaction**. The original stays under Show deleted after an edit, as today.

A transaction the sheet cannot express — a split, a transfer, a foreign-currency purchase, a trade — opens the full
form instead; the sheet is never shown half-filled.

## 9. Desktop parity

Desktop is the highest paid tier. It loses nothing and gains what the phone gains.

| Phone | Desktop |
|---|---|
| Tap a row → receipt | ⓘ at the end of the row → the same receipt. The row itself still opens the in-place editor |
| Swipe → Edit | Click the row → edit in place (`QuickRowEditor`), unchanged |
| Swipe → Delete | The row's Delete, unchanged (asks twice) |
| Tap the category icon → category list | Click the category icon → the same list, same Undo toast |
| The edit sheet | Edit in place, plus "Open in form" as today |
| The keypad | A text field that evaluates the same arithmetic on Enter and on blur |
| Photos: take or choose | Choose from disk (no `capture`); drag-and-drop onto the Photos screen |

Every new control is reachable by keyboard: the tabs are a radio group, each row is a button, the pickers are
dialogs that trap focus and close on Escape (the existing `Sheet`), and the receipt is a route with a real back
link.

## 10. Data model

### 10.1 No new columns on existing tables

`transactions`, `accounts`, `entries`, `expense_templates` gain nothing. The ORM names every column it knows on
every insert, so a column there breaks any database still stopped at an older version (migration 0028's comment).
New facts go in side tables, as `bill_payments` and `book_transactions` do.

### 10.2 Migration 0048 `transaction_extras`

```
transaction_flags   transaction_id PK · workspace_id · channel TEXT NULL ('online'|'offline') · excluded INTEGER NOT NULL DEFAULT 0
transaction_photos  id PK · workspace_id · transaction_id · file_name · mime · byte_size · sort_order · created_at
                    INDEX (workspace_id, transaction_id)
```

Additive; nothing is backfilled, because an absent row means "no channel, not excluded, no photos" — which is what
every existing transaction is.

Every read and write goes through `extrasTablesExist(db)`, the same `WeakMap` guard as `billTablesExist`, so a
database stopped at an older version behaves exactly as it does today.

### 10.3 What each new fact uses

| Fact | Storage |
|---|---|
| Channel | `transaction_flags.channel`; null = blank |
| Exclude from report | `transaction_flags.excluded` |
| Photos | one `transaction_photos` row per photo; the bytes in OPFS (§10.4) |
| Event | `transactions.event_id` — the column already exists and `replaceTransaction` already carries it; only the form is new |
| With, several people | the existing `splitBill` with several `shares`; each person is an account plus a `debt_profiles` row, as today |
| Original currency and amount | `transactions.original_currency` / `original_amount_minor`, as today |
| The derived rate | nothing. It is the ratio of the two amounts |
| Which card | `transactions.card_id`, as today |
| A new category's icon | `accounts.icon`, which exists and is unused for categories |

### 10.4 Photos on the device

Bytes live in OPFS under `expanses-photos/<photo id>.<ext>`, written and read from the **main thread**, never inside
the database's VFS directory and never through the worker — the same rule the data-safety snapshots follow. The
database row is the index; the file is the picture.

- Adding a photo before the transaction exists writes the file at once under a fresh id and holds the id in form
  state; the rows are inserted when Save posts the transaction.
- A form abandoned leaves a file with no row. `sweepOrphanPhotos()` runs on the Photos screen closing and at app
  start, and deletes any file OPFS has that no row names.
- Deleting a transaction keeps its photos (a void transaction can be shown again). Deleting a photo deletes both
  row and file.
- `replaceTransaction` carries the photo rows onto the replacement, as it does for card postings.
- **Backups.** The `.sqlite3` backup is unchanged. Beside it the Backup page offers "Download photos (12)", a
  store-only zip built by a small pure writer in `packages/core`, and "Restore photos" which reads one back. A
  restore writes only files whose rows exist, and never overwrites a file already there.

### 10.5 Posting

`PostTransactionInput` gains four optional fields — `channel`, `excludedFromReport`, `eventId`, `photoIds` — all
written inside the same database transaction as the posting, so a refused posting leaves no flag and no photo row
behind. `replaceTransaction` carries all four onto the replacement unless the input says otherwise, the way it
already carries MCC, card, template and bill month.

`TransactionView` gains `channel`, `excluded` and `photoCount`, read in one extra query per list, guarded by
`extrasTablesExist` — the pattern `billMonth` already uses.

## 11. What "excluded" means to each reader

| Reader | Excluded rows |
|---|---|
| `categoryTotalsBetween` / `categoryTotalsIn` (`categoryRows`) | left out — this one change covers the Cashflow chart, the category rings, `IncomeFlow`, the dashboard and the budget sheet |
| `periodFlows` — income and spending | left out |
| `periodFlows` — savings, debt payments, put away | **counted**: those are facts about balances, not about spending |
| `eventSpendingBetween`, `eventSheetFor` | left out |
| `nativeBalances`, net worth, Coretax | counted |
| `cardSpendLines` → points, statements, cycles | counted |
| `peopleDebts`, `debtHistory` | counted |
| The list itself | shown, faded, struck through, with the Excluded pill; `dayTotal` and `totals` ignore it |

## 12. Channel and the points engine

`RuleMatch` gains `channel?: 'online' | 'offline'` and `SpendLine` gains `channel: 'online' | 'offline' | null`.
`matchesSpend` adds one line:

```ts
if (match.channel && line.channel && match.channel !== line.channel) return false;
```

So a rule that names a channel is refused by a purchase marked the other way, and a purchase with no channel is
judged exactly as today, by its merchant keywords. No catalogue rule is written to use it in this project; the
field is there so a card whose points are online-only can be described at all.

## 13. Testing

**Pure (`packages/core`, vitest)** — the keypad evaluator (precedence, the 000 key, a bad expression, rounding per
currency); equal and custom shares (remainder to you, your share as the rest, a share over the bill); currency
flags (every `CURRENCIES` entry has one); `matchesSpend` with a channel; the store-only zip (round trip, CRC).

**Repository (`packages/db`, vitest against a real SQLite file)** — 0048 on a version-47 database; flags written
and read back; `replaceTransaction` carrying channel, exclusion, event and photo rows; an excluded transaction
leaving `categoryTotalsIn`, `periodFlows` income and spending, and `eventSpendingBetween`, while `nativeBalances`,
`cardSpendLines` and the points earned are unchanged to the rupiah; `splitBill` with three shares giving three
receivables and one category line; every new read behaving as today on a database without the tables.

**Web unit (vitest)** — the form model: a draft to posting input for each of the four tabs; the charged-in row
appearing and clearing; which extra rows apply; what the edit sheet can and cannot express.

**End to end (`chromium`)** — add an expense with the new card; the foreign-currency row; Add more details end to
end (event, split, with three people, MCC, channel, exclude); the receipt from ⓘ; edit in place still works; a new
category from the picker; an excluded purchase leaving the chart but staying on the statement.

**End to end (`phone`)** — the keypad and DONE; tap a row for its receipt; swipe for Edit and for Delete (twice);
tap the category icon and Undo; the edit sheet saving; a photo added from a file and shown on the receipt.

Every existing spec that drives today's form (16 of them) moves to one helper, `e2e/add-transaction.ts`, in the
task that replaces the form, so the gate never goes red.

## 14. Out of scope

- Reading the amount, the merchant or the date off a photo.
- Any upload, sync or sharing of photos.
- Set location, and anything that records where the owner has been.
- Catalogue rules that use Channel; voice or receipt capture; the review queue's own screens.
- Reordering and hiding categories (the ≡ button opens today's Categories page).
- The table view's cells and paste, which stay exactly as they are.
- Recurring bills, statements, points maths, net worth and the tax report: none of their figures move, except that
  an excluded transaction leaves the two report readers named in §11.

## 15. Decisions taken here that the decisions file did not cover

1. **Photos in backups.** The decisions say photos go into backups; the backup is a single `.sqlite3` file that
   cannot hold OPFS files. Photos are exported and restored as a store-only zip beside it, written by a small pure
   function in `packages/core` — no new dependency.
2. **"Recent" currencies** are the paying account's currency, the workspace's own, and the last three chosen,
   remembered in `localStorage` (a convenience only: losing it just shows the full list).
3. **Original currency beyond cards.** Today `original_currency` is kept only for card expenses. It is now kept for
   any expense or income whose chosen currency differs from the paying account's, so C2's row records something. No
   reader loses anything by this.
4. **The full form** is a route (`/transactions/new`, `/transactions/$transactionId/edit`), which is what "Open in
   full form" opens; the sheet and the dialog render the same card.
5. **`periodFlows` keeps excluded rows in its savings and debt figures**, since those describe balances rather than
   spending; only income and spending drop them.
6. **Splitting on an edit** stays as it is today: With is offered when adding, not when editing, because
   `splitBill` posts a differently shaped transaction. Editing a split bill opens the full form.
