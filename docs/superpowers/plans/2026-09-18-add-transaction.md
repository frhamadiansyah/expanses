# Add Transaction rebuild, the receipt, and the phone gestures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace today's flat `TransactionForm` with the Option B card — four tabs, short rows, an amount row with a currency flag and a "Charged in *base*" row, a keypad whose DONE works out sums, and "Add more details" holding Event, Split, With (several people), MCC, Channel, Photos and Exclude from report — add a receipt screen for every transaction, and give the phone its three gestures (tap → receipt, swipe → Edit/Delete, tap the icon → category) all leading to one edit sheet, without losing a single field or action, and without weakening the desktop.

**Architecture:** New facts go in side tables from migration 0048 — `transaction_flags` (channel, excluded) and `transaction_photos` (one row per photo) — never in columns on `transactions` or `accounts`, and every read and write of them is guarded by `extrasTablesExist(db)`, the same `WeakMap` guard `billTablesExist` uses. Photo bytes live in OPFS under `expanses-photos/`, written from the main thread, and reach backups as a store-only zip built by a pure function in `packages/core`. Event keeps the `transactions.event_id` column it already has; "With" is the existing `splitBill` with more than one share; the C2 currency row is the existing `original_currency` / `original_amount_minor` pair, so the derived rate needs no storage. Exclusion is enforced at four repository choke points and one in the web list. In `packages/db`: `categoryRows` in `reports.ts` (which covers the chart, the rings, `IncomeFlow`, the dashboard and the budget sheet in one change), `eventSpendingBetween` in the same file, `eventPlanFor` in `events.ts` — the function that replaced the `eventSheetFor` spec §11 names, which no longer exists — and the income/spending buckets of `periodFlows`. In `apps/web`: `dayTotal`, `totals` and `groupByCategory` in `list-model.ts`, which is what §11's last row and §4.4 mean by "the day's total in the list" and which no repository change can reach, because the list adds up `ListRow`s of its own. Balances, statements, points, Lend & borrow and net worth keep counting it everywhere. The web side is one card component (`TransactionCard`) and a row kit shared by the add form, the edit sheet and the full-form routes, plus one `TransactionRow` carrying the gestures in every transaction list.

**Tech Stack:** TypeScript monorepo — `packages/core` (pure), `packages/db` (Drizzle over sqlite-proxy, SQL migrations as `?raw` imports, `better-sqlite3` in tests), `apps/web` (React 19, TanStack Router/Query, Tailwind 4, SQLite wasm in a worker over OPFS); Vitest; Playwright (`chromium` and `phone` projects).

**Spec:** `docs/superpowers/specs/2026-09-18-add-transaction-design.md` (approved 2026-09-18)

## Global Constraints

- **No field and no action is lost.** §2 of the spec — the field map from `add-transaction.html` and the row actions from `quick-edit.html` — is the checklist. Before every commit that touches the form, the sheet or a row, re-read it and confirm each line still has a home. A field may move; none may disappear.
- **No new columns on existing tables** (`transactions`, `accounts`, `entries`, `expense_templates`, `cards`). The ORM names every column it knows on every insert, so a column there breaks any database still stopped at an older version (migration 0028's comment). New facts go in `transaction_flags` and `transaction_photos`.
- **Older databases:** every repository read or write of the two new tables goes through `extrasTablesExist(db)`; without them every function behaves exactly as it does today. Migration tests seed an older database through guarded repositories or with raw SQL naming only the columns that version had.
- **Desktop is never weaker than the phone.** Edit-in-place (`QuickRowEditor`) stays exactly as it is; the desktop gains ⓘ for the receipt, the category-icon picker, the same extras and the same keypad arithmetic through the keyboard. Every new control is reachable by keyboard and closes on Escape.
- **Photos never leave the device.** No upload, no `fetch`, no third-party library. Bytes go to OPFS from the main thread only, never through the worker and never inside the database's VFS directory.
- Migration **0048** is additive and backfills nothing: an absent row means "no channel, not excluded, no photos", which is what every existing transaction is. As read on `main` today, `MIGRATIONS` holds `{ version: 47, name: 'cash_equivalents' }` and `{ version: 49, name: 'event_plan_items' }` and **no 48** (`migrations.ts:106-107`); 48 is the free number and this project takes it. Because 0049 is already applied on every existing install, 0048 lands *after* 0049 in the real world — which is harmless (0048 is pure `CREATE TABLE` and touches nothing 0049 made) but must be tested, not assumed. `migrate` is set-based and sorted (`migrations.ts:179`), so it applies whatever is missing whatever the order.
- Inside `database.transaction((tx) => …)` use `tx` only — `database.db` there deadlocks on the mutex.
- Country-neutral: no Indonesia-specific presets, no country list, no locale-specific copy. In particular **no function in this project decides for itself which of `.` and `,` is a decimal point.** `parseMajor` (`money.ts:21-55`) is the one place that reads a typed figure, and it is separator-agnostic: *"The last '.' or ',' followed by 1..exponent digits is the decimal separator; every other '.' or ',' is a thousands separator."* Anything that reads a typed amount calls it. Only the tax report is local and it is not touched here.
- Test snippets name real functions and real signatures as read on 2026-09-18; if the compiler disagrees, re-read the type and match it rather than changing the function.
- Branch `feat/add-transaction`. Commit per task; merge and push only when the user asks. Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Gate before every commit, with no exceptions:** `npm run typecheck` (root), `npm test` (root), and `npx playwright test --workers=2` (in `apps/web`). A per-package run (`cd packages/core && npx vitest run …`) is the inner loop while a task is being written — the red step, and the first green — and is never the last thing run before a commit. Two tasks here change `packages/core` types that `packages/db` and `apps/web` compile against, and a per-package run cannot see that break; the root gate is what catches it. Every task's last **Run** step below therefore ends with all three commands.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/money/keypad.ts` | `evaluateAmount` — the keypad's and the desktop field's arithmetic |
| `packages/core/src/money/currencies.ts` | `flag` on `CurrencyInfo`, one per entry |
| `packages/core/src/debts/shares.ts` | `equalShares`, `yourShare` — With, split equally or custom |
| `packages/core/src/backup/zip.ts` | `zipStore`, `unzipStore` — store-only zip for the photo backup |
| `packages/core/src/points/earn.ts` | **(Task 4)** `RuleMatch.channel`, `SpendLine.channel`, one line in `matchesSpend` |
| `packages/core/src/index.ts` | export the above |
| `packages/core/test/keypad.test.ts`, `shares.test.ts`, `zip.test.ts`, `currency-flags.test.ts` | the pure tests (Task 1) |
| `packages/core/test/points-channel.test.ts` | **(Task 4)** a rule that earns only online |
| `packages/db/migrations/0048_transaction_extras.sql` | `transaction_flags`, `transaction_photos`, index |
| `packages/db/src/migrations.ts` | register 0048 |
| `packages/db/src/schema-extras.ts` | Drizzle `transactionFlags`, `transactionPhotos` |
| `packages/db/src/repos/transaction-extras.ts` | `extrasTablesExist`, `writeExtrasTx`, `extrasForTx`, `movePhotosTx`, `extrasFor`, `notExcluded`, `addPhoto`, `listPhotos`, `deletePhoto`, `allPhotoRows`, `allPhotoFileNames` |
| `packages/db/src/repos/ledger.ts` | `channel`/`excludedFromReport`/`eventId`/`photoIds` on posting; `replaceTransaction` carries them; `TransactionView.channel`, `.excluded`, `.photoCount`; `ListTransactionsOptions.id` |
| `packages/db/src/repos/reports.ts` | `categoryRows` leaves excluded out; so does `eventSpendingBetween` |
| `packages/db/src/repos/events.ts` | `eventPlanFor`'s actuals leave excluded out (spec §11's event-sheet row) |
| `packages/db/src/repos/flows.ts` | `periodFlows` leaves excluded out of income and spending only |
| `packages/db/src/repos/points.ts` | `cardSpendLines` reads the channel |
| `packages/db/src/repos/debts.ts` | `splitBill` carries channel, exclusion and event |
| `packages/db/src/repos/people.ts` | `recentPeople` — who to offer as chips under With |
| `packages/db/src/index.ts` | export the above |
| `packages/db/test/transaction-extras.test.ts` | flags, photos, replace, older databases |
| `packages/db/test/transaction-extras-migration.test.ts` | 0048 on a version-47 database |
| `packages/db/test/excluded-figures.test.ts` | what drops out and what does not |
| `packages/db/test/split-bill-people.test.ts` | three shares, one bill |
| `packages/db/test/database.test.ts` | applied-versions list gains 48 |
| `apps/web/src/photos/store.ts` (+ `.test.ts`) | the OPFS photo store, orphan sweep |
| `apps/web/src/photos/memory-directory.ts` | **(Task 6)** an in-memory `FileSystemDirectoryHandle` stand-in, so `store.test.ts` needs no OPFS |
| `apps/web/src/features/transactions/list-model.ts` (+ `.test.ts`) | **(Task 9)** `ListRow.excluded`; `dayTotal`, `totals` and `groupByCategory` ignore an excluded row |
| `apps/web/src/features/transactions/receipt-view.ts` (+ `.test.ts`) | **(Task 7)** `receiptLines` — a `TransactionView` and its neighbours turned into B8's lines |
| `apps/web/src/features/transactions/tx-form.ts` (+ `.test.ts`) | `FormDraft`, `emptyForm`, `formFromTransaction`, `formToPost`, `chargedInNeeded`, `extraRows`, `canEditInSheet` |
| `apps/web/src/features/transactions/FormRow.tsx` | the 48px row: glyph, label, value, chevron |
| `apps/web/src/features/transactions/AmountRow.tsx` | the amount row, the flag, the "Charged in" row |
| `apps/web/src/features/transactions/CurrencySheet.tsx` | recent, all, search |
| `apps/web/src/features/transactions/Keypad.tsx` | the dock keypad; DONE evaluates |
| `apps/web/src/features/transactions/TransactionCard.tsx` | the Option B card: tabs and rows, all four modes |
| `apps/web/src/features/transactions/MoreDetails.tsx` | the Add more details card and its rows |
| `apps/web/src/features/transactions/EventSheet.tsx`, `SplitSheet.tsx`, `WithSheet.tsx`, `ChannelSheet.tsx`, `PhotosSheet.tsx`, `McSheet.tsx` | one screen per extra |
| `apps/web/src/features/transactions/CategoryPicker.tsx`, `NewCategorySheet.tsx` | B7 and B7a |
| `apps/web/src/features/transactions/ReceiptPage.tsx` | B8 |
| `apps/web/src/features/transactions/EditSheet.tsx` | F3 |
| `apps/web/src/features/transactions/TransactionRow.tsx` | one list row: tap, swipe, category icon, Excluded pill |
| `apps/web/src/features/transactions/FormPage.tsx` | `/transactions/new` and `/transactions/$transactionId/edit` |
| `apps/web/src/ui/SwipeRow.tsx`, `apps/web/src/ui/UndoToast.tsx` | moved out of `features/bills/`, `SwipeRow` gains `reveal` |
| `apps/web/src/features/categories/CategoryIcon.tsx` | prefers an account's own `icon` |
| `apps/web/src/features/backup/BackupPage.tsx` | download and restore photos |
| `apps/web/src/app/router.tsx` | `/transactions/new`, `/transactions/$transactionId`, `/transactions/$transactionId/edit` |
| `apps/web/src/app/Layout.tsx`, `features/transactions/TransactionsPage.tsx`, `TransactionsTable.tsx` | open the new card instead of `TransactionForm` |
| Deleted: `apps/web/src/features/transactions/TransactionForm.tsx` | replaced by `TransactionCard` + `FormPage` |
| `apps/web/e2e/add-transaction.ts` | **(created in Task 10)** the shared helper every existing spec now uses |
| `apps/web/e2e/add-transaction.spec.ts` | **(created in Task 10)** chromium flows through the card |
| `apps/web/e2e/transaction-receipt.spec.ts` | **(created in Task 7, grown in Task 17)** the receipt on a desktop |
| `apps/web/e2e/phone-transaction-gestures.spec.ts` | **(created in Task 9, grown in Tasks 14 and 18)** tap, swipe, category icon |
| `apps/web/e2e/phone-add-transaction.spec.ts` | **(created in Task 15, grown in Task 18)** the keypad, the flag, the extras by thumb |

---

## Step 1 — What has to be stored

### Task 1: The pure parts — keypad arithmetic, shares, flags, zip

**Files:**
- Create: `packages/core/src/money/keypad.ts`, `packages/core/src/debts/shares.ts`, `packages/core/src/backup/zip.ts`
- Modify: `packages/core/src/money/currencies.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/keypad.test.ts`, `packages/core/test/shares.test.ts`, `packages/core/test/currency-flags.test.ts`, `packages/core/test/zip.test.ts`

**Interfaces:**
- Produces: `evaluateAmount(expression: string, currency: string): number | null`; `equalShares(totalMinor: number, people: number): { yours: number; each: number[] }`; `yourShare(totalMinor: number, shares: readonly number[]): number`; `CurrencyInfo.flag`; `zipStore(files: readonly { name: string; bytes: Uint8Array }[]): Uint8Array`; `unzipStore(archive: Uint8Array): { name: string; bytes: Uint8Array }[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/keypad.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateAmount, parseMajor } from '../src/index';

/*
 * Every figure the keypad reads is read by `parseMajor`, which is separator-agnostic: the last "." or "," followed
 * by 1..exponent digits is the decimal, every other one groups thousands. This file never states a second opinion
 * about separators — the first test below is the contract, and the rest are arithmetic on top of it.
 */
describe('what DONE works out', () => {
  // A single figure is exactly what the rest of the app would make of it. This is the whole of the convention:
  // if `evaluateAmount` and `parseMajor` ever part company, this test is the one that says so.
  it.each([
    ['85000', 'IDR'],
    ['85.000', 'IDR'],
    ['85,000', 'IDR'],
    ['1.234.567', 'IDR'],
    ['10.50', 'USD'],
    ['10,50', 'USD'],
    ['1,234.56', 'USD'],
    ['1.234,56', 'USD'],
    ['120', 'JPY'],
  ])('reads %s (%s) exactly as parseMajor does', (typed, currency) => {
    expect(evaluateAmount(typed, currency)).toBe(parseMajor(typed, currency));
  });

  it('adds and subtracts', () => {
    expect(evaluateAmount('120000+35000', 'IDR')).toBe(155_000);
    expect(evaluateAmount('100000−25000', 'IDR')).toBe(75_000);
    expect(evaluateAmount('100000-25000', 'IDR')).toBe(75_000);
    // Each operand is read by parseMajor, so a grouped figure adds up the same as a bare one.
    expect(evaluateAmount('120.000+35.000', 'IDR')).toBe(155_000);
    expect(evaluateAmount('10.50+2.25', 'USD')).toBe(1275);
  });

  it('multiplies and divides by a plain count, before it adds', () => {
    expect(evaluateAmount('85000×3', 'IDR')).toBe(255_000);
    expect(evaluateAmount('85000*3', 'IDR')).toBe(255_000);
    expect(evaluateAmount('450000÷4', 'IDR')).toBe(112_500);
    expect(evaluateAmount('10000+2000×3', 'IDR')).toBe(16_000);
    // The count is a count, not money: "3" after × is three of them, whatever the currency's exponent.
    expect(evaluateAmount('10.50×3', 'USD')).toBe(3150);
  });

  it('refuses a count that is not a whole number, rather than guessing what it meant', () => {
    expect(evaluateAmount('85000×2.5', 'IDR')).toBeNull();
    expect(evaluateAmount('85000÷1,5', 'IDR')).toBeNull();
  });

  it('rounds to the currency, away from zero', () => {
    expect(evaluateAmount('100÷3', 'IDR')).toBe(33);
    expect(evaluateAmount('10.00÷3', 'USD')).toBe(333);
  });

  it('gives nothing back when it cannot be read, so the row keeps what it had', () => {
    expect(evaluateAmount('', 'IDR')).toBeNull();
    expect(evaluateAmount('85000+', 'IDR')).toBeNull();
    expect(evaluateAmount('abc', 'IDR')).toBeNull();
    expect(evaluateAmount('85000÷0', 'IDR')).toBeNull();
    // parseMajor throws on a figure with more decimals than the currency allows; DONE turns that into "not read"
    // rather than letting a MoneyError out of a keypad. (`parseMajor('100,50', 'IDR')` throws: IDR has no cents.)
    expect(() => parseMajor('100,50', 'IDR')).toThrow();
    expect(evaluateAmount('100,50', 'IDR')).toBeNull();
    // An amount is never negative: the sign is the mode, not the figure.
    expect(evaluateAmount('25000−85000', 'IDR')).toBeNull();
    expect(evaluateAmount('0', 'IDR')).toBeNull();
  });
});
```

```ts
// packages/core/test/shares.test.ts
import { describe, expect, it } from 'vitest';
import { equalShares, yourShare } from '../src/index';

describe('splitting a bill equally', () => {
  it('divides by everyone including you', () => {
    expect(equalShares(400_000, 3)).toEqual({ yours: 100_000, each: [100_000, 100_000, 100_000] });
  });

  it('gives you the remainder, so the shares add back to the bill', () => {
    const split = equalShares(100, 2);
    expect(split).toEqual({ yours: 34, each: [33, 33] });
    expect(split.yours + split.each.reduce((sum, one) => sum + one, 0)).toBe(100);
  });

  it('is the whole bill when nobody else was there', () => {
    expect(equalShares(85_000, 0)).toEqual({ yours: 85_000, each: [] });
  });
});

describe('typing each share', () => {
  it('leaves you the rest', () => {
    expect(yourShare(400_000, [150_000, 120_000])).toBe(130_000);
  });

  it('can leave you nothing at all', () => {
    expect(yourShare(400_000, [400_000])).toBe(0);
  });

  it('refuses shares that come to more than the bill', () => {
    expect(() => yourShare(400_000, [300_000, 200_000])).toThrow(/more than the bill/);
  });
});
```

```ts
// packages/core/test/currency-flags.test.ts
import { describe, expect, it } from 'vitest';
import { CURRENCIES, currencyInfo } from '../src/index';

describe('the flag on the amount row', () => {
  it('is there for every currency the app knows', () => {
    expect(CURRENCIES.filter((c) => !c.flag)).toEqual([]);
  });

  it('is the country the money belongs to', () => {
    expect(currencyInfo('IDR').flag).toBe('🇮🇩');
    expect(currencyInfo('JPY').flag).toBe('🇯🇵');
    expect(currencyInfo('EUR').flag).toBe('🇪🇺');
  });
});
```

```ts
// packages/core/test/zip.test.ts
import { describe, expect, it } from 'vitest';
import { unzipStore, zipStore } from '../src/index';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('the photo archive', () => {
  it('is a zip any computer can open', () => {
    const archive = zipStore([{ name: 'a.jpg', bytes: bytes('first') }]);
    expect([...archive.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('comes back as it went in', () => {
    const files = [
      { name: '0192f0.jpg', bytes: bytes('a photo of a receipt') },
      { name: '0192f1.png', bytes: new Uint8Array([0, 1, 2, 250, 255]) },
    ];
    expect(unzipStore(zipStore(files))).toEqual(files);
  });

  it('is empty when there are no photos', () => {
    expect(unzipStore(zipStore([]))).toEqual([]);
  });

  /*
   * The CRC32 table is the part most likely to be written wrong, and a wrong one round-trips perfectly through our
   * own reader — so the round trip above cannot catch it. These are the values every zip tool computes; the second
   * is the standard CRC32 check value for "123456789", which is what a table is verified against.
   */
  it('writes the CRC every other zip tool will check', () => {
    const crcAt = (archive: Uint8Array, offset: number) =>
      new DataView(archive.buffer, archive.byteOffset).getUint32(offset, true);
    // The local file header: PK\3\4, version, flags, method, time, date, then the CRC at byte 14.
    expect(crcAt(zipStore([{ name: 'a.txt', bytes: bytes('123456789') }]), 14)).toBe(0xcbf43926);
    expect(crcAt(zipStore([{ name: 'a.txt', bytes: bytes('') }]), 14)).toBe(0);
    expect(crcAt(zipStore([{ name: 'a.txt', bytes: new Uint8Array([0]) }]), 14)).toBe(0xd202ef8d);
  });

  it('refuses an archive whose bytes do not match the CRC recorded for them', () => {
    const archive = zipStore([{ name: 'a.txt', bytes: bytes('123456789') }]);
    // The stored data starts at byte 35: a 30-byte local header plus the 5-byte name "a.txt".
    const tampered = new Uint8Array(archive);
    tampered[35] = tampered[35]! ^ 0xff;
    expect(() => unzipStore(tampered)).toThrow(/does not match/);
  });
});
```

- [ ] **Step 2: Run and see it fail** — `cd packages/core && npx vitest run` → FAIL (`evaluateAmount` and the rest are not exported).

- [ ] **Step 3: Implement**

`packages/core/src/money/keypad.ts` — tokenise, read every *figure* with `parseMajor` so the keypad and the rest of
the app can never disagree, work in minor units, × and ÷ before + and −, and round once at the end:

```ts
import { MoneyError, parseMajor, roundHalfAwayFromZero } from './money';

/**
 * A figure as typed, in minor units — read by `parseMajor` and by nothing else.
 *
 * This function exists only to turn `parseMajor`'s MoneyError into "cannot be read". It must never inspect "."
 * or "," itself: which of them is a decimal point depends on the figure, not on a country, and `parseMajor`
 * (money.ts:21-55) is the one place in the app that decides it. Re-implementing that rule here is how a keypad
 * ends up reading "10.50" as a thousand and fifty dollars.
 */
function figure(text: string, currency: string): number | null {
  try {
    const minor = parseMajor(text, currency);
    return minor < 0 ? null : minor;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

/** A plain count — how many of a thing, not an amount of money, so it is a whole number and never parsed as money. */
function count(text: string): number | null {
  return /^\d+$/.test(text) ? Number(text) : null;
}

/**
 * What DONE works out, in minor units: a plain amount, or a sum of them with × and ÷ by a plain count.
 *
 * Null when it cannot be read or comes to nothing or less, so the amount row keeps whatever it had and the keypad
 * stays open. Rounded once at the end, so 100÷3 three times over is still the bill.
 */
export function evaluateAmount(expression: string, currency: string): number | null {
  const normalised = expression.replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\s+/g, '');
  if (!normalised || /^[+\-*/]/.test(normalised) || /[+\-*/]$/.test(normalised)) return null;
  const parts = normalised.split(/([+\-*/])/);
  const values: number[] = [];
  const adds: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i] ?? '';
    const operator = parts[i - 1];
    if (operator === '*' || operator === '/') {
      // The operand after × or ÷ is a count of things, so it is read as a whole number. Reading it as money would
      // multiply a dollar amount by 300 when the user typed 3.
      const times = count(text);
      if (times === null) return null;
      const last = values.length - 1;
      if (operator === '/') {
        if (times === 0) return null;
        values[last] = values[last]! / times;
      } else {
        values[last] = values[last]! * times;
      }
    } else {
      const value = figure(text, currency);
      if (value === null) return null;
      values.push(value);
      if (operator) adds.push(operator);
    }
  }
  let total = values[0] ?? 0;
  for (const [index, operator] of adds.entries()) total = operator === '-' ? total - values[index + 1]! : total + values[index + 1]!;
  const minor = roundHalfAwayFromZero(total);
  return minor > 0 && Number.isSafeInteger(minor) ? minor : null;
}
```

`parseMajor`, `MoneyError` and `roundHalfAwayFromZero` are all already exported from `./money`; `currencyInfo` is
not needed here, because `parseMajor` applies the currency's exponent itself.

`packages/core/src/debts/shares.ts`:

```ts
/**
 * A bill split equally between everyone who was there, you included.
 *
 * The remainder goes to you rather than being spread about, so the shares always add back to the bill and
 * nobody is asked for a rupiah more than their share.
 */
export function equalShares(totalMinor: number, people: number): { yours: number; each: number[] } {
  if (people <= 0) return { yours: totalMinor, each: [] };
  const each = Math.floor(totalMinor / (people + 1));
  return { yours: totalMinor - each * people, each: Array.from({ length: people }, () => each) };
}

/** What is left for you once each person's share has been typed. */
export function yourShare(totalMinor: number, shares: readonly number[]): number {
  const theirs = shares.reduce((sum, share) => sum + share, 0);
  if (theirs > totalMinor) throw new Error('Their shares come to more than the bill');
  return totalMinor - theirs;
}
```

`packages/core/src/money/currencies.ts` — add `flag: string` to `CurrencyInfo` and one flag per entry: IDR 🇮🇩, USD 🇺🇸, SGD 🇸🇬, MYR 🇲🇾, THB 🇹🇭, CNY 🇨🇳, JPY 🇯🇵, KRW 🇰🇷, HKD 🇭🇰, TWD 🇹🇼, PHP 🇵🇭, AUD 🇦🇺, EUR 🇪🇺, GBP 🇬🇧, KWD 🇰🇼.

`packages/core/src/backup/zip.ts` — a store-only (method 0) writer and reader: local header, data, central directory, end-of-central-directory, with a table-driven CRC32 (the standard reflected polynomial `0xedb88320`, table built once at module load). No compression, no dependency. `unzipStore` recomputes each entry's CRC and throws `new Error('The archive is damaged: <name> does not match the checksum recorded for it')` when it differs, so a half-copied zip is refused rather than restored as broken pictures. Keep it under 140 lines and comment that it exists so photos can travel with a backup without a library.

Export all of it from `packages/core/src/index.ts`.

- [ ] **Step 4: Run** — `cd packages/core && npx vitest run` → all pass. Then the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green. `CurrencyInfo` gains a required field here, so the root run is what proves `packages/db` and `apps/web` still compile.

- [ ] **Step 5: Commit** — `git commit -am "feat(core): what DONE works out, how a bill divides, a flag per currency, and a zip for photos"` (with the trailer; `git add` the new files first).

---

### Task 2: Migration 0048 — channel, exclusion and photo rows

**Files:**
- Create: `packages/db/migrations/0048_transaction_extras.sql`, `packages/db/src/schema-extras.ts`, `packages/db/src/repos/transaction-extras.ts`
- Modify: `packages/db/src/migrations.ts`, `packages/db/src/repos/ledger.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/transaction-extras.test.ts`, `packages/db/test/transaction-extras-migration.test.ts`, `packages/db/test/database.test.ts`

**Interfaces:**
- Produces: `extrasTablesExist(db)`, `writeExtrasTx`, `extrasForTx`, `movePhotosTx`, `extrasFor`, `notExcluded(ws)`, `addPhoto`, `listPhotos`, `deletePhoto`, `allPhotoRows`, `allPhotoFileNames`, `TransactionPhotoRow`; `PostTransactionInput.channel | excludedFromReport | eventId | photoIds`; `TransactionView.channel | excluded | photoCount`; `ListTransactionsOptions.id`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/transaction-extras.test.ts
import { expenseLines } from '@expanses/core';
import { afterEach, expect, it } from 'vitest';
import { addPhoto, createAccount, listAccounts, listPhotos, listTransactions, postTransaction, replaceTransaction, saveEvent } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function purchase(extra: { channel?: 'online' | 'offline' | null; excludedFromReport?: boolean } = {}) {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const electronics = (await listAccounts(database, ws)).find((a) => a.systemKey === 'shopping.electronics')!.id;
  const id = await postTransaction(database, ws, {
    occurredOn: '2026-09-17',
    description: 'iPhone for Mama',
    lines: expenseLines({ categoryAccountId: electronics, paymentAccountId: card.id, amountMinor: 18_999_000, currency: 'IDR' }),
    ...extra,
  });
  return { database, ws, card, electronics, id };
}

it('keeps a channel and an exclusion beside the transaction, not on it', async () => {
  const p = await purchase({ channel: 'online', excludedFromReport: true });
  const [tx] = await listTransactions(p.database, p.ws);
  expect(tx).toMatchObject({ id: p.id, channel: 'online', excluded: true });
});

it('says nothing was chosen when nothing was', async () => {
  const p = await purchase();
  const [tx] = await listTransactions(p.database, p.ws);
  expect(tx).toMatchObject({ channel: null, excluded: false, photoCount: 0 });
});

it('counts the photos a transaction carries', async () => {
  const p = await purchase();
  await addPhoto(p.database, p.ws, { transactionId: p.id, fileName: '0192f0.jpg', mime: 'image/jpeg', byteSize: 1234 });
  await addPhoto(p.database, p.ws, { transactionId: p.id, fileName: '0192f1.jpg', mime: 'image/jpeg', byteSize: 4321 });
  const [tx] = await listTransactions(p.database, p.ws);
  expect(tx!.photoCount).toBe(2);
  expect((await listPhotos(p.database, p.ws, p.id)).map((row) => row.fileName)).toEqual(['0192f0.jpg', '0192f1.jpg']);
});

it('carries the channel, the exclusion and the photos onto a correction', async () => {
  const p = await purchase({ channel: 'offline', excludedFromReport: true });
  await addPhoto(p.database, p.ws, { transactionId: p.id, fileName: '0192f0.jpg', mime: 'image/jpeg', byteSize: 1234 });
  const replacement = await replaceTransaction(p.database, p.ws, p.id, {
    occurredOn: '2026-09-17',
    description: 'iPhone for Mama',
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 18_499_000, currency: 'IDR' }),
  });
  const [tx] = await listTransactions(p.database, p.ws);
  expect(tx).toMatchObject({ id: replacement, channel: 'offline', excluded: true, photoCount: 1 });
  expect(await listPhotos(p.database, p.ws, p.id)).toEqual([]);
});

it('lets a correction clear what was chosen', async () => {
  const p = await purchase({ channel: 'offline', excludedFromReport: true });
  const replacement = await replaceTransaction(p.database, p.ws, p.id, {
    occurredOn: '2026-09-17',
    description: 'iPhone for Mama',
    channel: null,
    excludedFromReport: false,
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 18_999_000, currency: 'IDR' }),
  });
  const [tx] = await listTransactions(p.database, p.ws);
  expect(tx).toMatchObject({ id: replacement, channel: null, excluded: false });
});

it('files the transaction under the event it was tagged to when it was recorded', async () => {
  const p = await purchase();
  const eventId = await saveEvent(p.database, p.ws, { name: 'Singapore holiday', startsOn: '2026-09-01', endsOn: '2026-09-30' });
  const id = await postTransaction(p.database, p.ws, {
    occurredOn: '2026-09-18',
    description: 'Hotpot',
    eventId,
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 250_000, currency: 'IDR' }),
  });
  expect((await listTransactions(p.database, p.ws, { eventId })).map((tx) => tx.id)).toEqual([id]);
});

/*
 * The event is the one fact `replaceTransaction` already carried before this project, and it carried it with an
 * unconditional update after the posting — so it could be kept but never taken off. The two tests are a pair: the
 * first is the behaviour that must not change, the second is the one that was impossible.
 */
it('keeps the event on a correction that does not mention it', async () => {
  const p = await purchase();
  const eventId = await saveEvent(p.database, p.ws, { name: 'Singapore holiday', startsOn: '2026-09-01', endsOn: '2026-09-30' });
  const id = await postTransaction(p.database, p.ws, {
    occurredOn: '2026-09-18',
    description: 'Hotpot',
    eventId,
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 250_000, currency: 'IDR' }),
  });
  const replacement = await replaceTransaction(p.database, p.ws, id, {
    occurredOn: '2026-09-18',
    description: 'Hotpot for four',
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 320_000, currency: 'IDR' }),
  });
  expect((await listTransactions(p.database, p.ws, { eventId })).map((tx) => tx.id)).toEqual([replacement]);
});

it('takes the event off when the correction says to', async () => {
  const p = await purchase();
  const eventId = await saveEvent(p.database, p.ws, { name: 'Singapore holiday', startsOn: '2026-09-01', endsOn: '2026-09-30' });
  const id = await postTransaction(p.database, p.ws, {
    occurredOn: '2026-09-18',
    description: 'Hotpot',
    eventId,
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 250_000, currency: 'IDR' }),
  });
  const replacement = await replaceTransaction(p.database, p.ws, id, {
    occurredOn: '2026-09-18',
    description: 'Hotpot',
    eventId: null,
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 250_000, currency: 'IDR' }),
  });
  expect(await listTransactions(p.database, p.ws, { eventId })).toEqual([]);
  expect((await listTransactions(p.database, p.ws)).map((tx) => tx.id)).toContain(replacement);
});

it('keeps the pictures in the order they were picked, whatever SQLite feels like returning', async () => {
  const p = await purchase();
  for (const fileName of ['0192f2.jpg', '0192f0.jpg', '0192f1.jpg']) {
    await addPhoto(p.database, p.ws, { transactionId: p.id, fileName, mime: 'image/jpeg', byteSize: 10 });
  }
  expect((await listPhotos(p.database, p.ws, p.id)).map((row) => [row.fileName, row.sortOrder])).toEqual([
    ['0192f2.jpg', 0],
    ['0192f0.jpg', 1],
    ['0192f1.jpg', 2],
  ]);
});

it('adopts the photos a form wrote before the transaction had an id', async () => {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const electronics = (await listAccounts(database, ws)).find((a) => a.systemKey === 'shopping.electronics')!.id;
  // What PhotosSheet does while the form is still open: the file is written, the row is written, nothing owns it yet.
  const photoId = await addPhoto(database, ws, { transactionId: '', fileName: '0192f9.jpg', mime: 'image/jpeg', byteSize: 77 });
  const id = await postTransaction(database, ws, {
    occurredOn: '2026-09-17',
    description: 'iPhone for Mama',
    photoIds: [photoId],
    lines: expenseLines({ categoryAccountId: electronics, paymentAccountId: card.id, amountMinor: 18_999_000, currency: 'IDR' }),
  });
  expect((await listPhotos(database, ws, id)).map((row) => row.id)).toEqual([photoId]);
  expect((await listTransactions(database, ws))[0]).toMatchObject({ id, photoCount: 1 });
});
```

`addPhoto` returns the new row's id (`Promise<string>`), which is what `draft.photoIds` holds and what
`writeExtrasTx` re-keys. It is a `transaction_photos.id`, **not** an OPFS file name — Task 15 depends on the
difference.

```ts
// packages/db/test/transaction-extras-migration.test.ts
import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccount, createDatabase, createWorkspace, listAccounts, listTransactions, migrate, MIGRATIONS, postTransaction } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

describe('migration 0048', () => {
  it('is version 48 and named transaction_extras', () => {
    expect(MIGRATIONS.find((m) => m.version === 48)).toMatchObject({ name: 'transaction_extras' });
  });

  it('adds the tables to a database stopped at 47, changing no figure', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 47));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-17',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 250_000, currency: 'IDR' }),
    });

    // Before the migration: the reads behave exactly as they did, and say nothing was chosen.
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id, channel: null, excluded: false, photoCount: 0 });

    // `migrate` is set-based and sorted (migrations.ts:179), so it applies everything this build has that the
    // database has not: 0048 and the 0049 that is already on main.
    expect(await migrate(database)).toEqual([48, 49]);
    const rows = await database.db.values<[number]>(sql`SELECT count(*) FROM transaction_flags`);
    expect(Number(rows[0]![0])).toBe(0);
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id, channel: null, excluded: false, photoCount: 0 });
  });

  /*
   * The path every existing install actually takes. 0049 shipped before this branch, so on a real database 0048 is
   * applied *after* it, not before. It is benign — 0048 is two CREATE TABLEs that touch nothing 0049 made — but
   * "benign" is a claim, and a claim the other test cannot make: there the two arrive together, lowest first.
   */
  it('applies on top of a database that already has 0049', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 47 || m.version === 49));
    expect(await migrate(database)).toEqual([48]);
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-17',
      description: 'Superindo',
      channel: 'offline',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 250_000, currency: 'IDR' }),
    });
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id, channel: 'offline', excluded: false });
  });
});
```

In `packages/db/test/database.test.ts`, the applied-versions list on line 20 reads
`…, 43, 44, 45, 46, 47, 49]` today. Insert `48` **between 47 and 49** — the list is what `migrate` returns, which is
sorted ascending, so appending it would fail. The line becomes `…, 43, 44, 45, 46, 47, 48, 49]`.

- [ ] **Step 2: Run and see it fail** — `cd packages/db && npx vitest run test/transaction-extras.test.ts` → FAIL (`addPhoto` missing, `channel` unknown).

- [ ] **Step 3: The migration and the schema**

`packages/db/migrations/0048_transaction_extras.sql`:

```sql
/* What a purchase was, beside what it cost.

   Three facts the form now records: whether it was bought online or in a shop, whether it should stay out of the
   chart and the budgets, and the receipt photos kept for it. None of them is a column on transactions: the ORM
   names every column it knows on every insert, so a column there would break any database still stopped at an
   older version (see 0028). Nothing is backfilled — no row means no channel, not excluded, no photos, which is
   what every transaction recorded until now is. */
CREATE TABLE transaction_flags (
  transaction_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  /* 'online', 'offline', or NULL for "not said". Never guessed. */
  channel TEXT,
  /* 1 leaves it out of the Cashflow chart, the budgets and the category totals. Balances, card statements,
     points and net worth still count it: the money really did move. */
  excluded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE transaction_photos (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  /* The file's name in OPFS, under expanses-photos/. The bytes never enter the database or leave the device. */
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX transaction_photos_tx ON transaction_photos (workspace_id, transaction_id);
```

Register it in `packages/db/src/migrations.ts`: `import transactionExtras from '../migrations/0048_transaction_extras.sql?raw';` after the 0047 import, and `{ version: 48, name: 'transaction_extras', sql: transactionExtras },` after the version 47 entry.

`packages/db/src/schema-extras.ts` — `transactionFlags` and `transactionPhotos` as Drizzle tables, column for column, with the same comments in short form. Export it from `index.ts` as `export * as extrasSchema from './schema-extras';`.

- [ ] **Step 4: The repository**

`packages/db/src/repos/transaction-extras.ts`:

```ts
/** One picture kept for a transaction: the row is the index, the file in OPFS is the picture. */
export interface TransactionPhotoRow {
  id: string;
  transactionId: string;
  /** The file's name in OPFS under expanses-photos/, which is what `readPhotoBytes` and `photoUrl` take. */
  fileName: string;
  mime: string;
  byteSize: number;
  sortOrder: number;
  createdAt: string;
}
```

- `extrasTablesExist(db: Db): Promise<boolean>` — the `WeakMap` guard, copied from `billTablesExist` (`bill-months.ts:12-18`) and asking `sqlite_master` for `transaction_flags`.
- `writeExtrasTx(tx, ws, transactionId, { channel, excludedFromReport, photoIds })` — **the same field names `PostTransactionInput` uses**, so one fact never travels under two names. Inserts or updates the flag row only when something is actually set (a row of `null` and `0` is never written; an existing row is deleted when both facts go back to nothing), then re-keys the photo rows named by `photoIds` onto this transaction.
- `extrasForTx(tx, ws, transactionId): Promise<{ channel: 'online' | 'offline' | null; excluded: boolean } | null>` — the flag row read **inside** a database transaction, so `replaceTransaction` can carry each fact separately rather than moving a row wholesale. `null` when there is no row.
- `movePhotosTx(tx, ws, fromId, toId): Promise<void>` — re-keys the photo *rows* onto a replacement, the way `replaceTransaction` already moves card postings. Photos are rows, not input fields: there is nothing to carry field by field, so this one really is a move.
- `extrasFor(db, ws, ids)` — one query per list: `Map<string, { channel, excluded, photoCount }>`.
- `notExcluded(ws: WorkspaceContext): SQL` — `sql`${transactions.id} NOT IN (SELECT transaction_id FROM transaction_flags WHERE excluded = 1 AND workspace_id = ${ws.workspaceId})``, for the readers in Task 3. **It takes the context**: `transaction_flags` carries `workspace_id`, every other predicate in `reports.ts` and `flows.ts` scopes on it, and an unscoped `NOT IN` lets one workspace's exclusion silently delete another workspace's figure.
- `addPhoto(database, ws, { transactionId, fileName, mime, byteSize })` — writes `sort_order` as `(SELECT COALESCE(MAX(sort_order), -1) + 1 FROM transaction_photos WHERE workspace_id = ? AND transaction_id = ?)`, so the pictures keep the order they were picked in. The column's `DEFAULT 0` is for rows written by anything else; this repository never leans on it.
- `listPhotos(database, ws, transactionId)` — `ORDER BY sort_order, id`. A total order, not a tie: without the `sort_order` above, every row would sort equal and SQLite could return them either way round, which is a test that passes by luck.
- `deletePhoto(database, ws, photoId)`.
- `allPhotoRows(database, ws): Promise<TransactionPhotoRow[]>` — this workspace's rows, for the backup's "Download photos (N)".
- `allPhotoFileNames(database): Promise<string[]>` — **every** row in the database, whatever workspace it belongs to, for the orphan sweep and nothing else. The sweep deletes files no row names; a workspace-scoped read would hand it another workspace's pictures as orphans and it would delete them. This one deliberately takes no `WorkspaceContext`, and says so in a comment.

Photos added before a transaction exists are written with `transactionId: ''` and re-keyed by `writeExtrasTx`; `allPhotoFileNames` returns them too, so a picture waiting on an unsaved form is never swept away while the form is open.

- [ ] **Step 5: Posting and reading**

In `packages/db/src/repos/ledger.ts`:

```ts
  /** Online or offline, when the user said; null when they did not. Never guessed. */
  channel?: 'online' | 'offline' | null;
  /** Leaves the chart, the budgets and the category totals; balances, statements, points and net worth keep it. */
  excludedFromReport?: boolean;
  /** The event this belongs to. The column exists already; only the form is new. */
  eventId?: string | null;
  /** Photo rows written before the transaction had an id. */
  photoIds?: string[];
```

`postTransactionTx` writes `eventId: input.eventId ?? null` into the insert it already makes, and calls `writeExtrasTx(tx, ws, id, input)` after the entries when `await extrasTablesExist(tx)`.

`replaceTransaction` carries each fact **as input to the posting**, not as a row moved afterwards. `writeExtrasTx`
runs inside `postTransactionTx`; anything that moved a whole flag row after it would overwrite what the input had
just written. So, before `await voidTransactionTx(tx, ws, id)`, read what is there:

```ts
    // What the original said about itself, so a correction that does not mention a fact keeps it, and one that
    // mentions it — `channel: null` — clears it. Read before the void, written as part of the replacement.
    const extras = (await extrasTablesExist(tx)) ? await extrasForTx(tx, ws, id) : null;
```

and add to the `postTransactionTx` call, beside the lines that carry MCC and card:

```ts
      ...(input.channel === undefined ? { channel: extras?.channel ?? null } : {}),
      ...(input.excludedFromReport === undefined ? { excludedFromReport: extras?.excluded ?? false } : {}),
      ...(input.eventId === undefined ? { eventId: original?.eventId ?? null } : {}),
```

**Delete the block that sits below it today** (`ledger.ts:258-261`):

```ts
    // A correction is still the same spending, so it stays with the event it was tagged to.
    if (original?.eventId) {
      await tx.update(transactions).set({ eventId: original.eventId }).where(eq(transactions.id, replacement));
    }
```

It runs *after* `postTransactionTx` and restores the original event unconditionally, so `eventId: null` would
silently do nothing. The spread above does everything that block did — it carries the event when the input is
silent — and, unlike the block, it lets a correction clear one. Its comment moves onto the spread line. The
`transactions`/`eq` imports it used are still needed elsewhere in the file; leave them.

After the `transactionPointActuals` update, add `await movePhotosTx(tx, ws, id, replacement)` when
`await extrasTablesExist(tx)` — the pictures follow the correction, as the card postings do.

`listWith` reads `extrasFor` once per page, exactly as it reads `billMonths`, and fills `channel`, `excluded` and `photoCount` on each view; without the tables they are `null`, `false` and `0`.

`TransactionView` gains the three, `channel` and `excluded` and `photoCount` marked optional in the same way `billMonth` is, so a view built by hand in a test need not name them.

`ListTransactionsOptions` gains one more, for the receipt in Task 7 — a receipt reads one transaction by its id, and
there is no such option today (`ledger.ts:339-354` has `accountId`, `accountIds`, `from`, `to`, `includeVoid`,
`limit`, `eventId`, `bookId`):

```ts
  /** One transaction by id — what a receipt reads. With `includeVoid`, a deleted one still opens. */
  id?: string;
```

handled in `listWith` beside the other conditions: `if (opts.id) conds.push(eq(transactions.id, opts.id));`

- [ ] **Step 6: Run** — `cd packages/db && npx vitest run` → all pass, including `books-sample-migration.test.ts` and `database.test.ts`. Then the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green.

- [ ] **Step 7: Commit** — `git commit -am "feat(db): a channel, an exclusion and photo rows beside a transaction (0048)"` (with the trailer; `git add` the new files first).

---

### Task 3: An excluded transaction leaves the chart and the budgets, and nothing else

**Files:**
- Modify: `packages/db/src/repos/reports.ts`, `packages/db/src/repos/flows.ts`, `packages/db/src/repos/events.ts`
- Test: `packages/db/test/excluded-figures.test.ts`

**Interfaces:**
- Consumes: `notExcluded(ws)`, `extrasTablesExist(db)` (Task 2).

Spec §11 names four readers that must drop an excluded row: `categoryTotalsBetween`/`categoryTotalsIn` (both go
through `categoryRows`), `periodFlows`' income and spending, `eventSpendingBetween`, and the event sheet.
**`eventSheetFor` does not exist**: the event-RAB project deleted it and put `eventPlanFor`
(`packages/db/src/repos/events.ts:192`) in its place — same screen, same figures, new name. `eventPlanFor` is the
fourth reader, and it is owned here.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/excluded-figures.test.ts
import { expenseLines, monthRange } from '@expanses/core';
import { afterEach, expect, it } from 'vitest';
import { categoryTotalsIn, createAccount, listAccounts, nativeBalances, periodFlows, postTransaction } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function month() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const electronics = all.find((a) => a.systemKey === 'shopping.electronics')!.id;
  const groceries = all.find((a) => a.systemKey === 'household.groceries')!.id;
  const spend = (categoryAccountId: string, amountMinor: number, extra = {}) =>
    postTransaction(database, ws, {
      occurredOn: '2026-09-17',
      description: 'A purchase',
      lines: expenseLines({ categoryAccountId, paymentAccountId: card.id, amountMinor, currency: 'IDR' }),
      ...extra,
    });
  return { database, ws, card, electronics, groceries, spend };
}

it('leaves the category totals the chart and the budget are built on', async () => {
  const m = await month();
  await m.spend(m.groceries, 250_000);
  await m.spend(m.electronics, 18_999_000, { excludedFromReport: true });
  const { from, to } = monthRange('2026-09');

  const totals = await categoryTotalsIn(m.database, m.ws, 'expense', from, to);
  expect(totals.rows.map((row) => [row.accountId, row.amountBaseMinor])).toEqual([[m.groceries, 250_000]]);
});

it('leaves what the month says was spent, but not what the card owes', async () => {
  const m = await month();
  await m.spend(m.groceries, 250_000);
  await m.spend(m.electronics, 18_999_000, { excludedFromReport: true });

  const flows = await periodFlows(m.database, m.ws, { from: '2026-09-01', to: '2026-09-30' });
  expect(flows.spendingMinor).toBe(250_000);
  // The purchase really happened on the card: the balance, and so the statement and net worth, still hold it.
  expect((await nativeBalances(m.database, m.ws))[m.card.id]).toBe(-19_249_000);
});

it('still counts one when nothing was excluded, so no figure moves for anybody else', async () => {
  const m = await month();
  await m.spend(m.groceries, 250_000);
  await m.spend(m.electronics, 18_999_000);
  const { from, to } = monthRange('2026-09');

  const totals = await categoryTotalsIn(m.database, m.ws, 'expense', from, to);
  expect(totals.rows.reduce((sum, row) => sum + row.amountBaseMinor, 0)).toBe(19_249_000);
});

it('leaves the event what it spent, and what the plan says it bought', async () => {
  const m = await month();
  const eventId = await saveEvent(m.database, m.ws, { name: 'Bali holiday', startsOn: '2026-09-01', endsOn: '2026-09-30' });
  await m.spend(m.groceries, 250_000, { eventId });
  await m.spend(m.electronics, 18_999_000, { eventId, excludedFromReport: true });

  expect((await eventSpendingBetween(m.database, m.ws, '2026-09-01', '2026-09-30')).amountMinor).toBe(250_000);
  // The same figure on the event's own screen: the plan's Spent and the category report must agree, so they drop
  // the same rows. `eventPlanFor` is what `eventSheetFor` became; spec §11's last-but-one row is about this one.
  expect((await eventPlanFor(m.database, m.ws, eventId)).spentMinor).toBe(250_000);
});
```

`saveEvent`, `eventSpendingBetween` and `eventPlanFor` come from `../src/index`; add them to the import line.
`EventPlan.spentMinor` is the real field (`packages/core/src/events/plan.ts:79-86`).

- [ ] **Step 2: Run and see it fail** — `cd packages/db && npx vitest run test/excluded-figures.test.ts` → FAIL (the excluded purchase is still counted).

- [ ] **Step 3: Implement**

In `packages/db/src/repos/reports.ts`, inside `categoryRows`, after the book narrowing:

```ts
      // What was marked "not my spending" leaves the chart, the rings and the budgets. It is still on the card,
      // still in the balance, still earning points: only this reading of it changes.
      ...((await extrasTablesExist(database.db)) ? [notExcluded(ws)] : []),
```

the same clause on `eventSpendingBetween`'s `where`, and the same clause on the `where` of `eventPlanFor`'s
`actualRows` query in `packages/db/src/repos/events.ts` — so the event's Spent and the category report drop the
same rows and go on agreeing, which is the only reason those two figures can be read side by side.

`notExcluded` takes the context: the subquery it writes is scoped by `workspace_id`, because `transaction_flags`
carries one and every other predicate in these three files does too.

In `packages/db/src/repos/flows.ts`, read the excluded ids once — **scoped to the workspace and to the period being
read**, so the set is the size of a month rather than the size of the database, and so one workspace's exclusions
can never reach another's figures:

```ts
  // What was marked "not my spending". Narrowed the same two ways `rows` above is: this workspace, this period.
  const excludedIds = new Set<string>(
    (await extrasTablesExist(database.db))
      ? (
          await database.db.values<[string]>(sql`
            SELECT tf.transaction_id FROM transaction_flags tf
            JOIN transactions t ON t.id = tf.transaction_id
            WHERE tf.excluded = 1
              AND tf.workspace_id = ${ws.workspaceId}
              AND t.workspace_id = ${ws.workspaceId}
              AND t.occurred_on BETWEEN ${range.from} AND ${range.to}`)
        ).map((row) => String(row[0]))
      : [],
  );
```

then in the row loop skip **only** the income and spending buckets for those transactions:

```ts
    const counted = !excludedIds.has(row.transactionId);
    if (counted && row.kind === 'income' && !realizedGains.has(row.accountId) && counts(row.accountId)) {
      if (bucket) bucket.incomeMinor += displayAmount('income', read);
    } else if (counted && row.kind === 'expense' && !finalTax.has(row.accountId) && counts(row.accountId)) {
      if (bucket) bucket.spendingMinor += displayAmount('expense', read);
    }
    // The rolls below are a separate statement, not an `else` on this chain, so they are unreachable from it and
    // go on counting an excluded row — which is what §15.5 asks for: they are facts about balances, not spending.
```

- [ ] **Step 4: Run** — `cd packages/db && npx vitest run` → all pass (`budget-sheet.test.ts`, `books-sample.test.ts`, `event-items.test.ts` and `bill-months-figures.test.ts` must be unchanged figure for figure). Then the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green.

- [ ] **Step 5: Commit** — `git commit -am "feat(db): a purchase can stay out of the chart and the budgets without leaving the card"` (with the trailer).

---

### Task 4: Channel reaches the points engine

**Files:**
- Modify: `packages/core/src/points/earn.ts`, `packages/db/src/repos/points.ts`
- Test: `packages/core/test/points-channel.test.ts`, `packages/db/test/transaction-extras.test.ts` (one test appended)

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/points-channel.test.ts
import { describe, expect, it } from 'vitest';
import { matchesSpend, type SpendLine } from '../src/index';

const line = (over: Partial<SpendLine> = {}): SpendLine => ({
  transactionId: 't', entryId: 'e', occurredOn: '2026-09-17', categoryId: 'shopping', description: 'Tokopedia',
  amountMinor: 1_000_000, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null, cardFee: false, ...over,
});

describe('a rule that earns only online', () => {
  it('takes a purchase marked online', () => {
    expect(matchesSpend({ channel: 'online' }, line({ channel: 'online' }), {})).toBe(true);
  });

  it('refuses one marked offline', () => {
    expect(matchesSpend({ channel: 'online' }, line({ channel: 'offline' }), {})).toBe(false);
  });

  it('falls back to the merchant keywords when nothing was said', () => {
    expect(matchesSpend({ channel: 'online', merchantPatterns: ['tokopedia'] }, line(), {})).toBe(true);
    expect(matchesSpend({ channel: 'online', merchantPatterns: ['tokopedia'] }, line({ description: 'Warung Steak' }), {})).toBe(false);
  });

  it('leaves every rule that names no channel exactly as it was', () => {
    expect(matchesSpend({}, line({ channel: 'offline' }), {})).toBe(true);
  });
});
```

Appended to `packages/db/test/transaction-extras.test.ts`: a card purchase saved with `channel: 'online'` comes back from `cardSpendLines(database, ws, card.id, '2026-09-01', '2026-09-30')` with `channel: 'online'`, and one saved without comes back with `channel: null`.

- [ ] **Step 2: Run and see it fail** — `cd packages/core && npx vitest run test/points-channel.test.ts` → FAIL (`channel` is not a `RuleMatch` field).

- [ ] **Step 3: Implement**

In `packages/core/src/points/earn.ts`, on `RuleMatch`:

```ts
  /** Bought online or in a shop, when the purchase says. A purchase that does not say is judged by its keywords. */
  channel?: 'online' | 'offline';
```

on `SpendLine`:

```ts
  /** What the owner said about the purchase: 'online', 'offline', or nothing. Never guessed. */
  channel?: 'online' | 'offline' | null;
```

**A deliberate divergence from spec §12, which writes `channel: 'online' | 'offline' | null` as required.** Optional
here, because `SpendLine` is built by hand in a dozen catalogue fixtures (`packages/core/test/catalog-*.test.ts`)
and a required field would make this task a rename of every one of them for no change in behaviour — `undefined`
and `null` both mean "not said" to the one line added to `matchesSpend` below. Nothing reads `channel` expecting it
to be present. If the compiler ever needs it required, that is a separate change and a separate commit.

and one line in `matchesSpend`, after the merchant patterns:

```ts
  if (match.channel && line.channel && match.channel !== line.channel) return false;
```

In `packages/db/src/repos/points.ts`, `cardSpendLines` reads `tf.channel` with a `LEFT JOIN transaction_flags tf ON tf.transaction_id = t.id` in both queries — guarded by `extrasTablesExist`, so a database without the table takes today's SQL unchanged.

- [ ] **Step 4: Run** — the gate: `npm run typecheck` (root), `npm test` (root) — including every `catalog-*.test.ts`, since no catalogue rule names a channel and so no earned figure may move — and `cd apps/web && npx playwright test --workers=2`, which is what proves `points.spec.ts` and `points-ledger.spec.ts` still read the same figures after `cardSpendLines` grew a join.

- [ ] **Step 5: Commit** — `git commit -am "feat: a card rule can earn online only, when the purchase says which it was"` (with the trailer).

---

### Task 5: A bill split between several people

**Files:**
- Modify: `packages/db/src/repos/debts.ts`, `packages/db/src/repos/people.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/split-bill-people.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/split-bill-people.test.ts
import { afterEach, expect, it } from 'vitest';
import { createAccount, listAccounts, listTransactions, peopleDebts, recentPeople, splitBill } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function dinner() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const restaurants = (await listAccounts(database, ws)).find((a) => a.systemKey === 'food_beverage.restaurants')!.id;
  return { database, ws, card, restaurants };
}

it('opens one account per person and leaves your share in the category', async () => {
  const d = await dinner();
  const { debtAccountIds } = await splitBill(d.database, d.ws, {
    occurredOn: '2026-09-17',
    description: 'Dinner for four',
    totalMinor: 400_000,
    moneyAccountId: d.card.id,
    ownCategoryId: d.restaurants,
    ownShareMinor: 100_000,
    shares: [
      { person: { name: 'Andi', currency: 'IDR' }, amountMinor: 100_000 },
      { person: { name: 'Putri', currency: 'IDR' }, amountMinor: 100_000 },
      { person: { name: 'Chika', currency: 'IDR' }, amountMinor: 100_000 },
    ],
    channel: 'offline',
  });
  expect(debtAccountIds).toHaveLength(3);

  const [tx] = await listTransactions(d.database, d.ws);
  // The card is charged the whole bill, so the statement and the points still match the bank.
  expect(tx!.entries.find((e) => e.accountId === d.card.id)!.amountMinor).toBe(-400_000);
  expect(tx!.entries.find((e) => e.accountId === d.restaurants)!.amountMinor).toBe(100_000);
  expect(tx).toMatchObject({ channel: 'offline' });

  const people = await peopleDebts(d.database, d.ws, '2026-09-17');
  expect(people.owedToYou.map((person) => [person.personName, person.totalMinor])).toEqual([
    ['Andi', 100_000],
    ['Chika', 100_000],
    ['Putri', 100_000],
  ]);
});

it('offers the people you have split with before, most recent first', async () => {
  const d = await dinner();
  await splitBill(d.database, d.ws, {
    occurredOn: '2026-09-17', description: 'Dinner', totalMinor: 200_000, moneyAccountId: d.card.id,
    ownCategoryId: d.restaurants, ownShareMinor: 100_000, shares: [{ person: { name: 'Andi', currency: 'IDR' }, amountMinor: 100_000 }],
  });
  await splitBill(d.database, d.ws, {
    occurredOn: '2026-09-18', description: 'Coffee', totalMinor: 100_000, moneyAccountId: d.card.id,
    ownCategoryId: d.restaurants, ownShareMinor: 50_000, shares: [{ person: { name: 'Budi', currency: 'IDR' }, amountMinor: 50_000 }],
  });
  expect((await recentPeople(d.database, d.ws)).map((person) => person.personName)).toEqual(['Budi', 'Andi']);
});
```

- [ ] **Step 2: Run and see it fail** — `cd packages/db && npx vitest run test/split-bill-people.test.ts` → FAIL (`recentPeople` missing, `channel` not accepted).

- [ ] **Step 3: Implement**

`splitBill` already loops `input.shares`, so several people work today; add `channel`, `excludedFromReport` and `eventId` to `SplitBillInput` and pass them through to its `postTransactionTx` call. Add to `packages/db/src/repos/people.ts`:

```ts
export interface RecentPersonRow {
  accountId: string;
  personName: string;
  direction: DebtDirection;
  currency: string;
  /** The last day money moved on their account: what "recent" means here. */
  lastOn: string;
}

/** Who to offer as a chip under With: people already on the books, the most recently used first. */
export async function recentPeople(database: Database, ws: WorkspaceContext, limit = 8): Promise<RecentPersonRow[]>
```

built from `debtProfiles` joined to the newest `transactions.occurred_on` on each account, falling back to `created_at` for a person with no movement yet.

Spec §4.1 names `listDebtProfiles` as the source for the With chips. That function is real
(`packages/db/src/repos/debts.ts:130`) but orders by `personName` then `createdAt` — it cannot answer "most
recently used first", which is what the chips are for. `recentPeople` is that ordering and nothing more;
`listDebtProfiles` is left exactly as it is, since `tax-inputs.ts` reads it and the tax report's order must not
move.

- [ ] **Step 4: Run** — `cd packages/db && npx vitest run` → all pass (`lend-borrow` figures unchanged). Then the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green.

- [ ] **Step 5: Commit** — `git commit -am "feat(db): one bill, several people, and the people you split with last"` (with the trailer).

---

### Task 6: Photos on the device, and in the backup

**Files:**
- Create: `apps/web/src/photos/store.ts`, `apps/web/src/photos/memory-directory.ts`, `apps/web/src/photos/store.test.ts`
- Modify: `apps/web/src/features/backup/BackupPage.tsx`, `apps/web/src/app/Layout.tsx`
- Test: `apps/web/src/photos/store.test.ts`

**Interfaces:**
- Produces: `makePhotoStore(getDirectory?): PhotoStore` and `export const photos = makePhotoStore()`, the app's one instance. A `PhotoStore` has `savePhotoBytes(bytes, mime): Promise<{ fileName: string; byteSize: number }>`, `readPhotoBytes(fileName): Promise<Uint8Array | null>`, `deletePhotoFile(fileName): Promise<void>`, `listPhotoFiles(): Promise<string[]>`, `sweepOrphanPhotos(kept: Iterable<string>): Promise<number>`, `photoUrl(fileName): Promise<string | null>`. Also `memoryDirectory()`, the in-memory stand-in the test uses.
- Consumes: `allPhotoRows`, `allPhotoFileNames` (Task 2); `zipStore`, `unzipStore` (Task 1).

**`savePhotoBytes` returns an OPFS file name, never a `transaction_photos.id`.** The two are different
identifiers and Task 15 has to keep them apart: the file name goes in the row's `fileName`, and the id `addPhoto`
gives back is what `draft.photoIds` holds.

- [ ] **Step 1: Write the failing test** — the store talks to a `FileSystemDirectoryHandle`, so it takes one (`navigator.storage.getDirectory()` by default) and the test passes an in-memory stand-in:

```ts
// apps/web/src/photos/store.test.ts
import { describe, expect, it } from 'vitest';
import { makePhotoStore } from './store';
import { memoryDirectory } from './memory-directory';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('photos kept on this device', () => {
  it('writes the bytes under a name of its own and reads them back', async () => {
    const store = makePhotoStore(() => memoryDirectory());
    const saved = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');
    expect(saved.fileName).toMatch(/\.jpg$/);
    expect(saved.byteSize).toBe(9);
    expect(new TextDecoder().decode(await store.readPhotoBytes(saved.fileName))).toBe('a receipt');
  });

  it('sweeps a photo no transaction names, and keeps the ones that are named', async () => {
    const store = makePhotoStore(() => memoryDirectory());
    const kept = await store.savePhotoBytes(bytes('kept'), 'image/jpeg');
    const orphan = await store.savePhotoBytes(bytes('abandoned'), 'image/jpeg');
    await store.sweepOrphanPhotos([kept.fileName]);
    expect(await store.listPhotoFiles()).toEqual([kept.fileName]);
    expect(orphan.fileName).not.toBe(kept.fileName);
  });

  it('says nothing and breaks nothing where OPFS is not there', async () => {
    const store = makePhotoStore(() => {
      throw new Error('no OPFS here');
    });
    expect(await store.listPhotoFiles()).toEqual([]);
  });
});
```

`apps/web/src/photos/memory-directory.ts` — created in this task, and a dependency of the test above, so it is
written first. A tiny in-memory `FileSystemDirectoryHandle` stand-in: a `Map<string, Uint8Array>` behind
`getFileHandle(name, { create })` (whose handle offers `getFile()` and `createWritable()`), `removeEntry(name)`
and an async iterator of `[name, handle]` pairs, which is all `store.ts` asks of a directory. Nothing else in the
app imports it.

- [ ] **Step 2: Run and see it fail** — `cd apps/web && npx vitest run src/photos/store.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `apps/web/src/photos/store.ts`:

- Directory `expanses-photos`, created on demand with `getDirectory()` then `getDirectoryHandle(name, { create: true })`, **on the main thread**. Never the worker's `.expanses` directory.
- `savePhotoBytes` names the file `${uuidv7()}.${extensionFor(mime)}` and writes through `createWritable()`.
- `photoUrl(fileName)` returns an object URL for a thumbnail or the full-size view; the caller revokes it.
- Every function catches a missing or refused OPFS and answers empty, so a private window shows a form without photos rather than a broken screen.
- `export const photos = makePhotoStore()` as the app's instance; the factory takes the directory getter so the test can hand it one.

- [ ] **Step 4: The backup** — in `apps/web/src/features/backup/BackupPage.tsx`, beside "Download backup":

- **Download photos (N)** — reads `allPhotoRows(database, ws)`, reads each file, `zipStore(...)`, `saveBytes(archive, 'expanses-photos-<date>.zip', 'application/zip')`. Hidden when there are none.
- **Restore photos** — an `<input type="file" accept=".zip">`, `unzipStore(...)`, writing back only files a row names and never overwriting one already there; it reports "12 photos restored · 2 already here".
- One line under both: *Photos live beside the database on this device. The backup file holds your figures; this zip holds the pictures.*

- [ ] **Step 5: The sweep at app start** — spec §10.4 asks for `sweepOrphanPhotos()` "on the Photos screen closing
**and at app start**". The sheet closing is Task 15; app start is here, because this is the task that owns the
store and nothing else ever calls the sweep for real.

In `apps/web/src/app/Layout.tsx`, one effect that runs once the database is open:

```tsx
  // A form abandoned halfway leaves a picture in OPFS that no row names. Tidying them at start is the only moment
  // nobody is looking at a form, and it reads every workspace's rows: a sweep that knew only the open workspace
  // would count another workspace's pictures as orphans and delete them.
  useEffect(() => {
    if (!database) return;
    void allPhotoFileNames(database).then((kept) => photos.sweepOrphanPhotos(kept));
  }, [database]);
```

The sweep already answers 0 and breaks nothing where OPFS is absent, so a private window needs no guard here.

- [ ] **Step 6: Run** — the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green.

- [ ] **Step 7: Commit** — `git commit -am "feat(web): receipt photos kept on the device, and a zip of them for the backup"` (with the trailer; `git add` the new folder first).

---

## Step 2 — The receipt

### Task 7: The receipt screen — B8

**Files:**
- Create: `apps/web/src/features/transactions/ReceiptPage.tsx`, `apps/web/src/features/transactions/receipt-view.ts`, `apps/web/src/features/transactions/receipt-view.test.ts`, `apps/web/e2e/transaction-receipt.spec.ts`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/features/transactions/TransactionsPage.tsx`, `apps/web/src/features/transactions/TransactionsTable.tsx`
- Test: `apps/web/src/features/transactions/receipt-view.test.ts`, `apps/web/e2e/transaction-receipt.spec.ts`

**Interfaces:**
- Produces: `receiptLines(input: ReceiptInput): ReceiptLine[]`; `ReceiptPage`; the route `/transactions/$transactionId`; `ConvertForm`, **exported** from `TransactionsPage.tsx` (it is a module-local `function ConvertForm` there today, `TransactionsPage.tsx:52`; the receipt and, later, the edit sheet both need it, so this task adds `export` and changes nothing else about it).
- Consumes: `ListTransactionsOptions.id` (Task 2), `TransactionView.channel | excluded | photoCount` (Task 2), `photoUrl` (Task 6), `loadPurchasePoints`, `peopleDebts`, `listPhotos`, `voidTransaction`.

- [ ] **Step 1: Failing unit test** — `receipt-view.ts` turns a `TransactionView` plus its accounts, cards, points and people into the lines B8 shows, so the screen itself holds no arithmetic:

```ts
// apps/web/src/features/transactions/receipt-view.test.ts
import type { AccountRow, CardRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { receiptLines } from './receipt-view';

const card: CardRow = { id: 'card-1', accountId: 'acct-card', last4: '1467', holderName: null, isPrimary: true };
const accounts = [
  { id: 'acct-card', name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' },
  { id: 'cat-restaurants', name: 'Restaurants', kind: 'expense', subtype: 'category', currency: null },
] as AccountRow[];

/** A dinner on the card: 400.000 charged, 100.000 of it the owner's own share. */
const dinner = (over: Partial<TransactionView> = {}): TransactionView =>
  ({
    id: 'tx-1',
    occurredOn: '2026-09-17',
    description: 'Dinner at Plataran',
    status: 'posted',
    cardId: 'card-1',
    entries: [
      { accountId: 'acct-card', accountKind: 'liability', amountMinor: -400_000, amountBaseMinor: -400_000, currency: 'IDR' },
      { accountId: 'cat-restaurants', accountKind: 'expense', amountMinor: 100_000, amountBaseMinor: 100_000, currency: 'IDR' },
    ],
    ...over,
  }) as TransactionView;

describe('what a receipt says', () => {
  it('says what was paid with, what it came to, and who owes what', () => {
    const lines = receiptLines({
      tx: dinner(),
      accounts,
      cards: [card],
      currency: 'IDR',
      points: { points: 1200, unit: 'KrisFlyer miles', approximate: false },
      owed: [
        { personName: 'Andi', totalMinor: 100_000 },
        { personName: 'Putri', totalMinor: 100_000 },
        { personName: 'Chika', totalMinor: 100_000 },
      ],
    });
    expect(lines.map((line) => [line.label, line.value])).toEqual([
      ['Paid with', 'BCA KrisFlyer ···· 1467'],
      ['Total', 'Rp400.000'],
      ['Points earned', '1.200 KrisFlyer miles'],
      ['Andi, Putri and Chika owe you', 'Rp300.000'],
      ['Your share', 'Rp100.000'],
    ]);
    expect(lines.find((line) => line.label === 'Points earned')!.tone).toBe('points');
  });

  it('leaves out a line it has nothing to say about', () => {
    const lines = receiptLines({ tx: dinner(), accounts, cards: [card], currency: 'IDR', points: null, owed: [] });
    expect(lines.map((line) => line.label)).toEqual(['Paid with', 'Total']);
    // No points, nobody owing, no event, no channel, no foreign currency, no bill month: two lines, not nine empties.
    expect(lines.some((line) => line.value === '' || line.value === '—')).toBe(false);
  });

  it('says an excluded purchase is still on the card', () => {
    const lines = receiptLines({
      tx: dinner({ excluded: true, channel: 'offline', eventId: 'ev-1' }),
      accounts,
      cards: [card],
      currency: 'IDR',
      points: null,
      owed: [],
      eventName: 'Bali holiday',
    });
    expect(lines.map((line) => [line.label, line.value])).toEqual([
      ['Paid with', 'BCA KrisFlyer ···· 1467'],
      ['Total', 'Rp400.000'],
      ['Event', 'Bali holiday'],
      ['Channel', 'Offline'],
    ]);
    // Excluded is not one of these lines: it is the sentence under the date, and Total is the whole 400.000
    // whatever the chart does with it, because the card really was charged that.
    expect(lines.some((line) => line.label === 'Excluded')).toBe(false);
  });
});
```

`receiptLines(input)` returns `ReceiptLine[]`, `{ label: string; value: string; tone?: 'points' }`, in B8's order:
Paid with · Total · Points earned · "<people> owe you" · Your share · Event · Channel · Original amount · bill
month — **omitting any line it has no value for**, which is what the second test pins. Its input is
`{ tx, accounts, cards, currency, points: PurchasePoints | null, owed: Pick<PersonDebtRow, 'personName' | 'totalMinor'>[], eventName?: string }`.
`PurchasePoints` is `{ points: number; unit: string; approximate: boolean }`
(`apps/web/src/lib/purchase-points.ts:4-8`); `PersonDebtRow` carries `personName` and `totalMinor`
(`packages/db/src/repos/people.ts:25-28`). When `approximate` is true the value reads "≈ 1.200 KrisFlyer miles",
the wording the points screens already use.

- [ ] **Step 2: The route** — in `apps/web/src/app/router.tsx`, after the `/transactions` route:

```tsx
  createRoute({ getParentRoute: () => rootRoute, path: '/transactions/$transactionId', component: ReceiptRoute }),
```

where `ReceiptRoute` reads `transactionId` with `getRouteApi('/transactions/$transactionId').useParams()` and renders `<ReceiptPage transactionId={transactionId} />`, the way `BillRoute` does for a bill.

`/transactions/new` and `/transactions/$transactionId/edit` arrive in Task 10 and both would be swallowed by this
pattern if the router matched in list order. TanStack Router ranks static segments above dynamic ones, so
`/transactions/new` wins over `/transactions/$transactionId` wherever it sits in the array — but the ranking is the
reason it works, not the order, so Task 10 asserts it rather than assuming it.

- [ ] **Step 3: The screen** — `ReceiptPage`:

- Reads the one transaction with `listTransactions(database, ownerScope(ws), { id: transactionId, includeVoid: true })` — `id` is the option Task 2 added to `ListTransactionsOptions`, and `includeVoid` is what lets a deleted transaction still open its receipt, which is what "the row then sits under Show deleted" needs. `ownerScope(ws)` because an account's history is owner-wide, so a receipt must open whatever workspace it was filed in. Then its accounts, cards, `loadPurchasePoints`, `peopleDebts` and `listPhotos`.
- ‹ back (`navigate({ to: '/transactions' })` when there is no history to pop), the category circle, the amount large, the description, "Restaurants · Personal", the long date.
- The card of `receiptLines`, then the photo strip — one `<img>` per row of `listPhotos`, its `src` from `photoUrl(row.fileName)`, revoked on unmount. Task 15 gives it the full-size viewer; the strip itself is built here and not built twice.
- Then **This was a purchase** (only with holdings), **Edit**, **Delete**. "This was a purchase" opens today's `ConvertForm` in a `Sheet`. `ConvertForm` is a module-local `function ConvertForm` in `TransactionsPage.tsx:52` today: add `export` to it and import it here. Do not copy it.
- Delete asks twice in place, then `voidTransaction` and back to the list.
- A row filed in another workspace shows `SwitchToEdit` (`apps/web/src/features/workspaces/SwitchToEdit.tsx`) instead of Edit, as the list does today.
- Excluded: under the date, *Excluded from the chart and budgets. Still counted in balances, statements and points.*

- [ ] **Step 4: Ways in** — on a desktop, a row in the list and a row in the table end with a ⓘ button (`Info` from lucide-react), `aria-label={`Receipt for ${description}`}`, `hidden md:inline-flex`, which navigates to the route. The row's own click still opens the in-place editor: **nothing about editing on a desktop changes.** The phone's tap comes in Task 9.

Put the ⓘ in `TransactionsPage`'s `recordedRow` (the trailing slot beside the pencil, around
`TransactionsPage.tsx:666`) and in `TransactionsTable`'s row. Task 9 rewrites `recordedRow` into `TransactionRow`
and carries the ⓘ across into its `trailing` slot — it is written once here and moved once there, not written twice.

- [ ] **Step 5: The desktop e2e** — create `apps/web/e2e/transaction-receipt.spec.ts` (`chromium`), one test for now:
record a purchase with today's form, click the row's **Receipt for Superindo**, and see the route, the description,
"Paid with BCA Visa" and the Total. Task 17 grows this file into the full desktop pass; it exists from here so that
Task 17 modifies a file that is there.

- [ ] **Step 6: Run** — the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green.

- [ ] **Step 7: Commit** — `git commit -am "feat(web): every transaction has a receipt, and a desktop row an ⓘ to open it"` (with the trailer).

---

## Step 3 — The row kit and the phone gestures

> **Order note.** The edit sheet (F3) was written here in the first draft of this plan, as Task 9. It cannot be:
> its only test is a `phone` e2e that must open a receipt, and until the tap gesture lands there is no way into a
> receipt on a phone (the ⓘ is `hidden md:inline-flex`); its **More** row opens `MoreDetails`, five tasks away;
> and "Open in full form" needs a route that does not exist yet. It has been moved to **Task 14**, after
> everything it opens. Tasks 10–14 below are the old 11–14 and 9, shifted up one; Tasks 15–18 are unchanged.

### Task 8: The row kit and the form model

**Files:**
- Create: `apps/web/src/features/transactions/tx-form.ts`, `tx-form.test.ts`, `FormRow.tsx`, `AmountRow.tsx`, `CurrencySheet.tsx`, `Keypad.tsx`
- Test: `apps/web/src/features/transactions/tx-form.test.ts`

(The kit lives in the feature folder; `apps/web/src/ui/index.tsx` is not touched.)

**Interfaces:**
- Produces: `FormDraft`; `emptyForm(bookId: string): FormDraft`; `formFromTransaction(tx, accounts): FormDraft`; `formToPost(draft, accounts): { kind: 'post' | 'split' | 'transfer-goal' | 'trade'; input: … }`; `chargedInNeeded(draft, accounts): boolean`; `extraRows(draft, accounts, { missingRate }): string[]`; `canEditInSheet(tx: TransactionView): boolean`; `FormRow`, `AmountRow`, `CurrencySheet`, `Keypad`.
- Consumes: `evaluateAmount`, `CurrencyInfo.flag` (Task 1); `PostTransactionInput`'s four new fields (Task 2); `paymentOptions` (`quick-row.ts:123`), `expenseLines`, `minorToMajorString`, `useResolveRates`.

`FormDraft` is today's `Draft` with the new facts added, so nothing is lost in the move:

```ts
export interface FormDraft {
  mode: 'expense' | 'income' | 'transfer' | 'trade';
  bookId: string;            // the workspace row
  occurredOn: string;
  description: string;       // the Note row
  moneyId: string;
  cardId: string;
  toId: string;
  categoryId: string;
  amount: string;            // typed, in `currency`
  currency: string;          // what the flag says
  chargedAmount: string;     // "Charged in <account currency>", '' when the currencies match
  toAmount: string;
  splits: { categoryId: string; amount: string }[];
  mcc: string;
  rememberPattern: string;
  eventId: string;
  channel: '' | 'online' | 'offline';
  excluded: boolean;
  photoIds: string[];
  with: { debtAccountId: string; name: string; amount: string }[];
  withEqually: boolean;
  goalId: string;
  manualRate: string;
  /** True while correcting a transaction rather than adding one: With is not offered on an edit (§15.6). */
  editing: boolean;
  purchase: PurchaseDraft;   // buy-in-form.ts, unchanged
}
```

`with` is a reserved word in JavaScript, but a legal property name and a legal destructuring target
(`const { with: withPeople } = draft`). It is kept because §2's field map calls the field With and the row is
labelled With; note it where the type is declared so nobody "fixes" it into `withPeople` and breaks `extraRows`.

- [ ] **Step 1: Failing tests** — `tx-form.test.ts`, against accounts built as plain `AccountRow` objects. The
fixtures first, so every assertion below has something real to stand on:

```ts
const accounts = [
  { id: 'acct-bank', name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' },
  { id: 'acct-card', name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' },
  { id: 'acct-cny', name: 'Alipay', kind: 'asset', subtype: 'cash', currency: 'CNY' },
  { id: 'cat-restaurants', name: 'Restaurants', kind: 'expense', subtype: 'category', currency: null },
] as AccountRow[];

/** An ordinary expense off the bank account: the case every other draft below is a variation on. */
const draft: FormDraft = { ...emptyForm('ws-1'), moneyId: 'acct-bank', categoryId: 'cat-restaurants', amount: '120000', currency: 'IDR', description: 'Warung Steak', occurredOn: '2026-09-17' };
/** The same expense typed in CNY off an IDR account, so C2's "Charged in IDR" row applies. */
const foreign: FormDraft = { ...draft, currency: 'CNY', amount: '120', chargedAmount: '272400' };
/** A transfer with no From chosen yet, for the error message. */
const transfer: FormDraft = { ...emptyForm('ws-1'), mode: 'transfer', toId: 'acct-card', amount: '500000' };
```

and the assertions:

```ts
// `formToPost` returns a discriminated result, so every assertion about what was built reaches through `input`.
it('builds an expense exactly as the old form did', () => {
  expect(formToPost(draft, accounts)).toMatchObject({
    kind: 'post',
    input: { lines: expenseLines({ categoryAccountId: 'cat-restaurants', paymentAccountId: 'acct-bank', amountMinor: 120_000, currency: 'IDR' }) },
  });
});
it('keeps the typed currency as the original, and the charged amount as the posting', () => {
  expect(formToPost(foreign, accounts)).toMatchObject({ kind: 'post', input: { originalCurrency: 'CNY', originalAmountMinor: 12_000 } });
});
it('clears the original pair when the currency is the account’s own', () => {
  expect(formToPost(draft, accounts)).toMatchObject({ kind: 'post', input: { originalCurrency: null, originalAmountMinor: null } });
});
it('asks for the charged amount only when the currencies differ', () => {
  expect(chargedInNeeded(foreign, accounts)).toBe(true);
  expect(chargedInNeeded(draft, accounts)).toBe(false);
});
it('passes the channel, the exclusion, the event and the photos through', () => {
  expect(formToPost({ ...draft, channel: 'online', excluded: true, eventId: 'ev-1', photoIds: ['p1'] }, accounts)).toMatchObject({
    kind: 'post',
    input: { channel: 'online', excludedFromReport: true, eventId: 'ev-1', photoIds: ['p1'] },
  });
});
// Three cases, three assertions: the title promised three and one covered only the first.
it('offers MCC only on a card, With only on a new expense, and the rate row only when one is missing', () => {
  expect(extraRows(draft, accounts, { missingRate: null })).toEqual(['event', 'split', 'with', 'channel', 'photos', 'exclude']);
  expect(extraRows({ ...draft, moneyId: 'acct-card' }, accounts, { missingRate: null })).toEqual([
    'event', 'split', 'with', 'mcc', 'channel', 'photos', 'exclude',
  ]);
  // Editing rather than adding: With is not offered, because splitBill posts a differently shaped transaction (§15.6).
  expect(extraRows({ ...draft, editing: true }, accounts, { missingRate: null })).toEqual(['event', 'split', 'channel', 'photos', 'exclude']);
  // The rate row is last, and only when resolveRates says one is missing.
  expect(extraRows(foreign, accounts, { missingRate: { from: 'CNY', to: 'IDR', onDate: '2026-09-17' } })).toEqual([
    'event', 'split', 'with', 'channel', 'photos', 'exclude', 'rate',
  ]);
});
it('sends a split with several people to splitBill, not to postTransaction', () => {
  expect(formToPost({ ...draft, with: [{ debtAccountId: '', name: 'Andi', amount: '100000' }] }, accounts)).toMatchObject({ kind: 'split' });
});
it('keeps the same messages the old form threw', () => {
  expect(() => formToPost({ ...draft, categoryId: '' }, accounts)).toThrow('Choose a category');
  expect(() => formToPost({ ...transfer, moneyId: '' }, accounts)).toThrow('Choose the From account');
  expect(() => formToPost({ ...draft, mcc: '58' }, accounts)).toThrow('An MCC is four digits, like 5814');
});
it('says the sheet cannot hold a split, a transfer or a foreign purchase', () => {
  expect(canEditInSheet(plainExpense)).toBe(true);
  expect(canEditInSheet(splitPurchase)).toBe(false);
  expect(canEditInSheet(transferTx)).toBe(false);
  expect(canEditInSheet(foreignPurchase)).toBe(false);
});
```

`plainExpense`, `splitPurchase`, `transferTx` and `foreignPurchase` are four `TransactionView` fixtures built the
same way as `dinner()` in `receipt-view.test.ts` (Task 7): one expense with a single category entry; one with two
category entries; one whose entries are two money accounts and no category; and one carrying `originalCurrency`.

The three error strings are the ones `draft.ts` throws today, verbatim. `FormDraft` gains `editing: boolean` so
`extraRows` can answer the With case without being handed the transaction — it is the same fact the old form had
as "is there an `initial`".

- [ ] **Step 2: Run and see it fail** — `cd apps/web && npx vitest run src/features/transactions/tx-form.test.ts` → FAIL.

- [ ] **Step 3: Implement `tx-form.ts`** — lifted from `draft.ts` and extended, keeping `draftToLines`'s validation word for word (`'Choose the From account'`, `'From and To must differ'`, `'An MCC is four digits, like 5814'`, …) and keeping `draft.ts`'s `isEditable` where it is. `formToPost` returns a discriminated result — `{ kind: 'post', input }`, `{ kind: 'split', input }`, `{ kind: 'transfer-goal', input }`, `{ kind: 'trade', input }` — so the screen only has to call the right repository function.

- [ ] **Step 4: The rows**

`FormRow.tsx` — `<button>` 48px tall: a 34px leading slot, a label, an optional value, an optional chevron; a `switch` variant for Exclude; disabled styling; `aria-label` from the label so a test can find it by name.

`AmountRow.tsx` — the flag circle (`currencyInfo(currency).flag`) opening `CurrencySheet`, the figure, the currency code, a ✕ while typing. Under it, when `chargedInNeeded`, the "Charged in *IDR*" row and one quiet line: `≈ {rate} per 1 {currency} · suggested from {date}, change it to what {account} charged`. The estimate comes from `useResolveRates` for the day; when no rate is known the row is empty and the hint says so, and the exchange-rate row appears under Add more details.

**On a desktop the figure is a real text input, and the keyboard does what the keypad does** — spec §3.4's last
line and the Global Constraint "the same keypad arithmetic through the keyboard". The phone's keypad is not the
only route into `evaluateAmount`:

```tsx
  // Desktop: no keypad, so the field itself is the evaluator. 85000+15000 is worked out when the field is left or
  // when Enter is pressed, and an expression that cannot be read leaves what was typed alone rather than clearing
  // it — the same bargain DONE makes on the phone.
  const evaluate = () => {
    const minor = evaluateAmount(value, currency);
    if (minor !== null) onChange(minorToMajorString(minor, currency));
  };
  <input
    aria-label="Amount"
    inputMode="decimal"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onBlur={evaluate}
    onKeyDown={(e) => {
      if (e.key !== 'Enter') return;
      // Enter evaluates; it does not also save. A second Enter, on a field that no longer changes, submits.
      const before = value;
      evaluate();
      if (evaluateAmount(before, currency) !== null && minorToMajorString(evaluateAmount(before, currency)!, currency) !== before) e.preventDefault();
    }}
  />
```

`minorToMajorString(amountMinor, currency)` is real (`packages/core/src/money/money.ts:69`) and is what writes the
result back in the shape `parseMajor` will read again.

`CurrencySheet.tsx` — `Sheet` titled "Currency": a search field, **Recent** (the paying account's currency, the workspace's, then up to three from `localStorage` under `expanses.currency.recent`), then **All currencies** from `CURRENCIES`, each row a flag, a name and its code, a ✓ on the current one.

`Keypad.tsx` — the dock grid `C ÷ × ⌫ / 7 8 9 − / 4 5 6 + / 1 2 3 DONE / 0 000 00`, DONE spanning two rows. **No recent amounts, no Save.** DONE calls `evaluateAmount`; a result writes the row and closes the keypad, `null` leaves both alone. Rendered only when `usePhone()` — the desktop's arithmetic is the input above, not this.

The dock carries `data-testid="keypad"` and every key is a `<button>` whose accessible name is the character on it
(`0`–`9`, `000`, `00`, `C`, `÷`, `×`, `−`, `+`, `⌫`, `DONE`). Two things depend on that: the shared e2e helper in
Task 10, which types an amount by tapping digits when the keypad is on screen, and Task 18's assertion that the
keypad has no `Save` key.

- [ ] **Step 5: Run** — `cd apps/web && npx vitest run` → pass. Then the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green (nothing imports the kit yet, so no existing spec may move).

- [ ] **Step 6: Commit** — `git commit -am "feat(web): the rows every transaction screen is built from, and what they add up to"` (with the trailer).

---

### Task 9: The gestures — F1, F2, F4

**Files:**
- Create: `apps/web/src/features/transactions/TransactionRow.tsx`, `apps/web/e2e/phone-transaction-gestures.spec.ts`
- Move: `apps/web/src/features/bills/SwipeRow.tsx` → `apps/web/src/ui/SwipeRow.tsx`; `apps/web/src/features/bills/UndoToast.tsx` → `apps/web/src/ui/UndoToast.tsx`
- Modify: `apps/web/src/features/bills/BillRow.tsx`, `RecurringPage.tsx` (imports only), `apps/web/src/features/transactions/TransactionsPage.tsx`, `apps/web/src/features/transactions/list-model.ts`, `apps/web/src/features/events/EventDetailPage.tsx`, `apps/web/src/features/cards/StatementPanel.tsx`
- Test: `apps/web/src/features/transactions/list-model.test.ts`, `apps/web/e2e/phone-transaction-gestures.spec.ts`

**Interfaces:**
- Consumes: `TransactionView.excluded` (Task 2), the route `/transactions/$transactionId` (Task 7).
- Produces: `TransactionRow`; `apps/web/src/ui/SwipeRow.tsx` with `reveal` and `testId`; `ListRow.excluded`.

- [ ] **Step 1: The failing unit test — the day's total** — spec §11's last row and §4.4 both say the list leaves an
excluded row out of `dayTotal` and `totals`. Task 3 changed the repository; nothing changes the list, and the list
adds up its own figures from `ListRow`, not from the repository. This is the §3.4-shaped hole from the last branch:
a §11 row that no task owned. It is owned here, in the task that already owns how the list treats an excluded row.

```ts
// appended to apps/web/src/features/transactions/list-model.test.ts
it('leaves a purchase marked "not my spending" out of the day, the totals and the category grouping', () => {
  const rows = buildRows(
    [
      txView({ id: 'a', occurredOn: '2026-09-17', description: 'Superindo', categoryId: groceries, amountMinor: 250_000 }),
      txView({ id: 'b', occurredOn: '2026-09-17', description: 'iPhone for Mama', categoryId: electronics, amountMinor: 18_999_000, excluded: true }),
    ],
    [], accounts, [],
  );
  const [day] = groupByDay(rows);

  // The row is still there — faded and struck through, but there — and it still says what it cost.
  expect(day!.rows).toHaveLength(2);
  expect(rows.find((row) => row.id === 'b')).toMatchObject({ excluded: true, baseMinor: 18_999_000 });

  // What it does not do is move a figure.
  expect(dayTotal(day!.rows)).toBe(-250_000);
  expect(totals(rows)).toMatchObject({ count: 1, spentMinor: 250_000 });
  expect(groupByCategory(rows).map((group) => [group.name, group.totalMinor])).toEqual([
    ['Groceries', 250_000],
    ['Electronics', 0],
  ]);
});
```

`txView` is the existing fixture helper at the top of `list-model.test.ts`; give it an `excluded` passthrough.

- [ ] **Step 2: The failing e2e** — `apps/web/e2e/phone-transaction-gestures.spec.ts`, in the `phone` project, on
the Cashflow list. The shared `addTransaction` helper arrives in **Task 10**, one task later, so this file records
its two purchases the way every phone spec does today — through the form that is still on screen at this point in
the sequence. Task 10 rewrites this helper along with the other twenty-four call sites.

```ts
import { expect, type Locator, type Page, test } from '@playwright/test';

/** Today's form, from the phone's tab bar. Task 10 replaces this body with a call to `addTransaction`. */
async function record(page: Page, description: string, category: string, amount: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Add a transaction' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a transaction' });
  await sheet.getByLabel('Description').fill(description);
  await sheet.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await sheet.getByLabel('Category', { exact: true }).selectOption({ label: category });
  await sheet.getByLabel('Amount', { exact: true }).fill(amount);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
}

/** Pointer down, a drag to the left, up — the gesture, not a click. */
async function swipeLeft(page: Page, row: Locator) {
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 12, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 12 - 140, y, { steps: 10 });
  await page.mouse.up();
}

test('a row opens its receipt, swipes to Edit and Delete, and its icon fixes the category', async ({ page }) => {
  // …an account, then…
  await record(page, 'Warung Steak', 'Restaurants', '120000');
  await record(page, 'Superindo', 'Groceries', '250000');

  await page.getByRole('button', { name: /Warung Steak/ }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Back' }).click();

  const row = page.getByTestId('transaction-row').filter({ hasText: 'Warung Steak' });
  await swipeLeft(page, row);
  // Both the action layer and the row content are inside the element carrying the test id, so this resolves.
  await expect(row.getByRole('button', { name: 'Edit' })).toBeVisible();
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(row.getByRole('button', { name: 'Delete?' })).toBeVisible();
  await row.getByRole('button', { name: 'Delete?' }).click();
  await expect(page.getByText('Warung Steak')).toHaveCount(0);

  await page.getByRole('button', { name: 'Category for Superindo' }).click();
  await page.getByRole('dialog', { name: 'Category for Superindo' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Moved to Restaurants');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Groceries')).toBeVisible();
});
```

- [ ] **Step 3: `SwipeRow` gains a width and a test id** — move the file to `apps/web/src/ui/SwipeRow.tsx`
unchanged but for two props:

```tsx
  reveal = 76,
  testId,
```

`reveal` replaces the `REVEAL` constant, and:

```tsx
  // Rounded, so the default really is the 50 bills have used since SwipeRow was written: 76 × 0.66 is 50.16, and
  // "BillRow passes nothing, so bills behave exactly as they do" has to be true rather than nearly true.
  const openAt = Math.round(reveal * 0.66);
```

`testId` goes on the **outer** `<div className={cx('relative overflow-hidden', className)}>` — the element that
contains both the absolutely-positioned action layer and the row content. Today's `data-testid` sits on the content
alone (`SwipeRow.tsx:40-44` renders `leftAction` in a *sibling* layer), so a locator scoped to the row could never
reach the Edit and Delete buttons. `BillRow` imports `SwipeRow` from its new home and passes neither prop, so bills
keep `reveal = 76` and `openAt = 50` exactly. `UndoToast` moves the same way, imports only.

- [ ] **Step 4: `TransactionRow`** — one row for every transaction list:

```tsx
export function TransactionRow({ row, accounts, currency, trailing, onOpen, onEdit, onDelete, onRecategorise, phone }: { … })
```

The markup, which is where two of the gestures live:

```tsx
// Three controls side by side, never nested. The row's tap target is the label block, not a wrapper around
// everything: a <button> inside a <button> is invalid HTML, and the outer one's accessible name swallows the
// inner one's, so `getByRole('button', { name: 'Category for Superindo' })` would never match.
<li data-testid={phone ? undefined : 'transaction-row'} className="flex items-center gap-3 py-2">
  {onRecategorise && (
    <button type="button" aria-label={`Category for ${row.description}`} onClick={() => onRecategorise(row)}>
      <CategoryIcon categoryId={row.categoryId} accounts={accounts} … />
    </button>
  )}
  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(row)}>
    {/* description, the category · card line, the Excluded pill */}
  </button>
  <span className={cx('tabular-nums', row.excluded && 'line-through')}>{/* the amount */}</span>
  {trailing}
</li>
```

- The **Excluded** pill sits after the category, and when `row.excluded` the whole `<li>` takes `opacity-60` and the amount takes `line-through` — §4.4's "faded, struck through, with the Excluded pill".
- On a phone the `<li>` is wrapped in `<SwipeRow reveal={148} testId="transaction-row" leftAction={…}>` — two buttons, Edit (slate) and Delete (red, arming to "Delete?"). `onOpen` navigates to `/transactions/$transactionId`.
- On a desktop `onOpen` is the in-place editor, exactly as today, and the trailing slot holds the pencil and the ⓘ from Task 7. **Nothing about editing on a desktop changes.**
- `onEdit` is what the swipe's Edit calls. At this task `TransactionsPage` passes the same in-place editor it already opens; Task 14 gives the phone the edit sheet and rewires it there. The e2e above asserts the button is *reachable*, not what it opens, so this task's gate does not depend on a sheet that does not exist.
- The category button opens a `Sheet` titled `Category for <description>` (the existing `Sheet` gives it `role="dialog"` and that `aria-label`). Its body here is a flat list of the workspace's expense categories, one `<button>` each; **Task 16 replaces that body with `CategoryPicker`** and the title, the gesture and the toast stay. Picking calls `replaceTransaction` at once and shows `UndoToast` "Moved to <category> · Undo", Undo replacing it back.

- [ ] **Step 5: The day's total** — in `list-model.ts`, `ListRow` gains `excluded: boolean`; `buildRows` fills it
from `tx.excluded ?? false` for a recorded row and `false` for a draft; and the three readers that add rows up stop
counting it:

```ts
// dayTotal
  return dayNet(rows.map((row) => ({ …, counted: row.kind === 'tx' && !row.deleted && !row.excluded })));
// totals
  const counted = rows.filter((row) => row.kind === 'tx' && !row.deleted && !row.excluded);
// groupByCategory — the row still joins its group, it just adds nothing to the group's figure
  if (!row.deleted && !row.excluded && (row.type === 'expense' || row.type === 'income')) group.totalMinor += row.baseMinor;
```

The row itself is never filtered out: §4.4 wants it shown, faded and struck through, not hidden.

- [ ] **Step 6: Adopt it** — `TransactionsPage`'s `recordedRow` renders `TransactionRow` (drafts keep their own row
and their own in-place editor, untouched); `EventDetailPage`'s history and `StatementPanel`'s purchases render it
too, each passing its own `trailing` (the statement keeps its posted date and points; the event keeps its untag
button). All three pass `onRecategorise` on a desktop as well as a phone — spec §9's parity row is "Click the
category icon → the same list, same Undo toast", so it is not a phone-only prop.

Spec §8 also names "the category screen" and "search results". Neither is a screen of its own in this app: both are
`TransactionsPage` with a different `grouping` or a non-empty search filter — `TransactionsPage.tsx` is the only
component that calls `buildRows` — so adopting `TransactionRow` there covers them, and there is nothing further to
adopt. Confirm that by reading the route table in `router.tsx` before ticking this step; if a category or search
route has appeared since, it takes `TransactionRow` too.

- [ ] **Step 7: Run** — `cd apps/web && npx vitest run src/features/transactions/list-model.test.ts` → pass. Then the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green, `phone-recurring-bills.spec.ts` and `recurring-bills.spec.ts` included: the swipe move must not have changed bills by a pixel.

- [ ] **Step 8: Commit** — `git commit -am "feat(web): tap a row for its receipt, swipe for Edit or Delete, tap the icon to fix a category"` (with the trailer; `git add -A` the moved files).

---

## Step 4 — The new Add form tab by tab, and the edit sheet

### Task 10: Expense and Income — the card replaces the old form

**Files:**
- Create: `apps/web/src/features/transactions/TransactionCard.tsx`, `apps/web/src/features/transactions/FormPage.tsx`, `apps/web/src/features/transactions/CategoryPicker.tsx`, `apps/web/e2e/add-transaction.ts`, `apps/web/e2e/add-transaction.spec.ts`
- Modify: `apps/web/src/app/Layout.tsx`, `apps/web/src/app/router.tsx`, `apps/web/src/features/transactions/TransactionsPage.tsx`, `TransactionsTable.tsx`, `apps/web/src/features/transactions/TransactionRow.tsx` (its category sheet uses `CategoryPicker` from here on), and the **25 e2e files** listed in Step 1
- Delete: `apps/web/src/features/transactions/TransactionForm.tsx`
- Test: `apps/web/e2e/add-transaction.spec.ts`

- [ ] **Step 1: The helper first** — `apps/web/e2e/add-transaction.ts`:

```ts
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Records an expense or income through the Option B card, from wherever the + is.
 *
 * The amount is typed two different ways because the card offers two: a phone gets a keypad in the dock and no
 * text input at all (§3.4), a desktop gets a text input that evaluates on blur and Enter. Asking for the input
 * unconditionally is how this helper would break every phone spec that uses it.
 */
export async function addTransaction(page: Page, tx: { mode?: 'Expense' | 'Income'; description: string; paidWith: string; category: string; amount: string; date?: string }) {
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  if (tx.mode && tx.mode !== 'Expense') await form.getByRole('radio', { name: tx.mode }).click();
  await form.getByRole('button', { name: /^Amount/ }).click();
  await fillAmount(page, form, tx.amount);
  await form.getByRole('button', { name: /^(Paid with|Received into)/ }).click();
  await page.getByRole('dialog', { name: /^(Paid with|Received into)$/ }).getByRole('button', { name: tx.paidWith }).click();
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: tx.category, exact: true }).click();
  await form.getByLabel('Note').fill(tx.description);
  if (tx.date) await form.getByLabel('Date').fill(tx.date);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
}

/** The amount row is open. Type into whichever thing this viewport gave us. */
export async function fillAmount(page: Page, form: Locator, amount: string) {
  const keypad = page.getByTestId('keypad');
  if (await keypad.isVisible()) {
    if (!/^\d+$/.test(amount)) throw new Error(`The keypad types digits: ${amount} has to be typed on a desktop`);
    for (const digit of amount) await keypad.getByRole('button', { name: digit, exact: true }).click();
    await keypad.getByRole('button', { name: 'DONE' }).click();
    return;
  }
  await form.getByLabel('Amount', { exact: true }).fill(amount);
}
```

and `addTransfer`, `addPurchase` beside it, one per tab, added in Tasks 11 and 12.

**Rewrite every call site.** The list below is every file in `apps/web/e2e` that drives today's `TransactionForm`,
found by grepping for the button that opens it and for the `Amount` label it fills — **25 files**: 18 chromium
specs, 5 phone specs, the shared `event-plan.ts` helper, and the gestures spec Task 9 created.

| chromium (18) | phone (5) | helpers (2) |
|---|---|---|
| `account-types.spec.ts` · `budget.spec.ts` · `business-income.spec.ts` · `buy-flow.spec.ts` · `card-statements.spec.ts` · `catalogue.spec.ts` · `category-sets.spec.ts` · `coretax-pickers.spec.ts` · `critical-path.spec.ts` · `event-partly-planned.spec.ts` · `event-plan.spec.ts` · `lend-borrow.spec.ts` · `mcc.spec.ts` · `points.spec.ts` · `points-ledger.spec.ts` · `supplementary-card.spec.ts` · `transactions-list.spec.ts` · `workspaces.spec.ts` | `phone.spec.ts` · `phone-budget-page.spec.ts` · `phone-event-plan.spec.ts` · `phone-events.spec.ts` · `phone-workspaces.spec.ts` | `event-plan.ts` · `phone-transaction-gestures.spec.ts`'s local `record` |

Six of these were missing from this plan's first draft, and each would have gone red the moment
`TransactionForm.tsx` was deleted: `coretax-pickers.spec.ts` (its transfer), `event-partly-planned.spec.ts` and
`event-plan.spec.ts` (the event's **Add spending** and an item's **Buy it now**, both of which render the form),
`phone-events.spec.ts` and `phone-event-plan.spec.ts` (the same two by thumb), and `event-plan.ts`, whose
`spend()` helper at line 139 drives the form for `events.spec.ts` as well.

`events.spec.ts` is **not** in the list and needs no edit of its own: it has no form interaction, only
`import { addEvent, addWallet, fillItem, planFor, spend } from './event-plan'`, so rewriting `event-plan.ts`
covers it. `recurring-bills.spec.ts` and `phone-recurring-bills.spec.ts` also stay out: their `getByLabel('Amount')`
is the bill form on `/bills/new`, not this one.

`buy-flow.spec.ts` is rewritten here **once**. Task 12 adds `addPurchase` to the helper and extends `buy-flow`'s
assertions; it does not rewrite the file a second time.

The helper is the only place that knows what the form looks like, so the next tab never touches a spec again.

- [ ] **Step 2: Failing e2e** — `apps/web/e2e/add-transaction.spec.ts`: an expense through the card; the workspace row defaulting to the open workspace; Paid with offering "BCA KrisFlyer ···· 1467" when the account carries two cards and setting both account and card; the category picker; Save; the row in the list. Then income into a bank account.

- [ ] **Step 3: `TransactionCard`** — `TransactionCard({ initial, mode, onDone, full })`:

- The tabs as a `role="radiogroup"` — Expense · Income · Transfer · Buy / sell, the last only when `buyChoices(...).buys.length > 0`.
- Expense and Income rows in B2's order: **Workspace** (a `FormRow` opening `WorkspaceSheet`'s list; changing it clears the category), **Paid with** / **Received into** (a `Sheet` over `paymentOptions(money, cards)`, each card its own row with its digits), **Amount** (`AmountRow`), **Category**, **Note**, **Date** (‹ › stepping a day, the middle a date input).
- Under the card, **Add more details** (Task 13 fills it; here it is a row that opens an empty card, so the layout is right from the start).
- The dock: **Save**, or the keypad while the amount is being typed on a phone.
- Errors from `formToPost` above Save, word for word as today.
- `full` renders the same card on a page rather than in a sheet, for the routes.

- [ ] **Step 4: `CategoryPicker`, in its first form** — the helper above asserts
`page.getByRole('dialog', { name: 'Select category' })`, so the picker has to exist the moment the card does.
Create `CategoryPicker.tsx` here as the plain version: a `Sheet` titled **Select category**, an
**Expense** / **Income** segmented control starting on the form's tab, and one `<button>` per category —
`categoryPath` as its name, filtered the way `CategoryOptions` filters today
(`membership[a.id] === undefined && inOpenBook(a)`), against the workspace named in the form's first row.

**Task 16 grows this same file** into B7's tree of cards with the elbow line, the floating search pill and
**+ New category**. It is one component in two sizes, not two components: that is what lets Task 9's category
sheet, this card and the edit sheet all open the same picker.

- [ ] **Step 5: The routes and the callers** — `/transactions/new` → `FormPage`; `/transactions/$transactionId/edit`
→ `FormPage` with the transaction loaded. Both sit beside Task 7's `/transactions/$transactionId`. TanStack Router
ranks a static segment above a dynamic one, so `/transactions/new` is matched before `/transactions/$transactionId`
wherever the three sit in the array — **assert it rather than assume it**: `add-transaction.spec.ts` opens
`/transactions/new` directly and expects the empty card, not a receipt for a transaction called "new".

`Layout.tsx`'s add sheet, `TransactionsPage`'s `adding` and `editingId`, and `TransactionsTable`'s `renderForm`
all render `TransactionCard`. `TransactionRow`'s category sheet swaps its flat list for `CategoryPicker`.
Delete `TransactionForm.tsx`.

- [ ] **Step 6: Field-map check** — walk §2 of the spec and confirm each of Workspace, Paid with, Card, Amount, Category, Note, Date has a home in this task, and that Event, Split, With, MCC, Channel, Photos, Exclude, the exchange rate, To, For goal, Received amount and every Buy/sell field is either present or booked into Tasks 11–15. Write the result in the commit body.

- [ ] **Step 7: Run** — the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green, all 25 rewritten e2e files included. This is the widest gate in the plan; run it before anything else is touched.

- [ ] **Step 8: Commit** — `git commit -am "feat(web): the new Add Transaction card — expense and income"` (with the trailer).

---

### Task 11: Transfer

**Files:**
- Modify: `apps/web/src/features/transactions/TransactionCard.tsx`, `apps/web/e2e/add-transaction.ts`
- Test: `apps/web/e2e/add-transaction.spec.ts`

`tx-form.ts` is **not** in this list. `FormDraft` already carries `toId`, `toAmount` and `goalId` from Task 8, and
`formToPost` already returns `{ kind: 'transfer-goal', input }` for them; this task is the card's rows and the
helper, and nothing in the form model changes. (The first draft listed the file and never said what it changed.)

- [ ] **Step 1: Failing e2e** — a transfer between two IDR accounts; then one into a USD account, where **Received amount (USD)** appears and is required; then one tagged **For goal**, which still reaches `recordTaggedTransfer` (assert the goal's progress moves). `addTransfer(page, { from, to, amount, goal?, receivedAmount? })` goes into `add-transaction.ts` beside `addTransaction`, using the same `fillAmount` for both figures.

- [ ] **Step 2: Implement** — rows **From · Amount · To · Note · Date**, **no workspace row**; a second card with **For goal** (only when adding and there are goals) and **Received amount** (only when the currencies differ). `transferTargets(accounts, values)` (`buy-in-form.ts:134`) still filters unit-priced holdings, and the hint "Buying a fund, shares or gold? Use Buy or sell, so units are counted." moves onto the **To** row as its subline.

- [ ] **Step 3: Run** — the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green.

- [ ] **Step 4: Commit** — `git commit -am "feat(web): the Transfer tab, with its goal and its received amount"` (with the trailer).

---

### Task 12: Buy or sell

**Files:**
- Modify: `apps/web/src/features/transactions/TransactionCard.tsx`, `apps/web/src/features/transactions/tx-form.ts`, `apps/web/e2e/add-transaction.ts`, `apps/web/e2e/buy-flow.spec.ts`
- Test: `apps/web/e2e/buy-flow.spec.ts`, `apps/web/e2e/add-transaction.spec.ts`

`tx-form.ts` **is** in this list: `formToPost`'s `{ kind: 'trade', input }` branch lives there, and this is the task
that makes it work end to end against `purchaseDraftToInput`. `buy-flow.spec.ts` was already moved onto the helper
in Task 10; here it is **extended**, not rewritten again.

- [ ] **Step 1: Failing e2e** — `addPurchase(page, { what: 'Antam gold', amount: '3980000', units: '2', fee: '15000', paidWith: 'BCA KrisFlyer', goal: 'Hajj fund', pointsCategory: 'Jewellery', mcc: '5944' })` and the holding's units and the goal both move; a sale into a bank account; a purchase on a card earning points.

- [ ] **Step 2: Implement** — rows **what you bought or sold · Amount (cost or proceeds, before fees) · Units** or **Lots · Fee · Paid with** / **Proceeds into · Date**, then a second card with **For goal** / **Sell from goal** and, on a credit card, **Category for points** and **MCC**. `purchaseDraftToInput` and `recordTrade` are called unchanged, and every message they throw is shown above Save. The tab is hidden when `buyChoices(values, profiles).buys` is empty (`buy-in-form.ts:18`), as today.

- [ ] **Step 3: Run** — the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green.

- [ ] **Step 4: Commit** — `git commit -am "feat(web): the Buy or sell tab, units and fee and all"` (with the trailer).

---

### Task 13: Add more details — Event, Split, MCC, Channel, Exclude, the rate

**Files:**
- Create: `apps/web/src/features/transactions/MoreDetails.tsx`, `EventSheet.tsx`, `SplitSheet.tsx`, `ChannelSheet.tsx`, `McSheet.tsx`
- Modify: `apps/web/src/features/transactions/TransactionCard.tsx`
- Test: `apps/web/e2e/add-transaction.spec.ts`, `apps/web/e2e/mcc.spec.ts`

`EditSheet.tsx` is **not** in this list: it does not exist yet. The sheet is Task 14, and it opens this
`MoreDetails` — one implementation, two ways in, built in that order.

- [ ] **Step 1: Failing e2e** — one purchase carrying an event, two splits, an MCC remembered for the merchant, Channel Offline and Exclude on; then the receipt showing the event and the channel, the chart missing the amount, and the card statement still holding it.

- [ ] **Step 2: `MoreDetails`** — the second card, one `FormRow` per extra, each showing its value, each opening its own screen, and only when `extraRows(...)` says it applies:

| Row | Value shown | Screen |
|---|---|---|
| Event | the event's name | `EventSheet` — "No event" then `useEvents()`, newest first |
| Split | "None" or "2 splits · Total 85.000 IDR" | `SplitSheet` — B3a: category + amount per row, ✕, **+ Split**, the running total |
| MCC | "5812" | `McSheet` — today's `MccPicker` with its hint, **Remember for this merchant**, **Merchant text** (`suggestPattern`) |
| Channel | "Online" / "Offline" / nothing | `ChannelSheet` — D1's two choices, each with its line, tapping the chosen one again clears it, and D1's explanation |
| Exclude from report | a switch on the row | none |
| Exchange rate | the typed rate | the rate field, `ratePreview` under it, `checkManualRate` on save — only when `resolveRates` reports one missing |

- [ ] **Step 3: One implementation** — `MoreDetails({ draft, onChange, accounts, cards, missingRate })` takes the
draft and gives back a changed one; it knows nothing about where it is drawn. Task 14's edit sheet opens the very
same component with the very same props, which is the whole reason it is built before the sheet rather than after.

- [ ] **Step 4: Run** — the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green.

- [ ] **Step 5: Commit** — `git commit -am "feat(web): Add more details — the event, the split, the MCC, the channel, and leaving it out of the report"` (with the trailer).

---

### Task 14: The edit sheet — F3

Moved here from its first position as Task 9. Everything the sheet opens now exists: the phone's tap into a receipt
(Task 9), `TransactionCard` and the `/transactions/$transactionId/edit` route (Task 10), `CategoryPicker` (Task 10)
and `MoreDetails` (Task 13). Written where it was, none of them did, and its gate could not pass.

**Files:**
- Create: `apps/web/src/features/transactions/EditSheet.tsx`
- Modify: `apps/web/src/features/transactions/ReceiptPage.tsx`, `apps/web/src/features/transactions/TransactionsPage.tsx`, `apps/web/e2e/phone-transaction-gestures.spec.ts`
- Test: `apps/web/e2e/phone-transaction-gestures.spec.ts`

**Interfaces:**
- Consumes: `canEditInSheet`, `formToPost`, `FormRow`, `AmountRow`, `Keypad` (Task 8); `MoreDetails` (Task 13); `CategoryPicker` (Task 10); `ConvertForm` (exported in Task 7); `replaceTransaction`, `voidTransaction`.
- Produces: `EditSheet({ tx, onClose })`.

- [ ] **Step 1: Failing e2e** — a second test appended to `apps/web/e2e/phone-transaction-gestures.spec.ts`, which
by now records through the shared helper:

```ts
test('Edit — from the receipt or from the swipe — is one sheet, and ⋯ holds the rest', async ({ page }) => {
  // …an account, then…
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '120000' });

  // In from the receipt.
  await page.getByRole('button', { name: /Warung Steak/ }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit' });
  await sheet.getByLabel('Note').fill('Warung Steak Tebet');
  await sheet.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText('Warung Steak Tebet')).toBeVisible();

  // In from the swipe: the same sheet, and the rarer actions behind ⋯.
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Warung Steak Tebet' });
  await swipeLeft(page, row);
  await row.getByRole('button', { name: 'Edit' }).click();
  await sheet.getByRole('button', { name: 'More actions' }).click();
  for (const name of ['Open in full form', 'This was a purchase', 'Delete this transaction']) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Open in full form' }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\/edit$/);
});
```

- [ ] **Step 2: The sheet** — `EditSheet({ tx, onClose })` inside the existing `Sheet` (`apps/web/src/app/Sheet.tsx`, which already gives it `role="dialog"`, the title as its `aria-label`, the grab handle, Escape, the backdrop and the scroll lock), titled **Edit**:

- Header: ✕ · "Edit" · ⋯ (`aria-label="More actions"`).
- The amount, large and centred, tapping it opens the keypad (phone) or focuses the `AmountRow` input (desktop).
- Rows: **Note** · **Date** · **Paid with** · **Category** (opening `CategoryPicker`) · **More** ("Event, With, Photos…"), which opens `MoreDetails` with the same props `TransactionCard` passes it — the same screens, not a second set.
- **Save** full width → `replaceTransaction` with `formToPost(draft, accounts).input`, then `invalidate()`. The original stays under Show deleted, as today.
- ⋯ → **Open in full form** (`/transactions/$transactionId/edit`), **This was a purchase** (`ConvertForm` in a `Sheet`), **Delete this transaction** (asks twice, `voidTransaction`).
- `canEditInSheet(tx)` false → the sheet is not shown at all; the caller opens the full form instead.

- [ ] **Step 3: Wire both ways in** — the receipt's **Edit** opens this sheet on a phone and navigates to
`/transactions/$transactionId/edit` on a desktop; and `TransactionsPage` changes the `onEdit` it hands
`TransactionRow` so the swipe's **Edit** opens the sheet on a phone too, instead of the in-place editor it has
been opening since Task 9. The desktop's `onEdit` is untouched: click still edits in place.

- [ ] **Step 4: Run** — the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green.

- [ ] **Step 5: Commit** — `git commit -am "feat(web): one edit sheet on the phone, with the rarer actions behind ⋯"` (with the trailer).

---

### Task 15: With, and Photos

**Files:**
- Create: `apps/web/src/features/transactions/WithSheet.tsx`, `PhotosSheet.tsx`, `apps/web/e2e/phone-add-transaction.spec.ts`
- Modify: `apps/web/src/features/transactions/MoreDetails.tsx`, `ReceiptPage.tsx`
- Test: `apps/web/e2e/add-transaction.spec.ts`, `apps/web/e2e/phone-add-transaction.spec.ts`

**Interfaces:**
- Consumes: `equalShares`, `yourShare` (Task 1); `recentPeople`, `splitBill` (Task 5); `savePhotoBytes`, `deletePhotoFile`, `photoUrl` (Task 6); `addPhoto`, `deletePhoto`, `listPhotos` (Task 2).

- [ ] **Step 1: Failing e2e** — dinner for four on a card: three people added, **Split equally**, the summary reading Bill 400.000 · They owe you 300.000 · Your share 100.000; after saving, Lend & borrow shows three people owing 100.000 each, the card's statement shows 400.000, and Restaurants shows 100.000. Then the same with **Custom amounts**, where one person's share is typed and your share is what is left. Then a photo chosen from a file, shown on the receipt.

- [ ] **Step 2: `WithSheet`** — D4:

- "Add a person" search over `recentPeople` as chips; a name not on the books is a new person, opened on saving exactly as today.
- **Split equally** / **Custom amounts**, using `equalShares` and `yourShare` from Task 1; the rows read "You · Your spending · <category>" then each person "Owes you", each with ✕.
- The summary card: **Bill**, **They owe you**, **Your share**.
- Saving goes through `formToPost`'s `{ kind: 'split' }` to `splitBill`, with the channel, the event and the exclusion carried along. Offered when adding an expense, not when editing one — an edit opens the full form, as today.

- [ ] **Step 3: `PhotosSheet`** — D2: the thumbnail grid with ✕ on each and a + tile, **📷 Take photo** (`capture="environment"`) and **🖼 Choose from library**, the line *Photos stay on this device with the transaction and go into your backups. Tap one to see it full size.*, a full-size viewer on tap, and drag-and-drop on a desktop. The receipt's strip (built in Task 7) reads the same files.

**Two identifiers, and they are not interchangeable.** `savePhotoBytes(bytes, mime)` gives back an **OPFS file
name**; `addPhoto(...)` gives back a **`transaction_photos.id`**; `draft.photoIds` holds the *row* ids, because
that is what `writeExtrasTx` re-keys at Save. So each pick is two writes, in this order:

```ts
  // The bytes first, so a row never names a file that is not there; then the row, owned by nobody yet. Save
  // re-keys the row onto the transaction (writeExtrasTx); an abandoned form leaves a row and a file that the
  // app-start sweep and the orphan pass tidy together.
  const { fileName, byteSize } = await photos.savePhotoBytes(bytes, file.type);
  const photoId = await addPhoto(database, ws, { transactionId: '', fileName, mime: file.type, byteSize });
  onChange({ ...draft, photoIds: [...draft.photoIds, photoId] });
```

✕ on a thumbnail does the reverse, both halves: `deletePhoto(database, ws, photoId)` then
`deletePhotoFile(fileName)`, and drops the id from `draft.photoIds`.

Closing the sheet runs `sweepOrphanPhotos(await allPhotoFileNames(database))` — the same call Task 6 wired at app
start, so a file whose row was deleted goes with it.

- [ ] **Step 4: The phone spec** — create `apps/web/e2e/phone-add-transaction.spec.ts` (`phone` project) with the
one flow this task can prove on its own: open Add more details, add a photo from a file, save, and see it on the
receipt. Task 18 grows this file into the full phone pass; it exists from here so Task 18 modifies a file that is
there.

- [ ] **Step 5: Run** — the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green.

- [ ] **Step 6: Commit** — `git commit -am "feat(web): several people can owe part of a bill, and a receipt can carry its photos"` (with the trailer).

---

### Task 16: The category picker and New category — B7, B7a

**Files:**
- Create: `apps/web/src/features/transactions/NewCategorySheet.tsx`
- Modify: `apps/web/src/features/transactions/CategoryPicker.tsx` (created flat in Task 10; it becomes the tree here), `apps/web/src/features/categories/CategoryIcon.tsx`
- Test: `apps/web/e2e/add-transaction.spec.ts`, `apps/web/e2e/category-sets.spec.ts`

`TransactionCard.tsx`, `TransactionRow.tsx` and `EditSheet.tsx` are **not** in this list. All three already open
`CategoryPicker` — the card and the row from Task 10, the sheet from Task 14 — so growing the picker reaches every
one of them without touching a caller.

- [ ] **Step 1: Failing e2e** — the picker shows parents as cards with their children indented; tapping a parent picks the parent; search narrows; **+ New category** makes "Boba" inside Food and beverage with an icon, files it into the open workspace, and returns to the form with it chosen; the new category then appears on the Categories page and in the picker of a second workspace **not at all**.

- [ ] **Step 2: `CategoryPicker` grows into B7** — the flat list from Task 10 keeps its `Sheet`, its title and its segmented control, and gains:

- Header ‹ · "Select category" · ≡ (a link to `/categories`).
- **+ New category** first, in green.
- One card per top-level category: the parent row, then its children indented with the elbow line (a `::before` border, as the mockup draws it). Tapping a parent picks the parent.
- A floating search pill at the foot, filtering on `categoryPath`.
- Only the chosen workspace's categories, set categories excluded — the same filter `CategoryOptions` uses (`membership[a.id] === undefined && inOpenBook(a)`), with the workspace taken from the form's first row rather than the open one.

The picker therefore has a workspace of its own, which may not be the open one. Step 3 has to honour that.

- [ ] **Step 3: `NewCategorySheet`** — B7a: **Name**, **Inside** (Top level, or a parent from the same kind), **Kind** (fixed by the tab), **Icon** (a grid of `ICONS`, `CategoryIcon.tsx:19`).

Save calls `createAccount(database, pickerWs, { name, kind, subtype: 'category', currency: null, parentId, icon })`
**with the picker's workspace context, not the open one** — the same context Step 2 filters on. `createAccount` files a
new category into the book of the context it is given; handed the open workspace while the form sits on another,
it would file the category in the wrong book, and the picker's own filter would then hide the category it had just
chosen. Build the context from the form's workspace row (`{ ...ws, workspaceId, bookId }` for the chosen row), and
add an e2e line for it: on a second workspace, **+ New category** makes "Boba", the picker shows it, and the
Categories page shows it **in that workspace and not in the first**.

`CreateAccountInput.icon` exists (`accounts.ts:42`) and `accounts.icon` exists (`schema.ts:34`) — no migration.

- [ ] **Step 4: The icon is drawn** — `CategoryIcon` takes the account's own `icon` when it has one. The existing variable is `visual` (`CategoryIcon.tsx:71`), so the edit is on that line:

```tsx
  const chosen = categoryId ? accounts.find((a) => a.id === categoryId)?.icon : null;
  const base = transfer ? TRANSFER_VISUAL : categoryId ? categoryVisual(key, rootKey) : UNKNOWN_VISUAL;
  // A category made in the picker draws the icon that was picked for it; one without keeps inheriting its parent's.
  const visual = chosen ? { ...base, icon: chosen } : base;
```

The final value stays named `visual`, because the two lines below it (`ICONS[visual.icon]` and `visual.colour`)
already use that name — `base` is the new local, not a rename.

A category with no icon keeps inheriting its parent's, exactly as today (`category-visuals.test.ts` stays green).

- [ ] **Step 5: Check every way in** — the form's Category row, the edit sheet's, and the category-icon gesture from Task 9 already point at this component; open each one and confirm it now draws the tree, the search and **+ New category**. No caller changes.

- [ ] **Step 6: Run** — the gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2` → all green, `category-visuals.test.ts` and `category-sets.spec.ts` included.

- [ ] **Step 7: Commit** — `git commit -am "feat(web): the category picker as a tree, with a new category without leaving the form"` (with the trailer).

---

## Step 5 — End to end

### Task 17: Desktop, end to end

**Files:**
- Modify: `apps/web/e2e/add-transaction.spec.ts` (Task 10), `apps/web/e2e/transaction-receipt.spec.ts` (Task 7)
- Test: both

Both files already exist by the time this task runs; nothing here creates one.

- [ ] **Step 1: Write the specs** (`chromium`):

- **Nothing was lost**: one purchase recorded with every field the old form had — date, note, paid with, which card, category, amount, a split of two, MCC with Remember for this merchant, a foreign currency with its charged amount — read back off the receipt and the row.
- **Edit in place still works**: click a row, change the amount, Enter, and the original is under Show deleted.
- **ⓘ** opens the receipt; **Delete** there asks twice; **This was a purchase** converts a purchase and the units appear under Net worth.
- **Excluded**: a purchase marked excluded leaves the chart's total and the budget's spending, stays on the card's statement and in the points, and shows the **Excluded** pill in the list.
- **The keyboard alone** can record a purchase: tab to +, tabs through the rows, `85000+15000` typed in the amount
  field. **Evaluating and saving are two keystrokes, not one** — the field's own Enter runs the evaluator built in
  Task 8 Step 4, so the assertion is in two parts:

```ts
  const amount = form.getByLabel('Amount', { exact: true });
  await amount.fill('85000+15000');
  await amount.press('Enter');
  await expect(amount).toHaveValue('100000');   // the evaluator ran; nothing was saved yet
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Superindo' })).toContainText('100.000');
```

  Then the same figure by blur alone: refill the field and press Tab, and the row still reads 100.000. Nothing in
  this bullet is new behaviour asked for by an e2e — Task 8 builds the desktop evaluator, and this proves it.

- [ ] **Step 2: Run** — `cd apps/web && npx playwright test --project=chromium --workers=2` → pass, then the whole gate: `npm run typecheck` (root), `npm test` (root), `cd apps/web && npx playwright test --workers=2`.

- [ ] **Step 3: Commit** — `git commit -am "test(e2e): the new form keeps every field, and the desktop keeps every way in"` (with the trailer).

---

### Task 18: The phone, end to end

**Files:**
- Modify: `apps/web/e2e/phone-add-transaction.spec.ts` (Task 15), `apps/web/e2e/phone-transaction-gestures.spec.ts` (Task 9)
- Test: both

Both files already exist by the time this task runs; nothing here creates one.

- [ ] **Step 1: Write the specs** (`phone`):

- **The keypad**: tap the amount, type `120000+35000`, **DONE** closes the keypad and the row reads 155.000; there is no Save key on the keypad and no recent amounts (`expect(keypad.getByRole('button', { name: 'Save' })).toHaveCount(0)`).
- **The flag**: tap it, choose CNY, the **Charged in IDR** row appears pre-filled, type what the bank took, save, and the receipt reads "¥120 charged as Rp272.400"; choosing IDR again removes the row.
- **The gestures**: tap → receipt; swipe → Edit → the sheet → Save; swipe → Delete twice; tap the icon → the picker → "Moved to … · Undo".
- **Add more details**: Channel Offline, one photo from a file, Exclude on — all three read back on the receipt.
- **Every thumb target is 44px or more** on the form and the sheet (`boundingBox()` over the rows, as `phone-inputs.spec.ts` does).

- [ ] **Step 2: Run** — `cd apps/web && npx playwright test --project=phone --workers=2` → pass, then the whole gate.

- [ ] **Step 3: Final field-map pass** — read §2 of the spec once more against the shipped screens; every line must name a screen that exists. Note any that do not in the commit body and fix them before committing.

- [ ] **Step 4: Commit** — `git commit -am "test(e2e): the phone records, corrects and reads a transaction by thumb"` (with the trailer).
