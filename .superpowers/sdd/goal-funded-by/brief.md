# Goal page: Funded by, one row per account — brief (owner-approved 2026-11-14)

Mockup: `docs/mockups/2026-11-13-goal-funded-by.html`, section 1 ONLY ("After · closed" and "After · opened"). Render it first. Section 2 (Set aside) is NOT approved — do not touch the Set aside sheet.

## What changes
- Today: GoalPage "Funded by" lists one FundingRow per link; a multicurrency account's currencies (pockets) each appear as separate rows mixed with other accounts.
- After: one row per account. A multicurrency account = one parent row: name + ▾, value "≈ Rp …" = sum of its currency links converted to the goal's currency, subtitle "n currencies" (or a warn subtitle "1 currency short" when any currency is short). Tap toggles open: its currencies as indented sub-rows (currency code left; amount in its own money with goal-currency figure under it; "short by …" in warn colour). Tapping a sub-row does what tapping that FundingRow does today.
- Single-currency accounts: unchanged row, subtitle says what kind ("Set aside" / "Tagged purchase", whatever FundingRow already says — keep existing captions, don't invent new data).
- Section header shows total on the right (the funded total already computed for the goal), if not already shown.
- Shared goals (sharedGroups per member): same grouping inside each member's group.
- Keep order stable (first appearance order). Unconverted (no rate) currency: parent shows "≈" of what converts, keep today's unconvertedWarning line.

## Rules
- UI only; no DB/sync change. If grouping needs data not available (how a pocket knows its parent account — see ItemSummary.pocketOf / account parent fields), find the existing field; if none, stop and report.
- No "you"/"your" in copy. Invented fixtures only.
- Tests: unit test for the grouping model (pure function: links -> rows with children, totals, short flag, shared groups); e2e or component test for tap to open. tsc packages/db + apps/web; vitest web goals. Fix nothing unrelated.
- Commit on feat/goal-funded-by in .worktrees/goal-funded-by. Do not merge to main; report back with commit list, test output, and a screenshot of closed/opened state if feasible.
