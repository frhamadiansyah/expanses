# Private event settings redesign (owner-approved 2026-11-14)

Mockup: docs/mockups/2026-11-14-event-settings-redesign.html — "After" section. Render it first.

- File: apps/web/src/features/events/EventSettingsPage.tsx (+ EditEventForm.tsx, which goes away from this page; keep it only if something else uses it).
- Top bar: back "‹ <event name>" to the event page (not Events list); title "Settings".
- No edit mode. Rows edited in place, each change saved at once (debounced/blur for Name; on change for dates; sheet pick for Currency / Categories):
  - Header EVENT: Name (TextRow, typed in place), Starts on, Ends on (date rows).
  - Header MONEY: Currency (opens CurrencySheet), Categories (opens a picker of sets incl. "The monthly categories"). Footer: "Categories stay once something is tagged or planned. Currency stays once something is bought." Locked rows: no ›, value grey, not tappable (same locks as today: setLocked / currencyLocked).
  - Plan switch; footer "A list of what to buy, and the "Against the plan" page."
  - Shared with <name> switch (today's behaviour); footer "On: <name> sees the event and adds to it." (or today's "Share this event" row when no household).
  - "Mark as done" action row (tint) with footer "Moves <name> to Past. It can be reopened."; when finished: "Reopen", footer "Done on <d MMM>. Reopening moves it back to Now and next." (uses finishEvent).
  - "Delete event" (red) last, footer "Its transactions stay where they are." Keep today's confirm.
- Validation: empty name not saved (keep last good name); ends before starts refused with today's error.
- UI only, no DB change. No "you"/"your". Invented fixtures.
- Tests: update e2e that use edit-event / settings-* test ids (keep test ids where possible: settings-name, settings-plan, settings-share, settings-delete; settings-done becomes the action row). tsc web, vitest events, affected Playwright specs (phone + desktop). Screenshot 390px into docs/mockups.
- Another agent builds the SHARED trip's new Settings page in parallel (feat/trip-split-costs); keep row components reusable (e.g. export the group pieces) but do not touch SharedEventPage / shared settings.
