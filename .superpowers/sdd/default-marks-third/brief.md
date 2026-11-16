# Default Essential / Lifestyle marks + third mark "Debts & savings" (owner-approved 2026-11-16)

## Default marks (no data written)
Implement as a code-level fallback by category systemKey, NOT by writing marks: resolution order = own stored mark > nearest ancestor's stored mark > DEFAULT by systemKey (own key, then ancestor keys) > essential. So existing data is untouched, nothing syncs, and any mark the owner set wins.
- Lifestyle: food_beverage.takeaways, food_beverage.restaurants, food_beverage.cafe_dessert, personal_care (+children), entertainment (+children), shopping (+children), gift_giving (+children), travel (+children).
- Debts & savings: protection (+children), donation (+children), miscellaneous.interest.
- Essential (explicit default, same as unmarked): utilities, household, transportation, property, health_care, education, government_taxes, miscellaneous (rest), food_beverage.home_catering, food_beverage.school_catering, business.
- Check exact child keys in packages/core/src/categories/defaults.ts (children(...) helper builds them).

## Third mark 'debts_savings'
- CategoryNeed becomes 'essential' | 'lifestyle' | 'debts_savings' (core budget/needs.ts). Category › Spending picker (apps/web/src/features/categories/NeedRow.tsx) offers Essential / Lifestyle / Debts & savings.
- Storage: the need column has CHECK (need IN ('essential','lifestyle')) (migration 0053). Add the value with a migration (number: next free after main's latest AND after 0117 (income-categories branch) AND 0118 (reserved for month-starts-on) → use 0119; SQLite needs a table rebuild for a CHECK change — copy rows faithfully, keep ids/clocks).
- SYNC SAFETY (critical): find whether category needs sync between phones. An older app's table would reject 'debts_savings' by its CHECK → its sync must not break. Gate sending/applying a 'debts_savings' mark behind a version gate (pattern: TRIP_SWITCHES_MIN_APP_VERSION / repair R5 in 0116): until every device in the shared book is at the new version, either don't send that mark or make the old-phone path ignore it safely; resend when peers are ready. If the needs table doesn't sync, say so. Prove with a two-phone db test incl. an old-schema peer. If this can't be made safe, stop and report before building.
## Where the third mark counts
- Essential · Lifestyle · Debts & savings split (packages/core/src/budget/essential-split.ts): spending in categories resolving to debts_savings is NOT Essential or Lifestyle; Debts & savings = income − Essential − Lifestyle (unchanged formula — it naturally includes that spending plus what was not spent).
- Budget box (needsPlan / capsByNeed): caps of debts_savings categories feed the Debts & savings plan side as spending planned there; keep it simple and say how.
- Budget ⋯ "Essential and lifestyle" sheet and budget/sheet.ts essential/lifestyle totals: handle the third value (not counted as lifestyle; show a third line if the sheet lists both).
- Financial health emergency fund ('essential' base): count debts_savings-marked spending together with essential (insurance, donations and loan interest continue in an emergency). Note this in the report.
- Cashflow Income page 2 filter: Debts & savings row stays not tappable (unchanged).
## Rules / tests
- No "you"/"your". Invented fixtures. Never bare git stash. Commits end with the Co-Authored-By line. Do not merge to main.
- Tests: core resolve (own > ancestor > default-by-key > essential; owner override of a default; renamed categories keep key-based default), split with third mark, health base; db migration (rebuild keeps rows), two-phone sync incl. old peer; web NeedRow; e2e set a category to Debts & savings and see Cashflow Income page 2 move it. tsc core/db/web; affected vitest; affected e2e.
