# Quick Ways to Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faster ways to record a purchase on the phone: One line (type a sentence, Return saves), the sideways Cashflow table, a hold-＋ menu with `cicis://add/...` links, and a home/lock-screen widget plus a Control Center control that open them.

**Architecture:** A pure line reader in `packages/core` (built on Paste a list's figure reader) turns text into date, currency, figure, paid-with and description; a pure screen model in `apps/web` adds the fallbacks, unsure parts and the Add form's `FormDraft`, so every save goes through the same `formToPost` → `ratesForSave` → `postTransaction` path the Add form uses. The sideways table reuses `TransactionsTable` behind a new `useSideways()` signal and a Cashflow-only rotation unlock. The widget is a WidgetKit extension that only opens deep links and, when switched on, reads a small summary the app writes to the existing App Group.

**Tech Stack:** TypeScript, vitest, React 19, TanStack Router, Tailwind 4, Playwright (`phone` project), Capacitor 8 (`@capacitor/screen-orientation`, `@capacitor/haptics`, `@capacitor/app`), Swift (WidgetKit, AppIntents, SwiftUI).

**Spec:** `docs/superpowers/specs/2026-11-10-quick-ways-to-add-design.md` (including "Settled after the builder check"). Read it before any task. It decides anything this plan does not.

## Global Constraints

- No "you"/"your" in any app text. Grep every new user-facing string before committing.
- No sample numbers in placeholders/hints (words only). The One line placeholder is `Shop, amount, card`.
- Features stay country-neutral (no locale presets). `rb`/`jt`/`kemarin` are read, never shown as hints; the hint line names "yesterday".
- Test fixtures are invented. Never use real bank SMS, statements, card numbers or merchants copied from real data.
- Minimum iOS 17.0. The Control Center control is iOS 18+ only, behind `@available` / `#available`.
- iPhone only (`TARGETED_DEVICE_FAMILY = 1`). No iPad layout.
- No database migration in this feature. No schema change, no new table, no new column.
- The Add form is not changed: a plain tap on ＋ still opens `/transactions/new` exactly as today.
- Every way in records the same transaction the Add form would. One line builds a `FormDraft` and posts it through `formToPost` / `ratesForSave` / `postTransaction`, with no second posting path.
- Paste a list's behaviour and its tests stay unchanged. The figure-reader export is a refactor only.
- Lock-screen widgets never show amounts. Totals on the medium widget are off by default.
- Landscape is allowed only on the exact route `/transactions`. Every other route locks portrait in the native app.

**Builder check answered: empty description.** The Add form accepts one. `formToPost`'s expense branch passes `draft.description` through with no check (`apps/web/src/features/transactions/tx-form.ts` around line 1161). The form's `ready` test (the `formToPost` try in `TransactionCard.tsx`) does not refuse it. The ledger stores `input.description.trim()` with no refusal (`packages/db/src/repos/ledger.ts:427`). So a line that is only an amount saves with an empty description, and the preview never asks for "Description?". The table's typing row (`readQuick`) does require one, but that is the table, not the Add form.

**Rulings where the spec could not be followed literally (owner to confirm):**
1. **No unlock screen exists.** The app has no app-lock screen today: `App` mounts only after the database opens. So "held until unlocked or fully started" means the existing pattern, where each listener reads `Shell.getLaunchUrl()` when it mounts and nothing more is built.
2. **No paid-with to fall back to.** This happens when nothing was used yet in the sitting and no Default Paid with is set. The preview then shows an amber `Paid with?` and Save stays dimmed, as it does for `Amount?`. An expense cannot post without an account.
3. **"Other pages stay in the phone shell" at 844×390.** The shell (tab bar and no sidebar) follows phone-or-sideways on every page. The pages' own `md:` styling and their `usePhone()` checks are left alone, per settled point 1.
4. **The sideways tip shows in the native app only.** The phone-browser e2e suite (over 100 specs on Cashflow) stays undisturbed, and a browser user is not told to turn a phone that may not rotate.
5. **Currency symbols.** As well as codes, One line reads `$ S$ € £ ¥ RM Rp` directly before a figure. A traveller's `$12` must not record Rp 12.

## Review Focus

- A known card's four digits as the only figure (`parkir 4417` where 4417 is a card): paid-with wins (settled order), so there is no amount, the preview says `Amount?` and Save stays dimmed. The amount must not become 4.417. Test in Task 1.
- Return pressed twice quickly, or Return then Save: exactly one row is saved and the second press is a no-op while the first is in flight. Test in Task 5 (e2e).
- A currency code with no rate for the day (offline, or a rare code): the save stops with words naming the missing pair and the field keeps the text. A Rp-for-KRW figure is never posted. Test in Task 4 (`foreignCharge` null) and Task 5 (the screen shows the message).
- Cashflow opened already sideways (cold start in landscape, or turned before the page loaded): the table shows at once with no tab bar. Turning upright lands on the list. Test in Task 3 (e2e).
- A widget summary from a month that has ended (the app not opened since October): the medium widget must not show October's spending as this month's. The summary carries its month, the widget shows the line only for the current month, and the writer rewrites when the month key changes. Test in Task 7 (`summaryKey` differs by month); the Swift check is in Task 9.

---

## Waves (the executor runs tasks in one wave in parallel worktrees; no two tasks in a wave edit the same file)

- **Wave 1:** Task 1 (core line reader), Task 2 (db last paid-with), Task 3 (sideways table). These ship on their own.
- **Wave 2:** Task 4 (One line screen model). Needs Task 1.
- **Wave 3:** Task 5 (One line screen + route + e2e). Needs Tasks 2 and 4.
- **Wave 4:** Task 6 (hold-＋ menu, deep links, receipt). Needs Tasks 3 and 5. **One line, the sideways table and the hold-＋ menu are shippable after this wave.**
- **Wave 5:** Task 7 (widget summary: web side and switch) and Task 8 (Swift summary plugin in the App target).
- **Wave 6:** Task 9 (WidgetKit extension + Control Center control). Needs Task 8.

Native tasks (8, 9, and the plist/SPM part of 3 and 6) are verified with an unsigned simulator build. Archiving needs the owner's Xcode signing later (spec Signing note).

**Commands used throughout** (run from the worktree root unless a `cd` is shown):
- Core unit: `cd packages/core && npx vitest run test/<file>.test.ts`
- DB unit: `cd packages/db && npx vitest run test/<file>.test.ts`
- Web unit: `cd apps/web && npx vitest run src/<path>.test.ts`
- Phone e2e: `cd apps/web && npx playwright test --project=phone e2e/<file>.spec.ts`. This builds first; `E2E_REUSE=1` reuses `dist` on a rerun with no `src` change.
- Typecheck: `npm run typecheck`. All tests: `npm test`.
- Simulator build (no signing): `cd apps/web && npm run cap:sync && xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -3`. Expected last line: `** BUILD SUCCEEDED **`.

---

### Task 1: Core line reader (`readExpenseLine`)

**Files:**
- Modify: `packages/core/src/entry/purchase-list.ts`. Export the figure reader and the year rule (refactor only).
- Create: `packages/core/src/entry/expense-line.ts`
- Modify: `packages/core/src/index.ts` (export the new names beside the `purchase-list` export, line 42)
- Test: `packages/core/test/expense-line.test.ts` (new). `packages/core/test/purchase-list.test.ts` must pass **unchanged**.

**Interfaces:**
- Consumes: `parseLooseDate` (`entry/quick-entry.ts`), `matchPayment`, `PaymentOption`, `CURRENCIES`, `currencyInfo`.
- Produces (all exported from `@expanses/core`):

```ts
// purchase-list.ts
export interface LineFigure {
  /** Index of the figure's first character (its "Rp" when it has one) and just past its suffix. */
  start: number;
  end: number;
  /** Minor units of `currency`; null when its marks make no sense (1.2.3) or it does not fit a safe integer. */
  minor: number | null;
  /** Read two ways (18,000) or rounded to the currency's cents. */
  ambiguous: boolean;
  /** Written with "Rp" in front. */
  rupiahMark: boolean;
  /** A minus sign directly before it (with only spaces between). */
  negative: boolean;
}
/** Every figure in `text`, left to right, read exactly as Paste a list reads its amount. */
export function lineFigures(text: string, currency: string): LineFigure[];
/** "18.000,-" → "18.000": the closing dash Paste a list drops before reading. */
export function withoutClosingDash(text: string): string;
/** A day typed as text (27/10, 27 Oct, 2026-10-27) with Paste a list's year rule: no year → this year, or last year when that would be over 31 days ahead. */
export function readDayText(text: string, today: string): string | null;

// expense-line.ts
export interface ReadExpenseLineOptions {
  today: string;      // YYYY-MM-DD
  currency: string;   // the workspace's currency
  payments: readonly PaymentOption[];
}
export interface ExpenseLineReading {
  description: string;           // tidied; '' when nothing is left
  amountMinor: number | null;    // in `currency`'s minor units; null: no amount
  currency: string;              // the code or mark read next to the amount, else options.currency
  currencyRead: boolean;
  occurredOn: string | null;     // null: the line names no day
  payment: { accountId: string; cardId: string | null } | null;
  ambiguous: boolean;            // the amount could be read two ways, or was rounded
  /** The line without the description's words: its date, currency, amount and paid-with words in typed order. */
  rest: string;
}
export function readExpenseLine(line: string, options: ReadExpenseLineOptions): ExpenseLineReading;
/** Capitalises each word's first letter when the text was typed all lower-case; otherwise leaves it as typed. */
export function tidyDescription(text: string): string;
```

- [ ] **Step 1: Write the failing tests** in `packages/core/test/expense-line.test.ts`. Fixtures are invented:

```ts
const TODAY = '2026-11-10';
const PAYMENTS: PaymentOption[] = [
  { accountId: 'nusa', cardId: 'nusa-a', accountName: 'Bank Nusa Platinum', last4: '4417', holderName: null },
  { accountId: 'biru', cardId: null, accountName: 'Dompet Biru', last4: null, holderName: null },
  { accountId: 'tunai', cardId: null, accountName: 'Cash', last4: null, holderName: null },
  { accountId: 'mandala', cardId: null, accountName: 'Bank Mandala', last4: null, holderName: null },
];
const read = (line: string, currency = 'IDR') => readExpenseLine(line, { today: TODAY, currency, payments: PAYMENTS });
```

Tests (name → assertion):
- `reads a note and an amount` → `read('parkir 10rb')` toEqual `{ description: 'Parkir', amountMinor: 10_000, currency: 'IDR', currencyRead: false, occurredOn: null, payment: null, ambiguous: false, rest: '10rb' }`.
- `reads every amount spelling Paste a list reads` → amountMinor of `'a 18000'`=18_000, `'a 18.000'`=18_000, `'a 38rb'`=38_000, `'a 38k'`=38_000, `'a 1,5jt'`=1_500_000, `'a Rp 38.000'`=38_000.
- `takes the last figure when there are two, leaving the other in the note` → `read('gojek 2 kali 38000')` gives amountMinor 38_000, description `'Gojek 2 Kali'`.
- `marks a comma read as thousands` → `read('kopi 18,000')` gives amountMinor 18_000, ambiguous `true`.
- `has no amount without a figure, or with a minus` → `read('parkir').amountMinor` null. `read('kopi -38rb').amountMinor` null.
- `saves an amount alone with an empty note` → `read('38rb')` gives description `''`, amountMinor 38_000.
- `reads paid-with from a whole word of an account` → `read('kopi pagi 38.000 biru')` gives payment `{ accountId: 'biru', cardId: null }`, description `'Kopi Pagi'`. `read('cash 15rb parkir')` gives payment tunai, description `'Parkir'`.
- `reads paid-with from a card's last digits, which are not the amount` → `read('warung sate 1,5jt 4417')` gives payment `{ accountId: 'nusa', cardId: 'nusa-a' }`, amountMinor 1_500_000, description `'Warung Sate'`.
- `lets known digits win when they are the only figure (Review Focus)` → `read('parkir 4417')` gives payment nusa, amountMinor null.
- `does not take a word that only contains an account's name` → `read('mandi 20rb')` gives payment null, description `'Mandi'`.
- `leaves words naming two accounts in the note` → `read('nusa biru 20rb')` gives payment null, description `'Nusa Biru'`.
- `reads yesterday in either word` → `read('kemarin toko buku 249k nusa').occurredOn` `'2026-11-09'` (and payment nusa, description `'Toko Buku'`). `read('yesterday taxi 25000').occurredOn` `'2026-11-09'`.
- `reads a date inside the line, never as the amount` → `read('toko buku 28/10 85000')` gives occurredOn `'2026-10-28'`, amountMinor 85_000, description `'Toko Buku'`. `read('28 Oct makan siang 45rb')` gives `'2026-10-28'`, 45_000, `'Makan Siang'`.
- `puts a yearless date over a month ahead in last year` → `read('2 Dec hotel 900000').occurredOn` `'2026-12-02'`. `read('25 Dec hotel 900000').occurredOn` `'2025-12-25'`.
- `reads a currency code before or after the figure, any case` → `read('KRW 95000 tteokbokki')` and `read('tteokbokki 95000 krw')` both give currency `'KRW'`, currencyRead `true`, amountMinor 95_000, description `'Tteokbokki'`.
- `scales a code's figure by that currency's cents` → `read('usd 12,50 museum')` gives currency `'USD'`, amountMinor 1_250. `read('$12.50 museum')` gives the same.
- `reads Rp as rupiah in a workspace of another currency` → `read('Rp 38.000 kopi', 'USD')` gives currency `'IDR'`, amountMinor 38_000.
- `does not read try as lira` → `read('try 50000').currency` `'IDR'`, description `'Try'`.
- `keeps a description typed with capitals as typed` → `read('KFC 50rb').description` `'KFC'`. `tidyDescription('kopi kenangan')` `'Kopi Kenangan'`. `tidyDescription('iPhone case')` `'iPhone case'`.
- `gives back what is not the description, for a picked suggestion` → `read('kopi ke 38rb nusa').rest` `'38rb nusa'`. `read('kemarin kopi 20rb').rest` `'kemarin 20rb'`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd packages/core && npx vitest run test/expense-line.test.ts`
Expected: FAIL. `readExpenseLine` is not exported.

- [ ] **Step 3: Refactor `purchase-list.ts`.** Move the `AMOUNT` match loop into `lineFigures`. Move the `(\d)[.,]-+` cleanup into `withoutClosingDash`. Move the year rule out of `dateLine` into `readDayText`, so `dateLine` becomes shape check + `readDayText`. `parsePurchaseList` then takes `lineFigures(cleaned, currency).at(-1)` and keeps its own note slicing, small/huge/suspicious rules and minus refusal. Run `cd packages/core && npx vitest run test/purchase-list.test.ts`. Expected: PASS with the file untouched.

- [ ] **Step 4: Implement `readExpenseLine` in `expense-line.ts`.** The reading order is fixed by the spec (settled point 2):

```
s = withoutClosingDash(line with whitespace runs collapsed, trimmed)
1. Date. Word /\b(kemarin|yesterday)\b/i → today − 1 day. Else the first token matching
   d/m[/yy|yyyy] (not touching other digits or "/") or "d Mon[th] [yyyy]" (month = jan…dec prefix)
   that readDayText reads. Remove the token from s; add it to rest.
2. Currency + figure. figures = lineFigures(s, options.currency), dropping those with minor === null.
   From the last figure backwards, the first one with a mark directly before it
   (S$, $, €, £, ¥, RM, or a word that uppercased is a CURRENCIES code)
   or a code word directly after it (only spaces between). Lower-case "try" is never a code.
   That figure is the amount, re-read with lineFigures(its text, code)[0].
   A figure with rupiahMark is IDR the same way. Remove the mark and the figure.
3. Paid with.
   (a) Each remaining 4-digit figure equal to some option's last4: matchPayment(digits, payments);
       when it resolves, that is the payment and the figure is removed.
   (b) Words of s that equal, case-insensitive, a whole word (≥ 2 letters) of an option's accountName
       or holderName: matchPayment(words.join(' '), payments). When it resolves to the same account as (a),
       or (a) found none, the payment is that and the words are removed. Otherwise the words stay.
4. Amount. When step 2 found none, the last remaining figure. Negative → amountMinor null and the figure
   stays in the text. Remove it.
5. Description. tidyDescription(what is left, with the same trimming as Paste a list's trimNote).
rest = the removed pieces, joined by single spaces, in the order they were typed.
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `cd packages/core && npx vitest run test/expense-line.test.ts test/purchase-list.test.ts && cd ../.. && npm run typecheck`
Expected: PASS. Typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/entry/purchase-list.ts packages/core/src/entry/expense-line.ts packages/core/src/index.ts packages/core/test/expense-line.test.ts
git commit -m "One line: read an expense from one line of text (core)"
```

---

### Task 2: Last paid-with for a shop (db)

**Files:**
- Modify: `packages/db/src/repos/entry.ts` (beside `guessCategoryFromHistory`, already re-exported by `packages/db/src/index.ts:118`)
- Test: `packages/db/test/entry.test.ts`

**Interfaces:**
- Consumes: `merchantKey` from `@expanses/core`.
- Produces: `lastPaidWith(database: Database, ws: WorkspaceContext, description: string): Promise<{ accountId: string; cardId: string | null } | null>`. This is the money line (an asset or liability entry with a negative amount) and `transactions.cardId` of the newest posted transaction in `ws.workspaceId` whose `merchantKey(description)` equals the given one. Order by `occurredOn desc, createdAt desc`, the same as `guessCategoryFromHistory`. Null when the key is empty or no row matches.

- [ ] **Step 1: Write the failing tests** in a new `describe('the account a shop was last paid with')`:
  - `gives the account and card the same shop was last paid with`. Post `Kopi Pagi` on 2026-09-01 from a bank account, then `KOPI PAGI 0912` on 2026-09-05 from a card account `createCardAccount(... last4: '7720')` with a card added by `addCard`. Expect `lastPaidWith(database, ws, 'kopi pagi')` toEqual `{ accountId: card.id, cardId: <that card id> }`.
  - `knows nothing about a shop never seen` → `lastPaidWith(database, ws, 'Toko Sepatu')` toBeNull.
- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/entry.test.ts`. Expected: FAIL (not exported).
- [ ] **Step 3: Implement `lastPaidWith`** with one drizzle query joining `entries` → `transactions` → `accounts` (kind `asset` or `liability`, `entries.amountMinor < 0`, status `posted`, workspace filter). Filter by `merchantKey` in JS over at most `HISTORY_LIMIT` rows, the same way `guessCategoryFromHistory` does.
- [ ] **Step 4: Run** `cd packages/db && npx vitest run test/entry.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/repos/entry.ts packages/db/test/entry.test.ts && git commit -m "One line: the account a shop was last paid with"`

---

### Task 3: Sideways Cashflow table

**Files:**
- Modify: `apps/web/src/app/use-phone.ts`. Add `useSideways`; `usePhone` itself is unchanged.
- Create: `apps/web/src/native/orientation.ts`, `apps/web/src/native/orientation.test.ts`
- Modify: `apps/web/src/app/Layout.tsx`. The shell decides by phone-or-sideways, and rotation is unlocked per route.
- Modify: `apps/web/src/app/TabBar.tsx`. Drop `md:hidden` from the wrapper `div`: Layout alone decides whether the bar exists.
- Create: `apps/web/src/features/transactions/SidewaysTable.tsx`, `apps/web/src/features/transactions/sideways-tip.ts`, `apps/web/src/features/transactions/sideways-tip.test.ts`
- Modify: `apps/web/src/features/transactions/TransactionsPage.tsx`
- Modify: `apps/web/src/main.tsx`. Call `lockPortrait()` before the first render when native.
- Modify: `apps/web/package.json` + `package-lock.json` (`@capacitor/screen-orientation@^8.0.2`), `apps/web/ios/App/App/Info.plist`, `apps/web/ios/App/CapApp-SPM/Package.swift` (written by `cap sync`), `apps/web/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` if it changes.
- Test: `apps/web/e2e/phone-sideways-table.spec.ts` (new)

**Interfaces:**
- Produces:
  - `export const SIDEWAYS = '(orientation: landscape) and (max-height: 499px)'` and `export function useSideways(): boolean` in `use-phone.ts`, the same matchMedia shape as `usePhone`.
  - `export function rotationFor(pathname: string): 'free' | 'portrait'` → `'free'` only for `/transactions` and `/transactions/`.
  - `export function lockPortrait(): Promise<void>` and `export function useCashflowRotation(pathname: string): void`. The second does nothing unless `isNative()` (`lib/pwa`); it calls `ScreenOrientation.unlock()` / `ScreenOrientation.lock({ orientation: 'portrait' })` from `@capacitor/screen-orientation` on each pathname change, and swallows errors with a `console.warn`.
  - `sideways-tip.ts`: `interface TipState { seen: number; done: boolean }`, `readTip(): TipState`, `writeTip(state: TipState): void` (both try/catch localStorage, key `'expanses.sideways-tip'`), `tipShown(state: TipState): boolean` (= `!state.done && state.seen < 3`), `afterVisit(state)` (seen + 1), `afterSideways(state)` / `afterDismiss(state)` (done true).
  - `SidewaysTable` props: `{ month: string; onMonth: (next: string) => void; spentMinor: number; currency: string; children: ReactNode }`. It draws a fixed full-screen layer (`fixed inset-0 z-40 overflow-auto`, page background, safe-area left/right padding) with a slim bar: `‹` (aria-label `Previous month`), `periodLabel(month)`, `›` (aria-label `Next month`), and `<b>{formatMinor(spentMinor, currency)}</b> spent`. Under the bar it renders `children` (the page's `TransactionsTable`). `stepPeriod`/`periodLabel` come from `@expanses/core`.
- Consumed later: Task 6 edits `TabBar.tsx` and `TransactionsPage.tsx` again (next wave). Task 7 edits `Layout.tsx`.

- [ ] **Step 1: Write the failing unit tests.**
  - `orientation.test.ts`: `rotationFor` gives `'free'` for `'/transactions'` and `'/transactions/'`, and `'portrait'` for `'/transactions/new'`, `'/transactions/paste'`, `'/transactions/line'`, `'/transactions/abc'`, `'/budget'`, `'/'`.
  - `sideways-tip.test.ts`: `tipShown({ seen: 0, done: false })` true; `tipShown({ seen: 3, done: false })` false; `tipShown(afterSideways({ seen: 0, done: false }))` false; `afterVisit({ seen: 1, done: false })` toEqual `{ seen: 2, done: false }`; `readTip()` with localStorage throwing gives `{ seen: 0, done: false }`.
- [ ] **Step 2: Write the failing e2e** `phone-sideways-table.spec.ts` (phone project, 390×844 to start). Create eight invented purchases in one go through Paste a list (`/transactions/new` → `Paste a list` → fill lines like `roti 15000` … → `Review 8` → `Save 8`), after an `openAccount(page, { subtype: 'bank', name: 'Bank Nusa', balance: '5000000' })`.
  - `turning sideways on Cashflow shows the table full screen, and upright returns to the list where it was`. On `/transactions` run `window.scrollTo(0, 300)` and read `scrollY`. `page.setViewportSize({ width: 844, height: 390 })`. Expect `getByTestId('typing-row')` visible, `getByTestId('table-row')` count ≥ 8, `getByRole('navigation', { name: 'Main' })` count 0, `page.locator('aside')` count 0, `getByRole('button', { name: 'Previous month' })` visible, and the bar contains `spent`. Back to 390×844: expect `getByRole('heading', { name: 'Transaction history' })` visible and `scrollY` within 2px of the saved value.
  - `the month arrows step the month`. Sideways, press `Previous month`. Expect the URL `month=` to be the previous month (computed from `todayIn(page)`).
  - `another page turned sideways stays in the phone shell`. `/budget` at 844×390: `getByRole('navigation', { name: 'Main' })` visible, `page.locator('aside')` count 0.
  - `Cashflow opened already sideways shows the table at once (Review Focus)`. `setViewportSize(844×390)` **before** `page.goto('/transactions')`. Expect `typing-row` visible and the Main nav count 0.
- [ ] **Step 3: Run them and see them fail.** `cd apps/web && npx vitest run src/native/orientation.test.ts src/features/transactions/sideways-tip.test.ts` fails on the missing modules. `npx playwright test --project=phone e2e/phone-sideways-table.spec.ts` fails because there is no table.
- [ ] **Step 4: Add the plugin.** `npm install -w @expanses/web @capacitor/screen-orientation@^8.0.2`. Add `UIInterfaceOrientationLandscapeLeft` and `UIInterfaceOrientationLandscapeRight` after `UIInterfaceOrientationPortrait` in `UISupportedInterfaceOrientations` (Info.plist), with a comment saying landscape is unlocked only on Cashflow (`native/orientation.ts`). Run `cd apps/web && npm run cap:sync` so `Package.swift` gains `CapacitorScreenOrientation`.
- [ ] **Step 5: Implement.**
  - `orientation.ts` as in Interfaces. `main.tsx` calls `void lockPortrait()` at the top when `isNative()`.
  - `Layout.tsx`: `const sideways = useSideways(); const pathname = useRouterState({ select: (s) => s.location.pathname }); useCashflowRotation(pathname); const phoneShell = phone || sideways; const tableOnly = sideways && rotationFor(pathname) === 'free';`. Render `<aside>` only when `!phoneShell`. Render `<TabBar>` when `phoneShell && !tableOnly`. Use `pb-32` on `<main>` when `phoneShell` and `pb-8` otherwise. Hide the status glass when `!phoneShell`.
  - `TransactionsPage.tsx`: `const sideways = useSideways()`. Treat the table view as `view === 'table' || sideways` wherever drafts are included (the `buildRows(...)` call near line 373). When `sideways`, wrap the page's normal tree in `<div hidden>` (still mounted, so its state stays) and render `<SidewaysTable month={month} onMonth={(next) => setSearch({ month: next === monthOf(today) ? undefined : next })} spentMinor={sum.spentMinor} currency={listCurrency}>` with the same `<TransactionsTable …/>` props the table branch uses. Save `window.scrollY` in a ref when `sideways` turns true. Restore it with `window.scrollTo(0, saved)` in a `useLayoutEffect` when it turns false. When `isNative() && phone && tipShown(readTip())`, draw a dismissible line under the title: `Turn sideways for the table` with a close button labelled `Dismiss`. Count the visit once per mount with `afterVisit`; `afterSideways` runs when `sideways` first turns true, and `afterDismiss` on close.
- [ ] **Step 6: Run** the unit tests and the e2e from Step 3, then `npx playwright test --project=phone e2e/phone-cashflow-controls.spec.ts e2e/phone.spec.ts`. Expected: all PASS. Run `npm run typecheck`. Run the simulator build. Expected: `** BUILD SUCCEEDED **`.
- [ ] **Step 7: Commit** every file listed above, with the message `Sideways table on Cashflow: rotation unlocked there only, phone shell by phone-or-sideways`.

---

### Task 4: One line screen model (pure)

**Files:**
- Create: `apps/web/src/features/transactions/one-line.ts`, `apps/web/src/features/transactions/one-line.test.ts`

**Interfaces:**
- Consumes: `ExpenseLineReading`, `readExpenseLine`, `matchCategory`, `CategoryOption`, `PaymentOption`, `convertMinor`, `minorToMajorString` (`@expanses/core`); `emptyForm`, `estimatedCharge`, `suggestedRate`, `formToPost`, `FormDraft` (`./tx-form`); `paymentKey` (`./quick-row`); `ListRow` (`./list-model`); `shortDate` (`./quick-row`).
- Produces:

```ts
export type LinePart = 'category' | 'paid' | 'day' | 'amount';
/** Parts picked from the preview: they read as sure. Cleared after each save. */
export interface LineChoices { categoryId?: string; paid?: PaymentOption; occurredOn?: string; amountMinor?: number }
export interface LineContext {
  today: string;
  /** The day kept from the last save in this sitting; `today` at the start. */
  sittingDay: string;
  lastPaid: PaymentOption | null;      // the last paid-with saved in this sitting
  defaultPaid: PaymentOption | null;   // the Add form's Default Paid with, resolved
  options: readonly PaymentOption[];
  category: CategoryGuess | null;
}
export interface CategoryGuess { id: string; from: 'history' | 'word' }
export interface LinePreview {
  description: string;
  occurredOn: string;
  amountMinor: number | null;
  currency: string;
  paid: PaymentOption | null;
  categoryId: string | null;
  unsure: ReadonlySet<LinePart>;
  /** What keeps Save dimmed: 'amount' while none is read, 'paid' while nothing pays. */
  missing: readonly ('amount' | 'paid')[];
}
export function previewOf(reading: ExpenseLineReading, context: LineContext, choices: LineChoices): LinePreview;
export const canSaveLine = (preview: LinePreview): boolean => preview.missing.length === 0;
/** History first; else the first description word (≥ 3 letters) that matchCategory files under exactly one category. */
export function categoryGuess(historyId: string | null, description: string, options: readonly CategoryOption[]): CategoryGuess | null;
/** Each option without digits takes its account's own (bank number or wallet phone) when known. */
export function withAccountDigits(options: readonly PaymentOption[], digits: Readonly<Record<string, string>>): PaymentOption[];
/** "Today", "Yesterday", else shortDate. */
export function previewDay(iso: string, today: string): string;
/** The charge in the payer's currency for a foreign amount, at the day's rates; null when no rate reaches it. */
export function foreignCharge(args: { amountMinor: number; currency: string; payerCurrency: string; base: string; rates: Record<string, number> }): { text: string; minor: number } | null;
/** The Add form's draft for this preview: Expense, one category ('' = Choose later), the typed currency and its charge. */
export function lineDraft(preview: LinePreview, bookId: string, chargedText: string): FormDraft;
/** What the Cashflow list would count: the settled figure in the workspace's currency. */
export function baseOf(settledMinor: number, payerCurrency: string, base: string, ratesToBase: Record<string, number>): number;
/** A list row standing for the preview (or a saved line), for TransactionRow. */
export function previewRow(preview: LinePreview, id: string, categoryName: string | null): ListRow;
/** What the sitting keeps after a save: the day and the paid-with. */
export function afterSave(context: LineContext, saved: LinePreview): Pick<LineContext, 'sittingDay' | 'lastPaid'>;
```

Rules (from the spec): `occurredOn = choices.occurredOn ?? reading.occurredOn ?? context.sittingDay`. Paid with comes from `choices.paid`, else the reading's payment (mapped back to its option by `paymentKey`), else `lastPaid`, else `defaultPaid`, else null. When it comes from `lastPaid`/`defaultPaid`, `'paid'` is unsure. `'amount'` is unsure when `reading.ambiguous` and there is no `choices.amountMinor`. `'category'` is unsure when `category.from === 'word'` and there is no `choices.categoryId`.

- [ ] **Step 1: Write the failing tests** (`one-line.test.ts`), with invented options `Bank Nusa` (`nusa`, card `nusa-a`, last4 `4417`) and `Dompet Biru` (`biru`), and today `2026-11-10`:
  - `previewOf takes the line's paid-with as sure`. Reading of `'kopi 38rb biru'`: `paid.accountId` `'biru'`, `unsure` has no `'paid'`, `missing` `[]`.
  - `falls back to the last paid-with of the sitting, then the default, as unsure`. No paid-with in the line, `lastPaid` = nusa: paid nusa, unsure has `'paid'`. With `lastPaid` null and `defaultPaid` = biru: paid biru, unsure has `'paid'`.
  - `asks for paid-with when nothing can pay (ruling 2)`. Both fallbacks null: `missing` toEqual `['paid']`, `canSaveLine` false.
  - `asks for an amount when none is read`. `'parkir'`: `missing` contains `'amount'`, `canSaveLine` false.
  - `keeps the sitting's day when the line names none`. `sittingDay` `'2026-11-09'`, line `'roti 15rb'`: occurredOn `'2026-11-09'`.
  - `a picked part is sure`. Reading `'kopi 18,000'` with `choices.amountMinor` 18_000: unsure has no `'amount'`. A word guess with `choices.categoryId`: unsure has no `'category'`.
  - `categoryGuess prefers history, then one word match`. `categoryGuess('cat-a', 'Parkir', opts)` → `{ id: 'cat-a', from: 'history' }`. With options `[{ id: 'p', name: 'Parking', parentName: 'Transport' }]`, `categoryGuess(null, 'Toko parking', opts)` → `{ id: 'p', from: 'word' }`. `categoryGuess(null, 'Xyz', opts)` → null.
  - `previewDay` → `'Today'` for today, `'Yesterday'` for 2026-11-09, `'28 Oct'` for 2026-10-28.
  - `foreignCharge converts at the day's rate, or says nothing (Review Focus)`. `{ amountMinor: 95_000, currency: 'KRW', payerCurrency: 'IDR', base: 'IDR', rates: { KRW: 11.5 } }` → `{ minor: 1_092_500, text: '1092500' }`. With `rates: {}` → null.
  - `lineDraft posts what the Add form posts`. For an IDR preview paid with nusa/nusa-a, category `'cat-a'`, the draft's `formToPost(draft, accounts)` (accounts: a credit-card liability `nusa` in IDR and an expense `cat-a`) has `kind: 'post'`, `input.cardId: 'nusa-a'`, `input.description: 'Kopi'`, and lines summing to zero with the expense line 38_000. For a KRW preview with `chargedText: '1092500'`, `input.originalCurrency` is `'KRW'` and `input.originalAmountMinor` is 95_000. With an empty description, `input.description` is `''` and nothing throws.
  - `baseOf` → `baseOf(38_000, 'IDR', 'IDR', {})` 38_000. `baseOf(1_250, 'USD', 'IDR', { USD: 16_000 })` equals `convertMinor(1_250, 'USD', 'IDR', 16_000)`.
  - `afterSave keeps the day and the paid-with` → `{ sittingDay: saved.occurredOn, lastPaid: saved.paid }`.
  - `withAccountDigits fills only missing digits`. Biru with `{ biru: '7720' }` gets `last4 '7720'`. Nusa keeps `'4417'`.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/features/transactions/one-line.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** `one-line.ts` with the signatures above. `lineDraft` = `{ ...emptyForm(bookId, preview.occurredOn), mode: 'expense', description, amount: minorToMajorString(amountMinor, currency), currency, chargedAmount: chargedText, moneyId: paid.accountId, cardId: paid.cardId ?? '', categoryId: categoryId ?? '' }`. `previewRow` returns a `ListRow` with `kind 'tx'`, `type 'expense'`, the preview's figure, `categoryId`/`categoryName`, `needsCategory: !categoryId`, `accountLabel: paid?.accountName ?? ''`, `last4: paid?.last4 ?? null`, and every other field at its empty value.
- [ ] **Step 4: Run** the same command and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add apps/web/src/features/transactions/one-line.ts apps/web/src/features/transactions/one-line.test.ts && git commit -m "One line: screen model (preview, fallbacks, unsure parts, Add form draft)"`

---

### Task 5: One line screen, route and e2e

**Files:**
- Create: `apps/web/src/features/transactions/OneLinePage.tsx`
- Modify: `apps/web/src/app/router.tsx`. Add `createRoute({ getParentRoute: () => rootRoute, path: '/transactions/line', component: OneLinePage })` beside `/transactions/paste`; "line" is static, so it beats `$transactionId`.
- Modify: `apps/web/src/features/transactions/TransactionRow.tsx`. Two optional props, nothing else changes:
  - `still?: boolean`: the face is drawn as a `<div>` instead of a `<button>`, so a caller's `label`/`subtitle`/`amount` may hold their own buttons (valid HTML, no nested buttons).
  - `amount?: ReactNode`: drawn in place of the formatted figure, inside the same coloured span.
- Test: `apps/web/e2e/phone-one-line.spec.ts` (new)

**Interfaces:**
- Consumes: Task 1 `readExpenseLine`. Task 2 `lastPaidWith`. Task 4: everything in `one-line.ts`. Existing pieces: `guessCategoryFromHistory`, `uncategorisedCategory`, `postTransaction`, `isPastDefault` (`@expanses/db`); `withCategoryLater`, `formToPost`, `rateDateFor` (`./tx-form`); `ratesForSave` (`./tx-save`); `useResolveRates`, `useAccounts`, `useInvalidateAll` (`lib/queries`); `useCards`, `useAccountNumberLast4`, `useWalletLast4` (`cards/card-queries`); `payableOptions`, `resolveDefaultPaidWith`, `useStoredDefaultPaidWith` (`account/default-paid-with`); `offeredCategories` + `useCategorySetMembership`; `useOpeningDay`; `useOpenBookReadOnly`; `CategoryPicker`, `PaymentSheet`, `Keypad`, `DateRow`, `NoteSuggestions`, `TransactionRow`; `useKeyboardInset`; `PushedTitle`; `useBack('/transactions')`; `usePhone`.
- Produces: the route `/transactions/line`, which Task 6 and the deep links navigate to. `TransactionRow`'s `still` and `amount` props.

Screen (spec "A · One line"; copy exact, no "you"):
- `PushedTitle title="One line" back="Cashflow" onBack={back}` with one corner action `{ key: 'done', label: 'Done', glyph: <Check/>, run: back }`. Rows already saved stay saved. When `useOpenBookReadOnly()` is true, draw only the title, as `NewTransactionRoute` does.
- Top: `data-testid="line-saved"` reads `{n} saved · {formatMinor(total, ws.baseCurrency)}`, shown once something is saved. Under it the saved rows as `TransactionRow` (`testId="line-saved-row"`, `phone`); `onOpen` navigates to `/transactions/$transactionId/edit`.
- Hint (muted, one line): `Shop, amount and how it was paid. Add “yesterday” or a date for another day.`
- Label `Will be saved as`, then `<TransactionRow still testId="line-preview" row={previewRow(preview, 'preview', name)} …/>`, using the same component the phone Cashflow list draws rows with. The lead circle's `onRecategorise` opens the category picker. `label` is a button (aria-label `Category`) with the category name, or `Uncategorised`. `subtitle` is `description · [Paid with button] · [Day button]` (aria-labels `Paid with`, `Day`). `amount` is a button (aria-label `Amount`) with `formatMinor(amountMinor, currency)`, or `Amount?` when none. An unsure part is `text-amber-700` with `data-unsure="true"`, and the unsure paid-with reads `{name}?`. When nothing pays, it reads `Paid with?` in amber.
- The field: `<input aria-label="One line" placeholder="Shop, amount, card" autoFocus enterKeyHint="done" autoCapitalize="off" autoCorrect="off" spellCheck={false}>` inside a `<form onSubmit>` that saves and keeps focus on the input (the keyboard stays open).
- Above the keyboard (`useKeyboardInset`; at the foot on a wide screen): `NoteSuggestions typed={reading.description} kind="expense" open={focused}` and a `Save` button (dimmed when `!canSaveLine(preview)` or busy). Picking a suggestion sets the field to `${suggestion.description} ${reading.rest}`.trim() + ' ', `choices.categoryId = suggestion.categoryId ?? undefined`, and `choices.paid` = the option for `await lastPaidWith(...)` when found.
- Pickers: Category opens `CategoryPicker kind="expense" lockKind`. Paid with opens `PaymentSheet title="Paid with" cards options={options}`. Amount opens `Keypad` on a phone, or a `Sheet title="Amount"` with one input on a wide screen (read by `settledAmount`/`parseGroupedMajor`). Day opens `Sheet title="Date"` holding `DateRow`. Each pick is written into `choices`.
- Category guess: `useQuery(['line-category', ws.workspaceId, ws.bookId, description])` → `guessCategoryFromHistory(database, ws, description, 'expense')` → `categoryGuess(id, description, offered.map(toCategoryOption))`.
- Save (a busy ref guards a second Return):
  1. `if (!canSaveLine(preview) || busy.current) return`.
  2. When `currency !== payerCurrency`: `rates = (await resolveRates([currency, payerCurrency], day)).rates`, then `foreignCharge(...)`. When that is null, show `No {currency}→{payerCurrency} rate for {day}. Record it from the Add screen.` and stop, keeping the text.
  3. `draft = lineDraft(preview, ws.bookId, charged?.text ?? '')`. When there is no category, `withCategoryLater(draft, await uncategorisedCategory(database, ws, 'expense'))`. Then `post = formToPost(...)` and `ratesToBase = await ratesForSave({ database, ws, draft, post, accounts, rateDate: rateDateFor(draft), needsRate: null, resolveRates, onMissing: () => {}, where: 'the Add screen' })`.
  4. `id = await postTransaction(database, ws, { ...post.input, ratesToBase, ...(moneyAccount && isPastDefault(openedOn, day) ? { pastPurchase: true } : {}) })`, then `await invalidate()`.
  5. Push `{ id, row, baseMinor: baseOf(settled, payerCurrency, ws.baseCurrency, ratesToBase) }`. Clear the text and `choices`. Apply `afterSave`.

- [ ] **Step 1: Write the failing e2e** `phone-one-line.spec.ts`. Set up with `openAccount(page, { subtype: 'bank', name: 'Bank Nusa', balance: '5000000' })` and `addTransaction(page, { description: 'warung sate', paidWith: 'Bank Nusa', category: 'Restaurants', amount: '10000' })` (invented). Then `page.goto('/transactions/line')`.
  - `a line is read into the preview and saved with Return, and the field stays for the next`. `getByLabel('One line')` is focused with placeholder `Shop, amount, card`. Fill `warung sate 45rb nusa`. `getByTestId('line-preview')` contains `Restaurants`, `Warung Sate`, `Bank Nusa`, `45.000`. No `[data-unsure="true"]` inside it. Press Enter. `getByTestId('line-saved')` contains `1 saved`. The field is empty and focused.
  - `note and amount are enough: paid-with falls back to the last one, shown unsure`. After the first save, fill `parkir 10rb`. The `Paid with` part has `data-unsure="true"` and text `Bank Nusa?`. The category reads `Uncategorised`. Press Enter. `2 saved`.
  - `the day and the card are kept for the next line`. Fill `kemarin kopi 20rb nusa`, Enter. Fill `roti 15rb`. The `Day` part reads `Yesterday`.
  - `a line with no amount does not save`. Fill `parkir`. The `Amount` part reads `Amount?`. `getByRole('button', { name: 'Save' })` is disabled. Enter leaves the count unchanged.
  - `a part is fixed from the preview`. Fill `toko buku 85rb nusa`. Tap `Category`. In `getByRole('dialog', { name: 'Select category' })` choose `Books`, or any default expense category name the setup has (check `e2e/categories.ts`). The preview shows it and its part has no `data-unsure`.
  - `two quick presses save one row (Review Focus)`. Fill `teh 5rb nusa`, press Enter twice without waiting. `line-saved` shows the count up by exactly one.
  - `Done leaves, and the saved rows are on Cashflow; a saved row opens its edit screen`. Tap a `line-saved-row`. The URL matches `/transactions/[^/]+/edit$`. Go back and tap `Done`. On `/transactions` the list contains `Warung Sate` and `Parkir`.
- [ ] **Step 2: Run** `cd apps/web && npx playwright test --project=phone e2e/phone-one-line.spec.ts`. Expected: FAIL (no route).
- [ ] **Step 3: Implement** `TransactionRow`'s `still`/`amount` props, `OneLinePage.tsx` and the route, as described above.
- [ ] **Step 4: Run** the e2e from Step 2, then `npx playwright test --project=phone e2e/phone-transaction-gestures.spec.ts e2e/phone-paste-list.spec.ts`. TransactionRow's other callers are unchanged. Run `npx vitest run src/features/transactions` and `npm run typecheck`. Expected: all PASS.
- [ ] **Step 5: Commit** `git add apps/web/src/features/transactions/OneLinePage.tsx apps/web/src/features/transactions/TransactionRow.tsx apps/web/src/app/router.tsx apps/web/e2e/phone-one-line.spec.ts && git commit -m "One line: the screen, its preview row and pickers"`

---

### Task 6: Hold-＋ menu, `cicis://add/...` links, Scan a receipt from a link

**Files:**
- Modify: `apps/web/src/app/TabBar.tsx`. A press-and-hold on ＋ opens the menu. A plain tap still calls `onAdd`.
- Create: `apps/web/src/app/AddMenu.tsx`, `apps/web/src/native/haptics.ts`
- Modify: `apps/web/src/native/deep-link.ts`, `apps/web/src/native/deep-link.test.ts`, `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/router.tsx`. `TransactionsSearch` gains `scan?: true`, and `/transactions`' `validateSearch` reads `scan: search.scan === true || search.scan === 'true' ? true : undefined`.
- Modify: `apps/web/src/features/transactions/TransactionsPage.tsx`. With `search.scan`, it drops the param (`replace: true`) and runs `scan.scan()` once (a ref guards StrictMode).
- Modify: `apps/web/package.json` + lock (`@capacitor/haptics@^8.0.2`), `apps/web/ios/App/CapApp-SPM/Package.swift` (via `npm run cap:sync`)
- Test: `apps/web/e2e/phone-add-menu.spec.ts` (new)

**Interfaces:**
- Consumes: the `/transactions/line` route (Task 5); `useScanReceipt` (already on TransactionsPage); `TabBar`'s state after Task 3 (no `md:hidden`).
- Produces:
  - `export type AddLink = 'line' | 'paste' | 'receipt'`
  - `export function addLinkOf(url: string): AddLink | null` (case-insensitive scheme, optional trailing slash, surrounding spaces)
  - `export function listenForAddLinks(open: (link: AddLink) => void): () => void`, the same shape as `listenForReviewLinks` (appUrlOpen + getLaunchUrl, no-op outside the shell)
  - `export function tapLight(): void` (`Haptics.impact({ style: ImpactStyle.Light })`, native only, errors swallowed)
  - `AddMenu({ onClose, onAdd }: { onClose: () => void; onAdd: () => void })`: `Sheet title="Add"` with four `InsetRow`s in this order: `One line` → `/transactions/line`, `Paste a list` → `/transactions/paste`, `Scan a receipt` → `{ to: '/transactions', search: { scan: true } }`, `Add transaction` → `onAdd()`.

- [ ] **Step 1: Write the failing tests.**
  - `deep-link.test.ts`, new `describe('an add link (quick ways A, D, E)')`: `addLinkOf('cicis://add/line')` `'line'`; `addLinkOf('CICIS://add/paste/')` `'paste'`; `addLinkOf(' cicis://add/receipt ')` `'receipt'`; `addLinkOf('cicis://add')`, `addLinkOf('cicis://add/other')`, `addLinkOf('cicis://review')`, `addLinkOf('https://example.com/add/line')` all null. `listenForAddLinks(open)()` with `isNative` mocked false never calls `open`.
  - `phone-add-menu.spec.ts`: `const plus = page.getByRole('button', { name: 'Add a transaction' })`.
    - `a plain tap on ＋ still opens the Add form`. Click `plus` → URL `/transactions/new`.
    - `holding ＋ opens the menu with the four ways`. `plus.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true })`, `page.waitForTimeout(600)`, `plus.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true })`. The dialog `Add` has the buttons `One line`, `Paste a list`, `Scan a receipt`, `Add transaction` in that order, and the URL is unchanged.
    - `each way goes where it says`. `One line` → `/transactions/line`. `Paste a list` → `/transactions/paste`. `Add transaction` → `/transactions/new`. `Scan a receipt` → URL `/transactions` with no `scan=` left in it and the error text `Not available here` shown (no camera in a browser).
    - `a press shorter than the hold is a tap`. pointerdown, wait 100ms, pointerup, click → `/transactions/new` and no `Add` dialog.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/native/deep-link.test.ts` and `npx playwright test --project=phone e2e/phone-add-menu.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `npm install -w @expanses/web @capacitor/haptics@^8.0.2 && cd apps/web && npm run cap:sync`.
  - The hold in `TabBar`: `onPointerDown` starts a 400ms timer; `onPointerUp`/`onPointerCancel`/`onPointerLeave` clear it. When it fires: `tapLight()`, open `AddMenu`, and remember to swallow the next `click`. `onContextMenu` (`preventDefault`) opens the menu too. Give the button `select-none` and `style={{ WebkitTouchCallout: 'none' }}`.
  - `App.tsx`: `useEffect(() => listenForAddLinks((link) => void router.navigate(link === 'line' ? { to: '/transactions/line' } : link === 'paste' ? { to: '/transactions/paste' } : { to: '/transactions', search: { scan: true } })), [])`.
- [ ] **Step 4: Run** the commands from Step 2, plus `npx playwright test --project=phone e2e/phone-add-transaction.spec.ts e2e/phone.spec.ts` (＋ unchanged) and `npm run typecheck`. Run the simulator build. Expected: all PASS, `** BUILD SUCCEEDED **`.
- [ ] **Step 5: Commit** every file listed above, with the message `Hold ＋ for One line, Paste a list, Scan a receipt; cicis://add links`.

---

### Task 7: Widget summary, web side, and the switch

**Files:**
- Create: `apps/web/src/native/widget-summary.ts`, `apps/web/src/native/widget-summary.test.ts`
- Create: `apps/web/src/features/account/WidgetSettingsPage.tsx`, `apps/web/src/features/account/use-widget-writer.ts`
- Modify: `apps/web/src/app/router.tsx` (route `/settings/widget`), `apps/web/src/app/nav.ts` (`SETTINGS_ITEMS` gains `{ to: '/settings/widget', label: 'Widget', icon: LayoutGrid }` after Capture), `apps/web/src/features/account/AccountMenuPage.tsx` (the filter on line 150 also hides `/settings/widget` unless `hasWidget()`), `apps/web/src/app/Layout.tsx` (calls `useWidgetSummaryWriter()`), `apps/web/src/features/recovery/StartFreshDialog.tsx` (`await WidgetSummary.erase().catch(() => undefined)` right after `wipeEverything()`)

**Interfaces:**
- Consumes: `budgetSheetFor`'s `spendingActualMinor`, `capsTotalMinor`, `currency` (via `useBudgetSheet(month)` in `features/budget/queries.ts`); `formatMinor`, `monthOf`, `isoDate`; `SwitchRow`, `InsetGroup`, `PushedTitle`.
- Produces (Task 8's Swift implements exactly this plugin, jsName `WidgetSummary`):

```ts
export interface WidgetSummary {
  bookId: string; month: string /* YYYY-MM */; amountMinor: number; currency: string;
  amountText: string /* formatMinor */; sharePercent: number | null; writtenAt: string /* ISO */;
}
export interface WidgetSummaryPluginApi {
  getEnabled(): Promise<{ enabled: boolean }>;          // false until switched on
  setEnabled(options: { enabled: boolean }): Promise<void>; // false erases the summary at once
  write(options: { summary: WidgetSummary }): Promise<void>; // ignored natively while disabled
  erase(): Promise<void>;
}
export const WidgetSummary: WidgetSummaryPluginApi; // registerPlugin('WidgetSummary', { web: WebPlugin no-op, getEnabled → false })
export const hasWidget: () => boolean;             // Capacitor.isNativePlatform() && getPlatform() === 'ios'
export function summaryOf(sheet: { spendingActualMinor: number; capsTotalMinor: number; currency: string }, at: { bookId: string; month: string; now: Date }): WidgetSummary;
/** What decides a rewrite: everything except writtenAt. */
export function summaryKey(summary: WidgetSummary): string;
export function useWidgetSummaryWriter(): void; // in use-widget-writer.ts
```

- [ ] **Step 1: Write the failing tests** (`widget-summary.test.ts`):
  - `summaryOf gives the month's spending and its share of the budget`. `summaryOf({ spendingActualMinor: 3_450_000, capsTotalMinor: 5_000_000, currency: 'IDR' }, { bookId: 'b1', month: '2026-11', now: new Date('2026-11-10T08:00:00Z') })` toEqual `{ bookId: 'b1', month: '2026-11', amountMinor: 3_450_000, currency: 'IDR', amountText: formatMinor(3_450_000, 'IDR'), sharePercent: 69, writtenAt: '2026-11-10T08:00:00.000Z' }`.
  - `has no share without a budget` → caps 0 gives `sharePercent` null.
  - `never shows less than nothing` → `spendingActualMinor: -20_000` gives `amountMinor` 0.
  - `rewrites for a new month or workspace, not for a new time (Review Focus)`. Same figures with a different `now` give an equal `summaryKey`. A different `month` or `bookId` gives a different key.
  - `the web has no widget` → `await WidgetSummary.getEnabled()` toEqual `{ enabled: false }`.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/native/widget-summary.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `useWidgetSummaryWriter`: does nothing unless `hasWidget()`. It reads `useQuery(['widget-enabled'], WidgetSummary.getEnabled)`, and only when that is on, `useBudgetSheet(monthOf(isoDate()))` (so the sheet is fetched only then). In an effect it builds `summaryOf(sheet, { bookId: ws.bookId ?? '', month, now: new Date() })` and calls `write` when `summaryKey` differs from a ref of the last key written. Every save invalidates all queries, so a spending change, a workspace switch (which removes queries) and a new month all lead to a rewrite. Leaving the open workspace switches to another, which replaces the summary.
  - `WidgetSettingsPage`: `PushedTitle title="Widget" back="Account" backTo="/account"`, then `InsetGroup` with `SwitchRow label="Show this month's spending on the widget"` (checked from `['widget-enabled']`; `onChange` → `setEnabled` → invalidate) and the footer `On the medium home screen widget, for the open workspace. Never on the lock screen.`
- [ ] **Step 4: Run** the test from Step 2, `npx vitest run src/app src/features/account`, `npx playwright test --project=phone e2e/phone-account.spec.ts e2e/phone-account-page.spec.ts` (the Widget row is hidden in a browser) and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** every file listed above, with the message `Widget summary: the switch, the writer and the bridge (web side)`.

---

### Task 8: Swift summary plugin in the App target

**Files:**
- Create: `apps/web/ios/App/App/WidgetSummaryStore.swift` (shared with the widget target in Task 9), `apps/web/ios/App/App/WidgetSummaryPlugin.swift`
- Modify: `apps/web/ios/App/App/AppViewController.swift` (`bridge?.registerPluginInstance(WidgetSummaryPlugin())`), `apps/web/ios/App/App.xcodeproj/project.pbxproj` (both files in the App group and the App target's Sources phase `504EC3001FED79650016851F`)

**Interfaces:**
- Consumes: the JS contract in Task 7 (method names, argument and result keys exactly as there).
- Produces, used by Task 9:

```swift
enum WidgetSummaryStore {
    static let suite = "group.com.cicis.app"           // the existing App Group
    static let enabledKey = "widget.totals.enabled"
    static let summaryKey = "widget.totals.summary"
    struct Summary: Codable { let bookId: String; let month: String; let amountMinor: Int; let currency: String
                              let amountText: String; let sharePercent: Int?; let writtenAt: String }
    static var isEnabled: Bool { get }                  // false when never set
    static func setEnabled(_ on: Bool)                  // false → erase()
    static func write(_ summary: Summary)               // no-op while !isEnabled
    static func erase()
    /** The summary only when switched on and written for the month `now` is in (yyyy-MM, Calendar.current). */
    static func current(now: Date) -> Summary?
}
```

`WidgetSummaryPlugin` follows `ICloudBackupPlugin`'s shape: `@objc(WidgetSummaryPlugin)`, `CAPPlugin, CAPBridgedPlugin`, `identifier "WidgetSummaryPlugin"`, `jsName "WidgetSummary"`, methods `getEnabled` / `setEnabled` / `write` / `erase`. `write` decodes `call.getObject("summary")` through `JSONSerialization` + `JSONDecoder` and rejects with code `failed` on a bad shape. Each change calls `WidgetCenter.shared.reloadAllTimelines()` (`import WidgetKit`).

- [ ] **Step 1: Write both Swift files and register the plugin.** pbxproj ids are new 24-hex ids not already in the file (for example the prefix `CB58…`), following the `CA57…` entries' format.
- [ ] **Step 2: Build for the simulator without signing** (command at the top). Expected: `** BUILD SUCCEEDED **`. Note in the commit body that the device check (the switch on and off, the summary in the App Group) waits for TestFlight.
- [ ] **Step 3: Commit** `git add apps/web/ios/App/App/WidgetSummaryStore.swift apps/web/ios/App/App/WidgetSummaryPlugin.swift apps/web/ios/App/App/AppViewController.swift apps/web/ios/App/App.xcodeproj/project.pbxproj && git commit -m "Widget summary: Swift plugin writing to the App Group"`

---

### Task 9: WidgetKit extension and Control Center control

**Files:**
- Create: `apps/web/ios/App/CicisWidgets/CicisWidgetsBundle.swift`, `AddExpenseWidget.swift`, `QuickAddWidget.swift`, `AddExpenseControl.swift`, `Info.plist`, `CicisWidgets.entitlements`
- Create: `apps/web/ios/App/App/OpenOneLineIntent.swift`, compiled into **both** the App target and the CicisWidgets target
- Modify: `apps/web/ios/App/App.xcodeproj/project.pbxproj`. A new `PBXNativeTarget` "CicisWidgets", modelled on CaptureShare (`CA5707012FE9A10100000001`). `WidgetSummaryStore.swift` (Task 8) is added to its Sources too.

**Interfaces:**
- Consumes: `WidgetSummaryStore.current(now:)` (Task 8); the links `cicis://add/line`, `cicis://add/receipt`, `cicis://add/paste` (Task 6).
- Produces: bundle id `com.cicis.app.widgets`, App Group `group.com.cicis.app`, iOS 17.0.

Contents (copy exact, no "you", no amounts on lock-screen families):
- `AddExpenseWidget`: kind `com.cicis.app.widgets.add`, families `[.systemSmall, .accessoryCircular]`, display name `Add expense`, description `Opens One line.` A static timeline. `widgetURL(URL(string: "cicis://add/line"))`. Small: a ＋ glyph and `Add expense`. Circular: a ＋ only.
- `QuickAddWidget`: kind `com.cicis.app.widgets.quick`, family `[.systemMedium]`, display name `Quick add`. Three `Link`s: `＋ Type` → `cicis://add/line`, `Receipt` → `cicis://add/receipt`, `Paste` → `cicis://add/paste`. Its timeline entry carries `WidgetSummaryStore.current(now: .now)`, with policy `.never` (the app reloads on write). When the summary is present, a line under the buttons: `"\(amountText) spent this month"` + `" · \(p)% of budget"` when `sharePercent` is set. When it is absent (switched off, never written, or another month: Review Focus), no line at all.
- `OpenOneLineIntent` (`@available(iOS 18.0, *)`, `AppIntent`): title `Add expense`, `static let openAppWhenRun = true`, `perform() async throws -> some IntentResult & OpensIntent { .result(opensIntent: OpenURLIntent(URL(string: "cicis://add/line")!)) }`.
- `AddExpenseControl` (`@available(iOS 18.0, *)`, `ControlWidget`): kind `com.cicis.app.widgets.control.add`, `StaticControlConfiguration { ControlWidgetButton(action: OpenOneLineIntent()) { Label("Add expense", systemImage: "plus") } }`, display name `Add expense`.
- `CicisWidgetsBundle` (`@main`): `AddExpenseWidget()`, `QuickAddWidget()`, and `if #available(iOSApplicationExtension 18.0, *) { AddExpenseControl() }`. On iOS 17 the control is simply not offered.
- `Info.plist`: copy CaptureShare's keys. `NSExtension` → `NSExtensionPointIdentifier` = `com.apple.widgetkit-extension` (no principal class). `CFBundleDisplayName` `cicis`.
- `CicisWidgets.entitlements`: `com.apple.security.application-groups` = `[group.com.cicis.app]`.
- Build settings, the same as CaptureShare's Debug/Release: `APPLICATION_EXTENSION_API_ONLY = YES`, `CODE_SIGN_ENTITLEMENTS = CicisWidgets/CicisWidgets.entitlements`, `CODE_SIGN_STYLE = Automatic`, `DEVELOPMENT_TEAM = JPMPS53HUZ`, `GENERATE_INFOPLIST_FILE = NO`, `INFOPLIST_FILE = CicisWidgets/Info.plist`, `IPHONEOS_DEPLOYMENT_TARGET = 17.0`, `PRODUCT_BUNDLE_IDENTIFIER = com.cicis.app.widgets`, `SKIP_INSTALL = YES`, `SWIFT_VERSION = 5.0`, `TARGETED_DEVICE_FAMILY = 1`, the same `LD_RUNPATH_SEARCH_PATHS`. The App target embeds `CicisWidgets.appex` in its "Embed Foundation Extensions" phase (`CA57070A2FE9A1010000000A`) and gains a `PBXTargetDependency` on it. `TargetAttributes` gives it `com.apple.ApplicationGroups.iOS` enabled.

- [ ] **Step 1: Write the extension files, the intent and the pbxproj target.**
- [ ] **Step 2: Build for the simulator without signing** (command at the top). Expected: `** BUILD SUCCEEDED **`. Also check that `ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app/PlugIns/CicisWidgets.appex` exists (`ls`).
- [ ] **Step 3: Optional local look.** `xcrun simctl install` the build on an iOS 18 simulator and add the small and medium widgets to the home screen. A tap opens One line. With the switch off, the medium widget shows no figure. A screenshot goes in the PR, not in the repo.
- [ ] **Step 4: Commit** `git add apps/web/ios/App/CicisWidgets apps/web/ios/App/App/OpenOneLineIntent.swift apps/web/ios/App/App.xcodeproj/project.pbxproj && git commit -m "Widgets and Control Center control: open One line, Receipt, Paste; totals only when switched on"`. The body must say: needs bundle id `com.cicis.app.widgets` registered with the App Group on the owner's Apple ID before archiving; device check in TestFlight.

---

## Self-review notes

- Spec coverage: A (Tasks 1, 4, 5), the hold-＋ menu and deep links (Task 6), B (Task 3), D's new ways in (Task 6 menu, Task 9 Paste button), E (Tasks 7–9), the copy rules (Global Constraints), and the Testing section (core: Task 1; web: Tasks 4–6; landscape 844×390: Task 3; iOS on device: noted in Tasks 8–9).
- Names are consistent across tasks: `readExpenseLine`/`ExpenseLineReading` (1 → 4, 5), `lastPaidWith` (2 → 5), `useSideways`/`rotationFor` (3 only), `/transactions/line` (5 → 6, 9), `AddLink` (6), `WidgetSummary`/`summaryKey` (7 ↔ 8), `WidgetSummaryStore.current` (8 → 9).
