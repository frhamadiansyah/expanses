# Funded by row: tap = Set aside, › = account (owner chose C1, 2026-11-14)

Mockup: docs/mockups/2026-11-14-funded-by-both-taps.html, column C1. Context: 2026-11-14-funded-by-tap-options.html (B = the sheet state).

- Goal page Funded by (apps/web/src/features/goals/funding.tsx, funding-lines.ts, GoalPage.tsx). Applies to this phone's own SET-ASIDE (earmark) lines only:
  - Row body tap (icon, name, amount) → opens the Set aside sheet (SetAsideSheet) with that account's row focused: cursor in its amount, keyboard up, bar showing (row is in "In <goal>" group). Needs a `focusAccountId` (or similar) prop on SetAsideSheet; focus must happen inside the tap gesture on iOS if possible (see app/Sheet.tsx lockedFieldOf note — iOS only raises the keyboard for a focus made during the tap; the Set aside sheet is not `tall`, so no lock; if focusing on open can't raise the keyboard on iOS, focus anyway and report).
  - A separate › button at the right edge: own ~34–44pt tap area, thin hairline before it, accessible name "Open <account name>", opens the account page as the row does today.
- Multicurrency parent row: body tap keeps toggling ▾ open/closed; its › opens the parent account page. Currency sub-row: body tap → Set aside focused on that pocket; its › → that pocket's account page.
- Tagged purchases / holdings (Gold etc.) and other members' lines in shared goals: unchanged (whole row as today, normal chevron or none).
- Every row stays one line.
- UI only. No "you"/"your". Invented fixtures.
- Tests: e2e (phone + desktop): tap row body → sheet open with that row's input focused; tap › → account page; multicurrency sub-row both ways; Gold row unchanged. Update goal-funded-by.spec and any spec that clicked a Funded by row expecting the account page. tsc web; vitest goals. Screenshot 390px into docs/mockups.
