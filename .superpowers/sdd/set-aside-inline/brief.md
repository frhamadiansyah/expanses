# Goal Set aside: typed in the list (owner-approved 2026-11-14, option A)

Mockups (render both first):
- `docs/mockups/2026-11-14-set-aside-free-look.html` section A = the approved list look.
- `docs/mockups/2026-11-14-set-aside-inline-form.html` = the flow, the bar above the keyboard (three-slot look), too-much, change, foreign currency. Its "free" text in rows is SUPERSEDED by the free-look A (no word "free" in rows).

## The sheet (SetAside.tsx: SetAsideSheet / SetAsideGroup / useSetAside)
- Opened by the goal page's Set aside button and the "＋ Set aside" row (as today). No second screen, no AccountChooser, no "＋ Set aside" row inside the sheet, no ⓘ info popups.
- Two groups:
  1. "In <goal name>": every account with an earmark for this goal, amount in black (ink), same "Rp …" format. Shown even when it has nothing free.
  2. "Can add" (header right: "Free"): eligible money accounts (MONEY_SUBTYPES, as today) with room > 0 and no earmark here, showing their free room in light grey (placeholder colour), same "Rp …" format so digits line up. Sorted most free first (compare in goal currency where a rate exists; else keep order). Accounts with nothing free and not in the goal: not shown.
- Every row ONE line: icon, name left, amount right. No boxed input look: the right side is a borderless right-aligned input (like the Amount row in Add transaction); empty input shows the grey free figure as placeholder.
- Multicurrency account: parent name row (no amount) with its currency pockets as indented sub-rows (code left, amount right) — inside whichever group each pocket belongs; repeat the parent row in both groups if its pockets split.
- Tap a row: focus its input (cursor), name turns tint colour, system decimal keyboard. A row typed into stays in its group/place until the sheet closes.
- Bar pinned directly above the keyboard (three slots, like iOS suggestions), for the focused row:
  - New row: [min(free, still needed) · "All free" (label "Fills goal" when capped by still needed)] [half of that · "Half"] [goal still needed, live as typed · "still needed", info only]. For a pocket whose currency ≠ goal currency, slot 3 = "≈ Rp … · this adds" instead. Never show ≈ when currencies match.
  - Row already in the goal: ["Most possible" = in + free] ["Rp 0 · Take back"] [still needed].
  - Over the limit (typed > room): amount text warn colour; bar becomes one slot, warn: "Only <room> free · tap to use it" (tap fills room).
  - Tapping a slot fills the input.
  Find how the app already pins things above the keyboard (e.g. the One line dock, visualViewport / @capacitor/keyboard usage) and reuse it. Do NOT draw a custom number pad.
- Save: disabled (grey) while ANY row is over its room. Empty or 0 on an in-goal row = take back (removeEarmark), as setAsideWrites already does.
- Goal form (new goal) uses SetAsideGroup too: apply the same list there if it fits naturally; if it would need a different design, keep the form working and report.

## Rules
- UI only; reuse roomFor / useSetAsideViews / useBalances(isoDate()) / setAsideWrites. No DB/sync/migration change; stop and report if needed.
- No "you"/"your" in copy. Invented fixtures only. Funded by row taps stay as they are (owner not decided).
- Tests: unit tests for the pure model (grouping, sort, placeholder, bar slots incl. cap/half/≈/over/most possible/take back, Save blocked). Update e2e (set-aside*.spec.ts, set-aside.ts helper, set-aside-journeys.ts, phone-set-aside, goal-form specs) to the new sheet. tsc packages/db + apps/web; vitest web goals; affected e2e. Screenshots of at-rest, typing with bar, over-limit at 390px into docs/mockups.
