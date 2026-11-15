# Month starts on (owner-approved 2026-11-16)

Mockup: docs/mockups/2026-11-16-month-starts-on.html — ONLY section 1 ("Where it is set") is approved as UI. Section 2 is NOT wanted: Cashflow / Budget month switchers and month pickers keep their CURRENT design (no date line under the month name, no new period list). Section 3 describes behaviour and stands.

## Setting
- Account › <workspace> settings: row "Month starts on" (value "1st" … "28th" / "Last day"), under Currency, footer "November is 25 Oct – 24 Nov. Cashflow, Budget, bills and reports all use it." (computed from the chosen day).
- Picker page: grid of days 1–28 + "Last day of the month"; footer lines showing this and next period with dates; "1" = calendar month as today. Default 1 (no behaviour change for anyone who never sets it).
- Per workspace. In a SHARED workspace (Family) both phones must use the same value: store/sync it with the workspace's other synced settings if such a path exists; if it needs a new sync field or migration, design it (next migration number after main's latest) with a version gate like TRIP_SWITCHES_MIN_APP_VERSION, and report before building if risky.

## Behaviour (everywhere a "month" is shown)
- A period with start day d: from d of the previous month to d−1 of the named month; named after the month most of it falls in (d=25: "November" = 25 Oct – 24 Nov). "Last day": from the last day of the previous month to the day before the last day of the named month (Nov = 31 Oct – 29 Nov; Mar = 28 Feb – 30 Mar). Clamp days to short months.
- One core function (packages/core) maps (workspace start day, month key) → [from, to] and date → month key; unit-test edge cases (Feb, leap year, 29–31, d=1 identity, year boundary: d=25 "January 2027" = 25 Dec 2026 – 24 Jan 2027).
- Use it in: Cashflow month, Budget month (caps, left to spend, days left), Essential · Lifestyle · Debts & savings, recurring bills' "this month" grouping (a bill keeps its due day, counts in the period its date falls in), Financial health monthly figures, reports and any "this month" summaries (grep for month-key helpers like monthOf / startOfMonth / slice(0,7) used for grouping).
- Unchanged: card statement cycles, loan schedules, goal due dates, transaction dates. Changing the setting never edits data; only regroups.
- UI copy: no "you"/"your". Month switcher look unchanged.
- Tests: core unit; db/web tests for Budget and Cashflow totals with d=25; e2e set 25th then check Cashflow/Budget totals include 25 Oct and exclude 25 Nov for "November"; shared workspace two-phone test if synced. tsc core/db/web.
