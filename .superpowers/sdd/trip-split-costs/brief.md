# Shared trip: Split costs + Plan switches, ＋/⚙, Settings page (owner-approved 2026-11-14)

Mockup: docs/mockups/2026-11-14-trip-split-costs-off.html sections 1–5. Render first. Context: docs/mockups/2026-11-14-trip-private-vs-shared.html.

## Behaviour
- Two trip-wide settings on a SHARED event, same on every phone: `splitCosts` (bool) and `planOff` (bool).
- Split costs OFF ("one pot"):
  - Add/edit spending form (SharedExpenseCard etc.): no Split row. Expenses recorded with a split that puts the whole amount on the payer (so balances stay 0 and existing maths need no change) — verify with core shared-events split maths; if a cleaner representation exists, report before using it.
  - Trip page: no Balances card, no settle-up rows/sheets, no "share …" under amounts; row grey line "place · <payer> · <paid-with account name if known on this phone>".
  - Turning OFF while any balance ≠ 0: confirm sheet "Stop splitting costs?" with the owed line; existing expenses keep their splits (stored), only hidden; turning back ON shows them again. Balances while off: hidden (not recomputed).
  - Default when a shared event is created: OFF if the only other people are household members (the partner); ON otherwise. Existing shared events: ON (unchanged).
- Plan OFF on a shared trip: Plan card and its ＋ hidden.
- HeroSwipe slides: Spending always; Balances only if split on; Plan only if plan on. One slide: no dots, no swipe.
- Top bar: ＋ (Add spending) and ⚙ (Settings) like the private event; remove ⋯.
- New shared trip Settings page (route like /events/$eventId/settings for shared): Split costs + Plan switches (footer "Split costs off: one pot, no shares or settling up."), People ›, Categories ›, "Mark as done"/"Reopen" action, "Leave <name>" red last (today's leave rules: disabled when balance not zero, with detail), Delete copy for read-only. Read-only / locked states as today. Match the private Settings look being redesigned in parallel (feat/event-settings-redesign: headers, footers, action rows); don't edit EventSettingsPage.tsx.

## Data / sync (allowed in this drop)
- New migration 0116 for the shared event fields (check main's latest migration first). Synced through the existing shared-event record/log path so both phones agree; last-writer-wins like other event fields. Older app versions: unknown fields ignored; note in report what an old phone shows (it will still show splits — acceptable, owner told both phones update together). Add a version gate if the codebase has a pattern for it (see TRIP_TRANSFERS_MIN_APP_VERSION).
- Never lose existing splits.

## Rules / tests
- No "you"/"your". Invented fixtures only. Never bare git stash. Commits end with the Co-Authored-By line.
- Tests: core/db unit tests for the setting sync (two phones), split-off expense maths (balances 0), default on create; web unit for slide list; e2e (phone + desktop) for switch off/on, confirm when owed, add form without Split, Settings page, ＋/⚙. tsc core/db/web; vitest db sync + web events; affected Playwright. Screenshots 390px into docs/mockups.
