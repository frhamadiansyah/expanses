# Workspaces, steps 3–4 (switching, and across workspaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a second workspace real: fix the four money-correctness preconditions the steps 1–2 review found, put a workspace switcher in Cashflow's ⋯ and in the desktop sidebar, add New workspace and Settings → Workspaces (rename, archive, base currency), let each workspace read its Cashflow, budgets and bills in its own base currency, and then hold across workspaces — event tabs, `count_events_in_budget`, and workspace badges on a card.

**Architecture:** Nothing new hangs off `accounts` or `transactions`. Books stay attached through the membership tables of migration 0042, and `WorkspaceContext.bookId` stays the only narrowing: book-scoped repositories read it, owner-level ones drop it with `ownerScope(ws)`. Three things are added. First, `system_key` lookups split in two — `categoryIdsByKeyTx` (the book the context names) and `categoryIdsByKeyAllTx` (every copy, for owner-level figures and card rules). Second, the open book becomes React state in `App.tsx` with a `switchBook` that removes every cached query, so no other workspace's figures can flash. Third, a workspace's own base currency is a **display** conversion, built from one `fx_rates` snapshot per read and applied in JS only when the book's currency differs from the owner's — the existing SQL path is untouched otherwise, so a one-currency owner's figures stay bit-identical.

**Tech Stack:** TypeScript monorepo — `packages/core` (pure), `packages/catalog` (pure card catalogue), `packages/db` (Drizzle over sqlite-proxy, SQL migrations as `?raw` imports; latest is 0045), `apps/web` (React 19, TanStack Router/Query, Tailwind 4); Vitest; Playwright (`chromium` and `phone` projects).

**Spec:** `docs/superpowers/specs/2026-09-18-workspaces-switching-design.md` (approved 2026-09-18), on top of `docs/superpowers/specs/2026-09-17-workspaces-design.md` sections 4–7.

## Global Constraints

- Branch `feat/workspace-switching`. Commit per task; merge and push only when the user asks. Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **No new columns on existing tables.** The ORM names every column it knows on every insert, so a column on `accounts`, `transactions`, `entries`, `budgets` or `expense_templates` breaks any database still stopped at an older version (migration 0028's comment). New facts go in side tables; migration 0046 adds an index only.
- **Older databases:** every read or write of a book table goes through `hasBooks(tx)` exactly as steps 1–2 do, and behaves as it did before books existed when the tables are absent. Migration tests that stop at an older version must keep passing.
- **Owner-level reads use `ownerScope(ws)`** — cards, statements, points, instalments, net worth, holdings, loans, debts, goals, events, tax, balances. Book-scoped reads pass `ws` unchanged.
- **Desktop is never weaker than the phone.** Every control added to the ⋯ menu has a mouse and keyboard path; the sidebar switcher is reachable from every screen, which the phone's is not.
- In the product the word is **workspace**; `book` is the name in code only. Error messages, labels and test names say "workspace".
- Country-neutral: no category list hard-coded per kind, no Indonesia-specific presets. Only the tax report is local, and it is not touched.
- Inside `database.transaction((tx) => …)` use `tx` only — `database.db` there deadlocks on the mutex.
- A workspace whose base currency equals the owner's must take the existing code path, unchanged, so `books-sample.test.ts` stays green figure-for-figure. Run it in every task that touches a repository.
- Test snippets name real functions read on 2026-09-18. Where an input object is shown for an existing function (`createAccount`, `postTransaction`, `saveBudget`, `saveExpenseTemplate`, `createBook`), it matches the signature as read; if the compiler disagrees, re-read the type and match it rather than changing the function.
- Gate before every commit: `npm run typecheck` (root), `npm test` (root), and `npx playwright test --workers=2` (in `apps/web`).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/db/migrations/0046_book_indexes.sql` | index on `book_category_sets(book_id)` |
| `packages/db/src/migrations.ts` | register 0046 |
| `packages/db/src/repos/books.ts` | Personal by kind; codes on `BookError`; validation; `setBookEventsInBudget`; `setBookBaseCurrency`; `bookNamesOf`; `booksInEvent`; `spentThisMonthByBook`; copy `category_mccs` |
| `packages/db/src/repos/categories.ts` | `categoryIdsByKeyTx` book-aware, `categoryIdsByKeyAllTx` new |
| `packages/db/src/repos/catalog.ts`, `packages/catalog/src/plan.ts` | a catalogue key maps to every copy of its category |
| `packages/db/src/repos/flows.ts`, `point-ledger.ts` | owner-level key lookups use every copy; `periodFlows` converts and narrows |
| `packages/db/src/repos/debts.ts`, `loans.ts`, `trades.ts` | key lookups use the book being recorded into |
| `packages/db/src/repos/entry.ts` | `guessCategoryFromHistory` stays in the open book |
| `packages/db/src/repos/ledger.ts` | neutral `TWO_BOOKS` wording; conversion of `listTransactions` amounts |
| `packages/db/src/repos/budgets.ts`, `expense-templates.ts` | refuse a category from another workspace; `committedByCategory` converts |
| `packages/db/src/repos/book-currency.ts` | the `fx_rates` snapshot and the `BookMoney` converter |
| `packages/db/src/repos/reports.ts`, `budget-sheet.ts`, `events.ts` | converting and event-flag-aware reads |
| `packages/core/src/money/rates.ts` | `pickRate`, pure |
| `packages/core/src/budget/sheet.ts` | `eventsInCaps` |
| `packages/db/test/books-*.test.ts`, `book-currency.test.ts`, `book-events.test.ts` | the tests below |
| `apps/web/src/app/App.tsx`, `context.ts`, `Layout.tsx`, `nav.ts`, `router.tsx` | `switchBook`, the sidebar switcher, `/settings` |
| `apps/web/src/features/workspaces/WorkspaceSheet.tsx` | the workspace list |
| `apps/web/src/features/workspaces/NewWorkspaceSheet.tsx` | New workspace |
| `apps/web/src/features/workspaces/SettingsPage.tsx` | Settings → Workspaces |
| `apps/web/src/features/workspaces/queries.ts` | `useBooks`, `useOpenBook`, `useWorkspaceBadges`, `useSpentThisMonth` |
| `apps/web/src/features/workspaces/WorkspaceBadge.tsx` | the badge, drawn only when there is more than one workspace |
| `apps/web/src/features/transactions/TransactionsPage.tsx` | ⋯ workspace row; owner-scoped account view with badges |
| `apps/web/src/features/cards/StatementPanel.tsx`, `PurchaseList.tsx` | badges |
| `apps/web/src/features/events/EventDetailPage.tsx` | workspace tabs |
| `apps/web/src/features/import/ImportPage.tsx` | fallback categories from the open workspace |
| `apps/web/e2e/workspaces.spec.ts`, `phone-workspaces.spec.ts` | chromium and phone flows |

---

## Step 3.0 — The preconditions (money correctness)

### Task 1: Personal by kind, and a book repository that refuses what it should

**Files:**
- Create: `packages/db/migrations/0046_book_indexes.sql`
- Modify: `packages/db/src/migrations.ts`, `packages/db/src/repos/books.ts`
- Test: `packages/db/test/books.test.ts`, `packages/db/test/database.test.ts`

**Interfaces:**
- Produces: `BookError` with `readonly code: string`; codes `NAME_REQUIRED`, `NOT_FOUND`, `LAST_BOOK`, `PERSONAL_BOOK`, `ONE_PERSONAL`, `BAD_CURRENCY`, `BAD_KIND`, `NO_SOURCE`; `personalBook`/`personalBookIdTx` by kind; `setBookEventsInBudget(database, ws, bookId, on: boolean): Promise<void>`.
- Consumes: `isSupportedCurrency` from `@expanses/core`.

- [ ] **Step 1: Write the failing tests** (append to `packages/db/test/books.test.ts`)

```ts
describe('the Personal workspace is found by what it is', () => {
  it('stays Personal when a workspace made before it is archived, and cannot itself be archived', async () => {
    const { database, ws } = await setupDb();
    const personal = await personalBook(database, ws);
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });

    // Personal is the book of kind 'personal', not merely the first row.
    await database.db.run(sql`UPDATE books SET sort_order = 5 WHERE id = ${personal.id}`);
    expect((await personalBook(database, ws)).id).toBe(personal.id);

    await expect(archiveBook(database, ws, personal.id)).rejects.toMatchObject({ code: 'PERSONAL_BOOK' });
    await archiveBook(database, ws, business);
    expect((await listBooks(database, ws)).map((b) => b.name)).toEqual(['Personal']);
  });

  it('refuses a second Personal, an unknown id, an unsupported currency and an unknown kind', async () => {
    const { database, ws } = await setupDb();
    await expect(createBook(database, ws, { name: 'Also me', kind: 'personal', baseCurrency: 'IDR' })).rejects.toMatchObject({ code: 'ONE_PERSONAL' });
    await expect(createBook(database, ws, { name: 'Biz', kind: 'business', baseCurrency: 'ZZZ' })).rejects.toMatchObject({ code: 'BAD_CURRENCY' });
    await expect(createBook(database, ws, { name: 'Biz', kind: 'club' as never, baseCurrency: 'IDR' })).rejects.toMatchObject({ code: 'BAD_KIND' });
    await expect(renameBook(database, ws, 'no-such-book', 'Nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(archiveBook(database, ws, 'no-such-book')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(setActiveBook(database, ws, 'no-such-book')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('remembers whether a workspace counts event spending in its budget', async () => {
    const { database, ws } = await setupDb();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', countEventsInBudget: true });
    expect((await listBooks(database, ws)).find((b) => b.id === business)).toMatchObject({ countEventsInBudget: true });
    await setBookEventsInBudget(database, ws, business, false);
    expect((await listBooks(database, ws)).find((b) => b.id === business)).toMatchObject({ countEventsInBudget: false });
  });
});
```

Add `setBookEventsInBudget` to the file's imports, and in `packages/db/test/database.test.ts` extend the applied-versions list to end `…, 44, 45, 46]`.

- [ ] **Step 2: Run and see them fail**

Run: `cd packages/db && npx vitest run test/books.test.ts test/database.test.ts`
Expected: FAIL — `archiveBook` allows Personal, errors carry no `code`, version 46 is missing.

- [ ] **Step 3: Implement**

`packages/db/migrations/0046_book_indexes.sql`:

```sql
/* book_category_sets is read by set id and written by book; the book side had no index, so listing a
   workspace's category sets scanned the table. Index only — no column, no figure. */
CREATE INDEX IF NOT EXISTS book_category_sets_book ON book_category_sets (book_id);
```

In `packages/db/src/migrations.ts` add `import bookIndexes from '../migrations/0046_book_indexes.sql?raw';` after the 0045 import, and `{ version: 46, name: 'book_indexes', sql: bookIndexes },` after the version 45 entry.

In `packages/db/src/repos/books.ts`:

```ts
export class BookError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BookError';
  }
}

const KINDS: readonly BookKind[] = ['personal', 'business', 'family', 'shared'];

/**
 * The workspace things fall back to: expected income, recreated default categories, default category sets, and a
 * category filed with no context. It is the book of kind 'personal' — never merely the first row, because archiving
 * or reordering would otherwise hand all of that to Business.
 */
export async function personalBook(database: Database, ws: WorkspaceContext): Promise<BookRow> {
  const open = await listBooks(database, ws);
  const found = open.find((book) => book.kind === 'personal') ?? open[0];
  if (!found) throw new BookError('NO_BOOK', 'This workspace has no workspaces in it');
  return found;
}

export async function personalBookIdTx(tx: Db, workspaceId: string): Promise<string | null> {
  const rows = await tx
    .select({ id: books.id, kind: books.kind })
    .from(books)
    .where(and(eq(books.workspaceId, workspaceId), isNull(books.archivedAt)))
    .orderBy(asc(books.sortOrder), asc(books.createdAt));
  return (rows.find((row) => row.kind === 'personal') ?? rows[0])?.id ?? null;
}

/** The book a write belongs to: the one the context names, else Personal. */
export async function writeBookIdTx(tx: Db, ws: WorkspaceContext): Promise<string | null> {
  return ws.bookId ?? (await personalBookIdTx(tx, ws.workspaceId));
}

async function bookOf(database: Database, ws: WorkspaceContext, bookId: string): Promise<BookRow> {
  const [row] = await database.db.select().from(books).where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, bookId)));
  if (!row) throw new BookError('NOT_FOUND', 'That workspace is not here');
  return toRow(row);
}
```

- `createBook`: before anything, `if (!KINDS.includes(input.kind)) throw new BookError('BAD_KIND', …)`, `if (!isSupportedCurrency(input.baseCurrency)) throw new BookError('BAD_CURRENCY', \`${input.baseCurrency} is not a currency this app knows\`)`, and inside the transaction, when `input.kind === 'personal'`, refuse if a personal book already exists (`ONE_PERSONAL`, "There is already a Personal workspace"). Change the existing `NAME_REQUIRED` and copy-source throws to carry codes (`NAME_REQUIRED`, `NO_SOURCE`).
- `renameBook`: `await bookOf(database, ws, bookId)` first.
- `archiveBook`: `const book = await bookOf(database, ws, bookId);` then `if (book.kind === 'personal') throw new BookError('PERSONAL_BOOK', 'Personal is where categories and expected income fall back to, so it stays')`, then the existing last-book check with code `LAST_BOOK`.
- `setActiveBook`: `await bookOf(...)` and refuse an archived one (`NOT_FOUND`).
- New:

```ts
/** Whether this workspace's monthly caps count spending tagged to an event. */
export async function setBookEventsInBudget(database: Database, ws: WorkspaceContext, bookId: string, on: boolean): Promise<void> {
  await bookOf(database, ws, bookId);
  await database.db.update(books).set({ countEventsInBudget: on ? 1 : 0 }).where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, bookId)));
}
```

- [ ] **Step 4: Run and see them pass**

Run: `cd packages/db && npx vitest run test/books.test.ts test/database.test.ts test/books-sample.test.ts`
Expected: PASS.

- [ ] **Step 5: Whole gate**

Run: `npm run typecheck && npm test`
Expected: all pass. A migration test that stops before 42 is unaffected (0046 only indexes a 0042 table).

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0046_book_indexes.sql packages/db/src packages/db/test
git commit -m "$(cat <<'EOF'
fix(db): Personal is the workspace it says it is, and cannot be archived

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2: Which copy a system key means

**Files:**
- Modify: `packages/db/src/repos/categories.ts`, `packages/catalog/src/plan.ts`, `packages/db/src/repos/catalog.ts`, `flows.ts`, `point-ledger.ts`, `debts.ts`, `loans.ts`, `trades.ts`
- Modify: `apps/web/src/features/cards/CatalogPicker.tsx`, `apps/web/src/features/import/ImportPage.tsx`
- Test: `packages/catalog/test/plan-copies.test.ts` (new), `packages/db/test/books-keys.test.ts` (new)

**Interfaces:**
- Produces: `categoryIdsByKeyTx(db, ws): Promise<Record<string, string>>` (the context's book, else Personal, deterministic), `categoryIdsByKeyAllTx(db, ws): Promise<Record<string, string[]>>`, `categoryIdsByKeyAll(database, ws)`.
- Changes: `planCatalogApply(entry, categoryIdsByKey: Record<string, readonly string[]>, …)`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/catalog/test/plan-copies.test.ts
import { describe, expect, it } from 'vitest';
import { findEntry, planCatalogApply } from '../src/index';

describe('a catalogue category key with a copy in every workspace', () => {
  it('puts every copy in the rule it plans, so the rule earns in each', () => {
    const entry = findEntry('jenius-platinum')!;
    const plan = planCatalogApply(entry, { 'food_beverage.restaurants': ['c-dining-personal', 'c-dining-business'] }, '2026-09-18', 'grow-plus', [
      { optionKey: 'dining', from: null, to: null },
    ]);
    const rule = plan.rules.find((row) => row.match.categoryIds?.includes('c-dining-personal'));
    expect(rule?.match.categoryIds).toEqual(['c-dining-personal', 'c-dining-business']);
    // A key with no category anywhere is still reported as unmapped, exactly as before.
    expect(planCatalogApply(entry, {}, '2026-09-18', 'grow-plus', [{ optionKey: 'dining', from: null, to: null }]).unmapped).toContain('food_beverage.restaurants');
  });
});
```

(Read `findEntry('jenius-platinum')`'s rules before running: if its dining rule is named differently, keep the shape of the test and match the real rule. `packages/catalog/test/member-levels.test.ts` line 243 shows the same entry being planned with category ids.)

```ts
// packages/db/test/books-keys.test.ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { categoryIdsByKey, categoryIdsByKeyAll, createAccount, createBook, inBook, personalBook } from '../src/index';
import { setupDb } from './helpers';

const copy = async () => {
  const { database, ws } = await setupDb();
  const personal = await personalBook(database, ws);
  const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
  return { database, ws, personal: personal.id, business };
};

describe('a system key once every workspace has a copy of it', () => {
  it('answers with the open workspace’s copy, and with every copy when asked for all', async () => {
    const { database, ws, personal, business } = await copy();
    const key = 'food_beverage.restaurants';
    const mine = (await categoryIdsByKey(database, inBook(ws, personal)))[key]!;
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))[key]!;
    expect(mine).not.toBe(theirs);
    // No book named: Personal, as every default has always been.
    expect((await categoryIdsByKey(database, ws))[key]).toBe(mine);
    expect([...(await categoryIdsByKeyAll(database, ws))[key]!].sort()).toEqual([mine, theirs].sort());

    // Each id really is filed in the book that claimed it.
    expect(await database.db.values(sql`SELECT book_id FROM book_categories WHERE category_account_id = ${theirs}`)).toEqual([[business]]);
  });

  it('keeps a new category out of it until it is given a key', async () => {
    const { database, ws, business } = await copy();
    const fresh = await createAccount(database, inBook(ws, business), { name: 'Client gifts', kind: 'expense', subtype: 'category', currency: null });
    const all = await categoryIdsByKeyAll(database, ws);
    expect(Object.values(all).flat()).not.toContain(fresh.id);
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `cd packages/catalog && npx vitest run test/plan-copies.test.ts` then `cd packages/db && npx vitest run test/books-keys.test.ts`
Expected: FAIL — `planCatalogApply` takes one id per key; `categoryIdsByKeyAll` is not exported; `categoryIdsByKey` ignores the book.

- [ ] **Step 3: Implement**

`packages/db/src/repos/categories.ts`:

```ts
/**
 * Categories that carry a default key, one per key, in the book the context names — else the Personal book.
 *
 * Once a workspace copies another's categories, two rows in one workspace share a key (migration 0043 narrowed the
 * unique index to allow it), so "the" category for a key only means anything inside one book. Owner-level figures
 * and card earning rules must not use this: they want every copy — `categoryIdsByKeyAllTx`.
 */
export async function categoryIdsByKeyTx(db: Db, ws: WorkspaceContext): Promise<Record<string, string>> {
  const all = await categoryIdsByKeyAllTx(db, ws);
  if (!(await hasBooks(db))) return Object.fromEntries(Object.entries(all).map(([key, ids]) => [key, ids[0]!]));
  const bookId = ws.bookId ?? (await personalBookIdTx(db, ws.workspaceId));
  const inBookId = new Map(
    (await db.select({ id: bookCategories.categoryAccountId }).from(bookCategories).where(eq(bookCategories.bookId, bookId ?? ''))).map((row) => [row.id, true]),
  );
  // The book's own copy when it has one; otherwise the oldest copy anywhere, so a workspace with no categories of
  // its own still records rather than failing.
  return Object.fromEntries(Object.entries(all).map(([key, ids]) => [key, ids.find((id) => inBookId.has(id)) ?? ids[0]!]));
}

/** Every id that carries each key, oldest first, across every book. */
export async function categoryIdsByKeyAllTx(db: Db, ws: WorkspaceContext): Promise<Record<string, string[]>> {
  const rows = await db
    .select({ id: accounts.id, key: accounts.systemKey })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.subtype, 'category'), isNotNull(accounts.systemKey), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.createdAt), asc(accounts.id));
  const byKey: Record<string, string[]> = {};
  for (const row of rows) (byKey[row.key as string] ??= []).push(row.id);
  return byKey;
}

export const categoryIdsByKey = (database: Database, ws: WorkspaceContext) => categoryIdsByKeyTx(database.db, ws);
export const categoryIdsByKeyAll = (database: Database, ws: WorkspaceContext) => categoryIdsByKeyAllTx(database.db, ws);
```

`packages/catalog/src/plan.ts` — the parameter becomes `categoryIdsByKey: Record<string, readonly string[]>`, and `ids` flattens:

```ts
  const ids = (keys: readonly string[] | undefined) =>
    (keys ?? []).flatMap((key) => {
      // One key, one category per workspace: a rule keyed to restaurants must earn on a business dinner too.
      const found = categoryIdsByKey[key];
      if (!found || found.length === 0) unmapped.add(key);
      return found ? [...found] : [];
    });
```

Existing catalogue tests pass `{}` or `{ 'x': 'id' }`; update the literal maps in `packages/catalog/test/member-levels.test.ts` and `mcc.test.ts` to arrays (`{ 'food_beverage.restaurants': ['c-dining'] }`). Nothing else in those tests changes.

Callers:

- `packages/db/src/repos/catalog.ts` line ~83: `planCatalogApply(entry, await categoryIdsByKeyAllTx(tx, ws), …)`.
- `packages/db/src/repos/point-ledger.ts` `cardYearRoi`: `const keys = await categoryIdsByKeyAll(database, ws);` and the fee query matches `e.account_id IN (…)` over `keys['miscellaneous.membership_fee'] ?? []` (use `inArray(entries.accountId, ids)` or `sql` with a list; skip the query when the list is empty, as today).
- `packages/db/src/repos/flows.ts` `periodFlows`: `const keys = await categoryIdsByKeyAll(database, ws);` then `const realizedGains = new Set(keys['income.realized_gains'] ?? [])` and likewise for `government_taxes.estimated_tax` and `miscellaneous.interest`; the three `row.accountId !== id` tests become `!set.has(row.accountId)` / `set.has(row.accountId)`.
- `debts.ts` `debtCategoriesTx`, `loans.ts` (both call sites) and `trades.ts` `tradeAccountsFor` keep `categoryIdsByKeyTx(tx, ws)` — now book-aware — and need no edit beyond a comment saying the category is the open workspace's.
- `apps/web/src/features/cards/CatalogPicker.tsx`: `categoryIdsByKeyAll`, and wherever it tests "is this key mapped" it now tests a non-empty array; where it shows one category name, show the first id's name.
- `apps/web/src/features/import/ImportPage.tsx` lines 59–60: filter by the open workspace —

```ts
  const inOpenBook = useInOpenBook();
  // An import records into the open workspace, so its fallbacks must be that workspace's categories.
  const otherExpense = all.find((a) => a.systemKey === 'miscellaneous' && inOpenBook(a))?.id ?? '';
  const otherIncome = all.find((a) => a.systemKey === 'income.other' && inOpenBook(a))?.id ?? '';
```

- [ ] **Step 4: Run**

Run: `npm test` (root) — catalogue, db and web unit suites.
Expected: PASS, `books-sample.test.ts` included.

- [ ] **Step 5: Commit**

```bash
git commit -am "$(cat <<'EOF'
fix: a system key means the open workspace's category, or every copy of it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3: One workspace per transaction, and guesses that stay in it

**Files:**
- Modify: `packages/db/src/repos/entry.ts`, `ledger.ts`, `budgets.ts`, `expense-templates.ts`
- Modify: `apps/web/src/features/debts/DebtsPage.tsx`, `apps/web/src/features/loans/LoanDetailPage.tsx`, `apps/web/src/features/networth/TradesPage.tsx` (category pickers)
- Test: `packages/db/test/books-keys.test.ts`

**Interfaces:**
- Produces: `guessCategoryFromHistory` narrowed to `ws.bookId`; `BudgetError('OTHER_BOOK')`, `RecurringError('OTHER_BOOK')`; the `TWO_BOOKS` message in neutral words; a test pinning that a card-funded trade and a card-paid loan are filed in no book, and that `replaceTransaction` keeps a transaction's book.

- [ ] **Step 1: Write the failing tests** (append to `packages/db/test/books-keys.test.ts`)

```ts
describe('one workspace per transaction', () => {
  it('guesses a category from the open workspace’s own history only', async () => {
    const { database, ws, personal, business } = await copy();
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const keys = await categoryIdsByKey(database, inBook(ws, personal));
    const mine = keys['household.groceries']!;
    await postTransaction(database, inBook(ws, personal), {
      occurredOn: '2026-09-02',
      description: 'Superindo Kebayoran',
      lines: [
        { accountId: mine, amountMinor: 412_300, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -412_300, currency: 'IDR' },
      ],
    });
    expect(await guessCategoryFromHistory(database, inBook(ws, personal), 'Superindo')).toBe(mine);
    // Business has never shopped there, so it is not handed a category it would then refuse.
    expect(await guessCategoryFromHistory(database, inBook(ws, business), 'Superindo')).toBeNull();
  });

  it('refuses a budget and a bill whose category belongs to another workspace', async () => {
    const { database, ws, personal, business } = await copy();
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['household.groceries']!;
    await expect(saveBudget(database, inBook(ws, personal), { categoryAccountId: theirs, amountMinor: 1_000_000 })).rejects.toMatchObject({ code: 'OTHER_BOOK' });
    await expect(
      saveExpenseTemplate(database, inBook(ws, personal), { name: 'Veg box', categoryAccountId: theirs, moneyAccountId: bank.id, amountMinor: 260_000, dayOfMonth: 2 }),
    ).rejects.toMatchObject({ code: 'OTHER_BOOK' });
  });

  it('says "workspaces", not "spend", when a transaction would straddle two', async () => {
    const { database, ws, personal, business } = await copy();
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const mine = (await categoryIdsByKey(database, inBook(ws, personal)))['household.groceries']!;
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['household.groceries']!;
    await expect(
      postTransaction(database, ws, {
        occurredOn: '2026-09-02',
        description: 'Mixed',
        lines: [
          { accountId: mine, amountMinor: 100, currency: 'IDR' },
          { accountId: theirs, amountMinor: 100, currency: 'IDR' },
          { accountId: card.id, amountMinor: -200, currency: 'IDR' },
        ],
      }),
    ).rejects.toThrow(/cannot belong to two workspaces/);
  });

  it('keeps a transaction’s workspace when it is edited', async () => {
    const { database, ws, business } = await copy();
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['food_beverage.restaurants']!;
    const dinner = await postTransaction(database, inBook(ws, business), {
      occurredOn: '2026-09-02',
      description: 'Supplier dinner',
      lines: [
        { accountId: theirs, amountMinor: 640_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -640_000, currency: 'IDR' },
      ],
    });
    const edited = await replaceTransaction(database, inBook(ws, business), dinner, {
      occurredOn: '2026-09-02',
      description: 'Supplier dinner',
      lines: [
        { accountId: theirs, amountMinor: 700_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -700_000, currency: 'IDR' },
      ],
    });
    expect(await database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${edited}`)).toEqual([[business]]);
  });
});
```

(`replaceTransaction`'s return shape is read before running: if it returns an object, take its id.)

- [ ] **Step 2: Run and see them fail**

Run: `cd packages/db && npx vitest run test/books-keys.test.ts`
Expected: FAIL — the guess crosses workspaces, budgets and bills accept a foreign category, the refusal says "spend".

- [ ] **Step 3: Implement**

`entry.ts` — add to the `where(and(…))` of `guessCategoryFromHistory`:

```ts
        // A guess is offered to a form that records into one workspace, so it may only offer that workspace's
        // categories: anything else the posting would refuse a moment later.
        ...(ws.bookId ? [sql`${entries.accountId} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`] : []),
```

`ledger.ts` — the `TWO_BOOKS` message becomes `'A transaction cannot belong to two workspaces at once. Pick categories from one workspace.'`.

`budgets.ts` — in `assertCategory` (or immediately after it in `saveBudget` and `setBudgetOverride`), when `ws.bookId` is set and `hasBooks`, read `bookOfCategory(tx, categoryAccountId)` and throw `new BudgetError('OTHER_BOOK', 'That category belongs to another workspace')` when it names a different book. `BudgetError` gains a `code` the way `BookError` does.

`expense-templates.ts` — the same check inside `saveExpenseTemplate`'s transaction, beside the existing `NOT_A_CATEGORY` check, as `RecurringError('OTHER_BOOK', 'That category belongs to another workspace')`.

Web pickers — `DebtsPage`, `LoanDetailPage` (the extras/penalty category pickers) and `TradesPage` filter their category lists with `useInOpenBook()`, exactly as `BillFormPage` line 42 does:

```ts
  const inOpenBook = useInOpenBook();
  const categories = (accounts.data ?? []).filter((a) => a.kind === 'expense' && a.subtype === 'category' && inOpenBook(a));
```

Also add, to `packages/db/test/books-keys.test.ts`, a test that a card-funded trade and a card-paid loan are filed in **no** book (they carry their category on `entries.spend_category_id`, not as a category line):

```ts
  it('files a card-funded purchase in no workspace, so it shows in every one', async () => {
    // build a holding and a card, buy through writeTrade with spendCategoryId set, then:
    expect(await database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${tradeTransactionId}`)).toEqual([]);
  });
```

(Use `packages/db/test/convert.test.ts` as the model for setting up a card-funded purchase.)

- [ ] **Step 4: Run**

Run: `npm run typecheck && npm test`
Expected: PASS, `books-sample.test.ts` included.

- [ ] **Step 5: Commit**

```bash
git commit -am "$(cat <<'EOF'
fix: a guess, a cap and a bill stay inside the workspace that asked

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4: An account's history is yours, and says whose spending each row is

**Files:**
- Modify: `packages/db/src/repos/books.ts`
- Create: `apps/web/src/features/workspaces/queries.ts`, `apps/web/src/features/workspaces/WorkspaceBadge.tsx`
- Modify: `apps/web/src/features/transactions/TransactionsPage.tsx`
- Test: `packages/db/test/books-keys.test.ts`, `apps/web/e2e/workspaces.spec.ts` (new)

**Interfaces:**
- Produces: `bookNamesOf(database, ws, transactionIds: readonly string[]): Promise<Record<string, { id: string; name: string; kind: BookKind }>>`; `useBooks()`, `useWorkspaceBadges(ids)`, `<WorkspaceBadge book={…} />` which renders nothing when the workspace has one book.

- [ ] **Step 1: Write the failing test** (append to `books-keys.test.ts`)

```ts
  it('names the workspace of each transaction asked about, and says nothing about a transfer', async () => {
    const { database, ws, business } = await copy();
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['food_beverage.restaurants']!;
    const dinner = await postTransaction(database, inBook(ws, business), {
      occurredOn: '2026-09-02',
      description: 'Supplier dinner',
      lines: [
        { accountId: theirs, amountMinor: 640_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -640_000, currency: 'IDR' },
      ],
    });
    const payment = await postTransaction(database, ws, {
      occurredOn: '2026-09-20',
      description: 'Card bill',
      lines: [
        { accountId: card.id, amountMinor: 640_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -640_000, currency: 'IDR' },
      ],
    });
    const names = await bookNamesOf(database, ws, [dinner, payment]);
    expect(names[dinner]).toMatchObject({ id: business, name: 'Business', kind: 'business' });
    expect(names[payment]).toBeUndefined();
    expect(await bookNamesOf(database, ws, [])).toEqual({});
  });
```

- [ ] **Step 2: Run and see it fail** — `cd packages/db && npx vitest run test/books-keys.test.ts`.

- [ ] **Step 3: Implement**

`books.ts`:

```ts
/** Which workspace each of these transactions was filed in. Ones filed nowhere are simply absent. */
export async function bookNamesOf(
  database: Database,
  ws: WorkspaceContext,
  transactionIds: readonly string[],
): Promise<Record<string, { id: string; name: string; kind: BookKind }>> {
  if (transactionIds.length === 0 || !(await hasBooks(database.db))) return {};
  const rows = await database.db
    .select({ transactionId: bookTransactions.transactionId, id: books.id, name: books.name, kind: books.kind })
    .from(bookTransactions)
    .innerJoin(books, eq(books.id, bookTransactions.bookId))
    .where(and(eq(bookTransactions.workspaceId, ws.workspaceId), inArray(bookTransactions.transactionId, [...transactionIds])));
  return Object.fromEntries(rows.map((row) => [row.transactionId, { id: row.id, name: row.name, kind: row.kind }]));
}
```

`apps/web/src/features/workspaces/queries.ts`:

```ts
import { bookNamesOf, listBooks } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/** Every workspace under this owner, open ones only, in the order the switcher shows them. */
export function useBooks() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['books', ws.workspaceId], queryFn: () => listBooks(database, ws) });
}

/** The open workspace's own row: its base currency, and whether events count in its budget. */
export function useOpenBook() {
  const { ws } = useApp();
  return (useBooks().data ?? []).find((book) => book.id === ws.bookId) ?? null;
}

/**
 * Which workspace each row belongs to — for a card's statement and for an account's history, both of which are
 * yours and so hold every workspace. Answers nothing at all while a workspace has only one workspace in it.
 */
export function useWorkspaceBadges(transactionIds: readonly string[]) {
  const { database, ws } = useApp();
  const many = (useBooks().data ?? []).length > 1;
  const ids = [...transactionIds].sort();
  const query = useQuery({
    queryKey: ['book-names', ws.workspaceId, ids.join(',')],
    enabled: many && ids.length > 0,
    queryFn: () => bookNamesOf(database, ws, ids),
  });
  return (transactionId: string) => (many ? (query.data?.[transactionId] ?? null) : null);
}
```

`WorkspaceBadge.tsx` — a small pill, tinted by kind, `null` when no book is given:

```tsx
const TINT: Record<string, string> = {
  personal: 'bg-sky-100 text-sky-800',
  business: 'bg-violet-100 text-violet-800',
  family: 'bg-amber-100 text-amber-800',
  shared: 'bg-emerald-100 text-emerald-800',
};

export function WorkspaceBadge({ book }: { book: { name: string; kind: string } | null }) {
  if (!book) return null;
  return <span className={cx('ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase', TINT[book.kind] ?? TINT.shared)}>{book.name}</span>;
}
```

`TransactionsPage.tsx`:

- the list query reads owner-wide for a money account —

```ts
  // An account is yours, not a workspace's: its history must hold every workspace, or it will not agree with the
  // statement the bank sends. A category scope stays narrowed, since a category belongs to one workspace anyway.
  const ownerWide = scope !== undefined && isMoneyAccount(scope);
  const listWs = ownerWide ? ownerScope(ws) : ws;
```

  used in both `queryKey` (add `ownerWide` to it) and `queryFn`;
- `const badgeOf = useWorkspaceBadges((list.data ?? []).map((tx) => tx.id));` and, in `recordedRow`, `{badgeOf(tx.id) && <WorkspaceBadge book={badgeOf(tx.id)} />}` immediately after the `label` in the first line of the row (beside the bill tag).

- [ ] **Step 4: Write the chromium flow** — `apps/web/e2e/workspaces.spec.ts`, first test:

```ts
test('an account’s history holds every workspace, each row saying which', async ({ page }) => {
  // Build: a bank account, a card, a second workspace copying categories (through Settings in Task 10 — until
  // then, through the workspace sheet’s New workspace), a purchase in each, then open the card from Accounts.
  await page.goto('/accounts');
  …
  await expect(page.getByText('BUSINESS')).toBeVisible();
  await expect(page.getByText('PERSONAL')).toBeVisible();
});
```

Write it after Task 7 lands (New workspace is what creates the second workspace); until then keep the file with the single db-driven expectation and a `test.skip` carrying the reason.

- [ ] **Step 5: Run**

Run: `npm run typecheck && npm test && cd apps/web && npx playwright test --workers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "$(cat <<'EOF'
fix(web): an account's history shows every workspace, and says which

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 3.1 — Switching

### Task 5: The open workspace becomes something you can change

**Files:**
- Modify: `apps/web/src/app/context.ts`, `apps/web/src/app/App.tsx`
- Modify: `packages/db/src/repos/books.ts` (`spentThisMonthByBook`)
- Create: `apps/web/src/features/workspaces/WorkspaceSheet.tsx`
- Test: `packages/db/test/books-keys.test.ts`

**Interfaces:**
- Produces: `AppState = AppDb & { switchBook(bookId: string): Promise<void> }` from `useApp()`; `spentThisMonthByBook(database, ws, from, to): Promise<Record<string, number>>`; `<WorkspaceSheet onClose onNew />`.

- [ ] **Step 1: Write the failing test**

```ts
  it('adds up what each workspace spent in a period, and leaves transfers out of all of them', async () => {
    const { database, ws, personal, business } = await copy();
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const spend = (bookId: string, key: string, amountMinor: number) =>
      categoryIdsByKey(database, inBook(ws, bookId)).then((keys) =>
        postTransaction(database, inBook(ws, bookId), {
          occurredOn: '2026-09-10',
          description: 'x',
          lines: [
            { accountId: keys[key]!, amountMinor, currency: 'IDR' },
            { accountId: card.id, amountMinor: -amountMinor, currency: 'IDR' },
          ],
        }),
      );
    await spend(personal, 'household.groceries', 412_300);
    await spend(business, 'food_beverage.restaurants', 640_000);
    await postTransaction(database, ws, {
      occurredOn: '2026-09-11',
      description: 'Card bill',
      lines: [
        { accountId: card.id, amountMinor: 640_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -640_000, currency: 'IDR' },
      ],
    });

    expect(await spentThisMonthByBook(database, ws, '2026-09-01', '2026-09-30')).toEqual({ [personal]: 412_300, [business]: 640_000 });
  });
```

- [ ] **Step 2: Run and see it fail.**

- [ ] **Step 3: Implement**

`books.ts`:

```ts
/**
 * What each workspace spent between two dates, in the owner's base currency.
 *
 * One query rather than one per workspace: the switcher shows this for every workspace at once. Transfers and card
 * payments are filed in no workspace, so they are in nobody's figure — which is the rule everywhere else too.
 */
export async function spentThisMonthByBook(database: Database, ws: WorkspaceContext, from: string, to: string): Promise<Record<string, number>> {
  if (!(await hasBooks(database.db))) return {};
  const rows = await database.db.values<[string, number]>(sql`
    SELECT bc.book_id, sum(e.amount_base_minor)
    FROM entries e
    JOIN transactions t ON t.id = e.transaction_id
    JOIN accounts a ON a.id = e.account_id
    JOIN book_categories bc ON bc.category_account_id = e.account_id
    WHERE e.workspace_id = ${ws.workspaceId} AND t.status = 'posted' AND a.kind = 'expense'
      AND t.occurred_on BETWEEN ${from} AND ${to}
    GROUP BY bc.book_id
  `);
  return Object.fromEntries(rows.map(([bookId, total]) => [String(bookId), displayAmount('expense', Number(total))]));
}
```

`apps/web/src/app/context.ts`:

```ts
export interface AppState extends AppDb {
  /** Opens another workspace: remembered on the device, and every cached figure dropped. */
  switchBook: (bookId: string) => Promise<void>;
}

export const AppContext = createContext<AppState | null>(null);
export function useApp(): AppState { … }
```

`App.tsx`:

```tsx
export function App({ app }: { app: AppDb }) {
  const [queryClient] = useState(() => new QueryClient({ … }));
  const [bookId, setBookId] = useState(app.ws.bookId);
  const value = useMemo<AppState>(
    () => ({
      ...app,
      ws: { ...app.ws, bookId },
      switchBook: async (next) => {
        await setActiveBook(app.database, app.ws, next);
        setBookId(next);
        // Removed, not invalidated: an invalidated query keeps showing its old data while it refetches, and that
        // data is another workspace's money.
        queryClient.removeQueries();
      },
    }),
    [app, bookId, queryClient],
  );
  return (
    <AppContext.Provider value={value}>…</AppContext.Provider>
  );
}
```

`WorkspaceSheet.tsx` — `useBooks()`, `useSpentThisMonth()` (a query over `spentThisMonthByBook` for `monthRange(monthOf(isoDate()))`), one `<button>` per workspace at least 44px tall with the kind dot, the name, "Spent {formatMinor(spent, ws.baseCurrency)} this month" — the owner's currency here, because `spentThisMonthByBook` reads in it; Task 9 turns that call into one that answers per workspace currency and this line then formats with the row's own `book.baseCurrency` — a tick on the open one, then "+ New workspace" and a `Link` to `/settings`. Choosing calls `switchBook` and `onClose`.

- [ ] **Step 4: Run** — `npm run typecheck && npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "$(cat <<'EOF'
feat(web): the open workspace can be changed, and every figure follows

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 6: The switcher in ⋯, and its equal on a wide screen

**Files:**
- Modify: `apps/web/src/features/transactions/TransactionsPage.tsx`, `apps/web/src/app/Layout.tsx`
- Test: `apps/web/e2e/phone-workspaces.spec.ts` (new), `apps/web/e2e/workspaces.spec.ts`

**Interfaces:**
- Consumes: `useBooks`, `useApp().switchBook`, `WorkspaceSheet`.
- Produces: a `data-testid="workspace-row"` item first in the ⋯ menu, and a `aria-label="Workspace"` button in the sidebar.

- [ ] **Step 1: Implement the phone row**

In `TransactionsPage`, inside the `filters-menu` `<div role="menu">`, **above** the "Not recorded" button, and only when `books.length > 1 || true` (it is always shown — it is how a second workspace is made):

```tsx
            <button
              type="button"
              role="menuitem"
              data-testid="workspace-row"
              onClick={() => {
                setShowFilters(false);
                setChoosingWorkspace(true);
              }}
              // A gap, not a divider: this changes the whole app, where the three below it narrow one list.
              className="flex min-h-12 w-full items-center gap-3 border-b-6 border-slate-100 px-4 text-left text-sm"
            >
              <WorkspaceDot book={openBook} />
              <span className="flex-1 truncate font-medium">{openBook?.name ?? workspaceName}</span>
              <span className="text-xs text-slate-500">Workspace ›</span>
            </button>
```

with `const [choosingWorkspace, setChoosingWorkspace] = useState(false)` and, beside the "Paid with" sheet, `{choosingWorkspace && <WorkspaceSheet onClose={() => setChoosingWorkspace(false)} />}`. `WorkspaceDot` lives beside `WorkspaceBadge`: a 22px round tinted by kind with the name's first letter.

- [ ] **Step 2: Implement the desktop switcher**

In `Layout.tsx`, the identity block becomes a button opening the same sheet:

```tsx
        <button
          type="button"
          aria-label="Workspace"
          onClick={() => setChoosing(true)}
          className="mb-6 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-100"
        >
          <WorkspaceDot book={openBook} />
          <span className="min-w-0 flex-1">
            <span className="block text-lg leading-tight font-semibold">Expanses</span>
            <span className="block truncate text-xs text-slate-500">
              {openBook?.name ?? workspaceName} · {openBook?.baseCurrency ?? ws.baseCurrency} · on this device
            </span>
          </span>
          <ChevronsUpDown size={14} aria-hidden className="shrink-0 text-slate-400" />
        </button>
        {choosing && <WorkspaceSheet onClose={() => setChoosing(false)} />}
```

It is on every screen, so a wide screen reaches the switcher from more places than a phone does, not fewer.

- [ ] **Step 3: Write the flows**

`apps/web/e2e/phone-workspaces.spec.ts`:

```ts
test('the workspace is the first thing under ⋯, and switching empties the chart', async ({ page }) => {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Filters' }).click();
  const menu = page.getByTestId('filters-menu');
  await expect(menu.getByTestId('workspace-row')).toBeVisible();
  // It comes before the three filters, because it changes the app rather than narrowing the list.
  await expect(menu.getByRole('menuitem').first()).toHaveAttribute('data-testid', 'workspace-row');
  await menu.getByTestId('workspace-row').click();
  await expect(page.getByRole('dialog', { name: 'Workspaces' })).toBeVisible();
});
```

`apps/web/e2e/workspaces.spec.ts` gains: the sidebar button is visible on `/`, opens the dialog, and the dialog lists Personal with a tick.

- [ ] **Step 4: Run** — `cd apps/web && npx playwright test --workers=2`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "$(cat <<'EOF'
feat(web): a workspace switcher in Cashflow's menu and in the sidebar

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 3.2 — New workspace

### Task 7: Making one, with categories copied or none at all

**Files:**
- Modify: `packages/db/src/repos/books.ts` (`createBook` copies `category_mccs`)
- Create: `apps/web/src/features/workspaces/NewWorkspaceSheet.tsx`
- Modify: `apps/web/src/features/workspaces/WorkspaceSheet.tsx`
- Test: `packages/db/test/books.test.ts`, `apps/web/e2e/workspaces.spec.ts`, `apps/web/e2e/phone-workspaces.spec.ts`

**Interfaces:**
- Produces: a copied workspace whose categories carry the source's `system_key`, `icon` **and** typed MCC; `<NewWorkspaceSheet onClose />`.

- [ ] **Step 1: Write the failing test** (append to `packages/db/test/books.test.ts`)

```ts
  it('copies a category’s typed MCC with the category, so a copied workspace earns the same points', async () => {
    const { database, ws } = await setupDb();
    const personal = await personalBook(database, ws);
    const keys = await categoryIdsByKey(database, ws);
    await saveCategoryMcc(database, ws, keys['food_beverage.restaurants']!, '5812');

    const family = await createBook(database, ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    const copied = (await categoryIdsByKey(database, inBook(ws, family)))['food_beverage.restaurants']!;
    expect((await listCategoryMccs(database, ws))[copied]).toBe('5812');
    // The choice of which published category option a card runs is the card's, not a category's: nothing to copy.
    expect(await database.db.values(sql`SELECT count(*) FROM catalog_category_choices`)).toEqual([[0]]);
  });
```

- [ ] **Step 2: Run and see it fail.**

- [ ] **Step 3: Implement** — in `createBook`'s copy loop, after inserting the new category and its `book_categories` row:

```ts
      // The typed MCC is a property of "this category means restaurants", which is exactly what was copied. Without
      // it a copied workspace earns at the card's base rate until somebody notices.
      const [mcc] = await tx.select({ mcc: categoryMccs.mcc }).from(categoryMccs).where(eq(categoryMccs.categoryId, a.id));
      if (mcc) await tx.insert(categoryMccs).values({ categoryId: newIds.get(a.id)!, workspaceId: ws.workspaceId, mcc: mcc.mcc });
```

`catalog_category_choices` is keyed by `(program_id, option_key)` — it belongs to the card, not to a category — so nothing of it is copied. Say so in the comment above the copy.

- [ ] **Step 4: Build the sheet**

`NewWorkspaceSheet.tsx`, following the mockup: a `Sheet title="New workspace"` holding

- `Field label="Name"` → `Input`, required;
- four kind tiles in a `grid-cols-4` (`aria-pressed`), `personal` disabled with the title "There is already a Personal workspace" when `books.some(b => b.kind === 'personal')`;
- "Starts with" → a `Select` of "Start empty" and one option per existing workspace ("Copy from Personal"), and a `Select` of `CURRENCIES` defaulting to `ws.baseCurrency`;
- "Events" → a switch, "Count event spending in this workspace's monthly budget", defaulting to `kind === 'business'`;
- a "Create workspace" button that calls

```ts
      const id = await createBook(database, ws, { name, kind, baseCurrency, countEventsInBudget, copyCategoriesFrom: copyFrom || null });
      await switchBook(id);
      onClose();
```

with `ErrorBox` showing a `BookError`'s message as it comes (the repository's words are the product's words).

`WorkspaceSheet`'s "+ New workspace" opens it.

- [ ] **Step 5: Write the flows** — in `workspaces.spec.ts`: create "Business" copying Personal's categories, land in it, see Cashflow empty of transactions but the category picker full; then switch back and find the previous month's spending again. In `phone-workspaces.spec.ts`: the same through ⋯ → Workspaces → + New workspace, with "Start empty" and an empty category picker.

- [ ] **Step 6: Run** — `npm run typecheck && npm test && cd apps/web && npx playwright test --workers=2`. Then un-skip Task 4's account-history flow, which now has a second workspace to build.

- [ ] **Step 7: Commit**

```bash
git commit -am "$(cat <<'EOF'
feat: a new workspace, empty or with a copy of another's categories

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 3.3 — Settings, and a currency of its own

### Task 8: Picking a rate for a date, and the money a workspace reads in

**Files:**
- Create: `packages/core/src/money/rates.ts`, `packages/core/test/rates.test.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/db/src/repos/book-currency.ts`, `packages/db/test/book-currency.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces (core): `interface DatedRate { onDate: string; rate: number }`, `pickRate(rows: readonly DatedRate[], onDate: string): DatedRate | null` — the exact date, else the latest earlier one, else null; rows may arrive in any order.
- Produces (db):

```ts
export interface BookMoney {
  /** False when the workspace reads in the owner's own currency: every figure then takes today's path, unchanged. */
  converts: boolean;
  /** The currency the figures are in. */
  currency: string;
  /** Null when no rate exists for that currency on or before that date; the caller leaves the amount out. */
  convert(amountMinor: number, currency: string, onDate: string): number | null;
  /** What could not be converted, for the screen to say: one entry per currency, with its earliest date. */
  missing(): { currency: string; onDate: string }[];
}
export function bookMoneyFor(database: Database, ws: WorkspaceContext): Promise<BookMoney>;
```

- [ ] **Step 1: Write the failing core test**

```ts
// packages/core/test/rates.test.ts
import { describe, expect, it } from 'vitest';
import { pickRate } from '../src/index';

const rows = [
  { onDate: '2026-08-01', rate: 11_800 },
  { onDate: '2026-09-01', rate: 12_050 },
  { onDate: '2026-08-15', rate: 11_900 },
];

describe('pickRate', () => {
  it('takes the rate of the day when there is one', () => {
    expect(pickRate(rows, '2026-08-15')).toEqual({ onDate: '2026-08-15', rate: 11_900 });
  });

  it('falls back to the latest earlier day, whatever order the rows arrive in', () => {
    expect(pickRate(rows, '2026-08-20')).toEqual({ onDate: '2026-08-15', rate: 11_900 });
    expect(pickRate(rows, '2026-12-31')).toEqual({ onDate: '2026-09-01', rate: 12_050 });
  });

  it('has nothing to say before the first rate it holds', () => {
    expect(pickRate(rows, '2026-07-31')).toBeNull();
    expect(pickRate([], '2026-08-15')).toBeNull();
  });
});
```

- [ ] **Step 2: Run and see it fail** — `cd packages/core && npx vitest run test/rates.test.ts`.

- [ ] **Step 3: Implement `pickRate`**

```ts
// packages/core/src/money/rates.ts
export interface DatedRate {
  /** YYYY-MM-DD. */
  onDate: string;
  rate: number;
}

/**
 * The rate that speaks for a date: the day's own, else the latest earlier one, else nothing.
 *
 * The same rule `findRate` uses in the database, as a pure function, so a whole month of amounts can be converted
 * from one snapshot of the table instead of one query per amount.
 */
export function pickRate(rows: readonly DatedRate[], onDate: string): DatedRate | null {
  let best: DatedRate | null = null;
  for (const row of rows) {
    if (row.onDate > onDate) continue;
    if (!best || row.onDate > best.onDate) best = row;
  }
  return best;
}
```

Export it from `packages/core/src/index.ts`.

- [ ] **Step 4: Write the failing db test**

```ts
// packages/db/test/book-currency.test.ts
import { describe, expect, it } from 'vitest';
import { bookMoneyFor, createBook, inBook, upsertRate } from '../src/index';
import { setupDb } from './helpers';

describe('the money a workspace reads in', () => {
  it('does nothing at all when the workspace reads in the owner’s currency', async () => {
    const { database, ws } = await setupDb();
    const money = await bookMoneyFor(database, ws);
    expect(money).toMatchObject({ converts: false, currency: 'IDR' });
    expect(money.convert(85_000, 'IDR', '2026-09-10')).toBe(85_000);
  });

  it('converts each amount at the rate on its own date, and says what it could not convert', async () => {
    const { database, ws } = await setupDb();
    const sgd = await createBook(database, ws, { name: 'Singapore', kind: 'business', baseCurrency: 'SGD' });
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: '2026-08-01', rate: 0.0000845, source: 'manual', sourceDate: '2026-08-01' });
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: '2026-09-01', rate: 0.000083, source: 'manual', sourceDate: '2026-09-01' });
    const money = await bookMoneyFor(database, inBook(ws, sgd));

    expect(money).toMatchObject({ converts: true, currency: 'SGD' });
    // IDR has no minor units and SGD has two, so 12.000.000 rupiah at 0,000083 is S$996.00.
    expect(money.convert(12_000_000, 'IDR', '2026-09-10')).toBe(99_600);
    // A date before any rate is not guessed at: it is left out and named.
    expect(money.convert(12_000_000, 'IDR', '2026-07-01')).toBeNull();
    // An amount already in the workspace's own currency is simply itself.
    expect(money.convert(6_000, 'SGD', '2026-07-01')).toBe(6_000);
    expect(money.missing()).toEqual([{ currency: 'IDR', onDate: '2026-07-01' }]);
  });
});
```

- [ ] **Step 5: Run and see it fail.**

- [ ] **Step 6: Implement `book-currency.ts`**

```ts
/**
 * A workspace reads its own Cashflow, budgets and bills in its own base currency: each amount converted from the
 * currency it was paid in, at the rate on the transaction's date.
 *
 * Display only. Nothing is written back, `entries.amount_base_minor` keeps meaning the owner's currency, and a
 * workspace whose currency is the owner's converts nothing — so a one-currency owner's figures are the same
 * numbers, down to the rupiah, that they were before workspaces existed.
 */
export async function bookMoneyFor(database: Database, ws: WorkspaceContext): Promise<BookMoney> {
  const currency = ws.bookId && (await hasBooks(database.db)) ? ((await bookOfId(database, ws, ws.bookId))?.baseCurrency ?? ws.baseCurrency) : ws.baseCurrency;
  const missed = new Map<string, string>();
  if (currency === ws.baseCurrency) {
    return { converts: false, currency, convert: (amountMinor) => amountMinor, missing: () => [] };
  }
  // One snapshot: fx_rates holds a handful of rows per pair, and a month's list would otherwise be a query an
  // amount. Rows are picked in memory with the same "exact day, else the latest earlier" rule findRate uses.
  const rows = await database.db.select({ from: fxRates.fromCurrency, onDate: fxRates.onDate, rate: fxRates.rate }).from(fxRates).where(eq(fxRates.toCurrency, currency));
  const byCurrency = new Map<string, DatedRate[]>();
  for (const row of rows) (byCurrency.get(row.from) ?? byCurrency.set(row.from, []).get(row.from)!).push({ onDate: row.onDate, rate: row.rate });

  return {
    converts: true,
    currency,
    convert(amountMinor, from, onDate) {
      if (from === currency) return amountMinor;
      const found = pickRate(byCurrency.get(from) ?? [], onDate);
      if (!found) {
        const earliest = missed.get(from);
        if (!earliest || onDate < earliest) missed.set(from, onDate);
        return null;
      }
      return convertMinor(amountMinor, from, currency, found.rate);
    },
    missing: () => [...missed].map(([currency, onDate]) => ({ currency, onDate })).sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}
```

`bookOfId` is a small local read of `books` by id (or reuse the `bookOf` added in Task 1 by exporting it).

- [ ] **Step 7: Run** — `cd packages/core && npx vitest run` and `cd packages/db && npx vitest run test/book-currency.test.ts test/books-sample.test.ts`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git commit -am "$(cat <<'EOF'
feat: the rate that speaks for a date, and the money a workspace reads in

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 9: Reading a workspace in its own currency

**Files:**
- Modify: `packages/db/src/repos/reports.ts`, `ledger.ts`, `flows.ts`, `expense-templates.ts`, `budget-sheet.ts`
- Modify: `apps/web/src/features/transactions/SpendingReport.tsx`, `apps/web/src/features/budget/BudgetPage.tsx`, `apps/web/src/features/bills/RecurringPage.tsx`, `apps/web/src/features/transactions/TransactionsPage.tsx`, `apps/web/src/features/workspaces/WorkspaceSheet.tsx`
- Test: `packages/db/test/book-currency.test.ts`

**Interfaces:**
- Produces: `categoryTotalsBetween`, `eventSpendingBetween`, `listTransactions`, `periodFlows`, `committedByCategory` and `spentThisMonthByBook` all reading in the open workspace's currency; each converting read also reports `missing` — `categoryTotalsBetween` keeps its array return and gains a sibling `categoryTotalsIn(database, ws, …): Promise<{ rows: …[]; currency: string; missing: … }>` used by the screens that show the banner. `budgetSheetFor`'s result gains `currency: string` and `unconverted: { currency: string; onDate: string }[]`.

- [ ] **Step 1: Write the failing test** (append to `book-currency.test.ts`)

```ts
  it('reads a workspace’s chart, list, budget and bills in its own currency, and leaves out what it cannot convert', async () => {
    const { database, ws } = await setupDb();
    const sgd = await createBook(database, ws, { name: 'Singapore', kind: 'business', baseCurrency: 'SGD' });
    const book = inBook(ws, sgd);
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: '2026-09-01', rate: 0.000083, source: 'manual', sourceDate: '2026-09-01' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const meals = await createAccount(database, book, { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });
    const spend = (occurredOn: string, amountMinor: number) =>
      postTransaction(database, book, {
        occurredOn,
        description: 'Dinner',
        lines: [
          { accountId: meals.id, amountMinor, currency: 'IDR' },
          { accountId: card.id, amountMinor: -amountMinor, currency: 'IDR' },
        ],
      });
    await spend('2026-09-10', 12_000_000);
    await spend('2026-08-10', 6_000_000); // before any rate

    const totals = await categoryTotalsIn(database, book, 'expense', '2026-08-01', '2026-09-30');
    expect(totals.currency).toBe('SGD');
    expect(totals.rows).toEqual([{ accountId: meals.id, amountBaseMinor: 99_600, transactions: 1 }]);
    expect(totals.missing).toEqual([{ currency: 'IDR', onDate: '2026-08-10' }]);

    // The owner's own figures are untouched: the same two purchases in rupiah.
    const owner = await categoryTotalsBetween(database, ownerScope(ws), 'expense', '2026-08-01', '2026-09-30');
    expect(owner.find((row) => row.accountId === meals.id)?.amountBaseMinor).toBe(18_000_000);

    // The day's total on the list reads in the workspace's currency too.
    const [newest] = await listTransactions(database, book, { from: '2026-09-01', to: '2026-09-30' });
    expect(newest!.entries.find((entry) => entry.accountId === meals.id)?.amountBaseMinor).toBe(99_600);
    // And the purchase itself still says what was paid.
    expect(newest!.entries.find((entry) => entry.accountId === meals.id)?.amountMinor).toBe(12_000_000);
  });
```

- [ ] **Step 2: Run and see it fail.**

- [ ] **Step 3: Implement**

`reports.ts` — keep today's grouped-in-SQL path exactly as it is when the money does not convert, and take a second path when it does:

```ts
export async function categoryTotalsIn(
  database: Database,
  ws: WorkspaceContext,
  kind: 'expense' | 'income',
  from: string,
  to: string,
  opts: { excludeEvents?: boolean; billMonths?: boolean } = {},
): Promise<{ rows: CategoryTotal[]; currency: string; missing: { currency: string; onDate: string }[] }> {
  const money = await bookMoneyFor(database, ws);
  if (!money.converts) return { rows: await categoryTotalsBetween(database, ws, kind, from, to, opts), currency: money.currency, missing: [] };
  // Converting is per amount, so the sum moves out of SQL: the same rows, grouped here instead.
  …select entries.accountId, entries.amountMinor, entries.currency, the attributed date and transactions.id with the
  same where clause as categoryTotalsBetween…
  for (const row of rows) {
    const converted = money.convert(row.amountMinor, row.currency, row.onDate);
    if (converted === null) continue; // left out, and named by money.missing()
    …accumulate per accountId, counting distinct transaction ids…
  }
  return { rows: […], currency: money.currency, missing: money.missing() };
}
```

`categoryTotalsBetween` keeps its signature and stays the owner-currency read; every book-scoped caller moves to `categoryTotalsIn`. Take the date used for conversion from the same expression the period filter uses (`attributedOn()` under `billMonths`, `transactions.occurredOn` otherwise), so a bill paid late converts on the day it was paid.

- `eventSpendingBetween`: the same two paths, returning `{ amountMinor, currency, missing }`.
- `listTransactions`: after the views are built, when `money.converts`, map every entry's `amountBaseMinor` through `money.convert(entry.amountMinor, entry.currency, tx.occurredOn)`, leaving the entry's own `amountMinor` and `currency` alone; an entry that cannot convert gets `0` and is listed by a `listTransactionsIn` sibling that also returns `{ currency, missing }`. `TransactionsPage` uses the sibling; `useCardLedger` and every owner-level caller keep `listTransactions`.
- `periodFlows`: convert `incomeMinor`, `spendingMinor` and `debtPaymentsMinor` the same way, per row, when the money converts; narrow income and spending to `ws.bookId` when one is set (`entries.accountId IN (SELECT … FROM book_categories WHERE book_id = …)` on the income/expense branches only — savings and debt stay owner-level facts about your accounts). `goal-funding.ts` and `apps/web/src/features/networth/queries.ts` call it with `ownerScope(ws)`, since what you can save is yours.
- `committedByCategory`: convert each template's amount from the currency of the account that pays it, at today's rate, into the read currency — which also settles the older mixing of currencies in that sum.
- `budgetSheetFor`: narrow its category list to the book (`accounts.id IN (SELECT category_account_id FROM book_categories WHERE book_id = …)` when `ws.bookId`), read through `categoryTotalsIn` and the converting `eventSpendingBetween`, convert each goal's plan and contribution at the rate on the month's last day, and return `currency` and `unconverted`.
- `spentThisMonthByBook`: loop the books and reuse `categoryTotalsIn` with `inBook(ws, book.id)` — a handful of workspaces, one tested path, each figure in its own currency: it returns `Record<string, { amountMinor: number; currency: string }>`. Task 5's test and `WorkspaceSheet` move to the new shape in this task (the test's expectation becomes `{ [personal]: { amountMinor: 412_300, currency: 'IDR' }, … }`), and a case is added for a workspace reading in SGD showing its own figure in the list.

Web: `SpendingReport`, `BudgetPage`, `RecurringPage` and `TransactionsPage` format with the returned `currency` rather than `ws.baseCurrency`, and show above the figure, when `missing.length > 0`:

```tsx
<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
  {missing.length} amount{missing.length === 1 ? '' : 's'} in {missing.map((m) => m.currency).join(', ')} are not counted: no{' '}
  {missing[0]!.currency}→{currency} rate for {shortDate(missing[0]!.onDate)} or earlier. Use Add transaction to enter one.
</p>
```

- [ ] **Step 4: Run the whole gate** — `npm run typecheck && npm test && cd apps/web && npx playwright test --workers=2`. `books-sample.test.ts` must be untouched and green: the sample household's workspace reads in the owner's currency, so none of this runs for it.

- [ ] **Step 5: Commit**

```bash
git commit -am "$(cat <<'EOF'
feat: each workspace reads its Cashflow, budgets and bills in its own currency

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 10: Settings → Workspaces

**Files:**
- Modify: `packages/db/src/repos/books.ts` (`setBookBaseCurrency`)
- Create: `apps/web/src/features/workspaces/SettingsPage.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/app/nav.ts`, `apps/web/src/app/Layout.tsx`
- Test: `packages/db/test/book-currency.test.ts`, `apps/web/e2e/workspaces.spec.ts`, `apps/web/e2e/phone.spec.ts` (the reachability list)

**Interfaces:**
- Produces: `setBookBaseCurrency(database, ws, bookId, currency): Promise<{ rate: number; onDate: string }>` — converts the workspace's caps, overrides and expected income, then writes the currency; `BookError('NO_RATE')` when there is no rate to convert with. Route `/settings`.

- [ ] **Step 1: Write the failing test**

```ts
  it('carries a workspace’s caps and expected income across when its currency changes, and refuses without a rate', async () => {
    const { database, ws } = await setupDb();
    const biz = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const book = inBook(ws, biz);
    const software = await createAccount(database, book, { name: 'Software', kind: 'expense', subtype: 'category', currency: null });
    await saveBudget(database, book, { categoryAccountId: software.id, amountMinor: 12_000_000 });
    await saveExpectedIncome(database, book, 240_000_000);

    await expect(setBookBaseCurrency(database, ws, biz, 'SGD')).rejects.toMatchObject({ code: 'NO_RATE' });

    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: isoDate(), rate: 0.000083, source: 'manual', sourceDate: isoDate() });
    expect(await setBookBaseCurrency(database, ws, biz, 'SGD')).toMatchObject({ rate: 0.000083 });

    expect((await listBooks(database, ws)).find((b) => b.id === biz)).toMatchObject({ baseCurrency: 'SGD' });
    expect((await listBudgets(database, book, '2026-09')).find((row) => row.categoryAccountId === software.id)?.amountMinor).toBe(99_600);
    expect((await getBudgetIncome(database, book, '2026-09')).amountMinor).toBe(1_992_000);
    // Personal is untouched: one workspace's currency is nobody else's business.
    expect((await listBooks(database, ws)).find((b) => b.kind === 'personal')).toMatchObject({ baseCurrency: 'IDR' });
  });
```

(`getBudgetIncome`'s field is read from `budget-settings.ts` before the test is written and matched exactly.)

- [ ] **Step 2: Run and see it fail.**

- [ ] **Step 3: Implement `setBookBaseCurrency`**

```ts
/**
 * Changes the currency a workspace reads in, and carries its plan across with it.
 *
 * Caps, month overrides and expected income carry no currency of their own: they are figures in whatever the
 * workspace reads in. Left alone, Rp 5.000.000 of groceries would become $5,000,000 overnight, so they are
 * converted once, at today's rate, and the change is refused outright when there is no rate to convert with —
 * better a refusal than a plan nobody can trust.
 */
export async function setBookBaseCurrency(database: Database, ws: WorkspaceContext, bookId: string, currency: string): Promise<{ rate: number; onDate: string }> {
  if (!isSupportedCurrency(currency)) throw new BookError('BAD_CURRENCY', `${currency} is not a currency this app knows`);
  const book = await bookOf(database, ws, bookId);
  if (book.baseCurrency === currency) return { rate: 1, onDate: isoDate() };
  const found = await findRate(database, book.baseCurrency, currency, isoDate());
  if (!found) throw new BookError('NO_RATE', `No ${book.baseCurrency}→${currency} rate yet. Record one first.`);

  await database.transaction(async (tx) => {
    const ids = (await tx.select({ id: bookCategories.categoryAccountId }).from(bookCategories).where(eq(bookCategories.bookId, bookId))).map((row) => row.id);
    // budgets, budget_overrides (through their budget), book_budget_settings and book_income_overrides, each
    // amount through convertMinor so a currency with different minor units lands on a whole figure.
    …
    await tx.update(books).set({ baseCurrency: currency }).where(eq(books.id, bookId));
    await tx.insert(auditLog).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      action: 'update',
      entity: 'book_currency',
      entityId: bookId,
      payloadJson: JSON.stringify({ from: book.baseCurrency, to: currency, rate: found.rate, onDate: found.onDate }),
      createdAt: new Date().toISOString(),
    });
  });
  return { rate: found.rate, onDate: found.onDate };
}
```

- [ ] **Step 4: Build the screen**

`SettingsPage.tsx` at `/settings`, added to `MORE_GROUPS`'s "Keep it safe" group (`{ to: '/settings', label: 'Settings', icon: Settings }`) and to `Layout`'s `MORE` list, so `phone.spec.ts`'s reachability test covers it without change:

- **Your money** — a `Card` showing `workspaceName`, `ws.baseCurrency`, and the sentence "Net worth, balances, statements and the tax report are read in this currency."
- **Workspaces** — one row per `useBooks()` entry: the dot, the name, the kind, the base currency, and a chevron. Opening a row shows, in place (a `<details>` on desktop, a `Sheet` on a phone):
  - `Input` + Save → `renameBook`;
  - a `Select` of `CURRENCIES` → `setBookBaseCurrency`, with a confirmation line first ("Caps and expected income will be converted at {rate} from {onDate}") and the `BookError`'s message shown when it refuses;
  - a switch → `setBookEventsInBudget`;
  - "Archive workspace", two-tap as `TransactionsPage`'s `twoTap` does, calling `archiveBook` and showing its refusal in place for Personal and for the last workspace.
- Every change calls `useInvalidateAll()`; a change to the **open** workspace's currency also needs the figures re-read, which the same invalidation does.

- [ ] **Step 5: Write the flow** — in `workspaces.spec.ts`: rename Business to Consulting and see the switcher follow; archive it and see it leave the switcher; try to archive Personal and read the refusal.

- [ ] **Step 6: Run** — `npm run typecheck && npm test && cd apps/web && npx playwright test --workers=2`.

- [ ] **Step 7: Commit**

```bash
git commit -am "$(cat <<'EOF'
feat(web): Settings holds the workspaces — rename, archive, currency

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 4 — Across workspaces

### Task 11: An event, whole or one workspace at a time

**Files:**
- Modify: `packages/db/src/repos/books.ts` (`booksInEvent`), `packages/db/src/repos/events.ts` (`eventSheetFor`, `listEventBudgets`)
- Modify: `apps/web/src/features/events/queries.ts`, `EventDetailPage.tsx`
- Test: `packages/db/test/book-events.test.ts` (new), `apps/web/e2e/workspaces.spec.ts`

**Interfaces:**
- Produces: `booksInEvent(database, ws, eventId): Promise<BookRow[]>`; `eventSheetFor` and `listEventBudgets` narrow to `ws.bookId` when one is set.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/book-events.test.ts
describe('an event across workspaces', () => {
  it('names the workspaces that spent in it, and narrows the ring to one at a time', async () => {
    const { database, ws, personal, business } = await copy(); // as in books-keys.test.ts
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const eventId = await saveEvent(database, ws, { name: 'Singapore holiday', startsOn: '2026-08-13', endsOn: '2026-08-17', plannedMinor: 15_000_000 });
    const spend = async (bookId: string, key: string, amountMinor: number) => {
      const keys = await categoryIdsByKey(database, inBook(ws, bookId));
      const id = await postTransaction(database, inBook(ws, bookId), {
        occurredOn: '2026-08-15',
        description: 'x',
        lines: [
          { accountId: keys[key]!, amountMinor, currency: 'IDR' },
          { accountId: card.id, amountMinor: -amountMinor, currency: 'IDR' },
        ],
      });
      await tagTransaction(database, ws, id, eventId);
      return keys[key]!;
    };
    await spend(personal, 'travel.lodging', 11_200_000);
    await spend(business, 'food_beverage.restaurants', 640_000);

    expect((await booksInEvent(database, ws, eventId)).map((book) => book.name)).toEqual(['Personal', 'Business']);
    // All: the whole trip. One tab: that workspace's share, and only its categories.
    expect((await eventSheetFor(database, ownerScope(ws), eventId)).actualMinor).toBe(11_840_000);
    expect((await eventSheetFor(database, inBook(ws, business), eventId)).actualMinor).toBe(640_000);
    expect((await eventSheetFor(database, inBook(ws, business), eventId)).lines.map((line) => line.name)).toEqual(['Restaurants']);
  });
});
```

(`eventSheetFor`'s result fields are read from `packages/core/src/events/sheet.ts` before writing the test and matched exactly; `saveEvent`'s input likewise.)

- [ ] **Step 2: Run and see it fail.**

- [ ] **Step 3: Implement**

```ts
/** The workspaces that have spending tagged to this event, in the order the switcher shows them. */
export async function booksInEvent(database: Database, ws: WorkspaceContext, eventId: string): Promise<BookRow[]> {
  if (!(await hasBooks(database.db))) return [];
  const rows = await database.db
    .select()
    .from(books)
    .where(
      and(
        eq(books.workspaceId, ws.workspaceId),
        isNull(books.archivedAt),
        sql`${books.id} IN (SELECT bt.book_id FROM book_transactions bt JOIN transactions t ON t.id = bt.transaction_id WHERE t.event_id = ${eventId} AND t.status = 'posted')`,
      ),
    )
    .orderBy(asc(books.sortOrder), asc(books.createdAt));
  return rows.map(toRow);
}
```

In `eventSheetFor`, add to the actuals' `where` and to the category-names query the same `book_categories` narrowing the other book-scoped reads use, and pass `ws` (not `ownerScope`) through to `listEventBudgets`, which gains the same narrowing on `event_budgets.category_account_id`.

- [ ] **Step 4: Build the tabs**

`events/queries.ts` gains `useBooksInEvent(eventId)`, and `useEventSheet`, `useEventBudgets` and `useEventHistory` take a `bookId: string | null` and read with `bookId ? inBook(ws, bookId) : ownerScope(ws)` (the book id goes in the query key). `EventDetailPage` holds `const [tab, setTab] = useState<string | null>(null)` and, when `books.length > 1`, draws a segmented control above the ring — "All" then one button per workspace — styled like the existing List/Table switcher. A tagged transfer belongs to no workspace, so it shows under every tab, exactly as it does in every workspace's Cashflow; the ring counts no transfers, so no figure double-counts.

- [ ] **Step 5: Write the flow** — in `workspaces.spec.ts`: tag one purchase in each workspace to an event, open it, see All's total, then Business's smaller ring and its single category.

- [ ] **Step 6: Run and commit**

```bash
git commit -am "$(cat <<'EOF'
feat: an event reads whole, or one workspace at a time

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 12: Whether a workspace's caps see an event

**Files:**
- Modify: `packages/core/src/budget/sheet.ts`, `packages/core/test/budget-sheet.test.ts`
- Modify: `packages/db/src/repos/budget-sheet.ts`
- Modify: `apps/web/src/features/transactions/SpendingReport.tsx`, `apps/web/src/features/budget/BudgetPage.tsx`
- Test: `packages/db/test/book-events.test.ts`

**Interfaces:**
- Produces: `BudgetSheetInput.eventsInCaps: boolean`; `budgetSheetFor` reading the open workspace's `count_events_in_budget`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/budget-sheet.test.ts (append)
describe('a workspace that counts its events', () => {
  const base = {
    month: '2026-08',
    categories: [{ id: 'c1', parentId: null, name: 'Restaurants' }],
    amounts: [{ accountId: 'c1', amountBaseMinor: 1_000_000 }],
    caps: [{ categoryId: 'c1', amountMinor: 2_000_000 }],
    incomePlanMinor: 10_000_000,
    incomeActualMinor: 10_000_000,
    debtPaymentsPlanMinor: 0,
    debtPaymentsActualMinor: 0,
    savings: [],
    eventSpendingMinor: 400_000,
  };

  it('subtracts event spending once when the caps do not see it', () => {
    const sheet = budgetSheet({ ...base, eventsInCaps: false });
    expect(sheet.leftOverActualMinor).toBe(10_000_000 - 1_000_000 - 400_000);
  });

  it('does not subtract it twice when the caps already contain it', () => {
    // The caller passed totals that include the event, so spendingActual is the whole 1.400.000.
    const sheet = budgetSheet({ ...base, amounts: [{ accountId: 'c1', amountBaseMinor: 1_400_000 }], eventsInCaps: true });
    expect(sheet.spendingActualMinor).toBe(1_400_000);
    expect(sheet.eventSpendingMinor).toBe(400_000);
    expect(sheet.leftOverActualMinor).toBe(10_000_000 - 1_400_000);
  });
});
```

```ts
// packages/db/test/book-events.test.ts (append)
  it('keeps a holiday out of Personal’s caps and inside Business’s', async () => {
    // one event-tagged purchase in each workspace, Business created with countEventsInBudget: true
    const personalSheet = await budgetSheetFor(database, inBook(ws, personal), '2026-08');
    const businessSheet = await budgetSheetFor(database, inBook(ws, business), '2026-08');
    expect(personalSheet.spendingActualMinor).toBe(0);
    expect(personalSheet.eventSpendingMinor).toBe(11_200_000);
    expect(businessSheet.spendingActualMinor).toBe(640_000);
    expect(businessSheet.leftOverActualMinor).toBe(businessSheet.incomeActualMinor - 640_000);
  });
```

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement**

Core: `eventsInCaps: boolean` on `BudgetSheetInput` (required, so no caller can forget it), and

```ts
    leftOverActualMinor:
      input.incomeActualMinor -
      spendingActualMinor -
      // When the workspace counts its events, they are already inside spendingActual: subtracting again would
      // charge the month for the same dinner twice.
      (input.eventsInCaps ? 0 : input.eventSpendingMinor) -
      input.debtPaymentsActualMinor -
      savingsActualMinor,
```

DB: `budgetSheetFor` reads the open book (`ws.bookId` → `listBooks`/`bookOf`, defaulting `countEventsInBudget` to `false` when no book is open), passes `excludeEvents: !countEvents` to `categoryTotalsIn` and `eventsInCaps: countEvents` to `budgetSheet`, and still reports `eventSpendingMinor`.

Web: `SpendingReport`'s totals query passes `excludeEvents: !(useOpenBook()?.countEventsInBudget ?? false)` and puts the flag in its query key, so the chart and the budget never disagree about what the month cost; `BudgetPage` labels the event line "included in the caps above" when the flag is on.

- [ ] **Step 4: Run and commit**

```bash
git commit -am "$(cat <<'EOF'
feat: a workspace decides whether its caps see an event

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 13: A card's rows say which workspace they were filed in

**Files:**
- Modify: `apps/web/src/features/cards/StatementPanel.tsx`, `apps/web/src/features/cards/PurchaseList.tsx`
- Test: `apps/web/e2e/workspaces.spec.ts`

**Interfaces:**
- Consumes: `useWorkspaceBadges` from Task 4. No figure on any card screen changes.

- [ ] **Step 1: Implement**

In `StatementPanel`, `const badgeOf = useWorkspaceBadges(lines.map((line) => line.transactionId));` and `<WorkspaceBadge book={badgeOf(line.transactionId)} />` beside `{line.description}` in both places it is drawn (the plain row and the payable row's label). In `PurchaseList`, the same against each purchase row. A card payment, an instalment row and anything filed in no workspace get nothing, because `bookNamesOf` says nothing about them; with one workspace the hook returns `null` for everything, so no badge is drawn at all.

- [ ] **Step 2: Write the flow** — in `workspaces.spec.ts`: with two workspaces and a purchase in each on the same card, the statement lists both, its total is the sum of both, and each row carries its workspace's name. The total is the point: the badge is a label, not a filter.

- [ ] **Step 3: Run** — `cd apps/web && npx playwright test --workers=2`, and the card suites in `npm test`.

- [ ] **Step 4: Commit**

```bash
git commit -am "$(cat <<'EOF'
feat(web): a card's purchases say which workspace each was filed in

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 14: A transfer belongs to no workspace, so it shows in all of them

**Files:**
- Test only: `packages/db/test/book-events.test.ts`, `apps/web/e2e/phone-workspaces.spec.ts`

**Interfaces:**
- Consumes: today's `listTransactions` rule. This task adds no behaviour; it pins the one that is easiest to break later.

- [ ] **Step 1: Write the tests**

```ts
  it('shows a transfer in every workspace and counts it in none', async () => {
    const { database, ws, personal, business } = await copy();
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const pot = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR' });
    await postTransaction(database, ws, {
      occurredOn: '2026-09-11',
      description: 'Top up',
      lines: [
        { accountId: pot.id, amountMinor: 500_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -500_000, currency: 'IDR' },
      ],
    });
    for (const bookId of [personal, business]) {
      expect((await listTransactions(database, inBook(ws, bookId))).map((t) => t.description)).toContain('Top up');
      expect(await categoryTotalsBetween(database, inBook(ws, bookId), 'expense', '2026-09-01', '2026-09-30')).toEqual([]);
    }
  });
```

And in `phone-workspaces.spec.ts`: record a transfer in one workspace, switch through ⋯ → Workspaces, and find the same transfer on the list with the chart still reading nothing.

- [ ] **Step 2: Run** — `npm test && cd apps/web && npx playwright test --workers=2`. Expected: PASS without touching product code; if either fails, that is the bug this task exists to catch.

- [ ] **Step 3: Commit**

```bash
git commit -am "$(cat <<'EOF'
test: a transfer shows in every workspace and counts in none

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done when

- `npm run typecheck`, `npm test` and `npx playwright test --workers=2` are green, `books-sample.test.ts` unchanged.
- A second workspace can be made, switched to, renamed, given its own currency and archived, from a phone and from a wide screen.
- An account's history and a card's statement hold every workspace and say which; their totals still match the bank.
- An event reads whole or one workspace at a time; a workspace's caps see its events only when it says so.
- With one workspace, nothing on screen differs from before this branch: no badge, no banner, and the same figures.
