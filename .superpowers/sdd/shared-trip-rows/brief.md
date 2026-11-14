# Shared trip: history rows look like the private trip's (owner request 2026-11-14)

Mockup of today: docs/mockups/2026-11-14-trip-private-vs-shared.html.
Owner: shared trip transaction list has a different font and icon size; make it follow the private trip's transaction list design.

- Private (EventDetailPage.tsx) draws history with `TransactionRow` inside a day `Panel`. Shared (SharedEventPage.tsx, day.items loop) uses `InsetRow` with 16px glyphs.
- Make the shared rows (expense, settlement, transfer) use the same row look as TransactionRow: same icon circle size, title/subtitle/amount fonts, padding, separators, day card header. Reuse TransactionRow if it can take a shared expense; otherwise extract its presentational part into a shared component used by both (private must look identical to before).
- Content mapping for a shared expense, following the private order: title = category name (Other when none); subtitle = place/description · who paid (+ existing flags, e.g. split); amount right; under the amount = own share (today's `row.share`), in the slot where private shows the foreign amount. Settlement and ATM transfer rows: same look, keep today's text/colours (transfer grey, not counted).
- Keep every tap target and lock rule as today (expense opens edit unless voided/locked; settlement sheet; transfer opens its transaction).
- UI only. No "you"/"your". Invented fixtures. Update e2e selectors if needed (shared-expense-row etc. test ids must stay). tsc web, vitest events, affected Playwright specs (shared events). Screenshot private vs shared day card at 390px into docs/mockups.
