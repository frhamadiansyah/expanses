# Net Worth, Investments, Goals, Debts, and Coretax — Design

Extends `docs/superpowers/specs/2026-09-11-personal-finance-platform-design.md` (stages 4–6: loans, goals, asset valuations). Approved section by section with the owner on 2026-09-11 after reviewing a clickable mockup (published artifact "Expanses Net Worth").

## 1. Goal

Show the owner's full financial position the way a Certified Financial Planner reads it (statement of financial position, cash-flow ratios, goal funding), while keeping every asset and debt in the shape the yearly SPT Tahunan PPh Orang Pribadi needs in Coretax (Lampiran 1 Bagian A harta, Bagian B utang). Filling the SPT each year should become: enter 31 Dec prices, freeze, copy tables into the DJP converter.

## 2. Decisions

| Topic | Decision |
|---|---|
| Investments and the ledger | Approach A: the ledger holds cost and cash; market value lives beside it (prices, estimates). No revaluation postings |
| Holdings | Built from buy, sell, income, and unit-change records; sells use average cost |
| Fees on buys | Part of cost (Biaya perolehan, Pasal 10 UU PPh) |
| Property and vehicles | Ledger holds cost; estimates in a valuation table with a basis (estimate, appraisal, listing, NJOP, purchase) |
| Coretax value for property and vehicles | Switchable per report: acquisition cost (default), market estimate, NJOP, appraisal. Net worth always uses the estimate |
| Repeated purchases in Coretax | Switchable per report: one row per holding (default) or one row per purchase year |
| Money market funds | Reksa dana: Investments group in the plan and Investasi/Sekuritas in Coretax |
| Ratio period | CFP practice: a year of cash flow. Default last 12 months; calendar year for the yearly review |
| Goals | Linked per buy transaction (goal tag on each buy), not per whole asset; savings accounts by set-aside amounts |
| Lend and borrow | One receivable or payable account per loan, grouped by person |
| Card 0% installments | Spending once at purchase; the card balance already holds the debt; installments only split billed and unbilled |
| Coretax export | Copy table (tab-separated, converter column order) and CSV per table. No direct XML or .xlsx in this project |
| Card fee phrases | "admin fee" and "biaya admin" stay card fee phrases (owner confirmed) |
| Build order | Slice 1 asset values and buy & sell → 2 overview and ratios → 3 goals → 4 lend & borrow → 5 loans and installments → 6 Coretax report |

## 3. Shared model

### 3.1 Balance sheet groups

| Group | Default account types |
|---|---|
| Cash & equivalents | cash, bank, savings (includes time deposits) |
| Investments | investment (funds, shares, bonds, gold) |
| Owed to you | receivable |
| Personal use | property, vehicle, other_asset |
| Due within a year | credit_card, payable (due ≤ 12 months or no due date), next 12 months of loan principal |
| Long-term | loan principal after 12 months, payable due after 12 months, card installments unbilled beyond 12 months |

`asset_profiles.plan_group` can override an asset's group.

### 3.2 Value modes (existing `accounts.valuation_mode`)

| Mode | Used for | Value at date D |
|---|---|---|
| `derived` | cash, bank, savings, receivable, liabilities | Ledger balance at D |
| `market` | investment | Units held at D × latest price on or before D; cost when no price exists (flagged "No price yet") |
| `snapshot` | property, vehicle, other_asset | Latest non-NJOP valuation on or before D; cost when none |

```ts
export function valueAt(account: AssetAccount, date: string, data: ValueInputs): { valueMinor: number; costMinor: number; source: 'ledger' | 'price' | 'valuation' | 'cost' };
export function netWorthAt(date: string, accounts: AssetAccount[], data: ValueInputs, ratesToBase: Record<string, number>): { assetsMinor: number; liabilitiesMinor: number; netWorthMinor: number };
```

Staleness: prices older than 30 days and valuations older than 12 months show an update badge.

### 3.3 Numbers

- Money: integer minor units, as today.
- Units: `units_micro` integers (units × 1,000,000). Covers fund units to 4 decimals and gold to 0.0001 g.
- Prices: `price_micro` integers (minor units per unit × 1,000,000), so a NAV of 1.842,11 is stored exactly.
- Rates: basis points (`rate_bps`, 1% = 100).
- Coretax amounts: whole Rupiah, commercial rounding.
- Posting tables use + for a debit and − for a credit, so a liability grows with − and shrinks with +.

## 4. Slice 1 — Asset values and buy & sell

### 4.1 Storage (migration `0007_assets`)

- `accounts.subtype` gains `other_asset` (jewellery, art, electronics, furniture, intangibles).
- `asset_profiles`: `account_id` (PK), `workspace_id`, `plan_group` (nullable override), `unit_kind` (`units` | `shares` | `grams` | `face` | null), `lot_size` (shares: 100), `risk` (`low` | `medium` | `high` | null, used by goals), `coretax_section` (`kas` | `piutang` | `investasi` | `bergerak` | `tidak_bergerak` | `lainnya` | null), `coretax_code` (4-digit text), `acquired_year` (nullable override), `coretax_fields_json`, `updated_at`.
- `investment_trades`: `id`, `workspace_id`, `account_id`, `transaction_id` (nullable for unit changes), `kind` (`buy` | `sell` | `income` | `unit_change`), `occurred_on`, `units_micro`, `gross_minor`, `fee_minor`, `tax_minor`, `cash_account_id`, `template_id` (nullable), `status` (`active` | `replaced` | `deleted`), `replaces_trade_id`, `created_at`. For `unit_change`, `units_micro` is the signed change and money columns are 0.
- `prices`: `account_id`, `on_date`, `price_micro`, `source` (`manual`), `created_at`; unique (`account_id`, `on_date`).
- `valuations`: `id`, `account_id`, `as_of`, `value_minor`, `basis` (`estimate` | `appraisal` | `listing` | `njop` | `purchase`), `note`, `created_at`.
- `trade_templates`: `id`, `workspace_id`, `account_id`, `cash_account_id`, `amount_minor` or `units_micro` (exactly one), `day_of_month` (1–28), `active`, `created_at`.
- New category keys via `ensureCategoryKeys`: `income.realized_gains` "Realized Gains", `government.final_tax` "Final Tax".

Coretax field schema lives in core (`CORETAX_SECTIONS`): per section, the converter columns, which are required, and validators. `coretax_fields_json` is checked against it on save; missing required fields never block saving.

### 4.2 Postings (core, pure)

```ts
export function tradePostings(trade: TradeInput, position: Position, accounts: TradeAccounts): PostingLine[];
export function positionAfter(trades: TradeRecord[], upTo?: string): Position; // { unitsMicro, costMinor, byYear, realizedMinor, incomeMinor }
```

| Kind | Lines |
|---|---|
| Buy | holding + (gross + fee + tax); cash − (gross + fee + tax) |
| Sell | cash + (gross − fee − tax); Final Tax + tax; holding − basis; Realized Gains − (gross − fee − basis) |
| Income | cash + (gross − tax); Final Tax + tax; Investment Income − gross |
| Unit change | none |

- Basis of a sell = round(cost × units sold ÷ units held) at the trade date; a sell of all units takes all remaining cost.
- Trades order by `occurred_on`, then `created_at`.
- Selling more than held fails with the held amount ("You hold 32 g; enter up to 32").
- `unit_change` scales units, never cost.
- Saving, editing (replace), or deleting (void) a trade recomputes later sells of the same holding; any sell whose basis changed has its transaction voided and replaced in the same database transaction. The result reports the changed sells.
- Holding currency is the account currency. A cash account in another currency posts through the Currency Exchange system account with a rate, as transfers do.
- Opening positions are buys paid from the Opening Balances system account.
- Transactions linked to trades cannot be edited from the Transactions page.

### 4.3 Screens

- Sidebar item **Net worth**; routes `/net-worth/assets`, `/net-worth/assets/$accountId`, `/net-worth/trades`.
- **Add asset** by choice: Fund, Stock, Bond, Gold, Property, Vehicle, Other asset, Bank/cash/deposit. Each preset sets subtype, value mode, unit kind, risk, Coretax section and suggested code, and shows that section's fields. Holdings ask "Already own some?" (past purchases as opening positions); property, vehicles, and other assets ask purchase date, cost, and an optional estimate.
- **Assets page**: groups per §3.1, value, method tag, Coretax code and section, update badge, collapsed Sold section, "Update prices" sheet (every stale holding, one input each).
- **Asset detail**: value, cost, gain; method line with average cost; price or valuation form with basis; 12-month SVG chart of month-end `valueAt`; history (trades, valuations, or transactions); Coretax fields form with Missing markers; archive when nothing is left.
- **Buy & sell page**: holdings table (units, average cost, cost basis, value, unrealized, realized this year, income this year); record form (kind, holding, date, units, gross, fee, tax, cash account, price-per-unit check, realized preview on sells); due monthly buys (template day passed this month, no trade with that template in the month) with Record prefilled; template management; history with filter, edit, delete, and a notice when later sells changed.
- **Transactions page**: trade transactions labelled "Buy · Equity fund" with a link; they are transfers, not spending.
- **Accounts page**: market and snapshot accounts show value, then cost, linking to asset detail.
- **Dashboard**: net worth uses `valueAt`.

### 4.4 Tests

Core: postings per kind; average cost with partial and full sells; rounding; backdated trade changing later sells; unit change; `valueAt` per mode with and without prices; USD holding. DB: migration on a populated database; trade save and replace in one transaction; later sells replaced; category keys added. Web unit: presets, price-per-unit display, due-template logic, staleness. E2E: add gold with two past purchases, buy, partial sell, check units, average cost, realized gain, bank balance, unchanged spending; update prices sheet; trade edit blocked on Transactions.

## 5. Slice 2 — Overview, balance sheet, health ratios

### 5.1 Calculations (core, pure)

```ts
export function balanceSheet(accounts: SheetAccount[], values: Record<string, number>, loanSplits: Record<string, { dueWithinYearMinor: number }>): BalanceSheet;
export function healthRatios(flows: PeriodFlows, balances: SheetTotals): HealthRatio[]; // value, status, guide
```

- Net worth history is computed for month-ends (6 months, 12 months, all), never stored.
- Before slice 5, loans count as long-term in full.
- `periodFlows(ws, from, to)` (db) returns per month: take-home income (income categories except Realized Gains), spending (expense categories except Final Tax), debt payments (money paid into loan accounts plus loan interest; from slice 5 also card installment amounts billed in the period). Transfers and opening balances are excluded.
- Months used = months with data, at most 12; fewer than 12 shows "Based on N months".
- Period: last 12 months with today's balances, or a calendar year with balances on 31 Dec of that year.

### 5.2 Ratios

| Ratio | Formula | On track | Watch | Act now |
|---|---|---|---|---|
| Emergency fund | cash & equivalents ÷ (monthly spending + monthly debt payments) | ≥ 3 months | 1.5–3 | < 1.5 |
| Savings rate | (income − spending) ÷ income | ≥ 10% | 5–10% | < 5% |
| Liquidity | cash & equivalents ÷ net worth | ≥ 15% | 10–15% | < 10% |
| Debt payments | monthly debt payments ÷ monthly income | ≤ 25% | 25–30% | > 30% |
| Consumer debt payments | same, excluding home loans | ≤ 15% | 15–20% | > 20% |
| Debt to assets | liabilities ÷ assets | ≤ 50% | 50–70% | > 70% |
| Solvency | net worth ÷ assets | ≥ 50% | 30–50% | < 30% |
| Investments to net worth | investments ÷ net worth | ≥ 50% | < 50% | never |

Zero income or net worth ≤ 0 shows "Not enough data" for affected ratios. Thresholds live in one core table.

### 5.3 Screens

Overview tab (first tab): net worth card with deltas (since last month, since January) and chart; Needs attention (stale prices and valuations, due monthly buys; later slices add their items); balance sheet with share bars and per-asset rows; net worth line; health ratio cards with period switch, pill, gauge, and formula line. Dashboard net worth links here.

### 5.4 Tests

Core: net worth with mixed modes and USD; grouping; each ratio at thresholds; fewer than 12 months; zero income; calendar year balances. DB: `periodFlows` exclusions. E2E: salary, spending, loan payment, then ratios; a gold buy moves net worth only by the price difference.

## 6. Slice 3 — Goals

### 6.1 Storage (migration `0008_goals`)

- `goals`: `id`, `workspace_id`, `name`, `kind` (`emergency` | `hajj` | `umrah` | `education` | `retirement` | `home` | `wedding` | `vehicle` | `holiday` | `other`), `rank`, `growth_bps`, `return_bps`, `standing_monthly_minor`, `standing_note`, `status` (`active` | `achieved` | `archived`), `created_at`.
- `goal_stages`: `id`, `goal_id`, `name`, `target_minor` (today's money; null for emergency), `target_months` (emergency only), `due_on`, `sort`, `paid_on`.
- `goal_earmarks`: `goal_id`, `account_id` (cash, bank, savings only), `amount_minor`.
- `investment_trades.goal_id` and `trade_templates.goal_id` (nullable).

Kind defaults (editable): hajj starts with stages "Setoran awal" (Rp 25.000.000 per person) and "Final payment"; growth 10% education, 5% hajj and umrah, 4% others; return 2% emergency, 4.5% for goals due within 3 years, 8–10% otherwise.

### 6.2 Rules (core, pure)

```ts
export function goalUnits(trades: TradeRecord[], upTo?: string): Record<string /*accountId*/, Record<string /*goalId or ''*/, number /*unitsMicro*/>>;
export function goalPlan(goal: Goal, links: GoalLinkValues, flows: PeriodFlows, templates: TemplateValue[]): GoalPlan;
export function fitByRank(plans: GoalPlan[], monthlyCapacityMinor: number): FitResult[];
```

- A buy adds units to its goal; a sell removes units from the goal it names (or "No goal") and fails beyond that goal's units at the date; unit changes scale every goal's units proportionally.
- Changing a buy's goal updates the trade in place and writes an audit row; no ledger change.
- Goal value = Σ tagged units × latest price + set-aside amounts capped at each account's balance.
- Emergency target = months × (monthly spending + debt payments) over the last 12 months.
- Stages in date order: target at due date = today's amount × (1 + growth)^years; current value grows at the expected return; covered stages consume value and carry the rest (discounted to today); the first uncovered stage gives needed per month (future-value annuity); later stages show "Later".
- Set up per month = tagged templates (amount, or units × latest price) + standing amount.
- Status: Funded (nothing needed), On track (set up ≥ needed), Behind (shortfall).
- Capacity = take-home income − spending − debt payments (last 12 months). When total needed exceeds capacity, goals fill in rank order.
- Risk warning: a goal due within 3 years holding high-risk assets.
- Set-aside amounts above an account balance warn, never block.
- Goals never change net worth or the Coretax report.

### 6.3 Screens

Goals tab: summary (needed, set up, capacity, rank fit message); goals in rank order with up and down controls; start buttons per kind; goal cards (progress, stages, needed vs set up, funded by, assumptions); "What each asset is for" table. Goal form: name, kind, stages, growth, return, standing amount, set-aside amounts. Goal select on buy form, history rows, and templates; "Sell from goal" on sells. Asset detail "For goals" chips. Needs attention adds goals behind, set-aside above balance, risk warnings.

### 6.4 Tests

Core: goal units through buys, sells, retags, splits; annuity math against known values; stage carry; emergency target; rank fit; risk warning; 0% return. DB: migration; retag audit; earmark above balance. E2E: hajj goal, tagged gold buy, sell from the goal, progress and status.

## 7. Slice 4 — Lend and borrow

### 7.1 Storage (migration `0009_debts`)

- `debt_profiles`: `account_id` (PK), `workspace_id`, `person_name`, `person_id_number` (NIK or NPWP, optional), `reason`, `due_on`, `status` (`open` | `settled` | `forgiven`), `status_on`, `coretax_code` (receivable `0201` default, `0202` related party; payable `109` default, `103` related party).
- `entries.spend_category_id` (nullable): purchase category on a card line posted to a receivable, so card points still apply.

### 7.2 Postings (core, pure)

| Action | Lines |
|---|---|
| Lend cash | receivable +; bank or cash − |
| Lend on card | receivable + (with purchase category and MCC); card − |
| Split a bill | own category + share; receivable + per person; card or bank − total |
| Repayment received | bank +; receivable −; optional interest to Other Income − |
| Borrow | bank +; payable − |
| Repay borrowed | payable +; bank −; optional interest to Interest + |
| Forgive rest | receivable −; Gifts (or chosen category) + |

- Repayments above the balance fail ("Andi owes Rp 9.000.000").
- Balance 0 sets `settled` with the date.
- `cardSpendLines` includes receivable lines carrying `spend_category_id`, so points count the full card purchase.
- Account currency applies; existing rate handling.

### 7.3 Screens and effects

Lend & borrow tab: Owed to you and You owe columns; person cards with total, loans, progress, due pill, history, Record repayment, Forgive rest, Edit; add form (direction, person with suggestions, amount, date, account, card category and MCC when a card, reason, due date, NIK or NPWP); Settled section. Transaction form gains "Someone owes part of this". Balance sheet per §3.1. Needs attention: due within 21 days or overdue. Transactions page labels "Lent to …", "Repayment from …". Receivables don't fund goals.

### 7.4 Tests

Core: builders per action; over-repayment; split sums; card lending counted as points spend. DB: migration; settle on zero; `cardSpendLines` with receivable lines. E2E: lend on card, split dinner, repayment, forgive; spending totals, card points, person totals.

## 8. Slice 5 — Loans and installments

### 8.1 Storage (migration `0010_loans`)

- `loan_terms`: `account_id` (PK), `workspace_id`, `lender_name`, `lender_npwp`, `purpose`, `original_minor`, `first_payment_on`, `tenor_months`, `method` (`annuity` | `flat` | `zero`), `payment_day`, `asset_account_id` (nullable), `coretax_code` (`101` default), `status` (`open` | `paid_off`), `status_on`.
- `loan_rate_periods`: `id`, `account_id`, `from_on`, `rate_bps`, `kind` (`fixed` | `floating`), `payment_minor`.
- `card_installments`: `id`, `workspace_id`, `card_account_id`, `transaction_id`, `description`, `total_minor`, `months`, `monthly_minor`, `first_billed_month`, `rate_bps`, `conversion_fee_minor`, `earns_points` (default true).

### 8.2 Rules (core, pure)

```ts
export function loanSchedule(balanceMinor: number, terms: LoanTerms, periods: RatePeriod[], fromDate: string): ScheduleRow[]; // date, payment, principal, interest, balance
export function extraPaymentEffect(schedule: ScheduleRow[], extra: ExtraPayment): { interestSavedMinor: number; monthsEarlier: number; newPaymentMinor?: number };
export function flatToEffectiveBps(flatBps: number, tenorMonths: number): number;
export function installmentSplit(installment: CardInstallment, onDate: string): { billedMinor: number; unbilledMinor: number; unbilledBeyond12Minor: number };
```

- Schedule is computed from the ledger balance; recorded payments are truth. Annuity: interest on balance; flat: interest on original; zero: principal only; last payment clears the remainder.
- Payment posting: bank − payment; loan + principal; Interest + interest; extra charges + to chosen categories. The form is prefilled from the next row.
- Extra principal: loan + amount, bank − (amount + penalty), fees + penalty; then shorter tenor (payment kept) or lower payment (new rate period).
- Rate change adds a period with the new payment; no transaction.
- Onboarding existing loans: outstanding balance as opening balance plus terms; warn when the computed payoff differs from the tenor end by more than 2 months.
- New loans: bank + and loan −, or asset + price, bank − down payment, loan − principal ("Paid with a loan" in Add asset).
- Card installments: purchase is spending once; the card balance holds the debt; `installmentSplit` shows billed and unbilled; `earns_points = false` excludes the purchase from points.
- Balance sheet: next 12 months of principal due within a year; unbilled installments beyond 12 months long-term.
- Debt payments ratio adds billed installment amounts.

### 8.3 Screens

Loans tab: monthly installments total, total left; loan list (progress, rate, next payment); detail (still owed, payment, next date, interest still to pay, payoff month, months left, principal repaid, next 12 rows expandable, Record payment, Rate change, Extra payment, what-if once or monthly, flat-to-effective note); card installments under each card here and on card detail. House and car detail show equity; Coretax ownership source suggests Utang. Needs attention: payment due within 7 days unrecorded, fixed rate ending within 60 days, installment finishing this month.

### 8.4 Tests

Core: annuity, flat, zero schedules and rounding; rate periods; extra payment both ways; next-12-month principal; flat-to-effective; what-if; installment split; payoff mismatch warning. DB: migration; payment posting; balance on 31 Dec; installment linked to purchase. E2E: existing KPR, prefilled payment, rate change, extra payment; balance sheet split; interest in spending; installment billed and unbilled.

## 9. Slice 6 — Coretax report

### 9.1 Storage (migration `0011_tax_reports`)

- `tax_year_reports`: `id`, `workspace_id`, `tax_year`, `status` (`draft` | `frozen` | `filed`), `frozen_at`, `filed_on`, `npwp`, `taxpayer_name`, `property_basis` (`cost` | `estimate` | `njop` | `appraisal`), `repeat_rows` (`holding` | `year`).
- `tax_year_rows`: `id`, `report_id`, `section`, `account_id` (nullable), `acquired_year`, `sort`, `fields_json`, `cost_minor`, `value_minor`, `balance_minor`, `source` (`auto` | `edited` | `manual`), `already_filed` (first-year marker).
- `fx_rates.source` gains `kmk` (Kurs Menteri Keuangan, entered manually).

### 9.2 Rules (core, pure)

```ts
export function coretaxRows(year: number, inputs: CoretaxInputs, settings: ReportSettings): CoretaxRow[];
export function carryOver(current: CoretaxRow[], previous: CoretaxRow[] | null): CarryStatus[]; // new | removed | changed | same
export function readiness(rows: CoretaxRow[]): ReadinessIssue[];
export function toConverterTsv(section: CoretaxSection, rows: CoretaxRow[]): string;
```

- Draft rows are live from the ledger until frozen.
- Kas: balance on 31 Dec × KMK. Investasi and Lainnya: cost basis on 31 Dec (IDR at historical rates), value = units × 31 Dec price × KMK; per-year rows split cost and units by purchase year (sells reduce each year proportionally). Bergerak and Tidak bergerak: chosen basis. Piutang and Utang: open balances on 31 Dec (settled debts excluded). Card rows note unbilled installments.
- Freeze (from 1 Jan of the next year): 31 Dec prices sheet → KMK rates → review → rows copied. Later ledger changes show per-row differences with "Use ledger value". Filed reports are read-only and serve as next year's base.
- Carry-over matches rows by account (and acquired year when split). First year: all New, with "Already in my last SPT".
- Readiness: required fields per section, 16-digit NPWP and NIK, ISO 3166 alpha-3 country, year not after the tax year, positive amounts.
- Export: Copy table (tab-separated, converter DATA column order) and CSV per section, with a warning that the file contains NPWP and account numbers.
- Before implementation, verify section codes (REFF sheets) and column order against the current DJP converter (guide "Tata Cara Pembuatan XML SPT OP", version 20260310) and store the code lists in core. Mockup codes were illustrative.

### 9.3 Screens

Coretax tab: year picker and status; readiness list with links; changes since last SPT; value basis and repeat-row switches; Ikhtisar (rows and totals per section, total harta, total utang); section tabs with rows, carry-over pills, inline edits for manual rows; reconciliation line explaining the difference from net worth.

### 9.4 Tests

Core: rows per section; basis switch; per-year split; KMK conversion and rounding; carry-over statuses; readiness; TSV column order. DB: migration; freeze copies rows; differences after a backdated edit; filed read-only. E2E: 31 Dec prices and KMK, freeze, copy a table; backdated trade shows a difference.

## 10. Privacy

NPWP, NIK, account numbers, SIDs, plate numbers, and certificate numbers stay on the device and in the app's backups. No feature in this design sends data to a network service; prices and KMK rates are entered by hand.

## 11. Delivery

Each slice is its own implementation plan and branch-sized drop, in the order of §2, with the existing gate (catalog, core, db, web unit tests, typecheck, e2e). Migrations are numbered in slice order (`0007`–`0011`). The published mockup is the visual reference; screens follow the app's existing Tailwind components.

## 12. Known limitations and later work

- No automatic price or KMK feeds (market data is out of scope).
- No push reminders; due items appear in Needs attention only.
- No income attachments for the SPT (dividends, coupons, final tax), though trades keep gross amounts and tax for a later slice.
- No direct Coretax XML or .xlsx export.
- Goal math uses constant growth and return; no Monte Carlo or inflation scenarios.
- Hajj figures (setoran awal amount, queue years) are user-editable defaults and need checking against Kemenag each year.
- BPJS JHT, DPLK, and insurance cash values are tracked only as manual other assets until a dedicated slice.
