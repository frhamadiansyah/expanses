# Debt-free plan — design

**Date:** 2026-11-11 · **Branch:** `feat/debt-free-plan` (from `feat/debt-copy`, which adds the online-loan / paylater rate "a month", stored as yearly bps × 12, catalogue `ratePer: 'month'`).
**Mockups (owner-approved):** `docs/mockups/debt-free-plan.png` (+ `.html`) and `docs/mockups/debt-plan-placement.png` (+ `.html`). Sample figures only.

## 1. Intent

People paying off several loans, cards and paylaters at once want one place that answers: how much is left, when will it all be gone, what to pay next, and what an extra amount a month would change. The app already knows every figure this needs — each loan's own schedule, card statements, recurring bills, Lend & borrow, and payments recorded by hand or from bank messages. The Debt-free plan puts them on one page of its own.

The plan reads; it never posts. Every Pay button opens a payment form that already exists.

## 2. Goals and non-goals

**Goals (this build, three drops):**
1. A page of its own, **Debt-free plan** (`/net-worth/plan`): a header with the ring, Left to pay, Debt-free month, counts and Pay next; rows to Pay first, Schedule, All debts and Report.
2. **Pay first**: Snowball / Avalanche / By hand, a suggestion, Extra a month with its new debt-free month and the interest it saves, late debts on top, Pay per row. By hand keeps an order moved by hand.
3. **Schedule**: one month at a time across loan instalments, card statement due dates and recurring bills, with Due / Paid / Late totals and Late / Coming up / Paid sections.
4. **All debts**: filter chips, sort, progress per debt, a Paid off group.
5. **Report**: Borrowed, Repaid, Left, Interest paid for a period; paid-vs-due bars and a line per month.
6. Ways in: a corner icon on Net worth (1b), a corner icon on Liabilities (2), an Account → Money row with the late count (3), a Cashflow row while something is late or due within 3 days (4), and a sidebar item on wide screens with the plan beside the numbered list (6).
7. A pure payoff engine in `packages/core`, heavily unit-tested.

**Non-goals:**
- Reminders and notifications (mockup screen 5 and placement 5). The plan page has no Reminders row.
- Risk levels, daily challenges, any Google Drive or email set-up.
- Any change to the Liabilities page (`/net-worth/loans`, `DebtsPage.tsx`) other than one corner icon. It stays the twin of Assets; the plan is never drawn inside it.
- New payment forms. No new posting path.
- Card minimum payments or card interest rates (the app stores neither; see §5.3).
- Joint debts from a household partner (owner-scope data never syncs; §5.9).
- A database migration. Settings live in an existing table (§9).

## 3. Copy rules

- No "you" / "your" anywhere in app text. Every new string is grepped before commit.
- No sample numbers in placeholders or hints (the Extra a month field's placeholder is `Amount`).
- Country-neutral: no Indonesian-only presets, lender names or thresholds. Figures use the app's existing formatters (`formatMinor`, `Money`, `monthYearLabel`, `dayMonth`, `rateTextPer`).

## 4. Screens

### 4.0 Debt-free plan page (`/net-worth/plan`) — phone

Pushed page, title **Debt-free plan**, back goes to where it was opened from (the router's back; default `/net-worth`). No corner actions.

**Header panel** (one `Panel`):
- Ring (the existing `ProgressRing` from `features/cards/CardBack.tsx`, moved to the kit if needed) with `NN%` inside: the share repaid (§6.6).
- `Left to pay` and the figure (base currency, `Hero`-sized). Under it: `repaid Rp X of Rp Y`.
- A hairline row: `Debt-free` … `August 2028` (§7.5). When unknown: `Unknown` with one line under it naming why: `No terms on <name> yet`, `Payments never clear <name>`, or `No <CUR> rate yet`.
- Three counts: `N active` · `N late` (red when > 0) · `N paid off` (green when > 0) (§6.7).
- A full-width button **Pay next · <debt> <amount>** with one line under it: `3 days late`, `due today`, `due tomorrow`, `due 18 Nov` (§6.8). Hidden when nothing is due.

**Rows** (one `InsetGroup`, drop by drop):
- `Pay first` → value: the chosen order's name (`Avalanche`, `Snowball`, `By hand`) — drop 1.
- `Schedule` → value: `N due this month` (unpaid items due in the current month, bills included) — drop 2.
- `All debts` → value: the count of debts (active + paid off) — drop 3.
- `Report` — drop 3.

**Nothing owed** (no active debts and none paid off): an `Empty` line — `Nothing owed. Debts added on Liabilities show up here.` — and a row to Liabilities.

### 4.1 Pay first (`/net-worth/plan/pay-first`)

Pushed, title **Pay first**, back `Debt-free plan`.

- Segmented control: `Snowball` | `Avalanche` | `By hand`. Choosing one saves it (§9).
- Two lines under it: **Avalanche:** highest interest first. Costs the least in total. **Snowball:** smallest first, so debts close sooner and the list gets shorter. **By hand:** the order set below. (Only the chosen method's line is bold.)
- Suggestion panel (blue, `NoticeAlert`-style info): `Suggested: Avalanche. Rates are known for every debt and differ a lot (2,95% a month vs 7,5% a year).` — or Snowball wording (§8). Hidden when there is no suggestion.
- **Extra a month** group:
  - Row `Extra a month` with an amount field (base currency, grouped typing, placeholder `Amount`). Subtitle: `Goes to <first in line>, then rolls to <second>` (or `Goes to <first in line>` when only one).
  - Row `Debt-free` → `March 2028` and, when the extra changes it, a quiet `not Aug 2028`.
  - Row `Interest saved` → green figure. Hidden while the extra is empty or 0, or when either side is unknown.
- The **numbered list** (one group): every active debt in pay order (§7.2).
  - Leading badge: `!` in red for a late debt, otherwise its place number `1`, `2`, ….
  - Title: the debt's name. A late debt carries a red tag `3 days late`.
  - Subtitle: loans `2,5% a month · left Rp X` / `12% a year · 9 months left`; a loan with no terms `No terms yet`; cards `Statement due 18 Nov` or `Nothing billed`; Lend & borrow `Due 3 Dec` or `No fixed months`.
  - Trailing: the amount due next (§6.5) and a **Pay** button (§10). A loan without terms and an unnamed payable have no Pay button; the row opens the debt.
  - The first in line also shows `+ extra Rp X` under its amount when an extra is set; tapping it opens that loan's existing **Pay extra** sheet (loans only).
- **By hand** chosen: the list becomes reorderable — ≡ handle drag (or press-and-hold on a phone) using `DayReorder`, plus `Move up` / `Move down` for keyboard and screen readers, exactly as `WalletReorderPage` does. Each move saves (§9). Late debts stay pinned on top (most days late first) and have no handle; the hand order applies to the rest.

### 4.2 Schedule (`/net-worth/plan/schedule?month=YYYY-MM`) — drop 2

Pushed, title **Schedule**, back `Debt-free plan`. Month stepper `‹ Nov 2026 ›` in the title row (the same control Cashflow uses for its month). Corner menu (⋯) with three switches `Loans`, `Cards`, `Bills`, all on; session-only.

- Three tiles: `Due`, `Paid` (green), `Late` (red) — §6.9.
- Sections (each hidden when empty):
  - **Late** — every unpaid item whose due day has passed, oldest first, with a red tag `3 days late`. In the current month this includes late items from earlier months (their subtitle names the month: `Oct instalment`).
  - **Coming up** — unpaid items due today or later in the month, soonest first; an amber tag `Today` / `Tomorrow` for the next two days, otherwise the day `12 Nov`.
  - **Paid** — items paid, newest first: green tag `Paid 1 Nov`; a loan instalment matched to a payment recorded from a bank message adds `from bank message`.
- Row: leading circle (initial or kind icon), title `Kredivo · 4/6` (loan: name · instalment number / tenor), `BCA Visa` (card), `Electricity` (bill), `Rina` (person); subtitle kind words (`Statement · 18 Nov`, `Bill · 20 Nov`, `Lend & borrow · 3 Dec`); amount; **Pay** on unpaid rows that have a pay target (§10).
- Past months show their items as they stand today (paid, paid late, still late). Future months show scheduled instalments, the open statement (`so far`) only for the month its due date falls in, and bills as `upcoming`.

### 4.3 All debts (`/net-worth/plan/debts`) — drop 3

Pushed, title **All debts**, back `Debt-free plan`. Corner: `Sort: Most left` menu with `Most left` (default), `Least left`, `Highest rate`, `Ends soonest`, `Name`. The chosen sort is kept on the device (localStorage, wrapped in try/catch).

- Chips: `All N`, `Active N`, `Late N`, `Paid off N`.
- Rows (active): name and left figure on the top line; a progress bar (`ProgressBar`, red for a late debt, green otherwise); subtitle `52% repaid · ends Aug 2028`, card `Statement due 18 Nov`, person `Lend & borrow · no fixed months`; a late debt `Late · 40% repaid · 3 of 6 paid`.
- **Paid off** group: name, `Rp 0`, green tag `Paid off` and the month (`Sep 2026`) when known.
- A row opens the debt's own page (the Liabilities `destination` rule: loan page, card page, Lend & borrow person).

### 4.4 Report (`/net-worth/plan/report?period=…`) — drop 3

Pushed, title **Report**, back `Debt-free plan`. Chips: `This month`, `3 months`, `This year`, `All`.

- Figures: `Borrowed`, `Repaid` (green), `Left` (bold), `Interest paid` (§6.10).
- **Paid against due**: grouped bars per month (grey = due, green = paid), legend `Due` / `Paid`. `All` draws the last 12 months.
- One line per month (newest last): month name, a tag `All paid` (green), `N late` (red) or `Nothing due` (grey), and the paid figure; the current month says `so far` before its figure.

### 4.5 Wide screens and Mac

- Sidebar: a **Debt-free plan** item right under `Net worth`, indented one step, with a red pill `N late` when there are late debts (built like `ReviewLink`).
- The plan page at md and up: title row `Debt-free plan` with a segmented control `Plan` | `Schedule` | `Report` (`?tab=`), drop by drop (drop 1: no control, Plan only; drop 2 adds Schedule; drop 3 adds Report).
- **Plan tab**: two columns. Left (fixed ~260px): the header panel (ring, Left to pay, Debt-free, Pay next), the method segmented control and the Extra a month line (`Extra a month Rp 500.000 → debt-free Mar 2028`, the field inline). Right: the numbered list as a table — `#`, `Debt`, `Rate`, `Progress` (bar), `Left`, and a Pay button. Late rows show `!` and the red tag.
- **Schedule** and **Report** tabs render the same components as the phone pages, without their own title.
- The phone sub-routes still work on a wide screen (deep links), drawn in the single column.

### 4.6 Ways in

| # | Where | What | Shown when |
|---|---|---|---|
| 1b | Net worth (`OverviewPage.tsx` `actions`) | corner icon `Target`, label `Debt-free plan`, between Trade and Financial health | at least one debt, active or paid off |
| 2 | Liabilities (`DebtsPage.tsx` `actions`) | corner icon `Target`, label `Debt-free plan`, before `Add a debt` | always |
| 3 | Account → Money (`nav.ts` `MORE_GROUPS`) | row `Debt-free plan` (icon `Target`) right after Goals and before Lend & borrow; value `N late` | always (it is a place) |
| 4 | Cashflow box (`WaitingBox.tsx`) | a row above Recurring bills | only while an instalment, statement or bill is late or due within 3 days |
| 6 | Sidebar (`Layout.tsx` `NAV`) | `Debt-free plan` under Net worth, late pill | always |

The Net worth corner keeps `max={3}`: Trade + Debt-free plan + Financial health is three, so no `…` appears (the `phone-debts-page` spec checks there is none).

**Cashflow row (4)**: circle with `CircleAlert` in red when anything is late, amber otherwise. Title: the most urgent item — `Kredivo instalment`, `BCA Visa statement`, `Electricity`. Subtitle: its state, then the rest — one more item reads `+1 due today` / `+1 due tomorrow` / `+1 due in 3 days` (or `+1 late`), more read `+N more`: `3 days late · +1 due tomorrow`, `Due today · +2 more`. Trailing: its amount and a chevron. Tapping goes **straight to paying that item** (§10). Hidden inside a category or account (WaitingBox already is) and when nothing qualifies.

## 5. Which debts count, and how each is read

Everything reuses the readings the Liabilities page already makes (`groupDebts` in `apps/web/src/features/networth/debt-rows.ts`); the plan adds the schedule, lateness and payoff on top.

### 5.1 The set

From `groupDebts(...)` rows plus its `cleared` list, plus `peopleDebts(...).settled` for the paid-off people:

| Kind | Source | In the plan when |
|---|---|---|
| Loan (incl. online loan / paylater, mortgage, lease, any `subtype: 'loan'`) | `DebtRow.kind === 'loan'`, `LoanTermsRow` | active: listed by `groupDebts` (open, or no terms and something owed); paid off: in `cleared` |
| Credit card | `DebtRow.kind === 'card'`, `CardFacts` | owes something (`minor > 0`). A card owing nothing is left out, not "paid off" (it revolves) |
| Lend & borrow, money owed **by** the person | `DebtRow.kind === 'person'` with a `personName` (one row per person per currency, `PersonDebtRow.loans`) | active while the total is above 0; paid off: `settled` rows with `direction === 'borrowed'` |
| Unnamed payable | `DebtRow.kind === 'person'`, `accountId` set, no `personName` | while owed; no due date, no Pay button |

Money lent **to** others (receivables) is not a debt and is never in the plan. Archived accounts are not in the plan (`groupDebts` already drops them).

The plan's debt key is `DebtRow.key` (the account id for loans, cards and unnamed payables; `person:<name>:<currency>` for people). The same key is used by the engine, the By hand order and the UI.

### 5.2 Loans

- **Left** = `owedMinor(balances, accountId)` (ledger, never below 0) — the Liabilities figure.
- **Borrowed** = `terms.originalMinor` when the loan has terms; with no terms, the sum of every increase on the account (§5.7). A debt typed in from before the app starts at what was owed then (`planNewDebt` sets `originalMinor` to the owed figure), so its repaid share starts at 0%.
- **Repaid** = Borrowed − Left, never below 0. When Left is above Borrowed (arrears, capitalised interest), Borrowed is read as Left and Repaid as 0, so Borrowed = Left + Repaid always holds.
- **Rate** = `periodOn(terms.periods, month's payment date).rateBps` (yearly bps; an online loan's "a month" figure is already stored × 12). Shown with `rateTextPer(bps, loanRatePer(itemId))`. No terms: **unknown**.
- **Schedule**: `loanSchedule(owed, terms, periods, fromDate)` through the existing `scheduleFor`. `fromDate` is today, except when this month's instalment is already paid (§6.2): then it is the first day of next month, so the schedule does not show a paid month again.
- **Next payment** = the first late instalment if any (§6.2), else the first schedule row.
- **Ends** = the month of the last schedule row (the loan page's "Pays off" month). No terms: no end.
- **Late / due**: §6.2.
- **Paid off**: `terms.status === 'paid_off'` (`cleared` in `groupDebts`), with `statusOn` as the month.

### 5.3 Credit cards

The app stores no minimum payment and no card interest rate (`card_terms` has limit, statement day, due day, annual fee only). **Call: a card's statement is due in full and charges no interest in the plan.**

- **Left** = `owedMinor` (billed and unbilled, instalment plans included — the Liabilities figure).
- **Repaid** = what was paid toward the last statement since it closed: `max(0, CardFacts.billedMinor − CardFacts.leftToPayMinor)` when `billedMinor > 0`, else 0. **Borrowed** = Left + Repaid.
- **Rate** = 0 (known): paid in full, no interest.
- **Next payment** = `CardFacts.leftToPayMinor` due `CardFacts.dueOn` (`useCardFacts` reads the last closed statement through `cardStatement`, the card page's own reader).
- **Late** = `dueOn < today` and `leftToPayMinor > 0`; days late = `daysFrom(dueOn, today)`.
- **In the engine**: month 0's minimum = Left − the unbilled part of its instalment plans (`installmentTotals(...)[cardId].unbilledMinor`); each later month's minimum = that card's plan instalments billed in that month (`installmentSchedule`). New spending is not modelled.
- A card with no billing date (`hasTerms: false`): the whole balance is the month-0 minimum; no due date, so never late and never in the Schedule.

### 5.4 Lend & borrow (money owed by the person)

- **Left** = `PersonDebtRow.totalMinor`. **Borrowed** = Σ `loans[].originalMinor`; **Repaid** = Borrowed − Left (forgiven amounts count as repaid; the ledger already lowered the balance).
- **Rate** = 0 (known): Lend & borrow records no interest.
- **Due** = the earliest `dueOn` among the person's open loans. **Late** = any open loan with `dueState === 'overdue'` (core `dueStateFor`); days late = `daysFrom(dueOn, today)`.
- **In the engine**: with a due date, the whole of what is left is that month's minimum (a past due date → month 0). With none, there is no minimum: it is paid only from freed or extra money.
- **Paid off** = `settled` rows with `direction === 'borrowed'`; the month is the last movement on its accounts when known.
- **Unnamed payable**: like a person with no due date.

### 5.5 Recurring bills (Schedule and the Cashflow row only)

Bills are not debts and are not in the ring, the counts, Pay first or the Report. They appear in Schedule and the Cashflow row so a month's money out is in one list.

- The current month: `monthlyBills(database, ws, today)` (the Recurring page's own read, scoped to the open workspace/book). States come from `billStanding` (`overdue` = late, `dueSoon`/`open`/`upcoming` = coming up, `paid` = paid; `skipped` and `paused` are left out). The due day is `bill.window.payBy` (the pay window from `bill-view.ts` / `billWindow`).
- Any other month: a new read `billsInMonth(database, ws, month, today)` built from the same internals (`billFacts` + `monthOfBill`), keeping only bills owed that month (`isOwedMonth`, month ≥ `startsMonth`).
- Amount: `amountOf(bill)` after `billsInReadCurrency` (paid figure, else amount, else the estimate; `~` when it varies).

### 5.6 Foreign currency

Each debt keeps its own currency on its rows. Plan totals, the engine and ordering use the base currency (`ws.baseCurrency`) at **today's held rate** (`useHeldRates`, the Liabilities page's rates), converted with `convertMinor`. A debt whose currency has no rate:
- is listed with its own figure,
- is left out of Left to pay, the ring, the engine and every total, and those say so: `No USD rate yet` (the `Total` pattern in `DebtsPage.tsx`),
- sorts last in every order,
- makes the Debt-free month `Unknown` with `No USD rate yet`.

Bills use their existing conversion (`billsInReadCurrency` with `useBillMoney`), and one no rate reaches is listed but left out of totals and named (`Unconverted`).

### 5.7 The ledger reading the plan adds

One new db read, `debtMovements(database, ws, accountIds, range?)`: every posted entry on those debt accounts with its transaction's date, source and expense lines. Positive amount = the debt went down (a payment); negative = it went up (borrowing, a card charge, an opening balance). It feeds lateness (§6.2), loans-without-terms Borrowed, people paid-off months, and the Report (§6.10). `fromMessage` is `transactions.source === 'email'` — the channel bank notifications, screenshots and emails are filed under (`ledgerSourceOf`).

### 5.8 Workspaces

Loans, cards, people's debts and net worth are owner-level (`ownerScope`); every book in a workspace sees the same debts, as Liabilities does. Bills are per book: Schedule and the Cashflow row show the open book's bills, exactly as Recurring does. An archived book's bills show only while that book is open. The plan settings (§9) are kept per workspace (`ws.workspaceId`), shared by all its books.

### 5.9 Household sharing

Owner-scope data never syncs, so a partner's debts are not in this phone's plan, and this plan is not sent anywhere. Joint net worth summaries carry no schedules and are not read. In a shared (household) book, Schedule shows that book's bills. Where a book is read-only (`ReadOnlyNotice`), Pay buttons on bills follow the bill page's own rule (no payment can be saved there); loan, card and Lend & borrow pages are owner-level and unaffected.

## 6. Definitions

### 6.1 Months and days

`today` is `isoDate()`. Months are `YYYY-MM`; `addMonths`, `monthOf`, `daysFrom`, `dayMonth`, `monthYearLabel` are the existing helpers. Due "within 3 days" uses `BILL_DUE_SOON_DAYS` (3) from core, the same window the bills' amber and the card's `dueIn` use.

### 6.2 A loan instalment's standing (new, core `loans/standing.ts`)

A loan's instalments fall on `paymentDate(firstPaymentOn, paymentDay, n)` for `n = 0 … tenorMonths−1` (the function `schedule.ts` already uses; it is exported). Instalment number = `n + 1`.

**Tracked instalments**: due on or after the later of `firstPaymentOn` and the day of the account's first ledger entry (its opening), and on or before the end of the current month; none after the loan is paid off (`statusOn`). Instalments from before the app knew the loan are never called late.

**Payments**: every transaction that lowered the loan (`debtMovements` amount > 0 — the same test `loanPayments` in `loan-view.ts` uses), oldest first, with its total (principal + every expense line riding on it).

**Matching** (oldest unpaid first, as a lender applies money to arrears): walk the tracked instalments in order; each takes the earliest unused payment dated after the previous instalment's due day (for the first tracked one: after the same day a month earlier). There is no upper bound, so a payment made weeks late settles the oldest missed instalment and the later one stays late. One payment settles one instalment. Taken → **paid**, with `paidOn`, `paidMinor`, `fromMessage`, and `daysLate = max(0, daysFrom(dueOn, paidOn))`. Not taken and `dueOn < today` → **late**, `daysLate = daysFrom(dueOn, today)`. Otherwise **upcoming** (due today counts as upcoming, not late).

**Expected amount** of an unpaid instalment: the schedule row in its month when there is one; otherwise (earlier late months) the first schedule row's payment, else the current rate period's named payment.

Known limits (in this spec, not in the UI): an extra payment counts as the next instalment, paid early; one transaction that pays two instalments at once settles only one.

### 6.3 Late (a debt)

A debt is late when any of its items is late: a tracked loan instalment (§6.2), a card's last statement past due with something left (§5.3), a person's open loan overdue (§5.4). Its days late = the largest.

### 6.4 Due

An item is **due in a month** when its due day falls in that month: a loan instalment's `dueOn`; a card statement's due day (`dueDateAfter(cycle.end, dueDay)`); a person's `dueOn`; a bill's `window.payBy`.

### 6.5 Next payment (a debt)

Loan: its oldest late instalment, else its next schedule row. Card: `leftToPayMinor` on `dueOn`, else nothing. Person: Left on `dueOn`, else nothing (`No fixed months`). Unnamed payable / loan without terms: nothing.

### 6.6 Left, borrowed, repaid, the ring

- **Left to pay** = Σ Left of active debts (base currency).
- **Borrowed** and **Repaid** = Σ over active **and paid-off** debts (paid-off: Left 0, Borrowed = Repaid = what was borrowed). Paid-off debts stay in so paying one off never lowers the ring.
- **Ring %** = `repaidPercent(borrowed, left)` from `loan-view.ts` (whole percent, rounded down, 100 only when all is repaid).

### 6.7 Counts

`active` = debts with Left > 0 (late ones included); `late` = active debts that are late; `paid off` = paid-off loans + settled people's debts. All debts' `All` chip = active + paid off.

### 6.8 Pay next

The most urgent item among the debts (bills excluded): the late item with the most days late; else the unpaid item with the soonest due day; ties broken by plan order. Its button pays that item (§10).

### 6.9 Schedule totals (one month)

Over the items shown (after the Loans/Cards/Bills switches):
- **Due** = Σ items due in the month: a paid item at what was paid, an unpaid one at its expected amount.
- **Paid** = Σ paid items due in the month.
- **Late** = Σ late items listed (in the current month: also late items from earlier months).
Each in base currency; an item with no rate is listed and named, not added.

### 6.10 Report figures (a period)

Periods: `This month` = the current month; `3 months` = the current and the two before; `This year` = January to the current month; `All` = from the month of the earliest movement on any plan debt.

Over the plan's debt accounts (loans incl. paid off, credit cards, payables; not archived), from `debtMovements`:
- **Borrowed** = Σ increases in the period — new loans and opening balances, draws, card spending.
- **Repaid** = Σ decreases in the period — instalments' principal, card payments, repayments.
- **Left** = Left to pay today (§6.6). For every period ending this month, Left at the start + Borrowed − Repaid = Left (the test holds it).
- **Interest paid** = Σ expense lines with the category key `miscellaneous.interest` (the key `recordLoanPayment` posts interest under; any book's copy, via `categoryIdsByKeyAllTx`) in transactions that lowered a plan debt.

**Paid against due**, per month in the period (`All`: the last 12): Due and Paid as §6.9 for debts only (no bills). The month line: `All paid` when no item due that month is late; `N late` = the number still unpaid and past due; the current month adds `so far`.

All in base currency at today's rate.

## 7. Payoff engine (core `debts/payoff.ts`)

Pure, no dates beyond `YYYY-MM` labels, integer minor units, `roundHalfAwayFromZero`.

### 7.1 Inputs per debt

```
key, name, balanceMinor (base),
ratesBps: number[] | null   — yearly bps for month 0, 1, …; the last value holds after; null = unknown
interest: balance | fixed(minor) | none
minimumsMinor: number[]     — what its own schedule asks in month 0, 1, …
regularMinor                — what keeps rolling once its schedule has ended (§7.3)
firstMonth                  — the month index its own months begin (0, or 1 when this month is already paid)
late, daysLate
```

Built by `payoffDebtFromSchedule` (loans) and the web adapter (cards, people):
- **Annuity loan**: `interest: balance`; `ratesBps[m]` = the row's period rate; `minimumsMinor[m]` = the row's payment. If `fromDate` was next month, month 0's minimum is 0.
- **Flat loan**: `interest: fixed(rows[0].interestMinor)` — the flat interest on what was borrowed, charged every month while anything is owed.
- **Zero loan**: `interest: none`.
- **Loan without terms**: `ratesBps: null`, no minimums.
- **Card**: §5.3. **Person / payable**: §5.4. `ratesBps: [0]`, `interest: none`.

### 7.2 Order

- **Late debts first**, most days late first, whatever the method.
- **Snowball**: smallest Left first; ties: higher rate first, then name.
- **Avalanche**: highest current rate (`ratesBps[0]`) first; unknown rates after every known positive rate and before the 0% ones; ties: smaller Left first, then name.
- **By hand**: the saved order; debts not in it are appended in Snowball order; keys no longer present are dropped.
- Debts with no base rate (§5.6) are left out of the engine and listed last.

### 7.3 Each month m = 0, 1, … (up to the cap)

1. For each debt still owed: interest = `round(balance × rate_m / 10000 / 12)` (balance), the fixed figure (fixed), or 0 (none or unknown). Owed this month = balance + interest.
2. Minimum = `minimumsMinor[m]` while the schedule lasts; in the month after its last entry, everything left (as `loanSchedule`'s last row does); with no schedule, 0. Pay `min(minimum, owed)`.
3. **The month's budget** = Σ minimums paid this month + extra + **freed money**: for every debt already cleared before this month, what it would have cost this month — its own `minimumsMinor[m]` while its schedule lasts, then its `regularMinor` for good. Month 0 has no freed money, so nothing already paid this month rolls over. `regularMinor` is supplied by the adapter: a loan's first non-zero schedule payment, a card's monthly plan instalments, 0 for a statement in full and for a person's lump sum.
4. **Rollover**: what is left of the budget after the minimums goes to the first debt in order still owed, then the next, until spent or nothing is owed. A debt paid off frees its payment, so its money keeps going to debts — the snowball/avalanche effect. A single debt with no extra is paid exactly as its own schedule says, rate changes included.
5. Before a debt's `firstMonth` (a loan whose instalment this month is already paid starts next month) nothing accrues and nothing is due; extra or freed money may still reach it.
6. A debt's **end month** is the month its balance reaches 0.

Stop when nothing is owed, or at **600 months** (`PAYOFF_CAP_MONTHS`).

### 7.4 Outputs

`order`, per debt `{ endMonth | null, interestMinor, paidMinor }`, total `interestMinor`, `debtFreeMonth | null`, `months | null`, and `unknown: null | { reason: 'noRate' | 'neverCleared', keys }`:
- `noRate`: a debt has an unknown rate (a loan without terms). The others still get their end months; the plan's month is unknown — the mockup's "debt-free date unknown until one is added".
- `neverCleared`: the cap was reached with something owed (a payment below the interest, or no money ever reaches a debt with no schedule).

### 7.5 What the screens show

- **Header Debt-free** = the plan in the chosen order **with no extra** (freed payments still roll over). The mockups show this figure in the header and the extra's month beside it on Pay first (`March 2028 not Aug 2028`).
- **Pay first, Debt-free** = the same plan with the extra. **Interest saved** = interest(no extra) − interest(with extra), shown only when both are known and the saving is above 0. Months sooner from the same pair.
- **No extra and no rollover** is never shown; a single loan with no extra ends exactly when its own schedule says (the engine's tests hold it to `loanSchedule`).

## 8. Suggestion rule (core `suggestMethod`)

In order; the first that holds wins:
1. **Avalanche — rates differ a lot**: every debt's rate is known (no loan without terms; cards and people count as known 0%), at least two debts charge interest (rate > 0), and the highest yearly rate among those is at least **5 points** (500 bps) above the lowest. Words: `Suggested: Avalanche. Rates are known for every debt and differ a lot (<highest> vs <lowest>).` Each rate in its own loan's wording (`2,95% a month`, `7,5% a year`).
2. **Snowball — many small debts**: at least **3** active debts each with Left ≤ **10%** of Left to pay. Words: `Suggested: Snowball. N small debts: clearing them first shortens the list quickly.`
3. **Snowball — rates unknown**: some rate is unknown. Words: `Suggested: Snowball. Not every rate is known, so the smallest go first.`
4. Otherwise no suggestion (rates are close; either order costs about the same).

When nothing has been saved yet, the plan uses the suggested method (Avalanche when there is none).

## 9. Saved settings

`{ version: 1, method: 'snowball' | 'avalanche' | 'byHand', order: string[], extraMinor: number, extraCurrency: string }`, saved in the database in the existing `calculator_inputs` table (0053) under `kind = 'debt_plan'`, one row per workspace — the life-cover calculator's pattern (`calculator-inputs.ts`). **Call: workspace (database), not device**: it survives a restore and an iCloud copy, and is the same on a future Mac. No migration; the table is not synced to a household (owner data). A database older than 0053 reads as nothing saved and refuses to save with the existing words.

The extra keeps the currency it was typed in; if the workspace's base currency differs, it is converted at today's held rate, or ignored (and said) with no rate.

## 10. Pay buttons (existing flows only)

Each target page learns one search param that opens its existing pay sheet on arrival; closing the sheet (Save or Cancel) goes back in history, so the person lands where Pay was tapped.

| Item | Goes to | Opens |
|---|---|---|
| Loan instalment | `/net-worth/loans/$accountId?pay=due` | `LoanDetailPage`'s `PaySheet` (prefilled from the next schedule row) |
| Extra on the first in line | `/net-worth/loans/$accountId?pay=extra` | `PayExtraSheet` |
| Card statement | `/cards/$cardId?pay=1` | `CardHero`'s `PaySheet` (left to pay of the statement) |
| Bill | `/bills/$billId?pay=1` | `BillPage`'s `PaySheet` (oldest unsettled month first) |
| Lend & borrow | `/net-worth/lend-borrow/loan/$accountId?repay=1` (the person's loan with the earliest due day, else the first) | `LoanPage`'s `RepaymentForm` |
| Loan without terms, unnamed payable | no Pay button | the row opens the debt |

Nothing else changes on those pages.

## 11. Drops

- **Drop 1**: engine + standing (core), `debtMovements` + `loanPlanFacts` + settings (db), plan page (header, Pay first row), Pay first page (method, suggestion, extra, By hand), pay params on the four pages, ways in 1b, 2, 3 and the sidebar (6, with the wide Plan layout without tabs).
- **Drop 2**: `billsInMonth` (db), the month model, Schedule page, the Schedule row and wide tab, the Cashflow due row (4).
- **Drop 3**: All debts, Report, their rows, the wide Report tab and polish.

## 12. Calls I made (owner to check)

1. **Header Debt-free = plan without the extra**; the extra's month and "not <month>" sit on Pay first (both mockups show it so).
2. **Rollover**: a finished debt's payment keeps going to debts — its own scheduled amounts while they last, then its regular instalment for good — to the next in line. Nothing already paid this month rolls over, and a single debt with no extra ends exactly on its own schedule.
3. **Cards**: no minimum and no card rate are stored, so a statement is due in full with no interest; new spending is not modelled; instalment plans are billed month by month. A card owing nothing is left out (not "paid off").
4. **Lend & borrow** is interest-free; with a due date it is due whole that month, without one it is paid only from freed or extra money.
5. **Loan without terms**: rate unknown → Debt-free `Unknown` naming it (as the mockup note says); no Pay button.
6. **Late instalment rule**: each instalment takes the earliest unused payment made after the previous instalment's day (oldest unpaid first); instalments before the account's first ledger day are not tracked; one payment settles one instalment, and an extra payment counts as the next one paid early.
7. **Ring and Borrowed** include paid-off debts (not archived ones), so paying one off never lowers the %. A card's repaid = paid toward its last statement.
8. **Suggestion thresholds**: Avalanche at a 5-point yearly spread between interest-charging debts; Snowball at ≥ 3 debts each ≤ 10% of the total left; Avalanche wins when both hold; nothing when rates are close.
9. **Pay next** is the most urgent item (longest late, else soonest due), not simply the first in order.
10. **Saved per workspace in the database** (`calculator_inputs`, kind `debt_plan`), no migration, not synced to a household. Nothing saved → the suggested method.
11. **Pay** opens the existing sheet via a search param and returns to the plan after Save or Cancel.
12. **Foreign debts** at today's held rate; with no rate they are left out of totals and the plan, and named.
13. **Schedule** shows the open book's bills; **Report** covers debts only (no bills).
14. **Report Borrowed** counts every increase (opening balances, draws, card spending); Repaid every decrease; Interest = interest-category lines on debt payments; `All` bars show the last 12 months.
15. **Cashflow row** covers instalments, statements and bills (not Lend & borrow due dates), within 3 days.
16. **Net worth corner** only once a debt exists; Liabilities corner, Account row and sidebar always.
17. **"from bank message"** is shown on loan instalments only in this build.
18. **Rates in the engine** follow each loan's own rate periods month by month, so a loan with no extra ends exactly when its own schedule says.
19. **By hand** keeps late debts pinned on top.

## 13. Open question

None that changes what gets built. Calls 1, 3 and 9 are the ones most worth a glance.
