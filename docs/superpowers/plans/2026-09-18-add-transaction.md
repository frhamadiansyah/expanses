# Add Transaction rebuild, the receipt, and the phone gestures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace today's flat `TransactionForm` with the Option B card — four tabs, short rows, an amount row with a currency flag and a "Charged in *base*" row, a keypad whose DONE works out sums, and "Add more details" holding Event, Split, With (several people), MCC, Channel, Photos and Exclude from report — add a receipt screen for every transaction, and give the phone its three gestures (tap → receipt, swipe → Edit/Delete, tap the icon → category) all leading to one edit sheet, without losing a single field or action, and without weakening the desktop.

**Architecture:** New facts go in side tables from migration 0048 — `transaction_flags` (channel, excluded) and `transaction_photos` (one row per photo) — never in columns on `transactions` or `accounts`, and every read and write of them is guarded by `extrasTablesExist(db)`, the same `WeakMap` guard `billTablesExist` uses. Photo bytes live in OPFS under `expanses-photos/`, written from the main thread, and reach backups as a store-only zip built by a pure function in `packages/core`. Event keeps the `transactions.event_id` column it already has; "With" is the existing `splitBill` with more than one share; the C2 currency row is the existing `original_currency` / `original_amount_minor` pair, so the derived rate needs no storage. Exclusion is enforced in exactly two repository choke points — `categoryRows` in `reports.ts` and the income/spending buckets of `periodFlows` — which covers the chart, the rings, the dashboard and the budget sheet while balances, statements, points and net worth keep counting it. The web side is one card component (`TransactionCard`) and a row kit shared by the add form, the edit sheet and the full-form routes, plus one `TransactionRow` carrying the gestures in every transaction list.

**Tech Stack:** TypeScript monorepo — `packages/core` (pure), `packages/db` (Drizzle over sqlite-proxy, SQL migrations as `?raw` imports, `better-sqlite3` in tests), `apps/web` (React 19, TanStack Router/Query, Tailwind 4, SQLite wasm in a worker over OPFS); Vitest; Playwright (`chromium` and `phone` projects).

**Spec:** `docs/superpowers/specs/2026-09-18-add-transaction-design.md` (approved 2026-09-18)

## Global Constraints

- **No field and no action is lost.** §2 of the spec — the field map from `add-transaction.html` and the row actions from `quick-edit.html` — is the checklist. Before every commit that touches the form, the sheet or a row, re-read it and confirm each line still has a home. A field may move; none may disappear.
- **No new columns on existing tables** (`transactions`, `accounts`, `entries`, `expense_templates`, `cards`). The ORM names every column it knows on every insert, so a column there breaks any database still stopped at an older version (migration 0028's comment). New facts go in `transaction_flags` and `transaction_photos`.
- **Older databases:** every repository read or write of the two new tables goes through `extrasTablesExist(db)`; without them every function behaves exactly as it does today. Migration tests seed an older database through guarded repositories or with raw SQL naming only the columns that version had.
- **Desktop is never weaker than the phone.** Edit-in-place (`QuickRowEditor`) stays exactly as it is; the desktop gains ⓘ for the receipt, the category-icon picker, the same extras and the same keypad arithmetic through the keyboard. Every new control is reachable by keyboard and closes on Escape.
- **Photos never leave the device.** No upload, no `fetch`, no third-party library. Bytes go to OPFS from the main thread only, never through the worker and never inside the database's VFS directory.
- Migration **0048** is additive and backfills nothing: an absent row means "no channel, not excluded, no photos", which is what every existing transaction is. 0047 belongs to the Coretax pickers project; if it is not there, still take 48 and leave 47 free.
- Inside `database.transaction((tx) => …)` use `tx` only — `database.db` there deadlocks on the mutex.
- Country-neutral: no Indonesia-specific presets, no country list, no locale-specific copy. Only the tax report is local and it is not touched here.
- Test snippets name real functions and real signatures as read on 2026-09-18; if the compiler disagrees, re-read the type and match it rather than changing the function.
- Branch `feat/add-transaction`. Commit per task; merge and push only when the user asks. Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Gate before every commit: `npm run typecheck` (root), `npm test` (root), and `npx playwright test --workers=2` (in `apps/web`).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/money/keypad.ts` | `evaluateAmount` — the keypad's and the desktop field's arithmetic |
| `packages/core/src/money/currencies.ts` | `flag` on `CurrencyInfo`, one per entry |
| `packages/core/src/debts/shares.ts` | `equalShares`, `yourShare` — With, split equally or custom |
| `packages/core/src/backup/zip.ts` | `zipStore`, `unzipStore` — store-only zip for the photo backup |
| `packages/core/src/points/earn.ts` | `RuleMatch.channel`, `SpendLine.channel`, one line in `matchesSpend` |
| `packages/core/src/index.ts` | export the above |
| `packages/core/test/keypad.test.ts`, `shares.test.ts`, `zip.test.ts`, `currency-flags.test.ts`, `points-channel.test.ts` | the pure tests |
| `packages/db/migrations/0048_transaction_extras.sql` | `transaction_flags`, `transaction_photos`, index |
| `packages/db/src/migrations.ts` | register 0048 |
| `packages/db/src/schema-extras.ts` | Drizzle `transactionFlags`, `transactionPhotos` |
| `packages/db/src/repos/transaction-extras.ts` | `extrasTablesExist`, `writeExtrasTx`, `carryExtrasTx`, `extrasFor`, `notExcluded`, `addPhoto`, `listPhotos`, `deletePhoto`, `allPhotoRows` |
| `packages/db/src/repos/ledger.ts` | `channel`/`excludedFromReport`/`eventId`/`photoIds` on posting; `replaceTransaction` carries them; `TransactionView.channel`, `.excluded`, `.photoCount` |
| `packages/db/src/repos/reports.ts` | `categoryRows` leaves excluded out; so does `eventSpendingBetween` |
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
| `apps/web/src/features/transactions/tx-form.ts` (+ `.test.ts`) | `FormDraft`, `emptyForm`, `formFromTransaction`, `formToPost`, `extraRows`, `canEditInSheet` |
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
| `apps/web/e2e/add-transaction.ts` | the shared helper every existing spec now uses |
| `apps/web/e2e/add-transaction.spec.ts`, `transaction-receipt.spec.ts` | chromium flows |
| `apps/web/e2e/phone-add-transaction.spec.ts`, `phone-transaction-gestures.spec.ts` | phone flows |

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
import { evaluateAmount } from '../src/index';

describe('what DONE works out', () => {
  it('reads a plain amount the way the rest of the app does', () => {
    expect(evaluateAmount('85000', 'IDR')).toBe(85_000);
    expect(evaluateAmount('85.000', 'IDR')).toBe(85_000);
    expect(evaluateAmount('10,50', 'USD')).toBe(1050);
  });

  it('adds and subtracts', () => {
    expect(evaluateAmount('120000+35000', 'IDR')).toBe(155_000);
    expect(evaluateAmount('100000−25000', 'IDR')).toBe(75_000);
    expect(evaluateAmount('100000-25000', 'IDR')).toBe(75_000);
  });

  it('multiplies and divides by a plain count, before it adds', () => {
    expect(evaluateAmount('85000×3', 'IDR')).toBe(255_000);
    expect(evaluateAmount('85000*3', 'IDR')).toBe(255_000);
    expect(evaluateAmount('450000÷4', 'IDR')).toBe(112_500);
    expect(evaluateAmount('10000+2000×3', 'IDR')).toBe(16_000);
  });

  it('rounds to the currency, away from zero', () => {
    expect(evaluateAmount('100÷3', 'IDR')).toBe(33);
    expect(evaluateAmount('10,00÷3', 'USD')).toBe(333);
  });

  it('gives nothing back when it cannot be read, so the row keeps what it had', () => {
    expect(evaluateAmount('', 'IDR')).toBeNull();
    expect(evaluateAmount('85000+', 'IDR')).toBeNull();
    expect(evaluateAmount('abc', 'IDR')).toBeNull();
    expect(evaluateAmount('85000÷0', 'IDR')).toBeNull();
    // An amount is never negative: the sign is the mode, not the figure.
    expect(evaluateAmount('25000−85000', 'IDR')).toBeNull();
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
});
```

- [ ] **Step 2: Run and see it fail** — `cd packages/core && npx vitest run` → FAIL (`evaluateAmount` and the rest are not exported).

- [ ] **Step 3: Implement**

`packages/core/src/money/keypad.ts` — tokenise, evaluate in major units with × and ÷ before + and −, then round once:

```ts
import { currencyInfo } from './currencies';
import { roundHalfAwayFromZero } from './money';

/** A figure as typed: "." groups thousands and "," is the decimal, as parseMajor reads them. */
function parseDecimal(text: string): number | null {
  const cleaned = text.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/**
 * What DONE works out, in minor units: a plain amount, or a sum of them with × and ÷ by a plain count.
 *
 * Null when it cannot be read or comes to less than nothing, so the amount row keeps whatever it had and the
 * keypad stays open. Rounded once at the end, so 100÷3 three times over is still the bill.
 */
export function evaluateAmount(expression: string, currency: string): number | null {
  const normalised = expression.replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\s+/g, '');
  if (!normalised || /[+\-*/]$/.test(normalised)) return null;
  const parts = normalised.split(/([+\-*/])/);
  const values: number[] = [];
  const adds: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const value = parseDecimal(parts[i] ?? '');
    if (value === null) return null;
    const operator = parts[i - 1];
    if (operator === '*') values[values.length - 1] *= value;
    else if (operator === '/') {
      if (value === 0) return null;
      values[values.length - 1] /= value;
    } else {
      values.push(value);
      if (operator) adds.push(operator);
    }
  }
  let total = values[0] ?? 0;
  for (const [index, operator] of adds.entries()) total = operator === '-' ? total - values[index + 1]! : total + values[index + 1]!;
  const minor = roundHalfAwayFromZero(total * 10 ** currencyInfo(currency).exponent);
  return minor > 0 && Number.isSafeInteger(minor) ? minor : null;
}
```

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

`packages/core/src/backup/zip.ts` — a store-only (method 0) writer and reader: local header, data, central directory, end-of-central-directory, with a table-driven CRC32. No compression, no dependency. Keep it under 120 lines and comment that it exists so photos can travel with a backup without a library.

Export all of it from `packages/core/src/index.ts`.

- [ ] **Step 4: Run** — `cd packages/core && npx vitest run` → all pass. `npm run typecheck` → clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(core): what DONE works out, how a bill divides, a flag per currency, and a zip for photos"` (with the trailer; `git add` the new files first).

---

### Task 2: Migration 0048 — channel, exclusion and photo rows

**Files:**
- Create: `packages/db/migrations/0048_transaction_extras.sql`, `packages/db/src/schema-extras.ts`, `packages/db/src/repos/transaction-extras.ts`
- Modify: `packages/db/src/migrations.ts`, `packages/db/src/repos/ledger.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/transaction-extras.test.ts`, `packages/db/test/transaction-extras-migration.test.ts`, `packages/db/test/database.test.ts`

**Interfaces:**
- Produces: `extrasTablesExist(db)`, `writeExtrasTx`, `carryExtrasTx`, `extrasFor`, `notExcluded()`, `addPhoto`, `listPhotos`, `deletePhoto`, `allPhotoRows`, `TransactionPhotoRow`; `PostTransactionInput.channel | excludedFromReport | eventId | photoIds`; `TransactionView.channel | excluded | photoCount`.

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
```

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

    expect(await migrate(database)).toEqual([48]);
    const rows = await database.db.values<[number]>(sql`SELECT count(*) FROM transaction_flags`);
    expect(Number(rows[0]![0])).toBe(0);
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id, channel: null, excluded: false, photoCount: 0 });
  });
});
```

In `packages/db/test/database.test.ts`, extend the applied-versions list with `47, 48` (47 comes from the Coretax pickers project; if that has not landed, `…, 46, 48`).

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

- `extrasTablesExist(db: Db): Promise<boolean>` — the `WeakMap` guard, copied from `billTablesExist`, asking for `transaction_flags`.
- `writeExtrasTx(tx, ws, transactionId, { channel, excluded, photoIds })` — inserts or updates the flag row only when something is actually set (a row of nulls and zero is never written), and re-keys the named photo rows onto this transaction.
- `carryExtrasTx(tx, ws, fromId, toId)` — moves the flag row and the photo rows onto a replacement, the way `replaceTransaction` already moves card postings.
- `extrasFor(db, ws, ids)` — one query per list: `Map<string, { channel, excluded, photoCount }>`.
- `notExcluded(): SQL` — `${transactions.id} NOT IN (SELECT transaction_id FROM transaction_flags WHERE excluded = 1)`, for the two readers in Task 3.
- `addPhoto(database, ws, { transactionId, fileName, mime, byteSize })`, `listPhotos(database, ws, transactionId)`, `deletePhoto(database, ws, photoId)`, `allPhotoRows(database, ws)` — the last for the backup and the orphan sweep.

Photos added before a transaction exists are written with `transactionId: ''` and re-keyed by `writeExtrasTx`; `allPhotoRows` returns them so the sweep can tell an orphan from a kept photo.

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

`postTransactionTx` writes `eventId: input.eventId ?? null` into the insert it already makes, and calls `writeExtrasTx` after the entries when `await extrasTablesExist(tx)`. `replaceTransaction` gains, beside the lines that carry MCC and card:

```ts
      ...(input.eventId === undefined ? { eventId: original?.eventId ?? null } : {}),
```

and, after the `transactionPointActuals` update, `await carryExtrasTx(tx, ws, id, replacement)` — but only for the facts the input did not name, so `channel: null` clears rather than restores. `listWith` reads `extrasFor` once per page, exactly as it reads `billMonths`, and fills `channel`, `excluded` and `photoCount` on each view; without the tables they are `null`, `false` and `0`.

`TransactionView` gains the three, `channel` and `excluded` and `photoCount` marked optional in the same way `billMonth` is, so a view built by hand in a test need not name them.

- [ ] **Step 6: Run** — `cd packages/db && npx vitest run` → all pass, including `books-sample-migration.test.ts` and `database.test.ts`. `npm run typecheck` → clean.

- [ ] **Step 7: Commit** — `git commit -am "feat(db): a channel, an exclusion and photo rows beside a transaction (0048)"` (with the trailer; `git add` the new files first).

---

### Task 3: An excluded transaction leaves the chart and the budgets, and nothing else

**Files:**
- Modify: `packages/db/src/repos/reports.ts`, `packages/db/src/repos/flows.ts`
- Test: `packages/db/test/excluded-figures.test.ts`

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
```

- [ ] **Step 2: Run and see it fail** — `cd packages/db && npx vitest run test/excluded-figures.test.ts` → FAIL (the excluded purchase is still counted).

- [ ] **Step 3: Implement**

In `packages/db/src/repos/reports.ts`, inside `categoryRows`, after the book narrowing:

```ts
      // What was marked "not my spending" leaves the chart, the rings and the budgets. It is still on the card,
      // still in the balance, still earning points: only this reading of it changes.
      ...((await extrasTablesExist(database.db)) ? [notExcluded()] : []),
```

and the same clause on `eventSpendingBetween`'s `where`.

In `packages/db/src/repos/flows.ts`, read the excluded ids once (`SELECT transaction_id FROM transaction_flags WHERE excluded = 1`, guarded), then in the row loop skip **only** the income and spending buckets for those transactions:

```ts
    const counted = !excludedIds.has(row.transactionId);
    if (counted && row.kind === 'income' && …) …
    else if (counted && row.kind === 'expense' && …) …
    // The rolls below are facts about balances — what a loan paid down, what reached savings — so they keep it.
```

- [ ] **Step 4: Run** — `cd packages/db && npx vitest run` → all pass (`budget-sheet.test.ts`, `books-sample.test.ts` and `bill-months-figures.test.ts` must be unchanged figure for figure). `npm run typecheck` → clean.

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

on `SpendLine` (optional, so every fixture built by hand keeps compiling):

```ts
  /** What the owner said about the purchase: 'online', 'offline', or nothing. Never guessed. */
  channel?: 'online' | 'offline' | null;
```

and one line in `matchesSpend`, after the merchant patterns:

```ts
  if (match.channel && line.channel && match.channel !== line.channel) return false;
```

In `packages/db/src/repos/points.ts`, `cardSpendLines` reads `tf.channel` with a `LEFT JOIN transaction_flags tf ON tf.transaction_id = t.id` in both queries — guarded by `extrasTablesExist`, so a database without the table takes today's SQL unchanged.

- [ ] **Step 4: Run** — `npm test` (root) → all pass, including every `catalog-*.test.ts` (no catalogue rule names a channel, so no earned figure may move). `npm run typecheck` → clean.

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

- [ ] **Step 4: Run** — `cd packages/db && npx vitest run` → all pass (`lend-borrow` figures unchanged). `npm run typecheck` → clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(db): one bill, several people, and the people you split with last"` (with the trailer).

---

### Task 6: Photos on the device, and in the backup

**Files:**
- Create: `apps/web/src/photos/store.ts`, `apps/web/src/photos/store.test.ts`
- Modify: `apps/web/src/features/backup/BackupPage.tsx`
- Test: `apps/web/src/photos/store.test.ts`

**Interfaces:**
- Produces: `savePhotoBytes(bytes, mime): Promise<{ id: string; fileName: string; byteSize: number }>`, `readPhotoBytes(fileName)`, `deletePhotoFile(fileName)`, `listPhotoFiles()`, `sweepOrphanPhotos(kept: Iterable<string>)`, `photoUrl(fileName)`.

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

`apps/web/src/photos/memory-directory.ts` is a tiny in-memory `FileSystemDirectoryHandle` stand-in for the test (get, remove, entries).

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

- [ ] **Step 5: Run** — `npm run typecheck`, `npm test` (root), `cd apps/web && npx playwright test --workers=2` → pass.

- [ ] **Step 6: Commit** — `git commit -am "feat(web): receipt photos kept on the device, and a zip of them for the backup"` (with the trailer; `git add` the new folder first).

---

## Step 2 — The receipt

### Task 7: The receipt screen — B8

**Files:**
- Create: `apps/web/src/features/transactions/ReceiptPage.tsx`, `apps/web/src/features/transactions/receipt-view.ts` (+ `.test.ts`)
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/features/transactions/TransactionsPage.tsx`, `apps/web/src/features/transactions/TransactionsTable.tsx`
- Test: `apps/web/src/features/transactions/receipt-view.test.ts`

- [ ] **Step 1: Failing unit test** — `receipt-view.ts` turns a `TransactionView` plus its accounts, cards, points and people into the lines B8 shows, so the screen itself holds no arithmetic:

```ts
// apps/web/src/features/transactions/receipt-view.test.ts — the shape of it
it('says what was paid with, what it came to, and who owes what', () => { … });
it('leaves out a line it has nothing to say about', () => { … });
it('says an excluded purchase is still on the card', () => { … });
```

`receiptLines(...)` returns `{ label: string; value: string; tone?: 'points' }[]`, in B8's order: Paid with · Total · Points earned · "<people> owe you" · Your share · Event · Channel · Original amount · bill month.

- [ ] **Step 2: The route** — in `apps/web/src/app/router.tsx`, after the `/transactions` route:

```tsx
  createRoute({ getParentRoute: () => rootRoute, path: '/transactions/$transactionId', component: ReceiptRoute }),
```

where `ReceiptRoute` reads `transactionId` with `getRouteApi('/transactions/$transactionId').useParams()` and renders `<ReceiptPage transactionId={transactionId} />`, the way `BillRoute` does for a bill.

- [ ] **Step 3: The screen** — `ReceiptPage`:

- Reads the one transaction with `listTransactions(database, ownerScope(ws), { … })` filtered by id (an account's history is owner-wide, so a receipt must open whatever workspace it was filed in), its accounts, cards, `loadPurchasePoints`, `peopleDebts` and `listPhotos`.
- ‹ back (`navigate({ to: '/transactions' })` when there is no history to pop), the category circle, the amount large, the description, "Restaurants · Personal", the long date.
- The card of `receiptLines`, then the photo strip (`photoUrl`), then **This was a purchase** (only with holdings; reuses today's `ConvertForm` in a `Sheet`), **Edit**, **Delete**.
- Delete asks twice in place, then `voidTransaction` and back to the list.
- A row filed in another workspace shows `SwitchToEdit` instead of Edit, as the list does today.
- Excluded: under the date, *Excluded from the chart and budgets. Still counted in balances, statements and points.*

- [ ] **Step 4: Ways in** — on a desktop, a row in the list and a row in the table end with a ⓘ button (`Info` from lucide-react), `aria-label={`Receipt for ${description}`}`, `hidden md:inline-flex`, which navigates to the route. The row's own click still opens the in-place editor: **nothing about editing on a desktop changes.** The phone's tap comes in Task 10.

- [ ] **Step 5: Run** — gate → pass.

- [ ] **Step 6: Commit** — `git commit -am "feat(web): every transaction has a receipt, and a desktop row an ⓘ to open it"` (with the trailer).

---

## Step 3 — The edit sheet and the phone gestures

### Task 8: The row kit and the form model

**Files:**
- Create: `apps/web/src/features/transactions/tx-form.ts` (+ `.test.ts`), `FormRow.tsx`, `AmountRow.tsx`, `CurrencySheet.tsx`, `Keypad.tsx`
- Modify: `apps/web/src/ui/index.tsx` (nothing new; the kit lives in the feature)
- Test: `apps/web/src/features/transactions/tx-form.test.ts`

**Interfaces:**
- Produces: `FormDraft`, `emptyForm`, `formFromTransaction`, `formToPost`, `chargedInNeeded`, `extraRows`, `canEditInSheet`.

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
  purchase: PurchaseDraft;   // buy-in-form.ts, unchanged
}
```

- [ ] **Step 1: Failing tests** — `tx-form.test.ts` asserts, against real accounts built as plain `AccountRow` objects:

```ts
it('builds an expense exactly as the old form did', () => { … expect(formToPost(draft, accounts)).toMatchObject({ lines: expenseLines({ … }) }) … });
it('keeps the typed currency as the original, and the charged amount as the posting', () => { … originalCurrency: 'CNY', originalAmountMinor: 12_000 … });
it('clears the original pair when the currency is the account’s own', () => { … });
it('asks for the charged amount only when the currencies differ', () => { expect(chargedInNeeded(draft, accounts)).toBe(true); });
it('passes the channel, the exclusion, the event and the photos through', () => { … });
it('offers MCC only on a card, With only on a new expense, and the rate row only when one is missing', () => { expect(extraRows(draft, accounts, { missingRate: null })).toEqual(['event', 'split', 'with', 'channel', 'photos', 'exclude']); });
it('sends a split with several people to splitBill, not to postTransaction', () => { … });
it('keeps the same messages the old form threw', () => { expect(() => formToPost({ …, categoryId: '' }, accounts)).toThrow('Choose a category'); });
it('says the sheet cannot hold a split, a transfer or a foreign purchase', () => { expect(canEditInSheet(tx)).toBe(false); });
```

- [ ] **Step 2: Run and see it fail** — `cd apps/web && npx vitest run src/features/transactions/tx-form.test.ts` → FAIL.

- [ ] **Step 3: Implement `tx-form.ts`** — lifted from `draft.ts` and extended, keeping `draftToLines`'s validation word for word (`'Choose the From account'`, `'From and To must differ'`, `'An MCC is four digits, like 5814'`, …) and keeping `draft.ts`'s `isEditable` where it is. `formToPost` returns a discriminated result — `{ kind: 'post', input }`, `{ kind: 'split', input }`, `{ kind: 'transfer-goal', input }`, `{ kind: 'trade', input }` — so the screen only has to call the right repository function.

- [ ] **Step 4: The rows**

`FormRow.tsx` — `<button>` 48px tall: a 34px leading slot, a label, an optional value, an optional chevron; a `switch` variant for Exclude; disabled styling; `aria-label` from the label so a test can find it by name.

`AmountRow.tsx` — the flag circle (`currencyInfo(currency).flag`) opening `CurrencySheet`, the figure, the currency code, a ✕ while typing. Under it, when `chargedInNeeded`, the "Charged in *IDR*" row and one quiet line: `≈ {rate} per 1 {currency} · suggested from {date}, change it to what {account} charged`. The estimate comes from `useResolveRates` for the day; when no rate is known the row is empty and the hint says so, and the exchange-rate row appears under Add more details.

`CurrencySheet.tsx` — `Sheet` titled "Currency": a search field, **Recent** (the paying account's currency, the workspace's, then up to three from `localStorage` under `expanses.currency.recent`), then **All currencies** from `CURRENCIES`, each row a flag, a name and its code, a ✓ on the current one.

`Keypad.tsx` — the dock grid `C ÷ × ⌫ / 7 8 9 − / 4 5 6 + / 1 2 3 DONE / 0 000 00`, DONE spanning two rows. **No recent amounts, no Save.** DONE calls `evaluateAmount`; a result writes the row and closes the keypad, `null` leaves both alone. Rendered only when `usePhone()`.

- [ ] **Step 5: Run** — `cd apps/web && npx vitest run`; `npm run typecheck` → clean (nothing imports the kit yet).

- [ ] **Step 6: Commit** — `git commit -am "feat(web): the rows every transaction screen is built from, and what they add up to"` (with the trailer).

---

### Task 9: The edit sheet — F3

**Files:**
- Create: `apps/web/src/features/transactions/EditSheet.tsx`
- Modify: `apps/web/src/features/transactions/ReceiptPage.tsx`
- Test: `apps/web/e2e/phone-transaction-gestures.spec.ts` (created here, one test; grown in Task 10)

- [ ] **Step 1: Failing e2e** — in the `phone` project: record a purchase, open its receipt, press **Edit**, change the note and the category in the sheet, Save, and see the list say the new note; then re-open and check ⋯ holds **Open in full form**, **This was a purchase** and **Delete this transaction**.

- [ ] **Step 2: The sheet** — `EditSheet({ tx, onClose })` inside the existing `Sheet` (which already gives it the grab handle, Escape, the backdrop and the scroll lock):

- Header: ✕ · "Edit" · ⋯.
- The amount, large and centred, tapping it opens the keypad (phone) or focuses the field (desktop).
- Rows: **Note** · **Date** · **Paid with** · **Category** · **More** ("Event, With, Photos…"), which opens the Add more details card built in Task 14 — the same screens, not a second set.
- **Save** full width → `replaceTransaction` with `formToPost`, then `invalidate()`. The original stays under Show deleted, as today.
- ⋯ → **Open in full form** (`/transactions/$transactionId/edit`), **This was a purchase** (`ConvertForm`), **Delete this transaction** (asks twice, `voidTransaction`).
- `canEditInSheet(tx)` false → the sheet is not shown at all; the caller opens the full form instead.

- [ ] **Step 3: Wire the receipt** — the receipt's **Edit** opens this sheet on a phone and navigates to `/transactions/$transactionId/edit` on a desktop.

- [ ] **Step 4: Run** — gate → pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(web): one edit sheet on the phone, with the rarer actions behind ⋯"` (with the trailer).

---

### Task 10: The gestures — F1, F2, F4

**Files:**
- Create: `apps/web/src/features/transactions/TransactionRow.tsx`
- Move: `apps/web/src/features/bills/SwipeRow.tsx` → `apps/web/src/ui/SwipeRow.tsx`; `apps/web/src/features/bills/UndoToast.tsx` → `apps/web/src/ui/UndoToast.tsx`
- Modify: `apps/web/src/features/bills/BillRow.tsx`, `RecurringPage.tsx` (imports only), `apps/web/src/features/transactions/TransactionsPage.tsx`, `apps/web/src/features/events/EventDetailPage.tsx`, `apps/web/src/features/cards/StatementPanel.tsx`
- Test: `apps/web/e2e/phone-transaction-gestures.spec.ts`

- [ ] **Step 1: Failing e2e** — in the `phone` project, on the Cashflow list:

```ts
test('a row opens its receipt, swipes to Edit and Delete, and its icon fixes the category', async ({ page }) => {
  // …record two purchases with the helper…
  await page.getByRole('button', { name: /Warung Steak/ }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Back' }).click();

  const row = page.getByTestId('transaction-row').filter({ hasText: 'Warung Steak' });
  await swipeLeft(page, row);                       // a helper: pointer down, move −140, up
  await expect(row.getByRole('button', { name: 'Edit' })).toBeVisible();
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(row.getByRole('button', { name: 'Delete?' })).toBeVisible();
  await row.getByRole('button', { name: 'Delete?' }).click();
  await expect(page.getByText('Warung Steak')).toHaveCount(0);

  await page.getByRole('button', { name: /Category for Superindo/ }).click();
  await page.getByRole('button', { name: 'Restaurants' }).click();
  await expect(page.getByRole('status')).toContainText('Moved to Restaurants');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Groceries')).toBeVisible();
});
```

- [ ] **Step 2: `SwipeRow` gains a width** — move the file to `apps/web/src/ui/SwipeRow.tsx` unchanged but for one prop, `reveal = 76`, used in place of the `REVEAL` constant, and `OPEN_AT = reveal * 0.66`. `BillRow` imports it from its new home and passes nothing, so bills behave exactly as they do. `UndoToast` moves the same way.

- [ ] **Step 3: `TransactionRow`** — one row for every transaction list:

```tsx
export function TransactionRow({ row, accounts, currency, trailing, onEdit, onDelete, onRecategorise, phone }: { … }) 
```

- `data-testid="transaction-row"`, the category circle as its own `<button>` (`aria-label={`Category for ${description}`}`) when `onRecategorise` is given, then the label block and the amount, exactly as `recordedRow` draws them today — plus the **Excluded** pill and, when excluded, `opacity-60` with `line-through` on the amount.
- On a phone it sits inside `SwipeRow` with `reveal={148}` and a `leftAction` of two buttons, Edit (slate) and Delete (red, arming to "Delete?"); the row's own tap navigates to `/transactions/$transactionId`.
- On a desktop the row keeps today's behaviour: click opens the in-place editor, and the trailing slot holds the pencil and the ⓘ from Task 7.
- The category button opens a `Sheet` titled `Category for <description>` holding the same picker as the form (Task 16 replaces its body with `CategoryPicker`); picking calls `replaceTransaction` at once and shows `UndoToast` "Moved to <category> · Undo", Undo replacing it back.

- [ ] **Step 4: Adopt it** — `TransactionsPage`'s `recordedRow` renders `TransactionRow` (drafts keep their own row and their own in-place editor, untouched); `EventDetailPage`'s history and `StatementPanel`'s purchases render it too, each passing its own `trailing` (the statement keeps its posted date and points; the event keeps its untag button). Every list therefore has the same three gestures, which is what the decisions ask for.

- [ ] **Step 5: Run** — gate → pass, `phone-recurring-bills.spec.ts` included (the swipe move must not have changed bills).

- [ ] **Step 6: Commit** — `git commit -am "feat(web): tap a row for its receipt, swipe for Edit or Delete, tap the icon to fix a category"` (with the trailer; `git add -A` the moved files).

---

## Step 4 — The new Add form, tab by tab

### Task 11: Expense and Income — the card replaces the old form

**Files:**
- Create: `apps/web/src/features/transactions/TransactionCard.tsx`, `apps/web/src/features/transactions/FormPage.tsx`, `apps/web/e2e/add-transaction.ts`
- Modify: `apps/web/src/app/Layout.tsx`, `apps/web/src/app/router.tsx`, `apps/web/src/features/transactions/TransactionsPage.tsx`, `TransactionsTable.tsx`, and the 16 specs listed below
- Delete: `apps/web/src/features/transactions/TransactionForm.tsx`
- Test: `apps/web/e2e/add-transaction.spec.ts`

- [ ] **Step 1: The helper first** — `apps/web/e2e/add-transaction.ts`:

```ts
import { expect, type Page } from '@playwright/test';

/** Records an expense or income through the Option B card, from wherever the + is. */
export async function addTransaction(page: Page, tx: { mode?: 'Expense' | 'Income'; description: string; paidWith: string; category: string; amount: string; date?: string }) {
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  if (tx.mode && tx.mode !== 'Expense') await form.getByRole('radio', { name: tx.mode }).click();
  await form.getByRole('button', { name: /^Amount/ }).click();
  await form.getByLabel('Amount', { exact: true }).fill(tx.amount);
  await form.getByRole('button', { name: /^(Paid with|Received into)/ }).click();
  await page.getByRole('dialog', { name: /^(Paid with|Received into)$/ }).getByRole('button', { name: tx.paidWith }).click();
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: tx.category, exact: true }).click();
  await form.getByLabel('Note').fill(tx.description);
  if (tx.date) await form.getByLabel('Date').fill(tx.date);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
}
```

and `addTransfer`, `addPurchase` beside it, one per tab, added in Tasks 12 and 13.

Rewrite every call site to use it: `account-types`, `budget`, `business-income`, `card-statements`, `catalogue`, `category-sets`, `critical-path`, `events`, `lend-borrow`, `mcc`, `points`, `points-ledger`, `supplementary-card`, `transactions-list`, `workspaces`, `buy-flow`, and the phone specs `phone.spec.ts`, `phone-budget-page.spec.ts`, `phone-workspaces.spec.ts`. The helper is the only place that knows what the form looks like, so the next tab never touches a spec again.

- [ ] **Step 2: Failing e2e** — `apps/web/e2e/add-transaction.spec.ts`: an expense through the card; the workspace row defaulting to the open workspace; Paid with offering "BCA KrisFlyer ···· 1467" when the account carries two cards and setting both account and card; the category picker; Save; the row in the list. Then income into a bank account.

- [ ] **Step 3: `TransactionCard`** — `TransactionCard({ initial, mode, onDone, full })`:

- The tabs as a `role="radiogroup"` — Expense · Income · Transfer · Buy / sell, the last only when `buyChoices(...).buys.length > 0`.
- Expense and Income rows in B2's order: **Workspace** (a `FormRow` opening `WorkspaceSheet`'s list; changing it clears the category), **Paid with** / **Received into** (a `Sheet` over `paymentOptions(money, cards)`, each card its own row with its digits), **Amount** (`AmountRow`), **Category**, **Note**, **Date** (‹ › stepping a day, the middle a date input).
- Under the card, **Add more details** (Task 14 fills it; here it is a row that opens an empty card, so the layout is right from the start).
- The dock: **Save**, or the keypad while the amount is being typed on a phone.
- Errors from `formToPost` above Save, word for word as today.
- `full` renders the same card on a page rather than in a sheet, for the routes.

- [ ] **Step 4: The routes and the callers** — `/transactions/new` → `FormPage`; `/transactions/$transactionId/edit` → `FormPage` with the transaction loaded. `Layout.tsx`'s add sheet, `TransactionsPage`'s `adding` and `editingId`, and `TransactionsTable`'s `renderForm` all render `TransactionCard`. Delete `TransactionForm.tsx`.

- [ ] **Step 5: Field-map check** — walk §2 of the spec and confirm each of Workspace, Paid with, Card, Amount, Category, Note, Date has a home in this task, and that Event, Split, With, MCC, Channel, Photos, Exclude, the exchange rate, To, For goal, Received amount and every Buy/sell field is either present or booked into Tasks 12–15. Write the result in the commit body.

- [ ] **Step 6: Run** — gate → pass, all 19 rewritten specs included.

- [ ] **Step 7: Commit** — `git commit -am "feat(web): the new Add Transaction card — expense and income"` (with the trailer).

---

### Task 12: Transfer

**Files:**
- Modify: `apps/web/src/features/transactions/TransactionCard.tsx`, `tx-form.ts`, `apps/web/e2e/add-transaction.ts`
- Test: `apps/web/e2e/add-transaction.spec.ts`

- [ ] **Step 1: Failing e2e** — a transfer between two IDR accounts; then one into a USD account, where **Received amount (USD)** appears and is required; then one tagged **For goal**, which still reaches `recordTaggedTransfer` (assert the goal's progress moves).

- [ ] **Step 2: Implement** — rows **From · Amount · To · Note · Date**, **no workspace row**; a second card with **For goal** (only when adding and there are goals) and **Received amount** (only when the currencies differ). `transferTargets(accounts, assetValues)` still filters unit-priced holdings, and the hint "Buying a fund, shares or gold? Use Buy or sell, so units are counted." moves onto the **To** row as its subline.

- [ ] **Step 3: Run** — gate → pass.

- [ ] **Step 4: Commit** — `git commit -am "feat(web): the Transfer tab, with its goal and its received amount"` (with the trailer).

---

### Task 13: Buy or sell

**Files:**
- Modify: `apps/web/src/features/transactions/TransactionCard.tsx`, `apps/web/e2e/add-transaction.ts`
- Test: `apps/web/e2e/buy-flow.spec.ts` (rewritten through the helper), `apps/web/e2e/add-transaction.spec.ts`

- [ ] **Step 1: Failing e2e** — `addPurchase(page, { what: 'Antam gold', amount: '3980000', units: '2', fee: '15000', paidWith: 'BCA KrisFlyer', goal: 'Hajj fund', pointsCategory: 'Jewellery', mcc: '5944' })` and the holding's units and the goal both move; a sale into a bank account; a purchase on a card earning points.

- [ ] **Step 2: Implement** — rows **what you bought or sold · Amount (cost or proceeds, before fees) · Units** or **Lots · Fee · Paid with** / **Proceeds into · Date**, then a second card with **For goal** / **Sell from goal** and, on a credit card, **Category for points** and **MCC**. `purchaseDraftToInput` and `recordTrade` are called unchanged, and every message they throw is shown above Save. The tab is hidden when there are no holdings, as today.

- [ ] **Step 3: Run** — gate → pass.

- [ ] **Step 4: Commit** — `git commit -am "feat(web): the Buy or sell tab, units and fee and all"` (with the trailer).

---

### Task 14: Add more details — Event, Split, MCC, Channel, Exclude, the rate

**Files:**
- Create: `apps/web/src/features/transactions/MoreDetails.tsx`, `EventSheet.tsx`, `SplitSheet.tsx`, `ChannelSheet.tsx`, `McSheet.tsx`
- Modify: `apps/web/src/features/transactions/TransactionCard.tsx`, `EditSheet.tsx`
- Test: `apps/web/e2e/add-transaction.spec.ts`, `apps/web/e2e/mcc.spec.ts`

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

- [ ] **Step 3: Same screens in the sheet** — `EditSheet`'s **More** row opens `MoreDetails` with the same props. One implementation, two ways in.

- [ ] **Step 4: Run** — gate → pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(web): Add more details — the event, the split, the MCC, the channel, and leaving it out of the report"` (with the trailer).

---

### Task 15: With, and Photos

**Files:**
- Create: `apps/web/src/features/transactions/WithSheet.tsx`, `PhotosSheet.tsx`
- Modify: `apps/web/src/features/transactions/MoreDetails.tsx`, `ReceiptPage.tsx`
- Test: `apps/web/e2e/add-transaction.spec.ts`, `apps/web/e2e/phone-add-transaction.spec.ts`

- [ ] **Step 1: Failing e2e** — dinner for four on a card: three people added, **Split equally**, the summary reading Bill 400.000 · They owe you 300.000 · Your share 100.000; after saving, Lend & borrow shows three people owing 100.000 each, the card's statement shows 400.000, and Restaurants shows 100.000. Then the same with **Custom amounts**, where one person's share is typed and your share is what is left. Then a photo chosen from a file, shown on the receipt.

- [ ] **Step 2: `WithSheet`** — D4:

- "Add a person" search over `recentPeople` as chips; a name not on the books is a new person, opened on saving exactly as today.
- **Split equally** / **Custom amounts**, using `equalShares` and `yourShare` from Task 1; the rows read "You · Your spending · <category>" then each person "Owes you", each with ✕.
- The summary card: **Bill**, **They owe you**, **Your share**.
- Saving goes through `formToPost`'s `{ kind: 'split' }` to `splitBill`, with the channel, the event and the exclusion carried along. Offered when adding an expense, not when editing one — an edit opens the full form, as today.

- [ ] **Step 3: `PhotosSheet`** — D2: the thumbnail grid with ✕ on each and a + tile, **📷 Take photo** (`capture="environment"`) and **🖼 Choose from library**, the line *Photos stay on this device with the transaction and go into your backups. Tap one to see it full size.*, a full-size viewer on tap, and drag-and-drop on a desktop. Each pick writes the bytes through `savePhotoBytes` at once and holds the id in `draft.photoIds`; closing the sheet after a form is abandoned leaves `sweepOrphanPhotos` to tidy up. The receipt's strip reads the same files.

- [ ] **Step 4: Run** — gate → pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(web): several people can owe part of a bill, and a receipt can carry its photos"` (with the trailer).

---

### Task 16: The category picker and New category — B7, B7a

**Files:**
- Create: `apps/web/src/features/transactions/CategoryPicker.tsx`, `NewCategorySheet.tsx`
- Modify: `apps/web/src/features/transactions/TransactionCard.tsx`, `TransactionRow.tsx`, `EditSheet.tsx`, `apps/web/src/features/categories/CategoryIcon.tsx`
- Test: `apps/web/e2e/add-transaction.spec.ts`, `apps/web/e2e/category-sets.spec.ts`

- [ ] **Step 1: Failing e2e** — the picker shows parents as cards with their children indented; tapping a parent picks the parent; search narrows; **+ New category** makes "Boba" inside Food and beverage with an icon, files it into the open workspace, and returns to the form with it chosen; the new category then appears on the Categories page and in the picker of a second workspace **not at all**.

- [ ] **Step 2: `CategoryPicker`** — B7, inside `Sheet` (a phone gets the full height, a desktop the dialog):

- Header ‹ · "Select category" · ≡ (a link to `/categories`).
- **Expense** / **Income** segmented control, starting on the form's tab.
- **+ New category** first, in green.
- One card per top-level category: the parent row, then its children indented with the elbow line (a `::before` border, as the mockup draws it). Tapping a parent picks the parent.
- A floating search pill at the foot, filtering on `categoryPath`.
- Only the chosen workspace's categories, set categories excluded — the same filter `CategoryOptions` uses (`membership[a.id] === undefined && inOpenBook(a)`), with the workspace taken from the form's first row rather than the open one.

- [ ] **Step 3: `NewCategorySheet`** — B7a: **Name**, **Inside** (Top level, or a parent from the same kind), **Kind** (fixed by the tab), **Icon** (a grid of `ICONS`). Save calls `createAccount(database, ws, { name, kind, subtype: 'category', currency: null, parentId, icon })` — which already files it into the open book — then picks it and closes both sheets.

- [ ] **Step 4: The icon is drawn** — `CategoryIcon` takes the account's own `icon` when it has one: `const own = accounts.find((a) => a.id === categoryId)?.icon;` and `const visual = own ? { ...base, icon: own } : base;`. A category with no icon keeps inheriting its parent's, exactly as today (`category-visuals.test.ts` stays green).

- [ ] **Step 5: Use it everywhere** — the form's Category row, the edit sheet's, and the category-icon gesture from Task 10 all open this one picker.

- [ ] **Step 6: Run** — gate → pass.

- [ ] **Step 7: Commit** — `git commit -am "feat(web): the category picker as a tree, with a new category without leaving the form"` (with the trailer).

---

## Step 5 — End to end

### Task 17: Desktop, end to end

**Files:**
- Modify: `apps/web/e2e/add-transaction.spec.ts`, `apps/web/e2e/transaction-receipt.spec.ts`
- Test: both

- [ ] **Step 1: Write the specs** (`chromium`):

- **Nothing was lost**: one purchase recorded with every field the old form had — date, note, paid with, which card, category, amount, a split of two, MCC with Remember for this merchant, a foreign currency with its charged amount — read back off the receipt and the row.
- **Edit in place still works**: click a row, change the amount, Enter, and the original is under Show deleted.
- **ⓘ** opens the receipt; **Delete** there asks twice; **This was a purchase** converts a purchase and the units appear under Net worth.
- **Excluded**: a purchase marked excluded leaves the chart's total and the budget's spending, stays on the card's statement and in the points, and shows the **Excluded** pill in the list.
- **The keyboard alone** can record a purchase: tab to +, tabs through the rows, `85000+15000` in the amount field, Enter saves 100.000.

- [ ] **Step 2: Run** — `cd apps/web && npx playwright test --project=chromium --workers=2` → pass.

- [ ] **Step 3: Commit** — `git commit -am "test(e2e): the new form keeps every field, and the desktop keeps every way in"` (with the trailer).

---

### Task 18: The phone, end to end

**Files:**
- Modify: `apps/web/e2e/phone-add-transaction.spec.ts`, `apps/web/e2e/phone-transaction-gestures.spec.ts`
- Test: both

- [ ] **Step 1: Write the specs** (`phone`):

- **The keypad**: tap the amount, type `120000+35000`, **DONE** closes the keypad and the row reads 155.000; there is no Save key on the keypad and no recent amounts (`expect(keypad.getByRole('button', { name: 'Save' })).toHaveCount(0)`).
- **The flag**: tap it, choose CNY, the **Charged in IDR** row appears pre-filled, type what the bank took, save, and the receipt reads "¥120 charged as Rp272.400"; choosing IDR again removes the row.
- **The gestures**: tap → receipt; swipe → Edit → the sheet → Save; swipe → Delete twice; tap the icon → the picker → "Moved to … · Undo".
- **Add more details**: Channel Offline, one photo from a file, Exclude on — all three read back on the receipt.
- **Every thumb target is 44px or more** on the form and the sheet (`boundingBox()` over the rows, as `phone-inputs.spec.ts` does).

- [ ] **Step 2: Run** — `cd apps/web && npx playwright test --project=phone --workers=2` → pass, then the whole gate.

- [ ] **Step 3: Final field-map pass** — read §2 of the spec once more against the shipped screens; every line must name a screen that exists. Note any that do not in the commit body and fix them before committing.

- [ ] **Step 4: Commit** — `git commit -am "test(e2e): the phone records, corrects and reads a transaction by thumb"` (with the trailer).
