# Health ratios, the budget's shape, and the goal calculators (from the FinPlan review) — design

Status: approved · 2026-09-21
Decisions: `decisions-health-ratios.md` (user, 2026-09-19), with the sourced research behind it in
`research-emergency-and-cover.md` and `research-returns-by-horizon.md` (same scratchpad).
Mockups the user saw: **FinPlan vs Expanses** (https://claude.ai/artifact/7tLCJLqnC45J867dbNh6KA — "The list", changes
1–9) and **Education fund** (https://claude.ai/artifact/Lyr3UkbnTApw2nvu47zTxA).
Plans: `docs/superpowers/plans/2026-09-21-health-ratios.md` (Part 1 — ratios, necessary vs lifestyle, budget
frequency, compulsory goals, the emergency calculator) and `docs/superpowers/plans/2026-09-21-health-ratios-calculators.md`
(Part 2 — horizon returns, calculators in today's money, the education levels, life cover).

**The user's own workbook (`FinPlan_blank 2.xlsm`) is not an authority.** The user built it and asked for published
sources instead. Where the workbook and the research differ, this design follows the research. Its four arithmetic
bugs (§12) are named so that nothing here inherits them.

## 1. What we are building

The app already computes nine health ratios from the ledger (`packages/core/src/assets/health.ts`) and has three goal
calculators (`packages/core/src/budget/calculators.ts`). The review against the workbook and the research found nine
changes; the first one is already on main. What is left:

| # | Change | Part |
|---|---|---|
| 1 | Loan interest counted twice in the emergency target | **Done** — `2e49a12` (emergency ratio and goal) and `0c0602e` (what you can save) |
| 2 | Emergency months prefilled from household shape and income stability | 1 |
| 3 | The emergency denominator's switch becomes **essential spending vs all spending** | 1 |
| 4 | Debt-servicing guide defaults to **30%** | 1 |
| 5 | **Essential vs lifestyle** as one fact on a category | 1 |
| 6 | **A frequency on every budget line**, normalised with 52/12 and 365/12 | 1 |
| 7 | **Compulsory vs additional** goals; compulsory ones are funded first | 1 |
| 8 | **Life cover** calculator, capital needs analysis | 2 |
| 9 | **Assumed return by horizon**, prefilled and editable | 2 |
| — | **Education levels**, user-defined, fees once or yearly, ages against a birthday, a return per level | 2 |
| — | **Calculator targets stored in today's money** — a defect found while writing this (§9.1) | 2 |

## 2. Numbers this design uses — all prefills, always editable

| Figure | Value | Source |
|---|---|---|
| Emergency months | matrix in §3.1 | user, 2026-09-19 |
| General / retirement cost inflation | **3.5%** | BPS 3.19% y-o-y Aug 2026, BI target 2.5%±1% |
| Retirement accumulation return | **10%** nominal | 20-yr IHSG evidence; 6.28% real against 3.5% |
| Retirement drawdown return | **5%** | de-risked once you stop |
| Return ≤ 1 year | **4%** (3.5–5%) | pasar uang, deposito |
| Return 1–3 years | **5%** (4.5–6%) | pasar uang, short SBN ritel |
| Return 3–5 years | **6%** (5–7%) | pendapatan tetap, SBN ritel |
| Return > 5 years | **8%** (6–10%) | reksadana saham, equity |
| Debt-servicing guide | **30%** default, 35% selectable | OJK Buku 9, Tabel 5, quoting FPSB Indonesia |
| Goal growth templates | emergency 0%, education 10%, home 7%, hajj 5%, wedding 5%, vehicle 3%, holiday 3% (unchanged); **retirement 3.5%** (was 4%) | record, "Inflation and return are prefilled per goal" |

**18% appears nowhere** — not as a default, a band, a template, a hint or a test fixture. No prefill anywhere is above
10% (the top of the long band's range and the retirement accumulation figure). A test asserts it (Part 2, Task 1).

Band boundaries, in whole months until the money is needed: **≤ 12 → 4%**, **13–36 → 5%**, **37–60 → 6%**, **> 60 → 8%**.
The bands are nominal, net of fund fees, before the investor's own tax; the hint says so, in country-neutral words (C1
ruling: instrument kinds, never a country's product names).

## 3. The emergency fund

### 3.1 Months, prefilled from two answers

|                      | Salaried | Freelance / irregular |
|----------------------|----------|-----------------------|
| Single               | 3        | 6                     |
| Married, no children | 6        | 12                    |
| With children        | 12       | 24                    |

Freelance is exactly twice salaried. The two answers live on the emergency calculator (goal and Calculators page). The
months box is prefilled from them and stays editable; the screen says **which two answers produced the number**
("12 months · with children, salaried") and, once the months are typed over, "your own figure". The app never argues
with a figure the user types.

The two answers are stored with the calculator's inputs (`goal_calculators.inputs_json`), not in a new table.

### 3.2 What the months multiply — essential or all spending

The OJK/FPSB standard divides cash by *Kebutuhan Pengeluaran Bulanan* — monthly expenditure **needs** — and keeps debt
service as a separate income ratio. So the switch is no longer "count debt payments" but:

- **Essential spending** (default): spending minus lifestyle-category spending, **plus loan principal**.
- **All spending**: spending, **plus loan principal**.

Loan principal is in the base either way: an instalment keeps arriving when income stops, and principal is the only
half of the payment spending does not already hold (interest is an expense entry). Nothing adds the whole payment
beside spending, so the interest is never counted twice.

One function, `emergencyOutgoingMinor(flows, base)`, is the base for **both** the ratio card and the emergency goal, so
the two cannot drift apart. The ratio card's switch is a segmented control; the emergency goal keeps its own choice in
its calculator inputs. Both default to essential.

A category with no mark counts as **essential** (§4.2), so with nothing marked, "essential" equals "all" and nothing a
user sees today changes until they mark a category lifestyle.

### 3.3 What does not change

**The ratio card grades against the household's own months** (user decision, 2026-09-21 — Q5 flipped): the months on its emergency goal, derived from the two answers or typed. A household with no emergency goal is graded as before: at least 3 months for good, with the bar's guide mark at 6 and the text "3–6 months". Accelerated debt paydown is never in the base. The
income-based emergency route from the workbook is not built — no source was found for it.

## 4. Essential vs lifestyle

### 4.1 One fact on a category

Each expense category may be marked **Essential** or **Lifestyle**. It is stored in a side table (`category_needs`),
never as a column on `accounts`. A category with no mark of its own takes its nearest marked ancestor's; a root with no
mark is **Essential**. The Categories page shows each line's mark and where it came from ("Lifestyle", "Lifestyle
(from parent)", "Essential"), with an action to switch it and, when the mark is the line's own, one to reset it — the
same shape the page already uses for a card MCC.

### 4.2 Readers

| Reader | Uses |
|---|---|
| `periodFlows` | `lifestyleSpendingMinor`: the signed sum of counted expense rows whose category resolves to lifestyle. Excluded rows and final tax are out, exactly as for `spendingMinor`. |
| Emergency ratio card and emergency goal | `emergencyOutgoingMinor` (§3.2) |
| Budget sheet | `essentialActualMinor` and `lifestyleActualMinor`, shown on the Budget page |
| Workspace copy (`copyCategoriesTx`) | the marks travel with the copied categories, like a typed MCC |

Setting a mark refuses: an id that is not a category, an income category, a category of another workspace, and a
category filed in another book than the open one — the refusals `saveBudget` already applies.

## 5. A frequency on every budget line

A cap is typed in the unit the user thinks in — daily, weekly, monthly, quarterly or yearly — and converted to a month
before anything adds it:

| Frequency | Per month |
|---|---|
| Daily | × 365 ÷ 12 |
| Weekly | × 52 ÷ 12 |
| Monthly | × 1 |
| Quarterly | ÷ 3 |
| Yearly | ÷ 12 |

**Never × 4 and never × 30.** Each line is converted and rounded once, half away from zero, in the currency's minor
units; only converted figures are ever summed. Rp 500.000 weekly is Rp 2.166.667 a month, not Rp 2.000.000.

Storage: `budgets.amount_minor` keeps holding **the monthly figure**, so every existing reader of it (the sheet, the
caps total, the overrides) is untouched. The amount as typed and its frequency sit in a side table,
`budget_frequencies`, with no row meaning monthly. A line that converts to nothing a month is refused. A month's
override is always a monthly figure.

The Budget page's form gains an **Every** picker (Day · Week · Month · Quarter · Year, Month by default); the amount's
label follows it ("Monthly amount", "Weekly amount", …) and a read-only **Per month** row shows the conversion before
saving. A line set in another unit says so ("Cap Rp 2.166.667 · Rp 500.000 a week"). "Just this month" is always
monthly and hides the picker.

## 6. Compulsory and additional goals

**Compulsory: emergency fund and retirement only.** Everything else — education and hajj included — is additional,
which keeps the app country- and faith-neutral. The Goals page lists compulsory goals under their own heading, then
additional ones. **What you can save funds compulsory goals first**, then additional ones, each group in its own rank
order (`fitByRank`). Move up / Move down act within a group, and the ranks written back follow the page's order, so the
order on screen is the funding order.

## 7. Health ratios — what else changes

- Debt-servicing guide defaults to **30%**; 35% stays selectable. The options read "30% · the planning guide" and
  "35% · a looser guide" — no country named in the copy.
- `RatioSettings.emergencyIncludesDebtPayments` is replaced by `RatioSettings.emergencyBase: 'essential' | 'all'`.
- `health.ts`'s header stops claiming "CFP-aligned": no source was found for that label.
- Nothing else in the nine ratios moves: liquid-to-net-worth stays **≥ 15%**, solvency stays **≥ 50%**.

## 8. Assumed return by horizon

`assumedReturnBps(months)` answers the band in §2. It prefills:

- a new goal's **Expected return**, from its first stage's date, and follows that date while the return has not been
  typed over; the templates' return figures are derived from it. Two exceptions: the **emergency** template keeps 2%
  (the money sits in savings or a deposit, not in a horizon), and **retirement** is 10% (§2);
- each **education level's** return, from the months until the level starts (§10);
- nothing that already exists — a goal's saved return is the user's and is never rewritten.

The hint beside a prefilled return names the band and its range (`bandHint`): "6% · 3 to 5 years · typically 5–7%,
net of fund fees; a deposit taxed at source earns less". Country-neutral by ruling (C1): no country's fund type or tax
rate is named.

## 9. Calculators — today's money

### 9.1 A defect this fixes

`GoalStage.targetMinor` is documented as *today's money* and `goalPlan` inflates it by `goal.growthBps` to its due
date. But the calculators write stages already inflated — `educationStages` inflates each year, `retirementTargetMinor`
returns the pot on the day you retire — so a derived goal is inflated **twice**: once by the calculator, again by the
goal. An education goal at 10% growth, 10 years out, is asked for roughly 2.6× what its own working says. The goals
page shows it too: "today" on a derived stage is already a future figure.

The fix: a calculator writes each stage **in today's money**, and writes the inflation it assumed into the goal's
`growthBps`, which the goal engine then applies once, to each stage's own date. For education that is exactly the
"each year inflated to the year it is paid" rule. For retirement, the pot in today's money is the annuity of today's
yearly spending at the real drawdown rate; inflated to the retirement date it equals today's `retirementTargetMinor`
within a few minor units of rounding. The emergency fund's growth is 0%: it is re-sized from live spending, never inflated.

Existing derived goals are upgraded once, on open (§9.4).

### 9.2 Retirement

Inputs: yearly spending today, years to retirement, years in retirement, inflation (**3.5%**), return while saving
(**10%**), return while retired (**5%**). The pot is drawn down while it earns — the workbook's "pot earns nothing"
is not taken. The goal it writes carries growth = inflation and return = the return while saving; the Calculators
page's monthly figure uses the return while saving, not the return while retired (today it uses the latter — a defect).

### 9.3 Emergency

§3.1 and §3.2. Growth 0%.

### 9.4 Upgrading goals derived before this

On open, every `goal_calculators` row without `version: 2` is worked out again under the rules above, in one
transaction per goal. The year each stage falls in still starts from the goal's own `computed_at` — a course "starting
in 10 years" keeps counting from when it was first worked out, not from the day of the upgrade — but a v1 goal carries
no birthday, and §10's rule for that case is not waived here: a level's year falls on **1 January**, so upgrading
education v1 moves every stage's due date onto 1 January of its year, earlier than the day of the year `computed_at`
itself fell on. That is the conservative direction — the goal is asked to save sooner, never later — and it is
recorded in the upgrade's own ledger rather than left to surprise a reader of `dueOn`. **Silently, and only if the
figure changes** (provisional ruling, 2026-09-21): a goal whose stages and growth come out the same is only stamped
`version: 2`. A goal whose target the user typed by hand has no `goal_calculators` row (typing breaks the link), so it
is never touched:

- **education v1** (`feeTodayMinor`, `startsInYears`, `yearsOfStudy`, `feeInflationBps`) becomes one level named
  "Course" in calendar years, with one yearly fee, its due dates falling on 1 January per §10. The goal's own return
  becomes the course's **typed** return (§8: a saved return is never rewritten), so no band replaces it. Its stages
  keep their ids and paid marks by matching: by `derived_key` where the goal has keys; without keys, the same name and
  day first, then the same name, then date-order position only when the counts are equal. A paid or drawn stage the
  working no longer asks for is kept (§10);
- **retirement v1** keeps the goal's own return as the return while saving;
- **education v2** (user decision, Q8): re-read on every open from that day, only to move the band of a level whose
  return was never typed. A level's band is always read from **today** (months left from today), never from the day
  the working was first done — so the upgrade is idempotent: running it twice changes nothing;
- **emergency v1** gets growth 0%;
- **retirement v2 and emergency v2 are never revisited**: their dates count from the day they were worked out.

The upgrade runs over **every workspace**, not only the one open (ruling, 2026-09-21); one workspace failing stops
neither the others nor the app.

Nothing else about the goal — name, rank, standing amount, set-asides, tags — is touched.

## 10. The education fund

(Education-fund mockup, "Your changes".)

- **A birthday, asked once** on the goal. Optional.
- **Levels, named by the user.** Offered names, in order: Preschool, Primary School, Middle School, High School,
  University — each editable, added with **+ Add a level** when the user is ready. Nothing assumes six stages or any
  country's school system.
- **When**: with a birthday, a level is "starts at 6, until 12" and the calendar years are shown underneath; without
  one, "starts in 2032, until 2038". The length is the difference — there is no "lasts" field. What is stored is the
  age pair or the year pair, never "in N years", which goes stale. A level's year *i* is due on the day the child
  turns (start age + *i*), or on 1 January of (start year + *i*).
- **Fees per level, named by the user**, with Enrollment (once), Academic (every year) and Other (once) offered. Each
  fee carries **once at entry** or **every year**, and that flag is load-bearing: a once fee is in the level's first
  year only; a yearly fee is in every year of the level. Each year is one stage, in today's money; the goal engine
  inflates each to its own date at the goal's fee inflation (10% prefilled).
- **A return per level**, prefilled from the band for the months until the level starts, editable. Stored per stage
  (`goal_stage_terms.return_bps`); `goalPlan` uses a stage's own return where it has one, else the goal's.
- **Adding a level raises the target and never resets progress.** Progress is what funds the goal (tags and
  set-asides), which a level does not touch; a stage that was already there keeps its id and its paid mark.
- **A paid or drawn stage the working no longer asks for is kept** (set-aside merge ruling): a re-work never deletes a
  stage with a paid mark or a `goal_draws` row naming it, and a hand edit that removes a drawn stage is refused, so
  `goal_draws.stage_id` never dangles.
- **Monthly tuition stays out.** The editor's footer says it: monthly fees belong in the budget, not a fund.

Worked example (mockup): uang pangkal Rp 45 juta once and Rp 20 juta a year for 6 years, starting in 6 years, 12%
fee inflation — the once fee is Rp 88.822.021 when paid, the six yearly fees Rp 320.358.885 in total, not the
Rp 236.858.722 the workbook's start-year shortcut gives.

## 11. Life cover

A calculator on the Calculators page — not a goal, since cover is bought, not saved for. **Capital needs analysis**:

```
cover = PV(yearly family need, years of support, inflation, return)
      + debts to clear + education still to fund + final expenses
      − liquid assets − cover already in force
```

- The income need is the same real-rate annuity retirement uses (one function, §9.2).
- **Prefilled**: debts from the balance sheet's liabilities; liquid assets from its liquid group; education from the
  unpaid stages of education goals in today's money; inflation 3.5%; return 5% (the drawdown figure: the money is
  being spent down). Final expenses and cover in force (employer group cover included) start empty.
- The terms are summed signed, then clamped: when resources exceed needs, the answer is "no further cover needed",
  with the surplus shown, never a negative figure.
- Each line of the working is shown, then the total. The footer names the method and its sources (CFP Board lists
  capital needs first among the methods; the Insurance Information Institute advocates it and rejects income
  multiples for assuming no inflation) — names only, no links fetched.
- **Not built:** the workbook's lowest-of-four-methods and its after-the-fact "− assets + debts" (which double-counts on
  a needs-based result); any rounding down to a round number; a critical-illness or accident rider calculator — no
  published sizing rule exists; any income multiple; any country-specific benefit offset.
- **The figures are remembered** (user decision, 2026-09-21; storage ruled 2026-09-21): "Keep these figures" stores what was typed in 0053's own `calculator_inputs` table (`workspace_id`, `kind` = `life_cover`, `inputs_json`, `updated_at`), guarded by `healthTablesExist` — not a reserved `goal_calculators` row, so no goal reader has anything to skip. A prefilled box never typed in is not stored, so it keeps following the balance sheet. No goal is made. A prefill whose accounts include a currency with no rate yet is not offered: the row says which currency and asks for the figure, rather than counting those accounts as nothing.

## 12. The workbook's four bugs — none inherited

| Workbook bug | How this design avoids it |
|---|---|
| Gold outside total assets (`G22 = SUM(G24:G26)`) | Totals come from `balanceSheet`, which sums every account; the life-cover prefill and the net-worth page both read it through `ratioTotals`, whose five totals come from `sheetTotals` alone, and both take the currencies with no rate from the balance sheet's own `missing` |
| Jewellery outside the gold total (`G66 = SUM(G63)`) | No hand-listed rows anywhere; every total is a fold over accounts |
| Weekly ×4 in one column, ×52/12 in another | One conversion table (`perMonthMinor`), 52/12 and 365/12; tests fail on ×4 and ×30 |
| Retirement PMT with −1 outside the power | Every monthly figure goes through `monthlyNeededMinor` (`r·gap / ((1+r)^n − 1)`); nothing new writes its own annuity |

## 13. Storage — migration 0053 (`health_ratios`)

Four side tables, all `CREATE TABLE`, no backfill, no change to an existing table:

| Table | Row | Absent means |
|---|---|---|
| `category_needs` | `category_account_id` PK, `workspace_id`, `need` ∈ {essential, lifestyle} | no mark of its own |
| `budget_frequencies` | `budget_id` PK, `workspace_id`, `frequency` ∈ {daily, weekly, quarterly, yearly}, `amount_as_set_minor` > 0 | monthly |
| `goal_stage_terms` | `stage_id` PK, `workspace_id`, `goal_id`, `return_bps` (nullable, ≥ 0), `derived_key` (nullable) | the goal's return; not derived |
| `calculator_inputs` | (`workspace_id`, `kind`) PK, `kind` (`life_cover`), `inputs_json`, `updated_at` | nothing remembered; every box prefilled (§11) |

Every read and write goes through `healthTablesExist(db)`, a `WeakMap<Db, boolean>` guard like `extrasTablesExist`. On
a database without them: no marks (everything essential), every budget monthly, no stage returns — which is today's
behaviour.

## 14. Testing

- **Pure (core)**: every matrix cell; `perMonthMinor` against ×4 / ×30 / floor, in IDR and USD cents, with a half
  that rounds up; `needOf` inheritance; `emergencyOutgoingMinor` both ways; `fitByRank` compulsory-first; the four
  band boundaries (12/13, 36/37, 60/61); the no-18% assertion; `presentValueOfYearsMinor` at equal and unequal rates;
  retirement today × inflation = retirement target; the education worked example through `goalPlan`; per-stage
  return; life cover with resources above and below needs.
- **Repository (db)**: 0053 on a database stopped at 49; marks set, inherited, refused, copied with a workspace;
  `lifestyleSpendingMinor` with a refund and an excluded row; frequencies saved, read, cleared, refused at zero, on a
  USD workspace; emergency goal on each base; a level added keeps progress and paid marks; the v1 upgrade.
- **End to end**: chromium and phone, per task; and one task that walks the combinations (§15) with inputs typed
  key by key.

## 15. Combinations to walk end to end

Base (essential/all) × a lifestyle mark (own/inherited/none) × emergency goal (typed/derived); frequency (each of five)
× currency (IDR/USD workspace) × "just this month"; compulsory/additional × move up/down across the boundary; education
level with birthday / without, once / yearly fee, return typed / prefilled, a level added after a stage was paid; life
cover with resources above / below needs.

## 16. Out of scope

- The budget page's stacked "saved · needed · wanted · left" band from the mockup (Open question 3).
- Donation as a first-class group; the workbook's fixed category list; its typed balance sheet; its one-instrument
  goals; its income-based emergency route.
- Converting `GoalForm` to the native kit (only its return logic changes here).
- Any figure on the tax report.

## 17. Open questions

1. ~~Default for the emergency base~~ — **user decision 2026-09-21:** essential, and an unmarked category counts as
   essential.
2. ~~Pre-marked default categories~~ — **user decision 2026-09-21:** no; default categories start unmarked.
3. **The stacked band on the Budget page** is a new visual treatment, which the kit does not have. Built as rows
   (Essential spent, Lifestyle spent) until the kit decides.
4. ~~The emergency template's return~~ — provisional ruling 2026-09-21: keep 2%, outside the horizon bands.
5. ~~The emergency ratio card's guide~~ — **user decision 2026-09-21 (flipped):** it grades against the household's own months (§3.3).
6. ~~Upgrading existing derived goals~~ — provisional ruling 2026-09-21: silently, only when the figure changes, never
   a hand-edited target (§9.4).
7. ~~The calendar-year fallback~~ — provisional ruling 2026-09-21: 1 January, and the level's row subtitle says so.
8. ~~A level's band on open~~ — **user decision 2026-09-21:** yes; on open, a level whose return was never typed
   re-reads its band for the months left until it starts. A typed return is never touched.
9. ~~Remembering life-cover inputs~~ — **user decision 2026-09-21:** yes; storage ruled the same day: 0053's own
   `calculator_inputs` table, not a reserved `goal_calculators` row (§11, §13).
10. ~~`computed_minor` for retirement now in today's money~~ — accepted: nothing outside the repo reads it.
11. ~~v1 education's years move to 1 January~~ — **ruled 2026-09-21: accepted** (the user has no real data yet); §9.4
    amended to say so.
