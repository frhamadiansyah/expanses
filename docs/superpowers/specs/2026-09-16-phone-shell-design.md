# Phone shell design

**Date:** 2026-09-16
**Phase:** 1 of 5 on the road to the App Store, Play Store and Mac App Store
**Mockup:** https://claude.ai/artifact/G2hfVvBt415QL6DMmzV6nM

## Why

Expanses will ship as a native app on iOS, Android and macOS — never as a mobile website. One
responsive React app, wrapped by Capacitor for iOS and Android and by Mac Catalyst for the Mac App
Store. Every wrapper but Electron runs the same WKWebView, so one codebase serves all of them.

The app is desktop-first with a single `md:` breakpoint bolted on. On a phone today:

- The bottom bar carries **ten tabs at 39px each** with 11px labels ([Layout.tsx:87](../../../apps/web/src/app/Layout.tsx)).
- **Six screens have no route at all**: Review, Calculators, Tax report, Which card?, Import CSV and
  Backup live only in the desktop sidebar, which is `hidden md:block`.
- Nothing accounts for the notch. `viewport-fit=cover` is set, so content runs under the status bar;
  the only safe-area handling in the codebase is `padding-bottom` on the bottom nav.

This phase fixes the shell. Touch targets, input sizes, hover-only controls and the wide tables are
phases 2 and 3; the native file seams and the wrappers are phases 4 and 5.

## Scope

**In:** the tab bar, the More sheet, the phone header, safe areas, a 390px test project, and the
house rules every screen follows from here. Plus one worked example — the statement band — to prove
the rules on the screen most recently built.

**Out:** touch-target and input sizing across the app, `window.prompt` removal, phone views for wide
tables, native filesystem, Capacitor. Each is its own phase.

## Design

### 1. The tab bar

Four tabs and a centre button, replacing the current ten:

| | Tab | Route | Why |
|---|---|---|---|
| ⌂ | Home | `/` | The overview: owed, due, spent |
| ▤ | Cards | `/cards` | Statements, points, what is due |
| **+** | *(action)* | — | Opens the transaction form as a sheet |
| ◴ | Spending | `/spending` | Where the month went |
| ⋯ | More | *(sheet)* | Everything else |

The **+** is an action, not a place: it opens the existing transaction form in a bottom sheet over
whatever screen you are on, and dismisses back to it. A purchase gets recorded where it happens, so
it must never cost more than one tap.

Net worth loses its tab and moves into More. Transactions loses its tab too: the list is reached from
Home and from the + sheet's "see all" — a phone user reads a card's statement far more often than the
raw ledger.

The bar is `fixed`, `md:hidden`, and its height is `50px + env(safe-area-inset-bottom)`. The desktop
sidebar is untouched: above `md` the bar is not rendered at all.

### 2. The More sheet

A bottom sheet, not a page, so dismissing returns you where you were. Grouped, with every screen that
has no other phone route:

```
KEEP IT SAFE   Backup (with the date of the last one) · Import CSV
MONEY          Budget · Events · Goals · Accounts · Categories · Net worth
CARDS          Which card? · Merchants
WORK IT OUT    Review (with its pending count) · Calculators · Tax report
```

Backup leads because on a phone it is the only safety net, and the date is the one fact that says
whether you are covered. Review keeps the count badge it has in the sidebar today.

Rows are 48px tall with a chevron. The sheet closes on backdrop tap, on the grabber drag, and on
choosing a row.

### 3. The phone header

Every screen gets a compact header: title on the left, at most two icon actions on the right, sitting
below `env(safe-area-inset-top)`. It replaces the desktop `h1` on phone only; above `md` nothing
changes. Screens that need a search field pin it under the header rather than in the scrolling body.

### 4. Safe areas

- Header: `padding-top: env(safe-area-inset-top)`.
- Tab bar: `padding-bottom: env(safe-area-inset-bottom)` (already present).
- Scrolling body: `padding-bottom` of tab-bar height plus the inset, so the last row clears the bar.
- Side insets on landscape: `padding-inline: env(safe-area-inset-left / right)` on the app shell.

### 5. House rules from here

Every screen touched from now on, whether or not it is part of a phase:

1. **No horizontal page scroll at 390px.** A wide table may scroll inside its own container; the page
   body may not.
2. **44px minimum for anything tappable.** Icon-only buttons get an explicit size, not padding luck.
3. **16px minimum font on inputs.** Below that iOS zooms the viewport on focus and the layout jumps.
4. **Nothing hover-only.** No `title=` carrying information available nowhere else, no
   `opacity-0 group-hover:opacity-100` reveals. Information is visible or it is behind a tap.
5. **No `window.prompt` / `confirm` / `alert`.** In a webview these are system alerts titled with the
   app host, and `prompt` is unusable for real entry. In-app sheets instead.
6. **Desktop loses nothing.** Keyboard paths — paste-a-spreadsheet, Enter to save, the table view —
   stay exactly as they are. Touch equivalents are added beside them, never instead.

### 6. Worked example: the statement band

The band built this week is the first thing to meet rule 1. Side by side at 390px, "Rp 2.092.417" and
"Rp 5.765.917" collide. On phone it stacks, keeping the same information in the same order:

```
┌──────────────────────────────────────┐
│ Upcoming bill · due 5 Oct  Rp 7.858.334 │  ← dark strip, full width
├──────────────────────────────────────┤
│ ▨▨▨▨│░░░│████████████████████         │  ← the bar
│ Previous bill      Rp 2.092.417        │
│                    of Rp 5.230.417     │
│ Unbilled           Rp 5.765.917        │
└──────────────────────────────────────┘
```

Above `md` the band keeps the wide form: bar and figures on the left, dark cell on the right.

Its rows also meet rule 2: the two 16px icon buttons (Billed next statement, Use purchase date)
become a single 44px **⋯** that opens a sheet naming both actions in words — which also settles rule
4, since those buttons' meanings live in `title=` today.

## Components

| File | Responsibility |
|---|---|
| `apps/web/src/app/TabBar.tsx` (new) | The four tabs and the centre button; phone only |
| `apps/web/src/app/MoreSheet.tsx` (new) | The grouped sheet, its backdrop and dismissal |
| `apps/web/src/app/Sheet.tsx` (new) | The bottom-sheet primitive both of the above use, and the + form |
| `apps/web/src/app/PageHeader.tsx` (new) | Title plus actions, with the top safe-area inset |
| `apps/web/src/app/Layout.tsx` | Loses the ten-item bottom bar; keeps the desktop sidebar |
| `apps/web/src/app/nav.ts` (new) | One list of routes with labels, icons and where each belongs |
| `apps/web/src/features/cards/StatementBand.tsx` | Stacked below `md`, wide above |
| `apps/web/src/features/cards/StatementPanel.tsx` | Row actions collapse into one ⋯ sheet on phone |

`nav.ts` exists so the sidebar, the tab bar and the More sheet cannot drift apart: a route added there
appears in the right place on both platforms, and a route in none of them is a test failure.

## Testing

A second Playwright project, `iPhone 13` (390 × 844), running a **mobile-only spec file** plus the
existing specs that are not desktop-specific:

1. Every route in `nav.ts` is reachable on a phone: through a tab, or through the More sheet.
2. The More sheet opens, reaches Tax report, and dismissing it returns to the previous screen.
3. The + button opens the transaction form and records a purchase without leaving the screen.
4. No page scrolls horizontally at 390px: `document.body.scrollWidth <= 390` on every route.
5. The statement band stacks: the Upcoming bill strip sits above the bar, and nothing overlaps.
6. Every tappable element on the phone routes is at least 44px on its smaller side.

Tests 4 and 6 are written as sweeps over the route list, so a new screen is covered the day it exists.

## Risks

- ~~**OPFS under a custom scheme.**~~ **Settled on 2026-09-16.** Spiked in a throwaway Capacitor app
  on the iOS 26 Simulator: under `capacitor://localhost`, `navigator.storage.getDirectory()` resolves,
  sync access handles read and write, `installOpfsSAHPoolVfs()` succeeds, and rows survive three app
  relaunches. The real `vite build` then booted in the same shell, so the ES-module worker and the
  `.wasm` MIME type are fine too. **The data layer ships untouched; no native SQLite plugin needed.**
- **Backup is broken in a webview.** `<a download>` does nothing in WKWebView, and the restore flow
  tells the user to look in a Downloads folder iOS does not have. Phase 4, but it is the reason the
  app cannot ship before phase 4 is done.
- **Hiding Transactions behind Home** may not match how you work. If the ledger turns out to be a
  daily screen, it takes Spending's tab and Spending moves into More — a one-line change in `nav.ts`.
