# Essential · Lifestyle · Debts & savings (owner-approved 2026-11-16)

Mockups: docs/mockups/2026-11-16-elf-income-page.html (option A = Cashflow Income page 2) and docs/mockups/2026-11-16-nws-additions.html (B Budget box, C Health card). In mockups the third word is "Future" — the approved word is **"Debts & savings"**.

## The figure (one pure function in packages/core, unit-tested, used by all three places)
- For a period: income (what Cashflow counts as income, own transfers excluded as Cashflow already does), Essential spending and Lifestyle spending (each category's existing Essential/Lifestyle mark via resolveNeeds; unmarked = Essential, same rule as budget/sheet.ts and health), Debts & savings = income − Essential − Lifestyle.
- Spending = what Cashflow counts as spending for that period (same exclusions/event rules as the Expense ring — reuse its query; do not invent a second definition). Refunds net against their category as everywhere else.
- Shares are of income. Debts & savings may go negative (spent more than earned): show it as a negative amount in warn colour and its share as 0% of the bar with a short line "Spent Rp … more than earned". Income 0: show amounts only, no percentages, no bar.
- Guide 50 / 30 / 20 (Essential / Lifestyle / Debts & savings), shown as faint marks / guide text. Not configurable in this drop.

## 1. Cashflow — Income side, page 2 (option A "This month")
- Income keeps page 1 (ring). Income page 2 (today the income trend bars) is REPLACED by: "Where Rp X went", one 3-part bar with faint 50/30 marks, three rows (Essential %, amount · Lifestyle %, amount · Debts & savings %, amount), "Guide: 50 / 30 / 20". Expense side unchanged (ring + its bars).
- Tap Essential or Lifestyle row → filters the transaction list to that group (like a ring slice filter; reuse the filter mechanism; Debts & savings row not tappable). Month switcher drives it.
## 2. Budget — one box added, layout otherwise unchanged
- Between "Left to spend" and the Budgeted list: header "Essential · Lifestyle · Debts & savings", three rows with bars "Rp used of Rp planned". Planned Essential/Lifestyle = sum of caps of categories with that mark; planned Debts & savings = month's income (planned income if Budget has one, else actual income so far) − planned Essential − planned Lifestyle. No caps at all → show actual amounts only (no "of"). Over plan → warn colour. Existing ⋯ "Essential and lifestyle" sheet stays.
## 3. Financial health — one card added after "Savings ratio", layout otherwise unchanged
- Same card style as the others: title "Essential · Lifestyle · Debts & savings", value "55 · 29 · 16" (percent of take-home pay over the page's chosen period: Last 12 months / year), "Guide: 50 · 30 · 20", 3-part bar, explanation line. Status: ON TRACK when Debts & savings ≥ 20%, else the page's existing middle/bad wording by the same thresholds style the other cards use (look at Savings ratio's grading and mirror it).
## Rules
- UI + read-only queries; no DB/sync change. No "you"/"your". Invented fixtures. Category Essential/Lifestyle marks untouched.
- Tests: core unit for the figure (marks, unmarked, refunds, negative, zero income); web unit for each view model; e2e phone+desktop for Cashflow Income page 2 (+filter), Budget box, Health card. tsc core/db/web; vitest affected. Screenshots 390px into docs/mockups.
