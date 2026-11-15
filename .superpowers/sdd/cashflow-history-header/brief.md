# Cashflow "Transaction history" header (owner-approved 2026-11-15)

Mockup: docs/mockups/2026-11-15-cashflow-history-one-button.html (the "After" states ①–④). Render first. Before = today's header in apps/web/src/features/transactions/TransactionsPage.tsx (~line 1572: GROUP_HEADER_CLASS label, Group by box, Select box, Sort/Paid-with box).

- Title: "Transactions", 20px bold, normal case, ink, left; vertically centred with the boxes (replaces the caps "Transaction history" label). Same on desktop widths at its proportional size.
- Keep the grey Days | Categories box exactly as today.
- Replace the Select box and the Sort/Paid-with box with ONE grey square of the same kit (32x28 in the slate track), glyph ⋯ (lucide Ellipsis/MoreHorizontal), label "More".
- Tap ⋯ → one native-looking menu (reuse the app's ActionMenu / menu component the sort box uses today): "Select" (row, starts select mode), separator, "Sort" section with today's sort choices (✓ on current), separator, "Show": "Paid with" (opens today's Paid with sheet/menu, value shows current: All / account name), "Transfers" (today's show-transfers toggle, ✓ when on). Keep every option that exists today in the sort/Paid-with menu — none dropped; if an option exists that isn't listed here, keep it in the matching section.
- When any non-default sort or filter is on: a small blue dot on the ⋯ square (top-right). No chips.
- Select mode: exactly today's behaviour and look: the square shows today's dark CircleCheck square (tap it to stop selecting), today's ticks and today's top bar. When select mode ends, the square goes back to ⋯.
- Read-only workspaces: Select item absent (as today Select box is hidden when readOnly); list view rules as today (Select only in list view).
- UI only. No "you"/"your". Invented fixtures.
- Tests: update e2e that click the old Select / Sort buttons (grep aria-label "Select", "Sort", "Group by", Paid with on Cashflow) to go through ⋯. New e2e: menu items, dot appears with a filter/sort and disappears when reset, select mode via menu and stop via dark square. Phone + desktop. tsc web, vitest transactions. Screenshot 390px into docs/mockups.
