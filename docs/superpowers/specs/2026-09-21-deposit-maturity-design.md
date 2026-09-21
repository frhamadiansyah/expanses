# Deposit maturity — design

Status: approved · 2026-09-21
Decisions: `decisions-deposit-maturity.md` (user, 2026-09-19; layout decided 2026-09-21)
Mockup: `.superpowers/queue/deposit-maturity.html` — **S2** (switch and settings inline on the deposit's page) and
**P1** (the due proposal on the deposit's own page only). S1, P2 and P3 were rejected and are not built.
Migration: **0054**.

Assumed landed before this: `feat/data-safety`, `feat/event-rab`, `feat/add-transaction` (the queue order in the
decision record), and the native kit on the asset pages (`feat/native-look`).

## 1. What we are building

Migration 0047 gave a time deposit two facts in `deposit_terms`, `matures_on` and `rate_bps`, and nothing else.
The date and the rate are printed on the deposit's page (`DepositTermsCard`) and on its Accounts row. On the day
the money comes back the owner records it by hand with a transfer. Nothing is automated.

This adds automation as an optional layer, **per deposit and off by default**:

- **A switch on the deposit's own page** (S2). While it is off the page and the ledger behave exactly as they do
  today. When it is on, the same group shows the maturity choice, where the money lands, the term, whether
  the rate carries over, and the tax withheld.
- **Three choices at maturity**: roll over the principal only (interest lands in an account), roll over
  principal and interest (nothing lands and the deposit grows), or don't roll over (principal and interest land in
  an account and the deposit closes).
- **Monthly interest is covered too.** A deposit that pays monthly gets one event for each monthly payout, handled
  the same way as the maturity.
- **The app proposes and the user confirms.** On the due day a proposal appears on the deposit's page (P1) with the
  computed figures, and every figure that reaches the ledger can be edited. Nothing is posted until the user
  confirms. If the app went unopened for a while, several events wait, and they are proposed one at a time in
  date order.
- **A quiet "Due" marker** on the deposit's row in the Net worth → Assets list, so a waiting proposal can be found
  there. It is only a marker. Proposals are confirmed on the deposit's page and nowhere else.
- **Tax is withheld at source**, so the interest posted is net. By default the withheld share is 20% of gross
  interest. The user can change the percentage, or mark the deposit tax-free, on that deposit.

## 2. What exists today (read on 2026-09-21)

| Fact | Where |
|---|---|
| Deposit terms table | `packages/db/migrations/0047_cash_equivalents.sql` — `deposit_terms(account_id PK, workspace_id, matures_on, rate_bps, created_at)` |
| Terms repo | `packages/db/src/repos/deposit-terms.ts` — `depositTablesExist`, `saveDepositTermsTx`, `saveDepositTerms`, `getDepositTerms`, `listDepositTerms` |
| Opening a deposit | `openCashAccount` in `repos/cash-accounts.ts` (writes account, asset profile, terms in one transaction) |
| The deposit's page | `apps/web/src/features/networth/AssetDetailPage.tsx`, route `/net-worth/assets/$accountId`; renders `DepositTermsCard` |
| Terms labels | `apps/web/src/features/networth/deposit-terms.ts` — `maturityLabel`, `rateLabel`, `depositLine` |
| The assets list | `AssetsPage.tsx` + `asset-rows.ts` (`groupAssets`, `AssetRow`); a row's subtitle already carries a quiet "Update price" marker |
| Posting | `postTransactionTx(tx, ws, input)` in `repos/ledger.ts`; lines from `incomeLines` and `transferLines` in `packages/core/src/ledger/lines.ts` |
| Balances | `nativeBalances(database, ws, asOf?)` in `repos/ledger.ts` |
| Categories by key | `categoryIdsByKeyTx(tx, ws)` (book-aware); `income.investment` is in `POSTED_INTO_KEYS`, so every book has one |
| Archiving | `archiveAccount(database, ws, id)` in `repos/accounts.ts`; refuses an account whose balance is not zero |
| Day count | `daysFrom(from, to)` in `packages/core/src/bills/schedule.ts` (exported) |
| Month length | `daysInMonth(year, month1)` in `packages/core/src/reports/periods.ts` |
| Rates | `resolveRates` in `repos/fx.ts`; `useResolveRates`, `checkManualRate`, `ratePreview` in the web |
| Spendable subtypes | `SPENDABLE_SUBTYPES` in `repos/accounts.ts` (a deposit is not one) |

**The record says something the code does not have.** It says monthly coverage should be inferred "from the
payout setting the deposit already carries". A deposit carries no payout setting. `deposit_terms` has only
`matures_on` and `rate_bps`, and the account form asks for nothing else. The same is true of the term: the
mockup's "4,25% · 3 months" has no stored "3 months" behind it. Both facts are therefore **new**, and they live in
the new side table (§8) as the **Interest paid** and **Term** rows of the S2 group (§3). This fills a gap in the
data and changes no decision.

## 3. The switch and its settings (S2)

On the deposit's page, below the terms card, one inset group headed **At maturity**. It is only drawn for a
`time_deposit` account that has a `deposit_terms` row.

**Off** (the default, and every existing deposit): one row.

| Row | Kind | Notes |
|---|---|---|
| Automate | `SwitchRow` | hint: "Propose it on the day; nothing posts until you confirm." |

**On**: the same group grows. The rows appear in this order:

| Row | Kind | Values | Default when first switched on |
|---|---|---|---|
| Automate | `SwitchRow` | on | — |
| Roll over the principal | `InsetRow`, check glyph when chosen | subtitle "Interest lands in *payout*" | chosen |
| Roll over principal + interest | `InsetRow` | subtitle "Nothing lands; the deposit grows" | |
| Don't roll over | `InsetRow` | subtitle "Everything lands in *payout*" | |
| Interest paid | `SelectRow` | Monthly · At maturity | At maturity |
| Lands in | `SelectRow` | this workspace's spendable, unarchived accounts that hold **the deposit's currency** | the first one, or none |
| Term | `SelectRow` | 1 month · 3 months · 6 months · 12 months | 1 month |
| Keep the rate when it rolls over | `SwitchRow` | | on |
| Tax-free deposit | `SwitchRow` | hint below | off |
| Tax withheld % | `TextRow`, typed | 0–100, as the rate is typed ("20", "12,5") | 20 |

- **Lands in** is hidden when the choice is *Roll over principal + interest*, because nothing lands anywhere. If
  no account holds the deposit's currency, the row reads "No account holds *USD*". The proposal then cannot be
  confirmed until one exists (§6.4).
- **Term** is the length of every term: the current one, which dates this term's monthly payouts (§4), and the
  one a roll-over starts. A single roll-over can be given a different term on its proposal, and confirming that
  proposal makes it the stored term.
- **Tax withheld %** is hidden while *Tax-free deposit* is on. The hint on *Tax-free deposit* reads: "Only if the
  rules exempt this deposit on its own. Splitting a larger sum into smaller deposits doesn't make them tax-free."
- Each control saves when it changes. The switch, a choice row or a select saves at once. The percentage is
  typed per keystroke and saved when the field is left (blur), provided it reads as 0–100. Otherwise the error is
  shown under the group and nothing is saved.
- Turning the switch **off** keeps the settings and stops every proposal: nothing is proposed while it is off.
  Turning it back **on** proposes the maturity again if it has already passed and has not been confirmed. Monthly
  payouts dated before the day it was switched back on are not proposed (§4.3).

The rows are kit rows: `SwitchRow`, `InsetRow`, `SelectRow`, `TextRow` inside one `InsetGroup`. The mockup draws
round radios for the three choices. The kit has none, so the chosen row carries a check glyph in the tint, the way
`CurrencySheet` marks its choice. No new visual treatment is introduced.

## 4. Due events are derived, not stored

No "pending" row is ever written. What is due is computed from the terms, the automation settings, a log of what
has been confirmed, and today's date. Confirming an event writes the event to the log.

### 4.1 The current term

- **Start** = `termStartedOn` when it is set **and** `addMonthsToDate(termStartedOn, termMonths) === maturesOn`.
  Otherwise **start** = `addMonthsToDate(maturesOn, −termMonths)`.
  - `termStartedOn` is written by a confirmed roll-over (the old maturity date), so every term after the first
    is dated exactly, month-end clamps included.
  - If the owner changes the maturity by hand on the terms card, the two dates stop agreeing, and the start is
    derived again. A stale start never survives a hand edit.
- `addMonthsToDate(date, n)` keeps the day of the month. When the target month is shorter it uses that month's
  last day: 31 Jan + 1 → 28 Feb 2027, 31 Jan + 2 → 31 Mar 2027.

### 4.2 The events of a term

- **Pays at maturity**: one event, **maturity**, due on `maturesOn`, covering `start → maturesOn`.
- **Pays monthly**: `termMonths − 1` **monthly** events, the *k*-th due on `addMonthsToDate(start, k)` and covering
  `addMonthsToDate(start, k−1) → that day`. After them comes one **maturity** event covering
  `addMonthsToDate(start, termMonths−1) → maturesOn`. Every date is counted from the start date, never from the
  previous payout, so 31 Jan pays on 28 Feb, **31 Mar** and 30 Apr, not 28 Feb, 28 Mar and 28 Apr.
- A 1-month deposit that pays monthly has only its maturity event.

### 4.3 Which events are due

An event is due when **all** of these hold:

1. automation is on;
2. `dueOn ≤ today`;
3. the log has no row for (deposit, kind, dueOn);
4. it is a maturity event, **or** `dueOn ≥ enabledOn`, the day automation was last switched on. Monthly payouts
   dated before that day are assumed to have been recorded by hand. A maturity that has already passed is still
   proposed, because the stored maturity date says it has not been handled.

Due events are sorted by date, and **only the earliest is proposed**. The ones after it are counted ("2 more
waiting after this one"). Their figures depend on the event before them (a roll-over changes the rate and the
term, and a compounding payout changes the principal), so each is computed once the one before it is confirmed.
If the app goes unopened across several payouts, they are proposed one after another and none of them is applied
by itself.

Only one term is ever derived: the current one. The next term exists only once its roll-over has been confirmed.
An unconfirmed maturity therefore blocks everything after it, which is correct.

## 5. The figures — day count, rounding, tax

All money is in integer minor units, and the arithmetic is done in BigInt because
principal × rate × days can pass 2^53.

- **Day count: actual/365** (the Indonesian bank norm). `days = daysFrom(periodFrom, dueOn)`. A leap year does
  not change the divisor.
- **Gross interest** = `floor(principalMinor × rateBps × days / (10 000 × 365))`. It is floored because a bank
  credits no fraction, and an estimate should never promise more than arrives.
- **Tax withheld** = `floor(grossMinor × taxBps / 10 000)`, or 0 when the deposit is tax-free.
- **Net interest** = `grossMinor − taxMinor`. This is subtracted. It is never floored separately, so gross = net +
  tax exactly.
- **Principal** = the deposit's balance at the end of the due day, `nativeBalances(database, ws, dueOn)[deposit]`.
  With *principal + interest* and monthly payouts, each payout posted into the deposit raises the next period's
  principal, so the interest compounds monthly. That is the arithmetic of a payout that stays in the deposit.

### 5.1 The worked example, re-derived

BCA Deposito Rp 50.000.000 at 4,25% for 3 months, maturing **15 Oct 2026**. Start = 15 Jul 2026.
Days = 31 (Jul) + 31 (Aug) + 30 (Sep) = **92**.

| | Figure |
|---|---|
| gross | 50 000 000 × 425 × 92 / 3 650 000 = 535 616,438… → **Rp 535.616** |
| tax 20% | 535 616 × 0,2 = 107 123,2 → **Rp 107.123** |
| net | 535 616 − 107 123 = **Rp 428.493** |

The mockup's figures (Rp 535.616 gross, Rp 428.493 net) **reproduce under this rule** and stay as they are.
The rule matters. Flooring the net directly (`floor(gross × 80%)`) would give Rp 428.492. A 30/360 count gives
Rp 531.250 gross, and actual/360 gives Rp 543.055.

### 5.2 Fixtures that tell the rule from its neighbours

Every figure below is asserted in a test (§11). Each row names the wrong rule that it catches.

| Case | Figure (rule) | Wrong neighbour gives |
|---|---|---|
| Rp 50.000.000 · 4,25% · 92 d | gross 535 616, tax 107 123, net **428 493** | net-floored 428 492; 30/360 531 250; actual/360 543 055 |
| Rp 50.000.000 · 4,25% · 31 d (15 Jul → 15 Aug) | gross 180 479, tax **36 095** (36 095,8) | tax rounded 36 096; 30/360 177 083 |
| Rp 50.000.000 · 4,25% · 30 d (15 Sep → 15 Oct) | gross **174 657** (174 657,53) | gross rounded 174 658 |
| US$10,000.00 · 3,50% · 31 d (1 Aug → 1 Sep) | gross **2 972** cents (2 972,60) | rounded 2 973; computed in whole dollars 2 900 |
| Rp 7.500.000 · 3,00% · 31 d, tax-free | gross 19 109, tax 0, net **19 109** | taxed: tax 3 821 (3 821,8), net 15 288; tax rounded 3 822 |
| 3 monthly payouts vs one maturity, IDR | 180 479 + 180 479 + 174 657 = **535 615** gross | one maturity gives 535 616: each period is floored separately |
| 31 Jan 2027 start, monthly, 3 months | due **28 Feb, 31 Mar, 30 Apr**; days 28, 31, 30 | chained dates: 28 Feb, 28 Mar, 28 Apr |

(The 36 095,8 is 180 479 × 0,2 = 36 095,8.)

### 5.3 The tax is country-neutral

The 20% withholding and the Rp 7.500.000 small-deposit exemption are Indonesian rules. The app has no country
setting (none exists in `packages/*` or `apps/web`), and outside the tax report it must not carry local presets.
The design keeps no Indonesian constant in code or copy:

- **Tax withheld %** is a plain per-deposit figure. It defaults to **20** for every deposit in every currency,
  and the user can edit it.
- **Tax-free deposit** is a per-deposit switch, **off by default** (taxed), and available on every deposit. Its
  hint states the splitting rule in neutral words (§3). The app does not gate the switch on the principal being
  ≤ Rp 7.500.000, because that gate is an Indonesian figure in an app screen. This goes against the dispatch
  ruling and is raised in §14.
- With automation **off** the tax still applies in the real world: the bank withholds it either way. The user
  records what actually arrived, which is already net. The app computes nothing then.

## 6. The proposal (P1)

### 6.1 Where

On the deposit's page, directly under the hero, above every other group. It appears nowhere else: not in
Recurring, not in bills, not in Needs attention.

### 6.2 What it says

An `InsetGroup` whose header is the event:

- maturity: "Matured 15 Oct 2026", or "Matured today" when `dueOn` is today;
- monthly: "Interest due 15 Aug 2026", or "Interest due today".

The rows (read-only until *Edit figures*):

| Row | Maturity | Monthly |
|---|---|---|
| Principal | balance on the due day | balance on the due day |
| Interest | net, with "after 20% tax" or "tax-free" | same |
| What happens | "Roll over 3 months · interest to BCA Tahapan" / "Roll over 3 months · interest stays in the deposit" / "Everything to BCA Tahapan · the deposit closes" | "To BCA Tahapan" / "Stays in the deposit" |
| New rate | the rate the next term will carry, when rolling over | — |

The footer says that the figures are worked out from the stored rate and should be corrected to what the bank
credited. When more events are waiting it adds "2 more waiting after this one." A second group holds two action
rows, **Edit figures** and **Confirm**, the kit's action shape (the way `CashAccountForm` draws "Add account").

### 6.3 Editing

*Edit figures* turns the figures into typed rows. They are typed per keystroke and read by `parseMajor` in the
deposit's currency, with `parseRate` for percentages:

| Typed row | When | Posts as |
|---|---|---|
| Interest after tax | always | the interest transaction's amount |
| Principal | maturity with *Don't roll over* | the transfer out of the deposit |
| New rate % | maturity with a roll-over | `deposit_terms.rate_bps` of the new term. Pre-filled with the stored rate when *Keep the rate* is on; empty otherwise, and it must be typed |
| New term | maturity with a roll-over | the new term's length (`SelectRow`, 1/3/6/12). Pre-filled with the stored term |
| Rate: *base* per 1 *CCY* | deposit currency ≠ base **and** no stored rate is found for the due date | the posting's rate to base (as `CashAccountForm` asks it) |

On a roll-over the principal is not posted (it stays where it is), so it is shown rather than typed. The gross and
tax shown are the computed ones. Editing the net does not rewrite them, but the log records the net as posted.

### 6.4 Confirming

One `database.transaction`, `tx` only. It **calls the existing write paths** and adds no poster of its own:

1. Re-check, inside the transaction: the deposit is a live `time_deposit` of this workspace, automation is on, and
   the event is **the earliest due event**. Anything else is refused with "This is not the next thing due on this
   deposit".
2. **Interest**, when net > 0: `postTransactionTx` with `incomeLines({ incomeAccountId: income.investment,
   depositAccountId: interestInto, amountMinor: net, currency })`, dated `dueOn`, described
   "Interest: *deposit name*". `interestInto` is the deposit itself for *principal + interest* and the
   **Lands in** account otherwise.
3. **Don't roll over**: `postTransactionTx` with `transferLines({ from: deposit, to: Lands in, amountMinor:
   principal })`, dated `dueOn`, described "*deposit name* matured".
4. **Roll over** (either kind): `saveDepositTermsTx(tx, …)` with `maturesOn = addMonthsToDate(dueOn, newTerm)`
   and the new rate, then set the automation's `termMonths = newTerm` and `termStartedOn = dueOn`.
5. **Log**: insert the event (deposit, kind, dueOn, principal, gross, tax, net, the transaction ids). A unique
   index on (account, kind, dueOn) makes a double confirm fail and roll back the whole transaction.
6. **Don't roll over**, last: switch automation off and archive the deposit with `archiveAccountTx` (extracted
   from `archiveAccount`). The archive keeps its own refusal. If a principal edited below the balance leaves money
   in the deposit, the archive refuses before it writes, the deposit stays open with automation off, and its
   page's hero shows what is left.

For a deposit in a currency other than the base currency, the page resolves the rate for `dueOn` before calling
confirm, the same way `CashAccountForm` does. It uses `useResolveRates` and falls back to a stale stored rate, or
asks for the manual rate row (`checkManualRate`, then `upsertRate`). The rate is passed as `ratesToBase`.

After confirming, every query is invalidated. The next waiting event, if any, is proposed straight away. After
*Don't roll over*, the page navigates to `/net-worth/assets`.

A confirmed event is final in the log. If the posted transaction is later deleted in the transaction list, the
event is **not** proposed again. The log says it was handled, and the owner corrects the ledger as with any other
transaction.

## 7. The due marker (Net worth → Assets)

`groupAssets` receives the set of deposit ids that have a due event. `AssetRow.due` is true for them, and the
row's subtitle gains **"Due"** alongside the method and the tax code (`Balance · 0104 · Kas · Due`). The subtitle
uses the same quiet ink as the existing "Update price" marker, and the row's value tone does not change. The row
still opens the deposit's page, which is where the proposal waits. Nothing else in the app carries the marker.

## 8. Data model — migration 0054

**No column is added to `deposit_terms`, `accounts` or any other existing table.** There are two new side tables.
Every read and write is guarded by `automationTablesExist(db)`, a `WeakMap<Db, boolean>` exactly like
`extrasTablesExist`. A database stopped before 0054 has no automation: every deposit reads as off, and the list
of due events is empty.

```sql
CREATE TABLE deposit_automation (
  account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  enabled_on TEXT,
  at_maturity TEXT NOT NULL DEFAULT 'principal' CHECK (at_maturity IN ('principal', 'principal_interest', 'close')),
  interest_paid TEXT NOT NULL DEFAULT 'at_maturity' CHECK (interest_paid IN ('monthly', 'at_maturity')),
  payout_account_id TEXT,
  term_months INTEGER NOT NULL DEFAULT 1 CHECK (term_months IN (1, 3, 6, 12)),
  term_started_on TEXT,
  keep_rate INTEGER NOT NULL DEFAULT 1 CHECK (keep_rate IN (0, 1)),
  tax_bps INTEGER NOT NULL DEFAULT 2000 CHECK (tax_bps BETWEEN 0 AND 10000),
  tax_exempt INTEGER NOT NULL DEFAULT 0 CHECK (tax_exempt IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE deposit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('monthly', 'maturity')),
  due_on TEXT NOT NULL,
  principal_minor INTEGER NOT NULL,
  gross_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  net_minor INTEGER NOT NULL,
  interest_transaction_id TEXT,
  principal_transaction_id TEXT,
  confirmed_at TEXT NOT NULL
);
CREATE UNIQUE INDEX deposit_events_once ON deposit_events (account_id, kind, due_on);
CREATE INDEX deposit_events_workspace ON deposit_events (workspace_id, account_id);
```

- There are no `REFERENCES` clauses, as in 0048. A later rebuild of `accounts` (0047's kind) must never have to
  defer keys for these tables.
- No row means off. Nothing is backfilled.
- 0054 is pure `CREATE`. It depends on nothing that 0050–0053 make, so it applies in any order among them.

## 9. Refusals the new surface inherits

Confirming posts money, so it inherits every refusal that already guards posting, and adds its own:

| Refusal | Where it comes from |
|---|---|
| Deposit or payout account in another workspace | every read filters `workspace_id = ws.workspaceId`; `DepositAutomationError('NOT_FOUND')` / `('BAD_PAYOUT')` |
| Archived deposit or archived payout account | `archivedAt IS NULL` checked in the transaction |
| Payout in another currency | refused on save and on confirm (`BAD_PAYOUT`), and never offered in **Lands in** |
| Payout that is not a spendable account (a card, a loan, another deposit) | `SPENDABLE_SUBTYPES` |
| Categories from two workspaces (books) | `postTransactionTx` (`TWO_BOOKS`); the income category comes from `categoryIdsByKeyTx(tx, ws)`, the open book's own |
| Missing rate to base | `planPosting` (`MISSING_RATE`); the page asks for the manual rate first |
| Archiving a deposit that still holds money | `archiveAccountTx`'s own check |
| Confirming twice, or out of order | `NOT_NEXT`, backed by the unique index |
| Automation off | `OFF` |

The switch edits settings only. It does not edit or delete money, so none of the ledger's edit refusals apply to
it.

## 10. Phone, desktop, dark

The deposit's page is one component at every width. The S2 group and the P1 proposal are kit rows at the kit's
`md:max-w-2xl`. On a desktop every control is reachable by keyboard: the choice rows are buttons, the selects are
native, and the percentage is a text box. Nothing is phone-only, and desktop loses nothing. Colours come only from
kit tokens (`--ph-tint` for the check glyph), so dark mode follows without any literal colour.

## 11. Testing

- **Core** (pure): `addMonthsToDate` (clamps, negative months, year wrap); `depositInterest` and `withholdTax`
  against every row of §5.2; `dueDepositEvents` (single maturity, monthly 3 + anchor clamp, `enabledOn` skipping
  monthly but not maturity, done-set filtering, date order, a term of 1 month, nothing before `dueOn`).
- **Migration**: 0054 on a version-49 database; the tables exist and nothing else changes; `database.test.ts`
  lists 54.
- **Repo**: settings round-trip and default-off; payout refusals (other workspace, other currency, archived, not
  spendable); older database (no tables) reads off and has no due events; proposals (queue order, principal from
  the due day's balance, figures); confirm for each choice; refusals (`NOT_NEXT`, double confirm, `OFF`, missing
  payout); the archive refusal leaves the deposit open.
- **Combinations** (repo): 3 choices × monthly/at maturity × taxed/tax-free × IDR/USD = 24 cases, each asserting the
  final deposit and payout balances and the archived state as exact integers (table in the plan, Task 6).
- **Web unit**: the proposal draft (pre-fill, per-currency reading, required rate), payout choices by currency,
  and `groupAssets` due marker.
- **E2E**: the same 24 combinations walked through the real screens on chromium, with every typed amount and rate
  entered per keystroke and the clock moved to the due day. Four combinations run on phone. Also: off by default;
  an edited interest figure posts as typed; confirming one queued event proposes the next.

## 12. Out of scope

- Any proposal outside the deposit's page (Recurring, bills, Needs attention, a notification).
- Auto-posting without confirmation.
- Early withdrawal, penalties, partial withdrawals, top-ups mid-term.
- Terms other than 1/3/6/12 months, or day-based terms.
- Business-day shifting of a due date that falls on a weekend or holiday. The figure is editable, and the date is
  the contractual one.
- Feeding the logged gross/tax into the tax report (a later decision; see §14).
- Dismissing a proposal without posting. See §14. Meanwhile, a maturity the owner handled by hand is cleared by
  correcting the maturity date on the terms card, and switching automation off stops everything.

## 13. Decisions taken here that the record did not cover

1. **Interest paid** and **Term** are stored in `deposit_automation`, because the deposit carries neither (§2).
   Their defaults are At maturity and 1 month, and both rows sit in the group right under the switch.
2. With *Roll over principal + interest* and monthly payouts, each monthly payout lands **in the deposit**
   ("nothing lands; the deposit grows"). With the other two choices, monthly payouts land in **Lands in**.
3. Only the earliest due event is proposed. Later ones are counted.
4. Monthly payouts dated before the day automation was switched on are not proposed. A passed maturity is.
5. Principal = the deposit's balance on the due day. A roll-over does not post the principal, so it is not typed.
6. Interest is posted **net**, as one income transaction into `income.investment` (the key trades already post
   investment income into). Gross and tax are kept in the event log, not posted as lines.
7. *Don't roll over* archives the deposit when it reaches zero, through the existing archive refusal, and turns
   automation off either way.
8. Tax is a per-deposit percentage (default 20) plus a tax-free switch, with no country gate (§5.3).
9. The three choices are kit rows with a check glyph, not radios. The settings row is labelled "Term" rather
   than the mockup's "New term", because it also dates the current term's payouts.
10. A confirmed event stays confirmed even if its transaction is later deleted.

## 14. Open questions

1. **The tax-free gate.** The dispatch ruled that the tax-free option be offered only when the principal is
   ≤ Rp 7.500.000. Encoding that threshold puts an Indonesian figure in a non-tax-report screen, which the
   country-neutral rule forbids, so the switch is offered on every deposit and its copy carries the splitting
   rule. Should the gate be added, keyed to the IDR currency?
2. **Posting gross + tax, like trades.** `writeTradeTx` (via `tradePostings` in `packages/core/src/assets/trades.ts`) posts investment income as gross to `income.investment`
   with the tax as a separate `government_taxes.estimated_tax` line. This design posts net only, as ruled. Should
   deposit interest follow the trades' three-line shape instead, so that the category totals show gross interest
   and tax paid?
3. **Final-income section of the tax report.** Should the SPT's final-tax income list (bunga deposito, gross and
   PPh withheld) read `deposit_events`?
4. **Dismissing a proposal.** P1 shows only *Edit figures* and *Confirm*. Should there be a "Recorded it myself"
   action that logs the event without posting?
5. **Monthly interest with principal + interest.** Decision 13.2 (monthly payouts compound into the deposit) is a
   reasonable reading, but many banks don't offer ARO principal + interest with monthly payout. Confirm it, or
   refuse that combination?
