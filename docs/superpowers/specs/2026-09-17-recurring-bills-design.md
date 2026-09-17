# Recurring bills revamp — design

Status: approved · 2026-09-17
Mockups: `bills.html` (static options) and `bills-proto.html` (interactive; the reference for behaviour and copy).
Chosen flow: layout V1, one bill N2 (swipe), paying from a bill's page A1 (sheet, stay), several M2 (select), decision A
(a bill counts in the month it comes out).

## 1. What we are building

Today a recurring bill has one day. It is "owed" once that day has passed in the calendar month, "paid" if any
template-linked transaction was posted in the same calendar month, and it lives in two places: a sheet behind the
Cashflow "Recurring" card, and a setup list at `/bills`.

That breaks on the bills people actually have. Internet comes out on the 28th and must be paid by the 5th: paying it
on 3 September settles August's bill, but today it marks September paid and leaves nothing saying August was ever
due. And the setup list and the pay sheet are two screens for one thing.

The revamp:

- **A bill has a window.** "Bill is out on" (today's `day_of_month`) and an optional "Pay by" day. A pay-by day earlier
  than the out day falls in the following month (out on the 28th, pay by the 5th).
- **A payment says which month it settles** (its *bill month*). It defaults to the oldest unpaid, unskipped month; the
  user can change it.
- **A bill belongs to the month it comes out** (decision A). The budget sheet and the Cashflow chart count a bill
  payment in its bill month; everything else keeps counting it on the day it was paid.
- **One Recurring screen**, opened from the Cashflow card and from the Recurring nav item, on phone and desktop: the
  month's bills by urgency, each bill's own page with its history, a payment sheet, paying several at once, and the
  new/edit bill form.

Nothing about how money is recorded changes: a bill payment is still one ordinary posted transaction (category +
paying account) linked to its template.

## 2. Data model

### 2.1 Side tables, not columns

`expense_templates` and `transactions` get no new columns. The ORM names every column it knows on every insert, so a
column there would break any database still stopped at an older version (migration 0028's comment; the same reason
books attach through membership tables, 0042). Two side tables instead:

`bill_windows` — one row per bill.

| column | notes |
|---|---|
| `template_id` | PK; the `expense_templates.id` |
| `workspace_id` | owner scope, as every table |
| `pay_by_day` | 1–31, or NULL for "no pay-by day" (due on its out day) |
| `starts_month` | `YYYY-MM`: the first bill month this bill can be overdue for (see 4.3) |

`bill_payments` — one row per payment transaction that settles a bill month.

| column | notes |
|---|---|
| `transaction_id` | PK; the posted payment |
| `workspace_id` | |
| `template_id` | the bill (duplicates `transactions.template_id`, so the month query needs no join through transactions to find the bill) |
| `bill_month` | `YYYY-MM`, the month whose bill this pays |

Index `bill_payments_template (workspace_id, template_id, bill_month)`.

`transactions.template_id` keeps working exactly as today: it is still written on every bill payment and still copied
by `replaceTransaction`. `bill_skips (workspace_id, template_id, month)` stays as it is.

Book awareness comes only through the template's category: both tables are read through `listExpenseTemplates`, which
already narrows to `ws.bookId`'s categories. Neither table carries a `book_id`.

### 2.2 Migration 0044 `bill_months`

Additive only.

1. Create `bill_windows` and `bill_payments` and the index.
2. Backfill `bill_windows`: one row per existing `expense_templates` row, `pay_by_day` NULL, `starts_month` = the
   month the migration runs (`strftime('%Y-%m', 'now', 'localtime')`).
3. Backfill `bill_payments`: every transaction with a `template_id` that names an `expense_templates` row (posted or
   void) gets `bill_month = substr(occurred_on, 1, 7)` — the month it was counted in before, so no figure moves.

Because the backfill reproduces today's calendar-month rule, every figure the app shows is identical immediately
before and after 0044 (the realistic-sample migration test proves it, 8.2).

### 2.3 Writing

- `saveExpenseTemplate` takes `payByDay?: number | null` and upserts `bill_windows`. On insert `starts_month` is the
  month of today; an edit changes only `pay_by_day`.
- `postTransactionTx` takes `billMonth?: string | null`. When `templateId` names an expense template, it inserts a
  `bill_payments` row with `billMonth ?? month of occurredOn`. So every existing caller that posts with a
  `templateId` (the sample seed, tests) keeps producing a correct row.
- `replaceTransaction` reads the original's `bill_month` and passes it on, so correcting a payment keeps the month it
  settles.
- Voiding a payment leaves its `bill_payments` row; every read joins to `transactions.status = 'posted'`, so a void
  payment settles nothing. Undo is a void.

### 2.4 Older databases

Every write to and read from the two new tables goes through `billTablesExist(db)` (memoised the way `hasBooks` is).
Without the tables, reads fall back to today's rule (bill month = month of `occurred_on`, no pay-by, no bill-month
attribution) and writes skip the side tables. This is what lets the migration tests seed a genuine version-43 database
through the ordinary repositories.

## 3. Decision A — which month a bill counts in

### 3.1 The rule

A bill payment counts, in monthly spending figures, on its **attributed date**:

- the day it was paid, when it was paid inside its bill month (all backfilled payments, and most payments); otherwise
- the bill's out day in its bill month, clamped to that month's last day (Internet, out on the 28th, August's bill paid
  on 3 September → 28 August).

Anchoring on a date rather than on the month alone keeps weeks, quarters and custom ranges honest: August's internet
lands in the week of 28 August, not on the 1st.

### 3.2 SQL

`packages/db/src/repos/bill-months.ts` exports `attributedOn()`, an SQL expression over the `transactions` row in
scope:

```sql
COALESCE((
  SELECT CASE WHEN bp.bill_month = substr(transactions.occurred_on, 1, 7) THEN NULL
    ELSE min(date(bp.bill_month || '-01', '+' || (et.day_of_month - 1) || ' days'),
             date(bp.bill_month || '-01', '+1 month', '-1 day')) END
  FROM bill_payments bp JOIN expense_templates et ON et.id = bp.template_id
  WHERE bp.transaction_id = transactions.id
), transactions.occurred_on)
```

`categoryTotalsBetween(database, ws, kind, from, to, opts)` gains `opts.billMonths?: boolean`. With it set (and the
tables present) the two date conditions `occurred_on >= from AND occurred_on <= to` become:

```sql
(transactions.occurred_on BETWEEN :from AND :to
   OR transactions.id IN (SELECT transaction_id FROM bill_payments WHERE bill_month BETWEEN substr(:from,1,7) AND substr(:to,1,7)))
AND <attributedOn> BETWEEN :from AND :to
```

The first clause keeps the scan to the period's own rows plus the payments that name one of its months; the second
decides. Without the option, the query is byte-for-byte today's. Normal spending is unaffected either way: a
transaction with no `bill_payments` row attributes to its `occurred_on`.

### 3.3 Who asks for it

| Caller | `billMonths` |
|---|---|
| `budgetSheetFor` (`packages/db/src/repos/budget-sheet.ts`) — the expense `categoryTotalsBetween` | **true** |
| `SpendingReport` (Cashflow chart and its rows) | **true** |
| `IncomeFlow` (Cashflow's desktop income band), expense totals | **true** |
| `DashboardPage` month spending (this month, last month) | **true**, so the dashboard's month agrees with Cashflow's |
| `eventSpendingBetween`, `periodFlows` | unchanged (events and flows are not bill payments' concern) |
| every test and other caller | unchanged (option absent) |

### 3.4 What does not move

- **Transaction history** (`listTransactions`, Cashflow's day list and table, the list header's "spent" figure, which
  adds up the rows it lists): on the day paid.
- **Card and bank statements, balances** (`nativeBalances`, `netWorthAt`), **points**, **net worth**, **tax**: on the day
  paid. None of them call `categoryTotalsBetween`.
- **Monthly bill state** is per bill month: a month is paid when a posted payment names it.

## 4. States

### 4.1 A bill month's window

Pure, in `packages/core/src/bills/schedule.ts`:

- `opensOn` = out day in the bill month, clamped to its last day.
- `payBy` = with no pay-by day, `opensOn`. With a pay-by day ≥ out day, that day in the bill month (clamped). With a
  pay-by day < out day, that day in the **following** month (clamped).

### 4.2 A bill month's state on a day

Checked in this order:

| state | when | pill text | tone |
|---|---|---|---|
| `paid` | a posted payment names the month | `✓ Paid <d> <Mon>` (the payment's date) | green |
| `skipped` | a `bill_skips` row names the month | `Skipped` | grey |
| `upcoming` | today < `opensOn` | `Opens <d> <Mon>` | grey |
| `overdue` | today > `payBy` | `Overdue N days` (`1 day`) | red |
| `dueSoon` | 0 ≤ days to `payBy` ≤ 3 | `Due in N days` (`1 day`), `Due today` at 0 | amber |
| `open` | out, more than 3 days to `payBy` | `Pay by <d> <Mon>` | blue |

A bill with no pay-by day has `payBy = opensOn`, so it is `upcoming` until its out day, `Due today` on it and
`Overdue` after — today's behaviour, now with a count of days. Every unsettled state is payable (paying early stays).

### 4.3 Which month a bill's row speaks for (cross-month windows)

For today's month M and the previous month P:

- The row is for **P** when P ≥ `starts_month` and P is neither paid nor skipped. (P's window has always opened by
  now, so the row is `overdue`, or `dueSoon`/`open` while a cross-month pay-by is still ahead — "Aug bill · BCA".)
- Otherwise the row is for **M**.

Only one month back is ever raised. `starts_month` stops the upgrade from inventing debts: a database migrated in
September never calls August overdue, because backfilled payments were filed by calendar month and August's may be
filed as September's. Bills created later start in their creation month.

### 4.4 Which months a payment can be for

`payableBillMonths` = [P, M, M+1] minus months before `starts_month`, minus paid and skipped months, oldest first. The
first is the default ("oldest unpaid"); M+1 allows paying next month's bill early. A payment for a settled month is
refused (`ALREADY_SETTLED`).

### 4.5 Estimates

A bill with no fixed amount is estimated at the last amount paid for it (its newest posted payment's category line). A
bill never paid has no estimate and adds nothing to totals, but still counts toward "N amounts vary".

## 5. Screens

All copy below is the prototype's. Routes: `/bills` (the Recurring screen), `/bills/new`, `/bills/$billId`,
`/bills/$billId/edit`. The "Recurring" item in More and the desktop nav keeps pointing at `/bills`.

### 5.1 The Cashflow card (stays)

Same card, same place (`Recurring` in `TransactionsPage`): "4 of 6 bills paid" (paid + skipped rows of all rows) and the
amount owed now (overdue + due soon + open rows, estimates included, `~` prefix when one varies). Tapping it navigates
to `/bills` instead of opening a sheet.

### 5.2 Recurring screen — list V1

- Header: title "Recurring"; top right a tick-box icon button ("Select bills to pay") then "+" ("New bill", to
  `/bills/new`).
- Summary card: "Still to pay in <Month>" and the total of unsettled rows (fixed amounts + estimates), with `~` and
  "· N amounts vary" / "· 1 amount varies" when estimates were used. Lines, each only when non-zero: **Overdue**
  (red), **Due soon** (amber), **Later this month** (`open` + `upcoming`, `~` when it holds an estimate). When nothing
  is unsettled: "All paid for <Month> ✓".
- Sections, each only when non-empty: **Overdue**, **Due soon**, **Later**, **Paid and skipped · N** (faded). Within a
  section, by `payBy` then name.
- Row: category icon; name; subline = paying account, or "Aug bill · <account>" when the row is for an earlier month;
  right: amount (paid amount when paid; fixed amount; else "~Rp… · varies", or "Amount varies" with no estimate) and
  the state pill. No Pay button on the row.
- Tap a row → the bill's page. **Swipe right** on an unsettled row → the payment sheet. **Swipe left** on an unsettled
  row → reveals **Skip**; tapping Skip skips the row's bill month. Swipes are disabled on settled rows.
- After paying or skipping from the list, an undo toast for 4 s: "Paid <name>" / "Paid N bills" / "Skipped <name> this
  month", with **Undo** (voids the payment(s) / removes the skip).

### 5.3 Bill page — D1

- Top bar: back (to `/bills`), ✎ edit.
- Hero: icon, name, amount or "Amount varies", schedule line "Every month · out on the 28th · pay by the 5th" ("Every
  month · out on the 28th" with no pay-by day), the row's state pill.
- "Pay <Month> bill" (the row's bill month, full month name) when the row is unsettled.
- After recording (A1): the sheet closes and the page stays; the pill turns Paid, a green line "✓ Paid Rp… on <d Mon> ·
  Undo" appears under the hero, and the paid month is highlighted at the top of History. Undo voids and removes the
  line.
- Card: **Paid from** (account name), **Workspace** (the name of the bill category's book; the row is hidden when the
  database has no books).
- **History**: newest first, up to 12 months — every month with a payment or skip, plus every month from
  `starts_month` to M. Each line: "<Month> bill" and "Rp450.000 · paid 4 Aug", or "Skipped", or the month's pill text.
- "Skip <Month> bill" link when the row is unsettled.
- "Stop this bill": confirm, then archive (`deleteExpenseTemplate`, which already only sets `archived_at`); history stays
  in the ledger; back to `/bills`.

### 5.4 Payment sheet — P1

`Sheet` titled "Pay <name>":

- Big amount input ("What it came to"): the fixed amount prefilled; empty for a varying bill, with "Amount varies · last
  month Rp…" beneath (just "Amount varies" when never paid).
- Rows: **For** (select of payable months as "August bill", default the first), **Paid with** (money accounts, default
  the bill's), **Paid on** (date, default today).
- "Record payment". Empty amount → "Enter what it came to".
- Links: "Skip this month" (skips the month chosen in For) and, when opened from the list, "See bill ›".
- Recording posts one normal transaction: description = bill name, category line + paying account line, `templateId`,
  `billMonth`, `occurredOn` = Paid on.

### 5.5 Pay several — M2

- The tick-box icon enters select mode: title "N selected", top right "Done" (leaves select mode); unsettled rows show a
  tick box instead of their icon and a tap toggles it; settled rows cannot be ticked; swipes are off.
- With at least one ticked, a bottom bar "Pay N selected · Rp… ›" (`~` when an estimate is in it) opens **Pay several**:
  the ticked bills ticked, the other unsettled bills listed unticked; each line shows name, pill text, and either the
  fixed amount or an amount input (varying bills, placeholder "Amount"); one **Paid on** date; "Record N bills" (count
  follows the ticks). A ticked varying bill with no amount → "Enter the amount of each ticked bill that varies".
- Each bill is recorded for its row's bill month and its own paying account, all in one database transaction. Afterwards
  select mode ends and the undo toast says "Paid N bills".

### 5.6 New / edit bill — S1

Page titled "New bill" / "Edit bill": **Name**; **Amount** (empty = varies; hint "Leave it empty when it changes every
month, like electricity. You'll be asked each time."); **Category** (the open book's categories); **Paid from**
(money accounts). Section **When**: **Repeats** ("Every month", the only option), **Bill is out on** (day 1–31),
**Pay by** (optional day, "No pay-by day" first) with hint "Earlier than the out day means the next month: out on the
28th, pay by the 5th." **Save** → the bill's page (edit) or `/bills` (new).

## 6. Desktop parity

The same routes and components render at every width; nothing is phone-only.

- Swipes work with a mouse drag (pointer events), and every swipe action is also reachable without a gesture: from `md`
  up each row has a "⋯" button (label "Actions for <name>"), visible on row hover and on keyboard focus, opening a menu
  with **Pay…**, **Skip <Mon> bill** and **See bill**. The Skip revealed by a swipe is a real button.
- Select mode, the bottom bar and both sheets work with mouse and keyboard; `Sheet` is already a centred dialog from `md`
  up and closes on Escape.
- Header actions are labelled buttons at every width (`PageHeader` `action` from `md` up, round `controls` on a phone).

## 7. What stays from today

| Today | After |
|---|---|
| Skip a month, take it back | Swipe/⋯ Skip, bill page link, payment sheet link; Undo |
| Pay early ("Later this month · Pay early") | Every unsettled row is payable; For offers next month too |
| A varying bill asks what it came to | Payment sheet and Pay several amount inputs |
| Record several on one date | Pay several, one Paid on |
| List, add, edit, remove every bill (`/bills`, `BillList`) | Recurring list + New bill + bill page ✎ + Stop this bill |
| Cashflow "Recurring" card | Same card, opens `/bills` |
| `monthlyBills`, `skipBill`, `unskipBill`, `committedByCategory`, `dueExpenseTemplates` | Kept; `monthlyBills` returns the new states; `dueExpenseTemplates` is built on it |

Removed as superseded: the `RecurringSheet` inside `Recurring.tsx`, `BillList.tsx`, `BillsPage.tsx`, and the unused
`BillsDue.tsx` with its `useDueBills` hook.

## 8. Testing

1. **Core** (`packages/core/test/bills-schedule.test.ts`): windows (same month, cross-month, clamping to 28/29/30),
   every state and its boundaries (3 days, due today, day after pay-by, no pay-by), row month selection including
   `starts_month`, payable months, pill words.
2. **Migration** (`packages/db/test/bill-months-migration.test.ts`): a version-43 database seeded through the guarded
   repositories plus raw SQL, migrated to 44: windows backfilled, payments backfilled by calendar month, trade/other
   template ids ignored. `books-sample-migration.test.ts` and `database.test.ts` stay green (the latter lists 44).
3. **Repository** (`monthly-bills.test.ts`, `bill-payments.test.ts`, `expense-templates.test.ts`): states and bill
   months on fixed dates, an earlier month raised, pay-by saved and listed, recording/refusing/undoing payments, a
   correction keeps its month, book scoping.
4. **Figures** (`packages/db/test/bill-months-figures.test.ts`): August's bill paid in September counts in August's
   category totals and budget sheet with `billMonths`, in September's without; the transaction list and balances keep
   it on its paid date.
5. **Web unit** (`apps/web/src/features/bills/bill-view.test.ts`): sections, summary lines and `~`/varies wording.
6. **E2E**: `apps/web/e2e/recurring-bills.spec.ts` (chromium: add with pay-by, pay from the ⋯ menu, bill page A1 +
   Undo, skip + Undo, pay several with a varying bill, stop a bill) and `apps/web/e2e/phone-recurring-bills.spec.ts`
   (phone: swipe right pays, swipe left skips, select mode bar). Dates in e2e are computed from the real today.

## 9. Open questions

None. Choices made while writing this spec, beyond the agreed decisions: `starts_month` in `bill_windows` (4.3), one
month of look-back, the Dashboard's month spending following decision A (3.3), and the ⋯ row menu as the desktop
equivalent of swipes (6).
