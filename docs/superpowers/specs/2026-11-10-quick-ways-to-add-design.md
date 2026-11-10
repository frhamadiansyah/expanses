# Quick ways to add — design

Date: 2026-11-10 · Status: draft for owner approval · Mockups: companion page "phone-entry-all" (options A, B, E chosen; D kept; C dropped)

## Why

Some people keep expenses in a spreadsheet because typing a row there is fast: no form, no screens, keyboard only. The phone's Add form is thorough but slow for a run of small purchases. The owner chose three additions and to keep one existing path:

- **A · One line** — type the expense as one sentence; the app reads it.
- **B · Sideways table** — turn the phone to landscape on Cashflow and get the wide-screen table.
- **E · Widget and Control Center** — reach A from the home screen, lock screen and Control Center without opening the app first.
- **D · Paste a list** — already built; only made easier to reach.

## Goals

- Record a typical purchase with one line of text and Return; several in a row without the keyboard closing.
- Spreadsheet people get a real table on the phone.
- The slowest step — finding and opening the app — is one tap.

## Non-goals

- **The Add form is not replaced or changed.** Tapping ＋ still opens it exactly as today. A is an extra, faster way in.
- No income, transfers, splits, refunds or event tagging in One line (v1). Those stay in the Add form.
- No change to data, sync or migrations. Every way here records the same transaction the Add form would.
- No Mac app work.
- C (typing row in the list) is not built.

## Anti-goals

- A guess the owner cannot see. Every part One line read must be visible before saving, and an unsure part must look unsure.
- A widget that shows money on a home or lock screen without being asked to.
- Landscape breaking any other page.

## A · One line

**Where:** a screen of its own, `/transactions/line`. Reached from:
- long-press on the tab bar ＋, which opens a small menu: **One line**, **Paste a list**, **Scan a receipt**, **Add transaction** (plain tap on ＋ is unchanged);
- the widget and Control Center (E);
- the deep link `cicis://add/line`.

**Screen:** the mockup's A. A list of rows saved in this sitting (count and total) at the top. One text field above the keyboard, with tags under it showing what was read: description, amount, category, paid with, date. Return (keyboard key and the "Save" above the keyboard) saves; the field empties for the next row and keeps the date and the last "paid with". Done or Cancel leaves; rows already saved stay saved. Tapping a saved row opens the existing edit screen for it.

**Reading a line** (a pure function in `packages/core`, unit-tested with invented lines):
- **Amount:** a figure anywhere in the line, read with the same rules as Paste a list (`18000`, `18.000`, `38rb`, `38k`, `1,5jt`, `Rp 38.000`). If there are two figures, the last one is the amount. Reuse Paste a list's amount reader; do not write a second one.
- **Currency:** a currency code next to the figure (`KRW 95000`, `95000 krw`) records in that currency at the day's rate, as the Add form does for a foreign amount. Otherwise the workspace's currency.
- **Paid with:** a word that matches an account, card, wallet or card digits (existing `matchPayment`). Words used for it are taken out of the description. None matched: the last "paid with" used on this screen, else the one the Add form would default to — shown as an unsure tag.
- **Date:** today, unless the line has `kemarin` / `yesterday` or a date the Paste-a-list date reader understands (`28/10`, `28 Oct`). Taken out of the description.
- **Description:** what is left, tidied (first letter of each word capitalised when typed all lower-case).
- **Category:** from this merchant's past rows (existing `capturedCategory`), else a word match (existing `matchCategory`), else none. None is allowed: the row saves and shows under Needs category, as rows from bank messages do.
- **Unsure parts** (paid-with fallback, a comma figure read as thousands, a category from a word match rather than history) show as dashed tags. Saving is still allowed.

**Fixing a guess:** tapping a tag opens the same picker the Add form uses for that field (category picker, paid-with picker, amount, date). The tag then shows the chosen value as sure. A line with no amount cannot be saved; the amount tag says "Amount?".

**Suggestions:** while typing, past descriptions that match show above the keyboard as chips (as in the mockup); tapping one fills description, category and paid with from that merchant's last row.

**Workspace:** records in the open workspace, as the Add form does. Shared workspaces work as today.

**Wide screens:** the route works there too; no extra entry point (the table already exists there).

## B · Sideways table

- The iPhone app may turn to landscape **only while Cashflow is open**. Everywhere else it stays upright as today. Use the official `@capacitor/screen-orientation` plugin (8.x): lock portrait at start; unlock on entering Cashflow; lock again on leaving. Info.plist must list the landscape orientations so the unlock can take effect.
- On a phone in landscape (short and wide: landscape with height under 500px), Cashflow shows the existing wide-screen table full screen: a slim bar with the month (‹ ›) and the month's spent total, the table with its typing row first, no tab bar and no sidebar. Turning back upright returns to the list exactly where it was.
- The rest of the app must not switch to the wide-screen layout just because a landscape phone is wider than 768px. The phone shell decides by "is this a phone", not by width alone.
- A one-time tip on Cashflow ("Turn sideways for the table") the first few times, dismissible; never again once the table has been opened sideways.
- In a phone browser (not the app) the same landscape table appears when the browser is turned; there is no lock there.

## D · Paste a list

No change to the page. New ways in: the long-press ＋ menu, and the widget's Paste button (`cicis://add/paste`).

## E · Widget and Control Center

A new WidgetKit extension target in `apps/web/ios/App` (bundle id `com.cicis.app.widgets`, App Group `group.com.cicis.app`, iOS 17.0 minimum like the app).

- **Home screen, small:** one tap anywhere opens One line.
- **Home screen, medium:** three buttons — **＋ Type** (One line), **Receipt** (scan a receipt), **Paste** (Paste a list). Each is a deep link into the app.
- **Lock screen, circular:** a ＋ that opens One line.
- **Control Center (iOS 18 and later):** an "Add expense" control that opens One line. On iOS 17 the control simply is not offered; the widgets still work.
- **Totals on the widget: off by default.** A switch in the app's settings, "Show this month's spending on the widget", turns on a line on the medium widget: the month's spent amount and its share of the budget, for the open workspace. When it is on, the app writes that small summary (month, amount, currency, share, time written) to the App Group whenever spending changes and asks the widget to refresh. Turning it off erases the summary from the App Group at once. Lock screen widgets never show amounts.
- Deep links: `cicis://add/line`, `cicis://add/paste`, `cicis://add/receipt`, handled by the existing `appUrlOpen` handling. A link arriving while the app is locked behind its unlock screen opens the screen after unlock.

**Signing note:** the new target needs its bundle id registered and the App Group added to its profile. Like the App Intents extension (feat/intents-extension), it can only be archived once Xcode is signed in with the owner's Apple ID.

## Copy rules (app-wide, apply here)

No "you"/"your" in app text. No sample numbers in placeholders (the One line placeholder is words only, e.g. "Shop, amount, card"). Features stay country-neutral: `rb`/`jt`/`kemarin` are read because they are common, not shown as hints in other languages' settings — the screen's hint line names "yesterday" in the app's language.

## Testing

- Core: the line reader, with invented lines covering every rule above (figure positions, suffixes, currency codes, card words, card digits, dates, no amount, two figures).
- Web: One line screen (save, keep date and card, fix a tag, no-amount refusal); the long-press menu; landscape table on Cashflow at a phone landscape size (844×390) in the phone e2e project; other pages stay in the phone shell at that size.
- iOS: widget and Control Center checked on device (TestFlight) — not testable in CI.

## Settled after the builder check (my calls, owner to confirm)

1. **Landscape stays on Cashflow only — no app-wide breakpoint rewrite.** In the native app only `/transactions` (that exact path) unlocks rotation; every other route, including the Add form, a receipt or Paste a list opened from Cashflow, locks portrait again, so no other page is ever laid out sideways. On that one route in landscape the shell draws nothing of its own (no sidebar, no tab bar) and the page draws the full-screen table; the table's own wide-screen (`md:`) styling is exactly what is wanted there. `usePhone` gains a "phone held sideways" signal (landscape and height under 500px) used by the shell and Cashflow; the 88 `md:` uses and the other 768px checks are left alone. In a phone *browser* other pages can still go wide when turned, as they do today — accepted.
2. **Reading order for a line:** date words and dates first; then a currency code with its figure; then paid-with (a 4-digit group equal to a known card's or account's last digits is paid-with, not an amount; account and card names by `matchPayment`); then the amount is the last figure left; the rest is the description. Inline date reading (`kemarin`, `yesterday`, `28/10` inside a sentence) is new code built on `parseLooseDate`.
3. **Amount reader:** export Paste a list's figure reader from `purchase-list.ts` (refactor only, Paste a list's behaviour and tests unchanged) and call it from One line. Currency-code reading is added in One line's reader only; Paste a list does not change. The day's rate comes from the same path the Add form uses for a foreign amount.
4. **Widget summary:** the workspace open when the app was last used. Rewritten when spending changes or the workspace is switched. Not erased by the app's own lock (the owner switched it on knowing it shows on the home screen); erased when the switch is turned off, on erasing the app's data, and when leaving that workspace. Stored as plain values in the App Group (iOS file protection applies); no amounts on lock-screen widgets.
5. **Deep links:** a new `cicis://add/...` listener beside the existing ones. A link that arrives before the app is unlocked or fully started is held and followed once it is. `cicis://add/receipt` opens Cashflow and starts the same "Scan a receipt" action the Cashflow page has.
6. **iPhone only** (the app targets iPhone; no iPad layout). The share extension and App Intents extension are unaffected by the orientation lock.
7. **Native order:** the widget target is built on its own branch from main, independent of feat/intents-extension; whichever merges second resolves `project.pbxproj`.
8. **Hold-＋ menu** on both the native app and the phone web app (touch press-and-hold); its "Scan a receipt" is the same action as the widget's Receipt.

## Left to the builder

File layout, component names, how the long-press is detected (press-and-hold ~400ms with a light haptic on the native app), the exact unsure-tag styling within the mockup's look, and how the widget summary is passed from the web view to the App Group (a small native method next to the existing native bridges is expected).
