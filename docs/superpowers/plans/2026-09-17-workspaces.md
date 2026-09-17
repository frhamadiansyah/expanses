# Workspaces (books under the owner) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one person keep several sets of books (Personal, Business, Family) that share their accounts, cards, points, loans, goals, events and net worth, recording each purchase once.

**Architecture:** Today's `workspaces` row stays the owner scope and every owner-level query stays as it is. A new `books` table sits beneath it; membership tables attach categories, transactions and category sets to a book. `WorkspaceContext` gains an optional `bookId`: book-scoped repositories narrow by it when it is present and behave exactly as today when it is absent, so steps 1–2 change nothing a single-book user can see.

**Tech Stack:** TypeScript monorepo — `packages/core` (pure), `packages/db` (Drizzle over sqlite-proxy, SQL migrations as `?raw` imports), `apps/web` (React 19, TanStack Router/Query, Tailwind 4); Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-workspaces-design.md` (approved 2026-09-17)

## Global Constraints

- Branch `feat/workspaces`. Commit per task; merge and push only when the user asks.
- No data loss: migration 0042 is additive only. Old tables (`budget_settings`, `budget_income_overrides`) stay and keep their rows.
- Never add a column to `accounts` or `transactions` (the ORM names every known column on insert; see migration 0028's comment). Books attach through membership tables.
- `WorkspaceContext.bookId` is optional. With it absent, every repository returns exactly what it returns today.
- Owner-level code (cards, statements, points, loans, goals, events, net worth, tax, imports) is not touched in steps 1–2.
- In the product the word is **workspace**; `book` is the name in code only.
- Country-neutral: no hard-coded category lists per kind. A new book starts empty or copies another book's categories.
- Desktop stays first-class; nothing here removes a desktop control.
- Test snippets name real functions, but their input objects (`saveBudget`, `saveExpenseTemplate`, `createAccount`, `postTransaction`) are written from memory: read each function's input type before writing the test and match it.
- Gate before every commit: `npm run typecheck`, `npm test` (root), `npx playwright test` (in `apps/web`).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/db/migrations/0042_books.sql` | `books` and the five membership tables, backfilled to a Personal book |
| `packages/db/src/schema-books.ts` | Drizzle tables for the above |
| `packages/db/src/migrations.ts` | register 0042 |
| `packages/db/src/context.ts` | `WorkspaceContext.bookId?` and `inBook(ws, bookId)` |
| `packages/db/src/repos/books.ts` | list, create, rename, archive books; active book; book lookups used by other repos |
| `packages/db/src/repos/workspaces.ts` | `createWorkspace` also creates the Personal book and files its seeded categories |
| `packages/db/src/repos/accounts.ts` | new categories are filed into `ws.bookId`'s book (or the Personal book) |
| `packages/db/src/repos/ledger.ts` | posting files the transaction into its categories' book; refuses two books; `listTransactions({ bookId })` |
| `packages/db/src/repos/reports.ts` | `categoryTotalsBetween` narrows to the book's categories |
| `packages/db/src/repos/budgets.ts`, `budget-sheet.ts`, `budget-settings.ts` | budgets and expected income per book |
| `packages/db/src/repos/expense-templates.ts` | bills narrowed to the book's categories |
| `packages/db/src/repos/category-sets.ts` | sets filed into a book |
| `packages/db/test/books.test.ts` | books repo, posting rule, scoping |
| `packages/db/test/books-migration.test.ts` | 0042 on a version-41 database |
| `packages/db/test/books-sample.test.ts` | the sample household reads identically with and without its Personal book |
| `apps/web/src/db/bootstrap.ts` | open the active book into `ws` |

---

## Step 1 — Books underneath

### Task 1: Migration 0042 and its tables

**Files:**
- Create: `packages/db/migrations/0042_books.sql`
- Create: `packages/db/src/schema-books.ts`
- Modify: `packages/db/src/migrations.ts` (import and `MIGRATIONS` entry)
- Test: `packages/db/test/books-migration.test.ts`

**Interfaces:**
- Produces: tables `books`, `book_categories`, `book_transactions`, `book_category_sets`, `book_budget_settings`, `book_income_overrides`; Drizzle exports `books`, `bookCategories`, `bookTransactions`, `bookCategorySets`, `bookBudgetSettings`, `bookIncomeOverrides` from `schema-books.ts`.

- [ ] **Step 1: Write the failing migration test**

```ts
// packages/db/test/books-migration.test.ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, createDatabase, createWorkspace, migrate, MIGRATIONS, postTransaction } from '../src/index';
import { createNodeExecutor } from '../src/node';

const rows = async (database: ReturnType<typeof createDatabase>, query: string) => database.db.values<unknown[]>(sql.raw(query));

describe('migration 0042', () => {
  it('is version 42 and named books', () => {
    expect(MIGRATIONS.find((m) => m.version === 42)).toMatchObject({ name: 'books' });
  });

  it('files everything a version 41 database holds into a Personal book, changing no figure', async () => {
    const older = createDatabase(createNodeExecutor());
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 41));
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(older, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const savings = await createAccount(older, ws, { name: 'Jenius', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const [food] = await rows(older, `SELECT id FROM accounts WHERE kind = 'expense' AND system_key = 'food_beverage' AND workspace_id = '${ws.workspaceId}'`);
    const spend = await postTransaction(older, ws, {
      occurredOn: '2026-09-10',
      description: 'Warung',
      lines: [
        { accountId: String(food![0]), amountMinor: 85_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -85_000, currency: 'IDR' },
      ],
    });
    const move = await postTransaction(older, ws, {
      occurredOn: '2026-09-11',
      description: 'Top up',
      lines: [
        { accountId: savings.id, amountMinor: 500_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -500_000, currency: 'IDR' },
      ],
    });
    await older.db.values(sql`INSERT INTO budget_settings (workspace_id, expected_income_minor, updated_at) VALUES (${ws.workspaceId}, 41500000, '2026-09-01T00:00:00.000Z')`);

    expect(await migrate(older)).toContain(42);

    const [book] = await rows(older, `SELECT id, name, kind, base_currency FROM books WHERE workspace_id = '${ws.workspaceId}'`);
    expect(book!.slice(1)).toEqual(['Personal', 'personal', 'IDR']);
    const bookId = String(book![0]);

    const [[categories]] = (await rows(older, `SELECT count(*) FROM book_categories WHERE book_id = '${bookId}'`)) as [[number]];
    const [[allCategories]] = (await rows(older, `SELECT count(*) FROM accounts WHERE kind IN ('income','expense') AND workspace_id = '${ws.workspaceId}'`)) as [[number]];
    expect(Number(categories)).toBe(Number(allCategories));

    // The purchase is filed in Personal; moving money between your own accounts is filed nowhere.
    expect(await rows(older, `SELECT transaction_id FROM book_transactions WHERE book_id = '${bookId}'`)).toEqual([[spend]]);
    expect(await rows(older, `SELECT transaction_id FROM book_transactions WHERE transaction_id = '${move}'`)).toEqual([]);

    expect(await rows(older, `SELECT expected_income_minor FROM book_budget_settings WHERE book_id = '${bookId}'`)).toEqual([[41500000]]);
    // The old table keeps its row.
    expect(await rows(older, `SELECT expected_income_minor FROM budget_settings`)).toEqual([[41500000]]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd packages/db && npx vitest run test/books-migration.test.ts`
Expected: FAIL — `MIGRATIONS.find(...)` is undefined for version 42.

- [ ] **Step 3: Write the migration**

```sql
-- packages/db/migrations/0042_books.sql
/* Books: separate sets of books under one owner.

   The workspace row stays what it has always been — everything a person owns: accounts, cards, points, loans,
   goals, events, net worth. A book is one set of books inside it (Personal, Business, Family) with its own
   categories, budgets, bills and Cashflow, paying from the owner's accounts.

   Books attach through membership tables, never new columns on accounts or transactions: the ORM names every
   column it knows on every insert, so a column there would break any database still stopped at an older version
   (the same reason category_set_members is its own table, 0028). */
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  count_events_in_budget INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX books_workspace ON books (workspace_id);

CREATE TABLE book_categories (
  category_account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  book_id TEXT NOT NULL
);
CREATE INDEX book_categories_book ON book_categories (book_id);

CREATE TABLE book_transactions (
  transaction_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  book_id TEXT NOT NULL
);
CREATE INDEX book_transactions_book ON book_transactions (book_id);

CREATE TABLE book_category_sets (
  set_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  book_id TEXT NOT NULL
);

CREATE TABLE book_budget_settings (
  book_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  expected_income_minor INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE book_income_overrides (
  book_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  month TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  PRIMARY KEY (book_id, month)
);

/* One Personal book per workspace. Its id is derived from the workspace id so the backfill below can name it
   without a lookup; new books get uuid v7 ids from the app. */
INSERT INTO books (id, workspace_id, name, kind, base_currency, count_events_in_budget, sort_order, created_at)
SELECT 'book-' || id, id, 'Personal', 'personal', base_currency, 0, 0, created_at FROM workspaces;

INSERT INTO book_categories (category_account_id, workspace_id, book_id)
SELECT id, workspace_id, 'book-' || workspace_id FROM accounts WHERE kind IN ('income', 'expense');

INSERT INTO book_transactions (transaction_id, workspace_id, book_id)
SELECT DISTINCT t.id, t.workspace_id, 'book-' || t.workspace_id
FROM transactions t JOIN entries e ON e.transaction_id = t.id JOIN accounts a ON a.id = e.account_id
WHERE a.kind IN ('income', 'expense');

INSERT INTO book_category_sets (set_id, workspace_id, book_id)
SELECT id, workspace_id, 'book-' || workspace_id FROM category_sets;

INSERT INTO book_budget_settings (book_id, workspace_id, expected_income_minor, updated_at)
SELECT 'book-' || workspace_id, workspace_id, expected_income_minor, updated_at FROM budget_settings;

INSERT INTO book_income_overrides (book_id, workspace_id, month, amount_minor)
SELECT 'book-' || workspace_id, workspace_id, month, amount_minor FROM budget_income_overrides;
```

```ts
// packages/db/src/schema-books.ts
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['personal', 'business', 'family', 'shared'] }).notNull(),
  baseCurrency: text('base_currency').notNull(),
  /** A default here matters: without one drizzle names the column and sends null. */
  countEventsInBudget: integer('count_events_in_budget').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
});

export const bookCategories = sqliteTable('book_categories', {
  categoryAccountId: text('category_account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  bookId: text('book_id').notNull(),
});

export const bookTransactions = sqliteTable('book_transactions', {
  transactionId: text('transaction_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  bookId: text('book_id').notNull(),
});

export const bookCategorySets = sqliteTable('book_category_sets', {
  setId: text('set_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  bookId: text('book_id').notNull(),
});

export const bookBudgetSettings = sqliteTable('book_budget_settings', {
  bookId: text('book_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  expectedIncomeMinor: integer('expected_income_minor').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const bookIncomeOverrides = sqliteTable(
  'book_income_overrides',
  {
    bookId: text('book_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    month: text('month').notNull(),
    amountMinor: integer('amount_minor').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.month] })],
);
```

In `packages/db/src/migrations.ts` add `import books from '../migrations/0042_books.sql?raw';` after the 0041 import, and `{ version: 42, name: 'books', sql: books },` after the version 41 entry.

- [ ] **Step 4: Run the test and see it pass**

Run: `cd packages/db && npx vitest run test/books-migration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole db suite**

Run: `cd packages/db && npx vitest run`
Expected: all pass (nothing reads the new tables yet).

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0042_books.sql packages/db/src/schema-books.ts packages/db/src/migrations.ts packages/db/test/books-migration.test.ts
git commit -m "feat(db): books under the workspace, backfilled to Personal (migration 0042)"
```

### Task 2: Books repository, book in the context, Personal book for new workspaces

**Files:**
- Create: `packages/db/src/repos/books.ts`
- Modify: `packages/db/src/context.ts`, `packages/db/src/repos/workspaces.ts`, `packages/db/src/repos/accounts.ts` (`createAccountTx`), `packages/db/src/index.ts`
- Test: `packages/db/test/books.test.ts`

**Interfaces:**
- Consumes: Task 1 tables.
- Produces:
  - `interface WorkspaceContext { workspaceId: string; baseCurrency: string; bookId?: string }`
  - `inBook(ws: WorkspaceContext, bookId: string): WorkspaceContext`
  - `type BookKind = 'personal' | 'business' | 'family' | 'shared'`
  - `interface BookRow { id: string; name: string; kind: BookKind; baseCurrency: string; countEventsInBudget: boolean; archivedAt: string | null }`
  - `listBooks(database, ws): Promise<BookRow[]>` (not archived, by sort order then creation)
  - `personalBook(database, ws): Promise<BookRow>` (the first book; every workspace has one)
  - `createBook(database, ws, input: { name: string; kind: BookKind; baseCurrency: string; countEventsInBudget?: boolean; copyCategoriesFrom?: string | null }): Promise<string>`
  - `renameBook(database, ws, bookId: string, name: string): Promise<void>`
  - `archiveBook(database, ws, bookId: string): Promise<void>` — refuses the last unarchived book
  - `activeBookId(database, ws): Promise<string>` and `setActiveBook(database, ws, bookId: string): Promise<void>` (settings key `active_book:<workspaceId>`)
  - `bookOfCategory(tx: Db, categoryAccountId: string): Promise<string | null>`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/books.test.ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { activeBookId, archiveBook, createAccount, createBook, inBook, listAccounts, listBooks, personalBook, renameBook, setActiveBook } from '../src/index';
import { setupDb } from './helpers';

describe('books', () => {
  it('gives every new workspace a Personal book holding its categories', async () => {
    const { database, ws } = await setupDb();
    const [personal, ...rest] = await listBooks(database, ws);
    expect(personal).toMatchObject({ name: 'Personal', kind: 'personal', baseCurrency: 'IDR', countEventsInBudget: false });
    expect(rest).toEqual([]);
    const categories = (await listAccounts(database, ws)).filter((a) => a.kind === 'expense' || a.kind === 'income');
    const [[filed]] = (await database.db.values<[number]>(sql`SELECT count(*) FROM book_categories WHERE book_id = ${personal!.id}`)) as [[number]];
    expect(Number(filed)).toBe(categories.length);
  });

  it('starts a new book empty, or with a copy of another book’s categories', async () => {
    const { database, ws } = await setupDb();
    const personal = await personalBook(database, ws);
    const empty = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', countEventsInBudget: true });
    const copied = await createBook(database, ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });

    const count = async (bookId: string) =>
      Number(((await database.db.values<[number]>(sql`SELECT count(*) FROM book_categories WHERE book_id = ${bookId}`)) as [[number]])[0][0]);
    expect(await count(empty)).toBe(0);
    expect(await count(copied)).toBe(await count(personal.id));

    // A copy is a new category, keeping its system key so card earning rules still recognise it.
    const keys = async (bookId: string) =>
      (await database.db.values<[string | null]>(sql`SELECT a.system_key FROM accounts a JOIN book_categories b ON b.category_account_id = a.id WHERE b.book_id = ${bookId} ORDER BY a.system_key`)).map((r) => r[0]);
    expect(await keys(copied)).toEqual(await keys(personal.id));
    expect((await listBooks(database, ws)).find((b) => b.id === empty)).toMatchObject({ countEventsInBudget: true });
  });

  it('files a new category into the book the context names', async () => {
    const { database, ws } = await setupDb();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const software = await createAccount(database, inBook(ws, business), { name: 'Software', kind: 'expense', subtype: 'category', currency: null });
    expect(await database.db.values(sql`SELECT book_id FROM book_categories WHERE category_account_id = ${software.id}`)).toEqual([[business]]);
    // No book named: the Personal book, as every category has always been.
    const other = await createAccount(database, ws, { name: 'Pets', kind: 'expense', subtype: 'category', currency: null });
    expect(await database.db.values(sql`SELECT book_id FROM book_categories WHERE category_account_id = ${other.id}`)).toEqual([[(await personalBook(database, ws)).id]]);
  });

  it('renames, archives, and remembers which book was open', async () => {
    const { database, ws } = await setupDb();
    const personal = await personalBook(database, ws);
    expect(await activeBookId(database, ws)).toBe(personal.id);
    const business = await createBook(database, ws, { name: 'Biz', kind: 'business', baseCurrency: 'IDR' });
    await renameBook(database, ws, business, 'Business');
    await setActiveBook(database, ws, business);
    expect(await activeBookId(database, ws)).toBe(business);

    await archiveBook(database, ws, business);
    expect((await listBooks(database, ws)).map((b) => b.name)).toEqual(['Personal']);
    // An archived book is no longer open; the app falls back to Personal.
    expect(await activeBookId(database, ws)).toBe(personal.id);
    await expect(archiveBook(database, ws, personal.id)).rejects.toThrow(/last/);
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `cd packages/db && npx vitest run test/books.test.ts`
Expected: FAIL — `createBook` is not exported.

- [ ] **Step 3: Implement**

`packages/db/src/context.ts`:

```ts
export interface WorkspaceContext {
  workspaceId: string;
  baseCurrency: string;
  /**
   * The set of books being read or written, when there is more than one. Absent, book-scoped queries read the whole
   * workspace, exactly as before books existed — which is what every owner-level query does regardless.
   */
  bookId?: string;
}

export const inBook = (ws: WorkspaceContext, bookId: string): WorkspaceContext => ({ ...ws, bookId });
```

`packages/db/src/repos/books.ts`:

```ts
import { uuidv7 } from '@expanses/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, settings } from '../schema';
import { bookCategories, books } from '../schema-books';

export type BookKind = 'personal' | 'business' | 'family' | 'shared';

export interface BookRow {
  id: string;
  name: string;
  kind: BookKind;
  baseCurrency: string;
  countEventsInBudget: boolean;
  archivedAt: string | null;
}

export class BookError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BookError';
  }
}

const toRow = (row: typeof books.$inferSelect): BookRow => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  baseCurrency: row.baseCurrency,
  countEventsInBudget: row.countEventsInBudget === 1,
  archivedAt: row.archivedAt,
});

export async function listBooks(database: Database, ws: WorkspaceContext): Promise<BookRow[]> {
  const rows = await database.db
    .select()
    .from(books)
    .where(and(eq(books.workspaceId, ws.workspaceId), isNull(books.archivedAt)))
    .orderBy(asc(books.sortOrder), asc(books.createdAt));
  return rows.map(toRow);
}

/** The first book: every workspace has one, made with it or by migration 0042. */
export async function personalBook(database: Database, ws: WorkspaceContext): Promise<BookRow> {
  const [first] = await listBooks(database, ws);
  if (!first) throw new BookError('NO_BOOK', 'This workspace has no books');
  return first;
}

/** Makes the Personal book for a workspace being created. Used inside createWorkspace's transaction. */
export async function createPersonalBookTx(tx: Db, workspaceId: string, baseCurrency: string, createdAt: string): Promise<string> {
  const id = uuidv7();
  await tx.insert(books).values({ id, workspaceId, name: 'Personal', kind: 'personal', baseCurrency, countEventsInBudget: 0, sortOrder: 0, archivedAt: null, createdAt });
  return id;
}

export async function bookOfCategory(tx: Db, categoryAccountId: string): Promise<string | null> {
  const [row] = await tx.select({ bookId: bookCategories.bookId }).from(bookCategories).where(eq(bookCategories.categoryAccountId, categoryAccountId));
  return row?.bookId ?? null;
}

export async function createBook(
  database: Database,
  ws: WorkspaceContext,
  input: { name: string; kind: BookKind; baseCurrency: string; countEventsInBudget?: boolean; copyCategoriesFrom?: string | null },
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new BookError('NAME_REQUIRED', 'A workspace needs a name');
  const id = uuidv7();
  const now = new Date().toISOString();
  const [{ count }] = (await database.db.select({ count: sql<number>`count(*)` }).from(books).where(eq(books.workspaceId, ws.workspaceId))) as [{ count: number }];

  await database.transaction(async (tx) => {
    await tx.insert(books).values({
      id,
      workspaceId: ws.workspaceId,
      name,
      kind: input.kind,
      baseCurrency: input.baseCurrency,
      countEventsInBudget: input.countEventsInBudget ? 1 : 0,
      sortOrder: Number(count),
      archivedAt: null,
      createdAt: now,
    });
    if (!input.copyCategoriesFrom) return;

    // A copy is a new tree: new ids, parents remapped, system keys kept so card earning rules still apply.
    const source = await tx
      .select()
      .from(accounts)
      .innerJoin(bookCategories, eq(bookCategories.categoryAccountId, accounts.id))
      .where(and(eq(bookCategories.bookId, input.copyCategoriesFrom), isNull(accounts.archivedAt)));
    const newIds = new Map(source.map(({ accounts: a }) => [a.id, uuidv7()]));
    for (const { accounts: a } of source) {
      await tx.insert(accounts).values({ ...a, id: newIds.get(a.id)!, parentId: a.parentId ? (newIds.get(a.parentId) ?? null) : null, createdAt: now });
      await tx.insert(bookCategories).values({ categoryAccountId: newIds.get(a.id)!, workspaceId: ws.workspaceId, bookId: id });
    }
  });
  return id;
}

export async function renameBook(database: Database, ws: WorkspaceContext, bookId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new BookError('NAME_REQUIRED', 'A workspace needs a name');
  await database.db.update(books).set({ name: trimmed }).where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, bookId)));
}

export async function archiveBook(database: Database, ws: WorkspaceContext, bookId: string): Promise<void> {
  const open = await listBooks(database, ws);
  if (open.length <= 1) throw new BookError('LAST_BOOK', 'The last workspace cannot be archived');
  await database.db.update(books).set({ archivedAt: new Date().toISOString() }).where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, bookId)));
}

const activeKey = (ws: WorkspaceContext) => `active_book:${ws.workspaceId}`;

/** The book the app last had open, or Personal when it was never set or has since been archived. */
export async function activeBookId(database: Database, ws: WorkspaceContext): Promise<string> {
  const open = await listBooks(database, ws);
  const [row] = await database.db.select({ value: settings.value }).from(settings).where(eq(settings.key, activeKey(ws)));
  const remembered = open.find((book) => book.id === row?.value);
  return (remembered ?? open[0])!.id;
}

export async function setActiveBook(database: Database, ws: WorkspaceContext, bookId: string): Promise<void> {
  await database.db.insert(settings).values({ key: activeKey(ws), value: bookId }).onConflictDoUpdate({ target: settings.key, set: { value: bookId } });
}

/** Category ids filed in a book, for narrowing owner-wide queries to it. */
export async function categoryIdsOfBook(database: Database | { db: Db }, bookId: string): Promise<string[]> {
  const rows = await database.db.select({ id: bookCategories.categoryAccountId }).from(bookCategories).where(eq(bookCategories.bookId, bookId));
  return rows.map((row) => row.id);
}

```

`packages/db/src/repos/workspaces.ts` — inside `createWorkspace`'s transaction, after inserting `accounts`:

```ts
    const bookId = await createPersonalBookTx(tx, id, input.baseCurrency, now);
    const categoryRows = rows.filter((row) => row.kind === 'income' || row.kind === 'expense');
    if (categoryRows.length) {
      await tx.insert(bookCategories).values(categoryRows.map((row) => ({ categoryAccountId: row.id!, workspaceId: id, bookId })));
    }
```

`packages/db/src/repos/accounts.ts` — in `createAccountTx`, after the account insert, for `input.kind === 'income' || input.kind === 'expense'`:

```ts
    // A category belongs to a set of books: the one the context names, or the workspace's first (Personal).
    const bookId =
      ws.bookId ??
      (await tx.select({ id: books.id }).from(books).where(and(eq(books.workspaceId, ws.workspaceId), isNull(books.archivedAt))).orderBy(asc(books.sortOrder), asc(books.createdAt)).limit(1))[0]?.id;
    if (bookId) await tx.insert(bookCategories).values({ categoryAccountId: row.id, workspaceId: ws.workspaceId, bookId });
```

`packages/db/src/index.ts`: `export { inBook, type WorkspaceContext } from './context';` (keep the existing context export form) and `export * from './repos/books';`.

- [ ] **Step 4: Run and see them pass**

Run: `cd packages/db && npx vitest run test/books.test.ts test/books-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole gate**

Run: `npm run typecheck && npm test`
Expected: all pass. Migration tests that stop at older versions still pass because nothing inserts into book tables unless they exist — if one fails with "no such table: books", guard `createPersonalBookTx` and the `createAccountTx` insert behind a check that `books` exists (`SELECT 1 FROM sqlite_master WHERE name = 'books'`), and note it in a comment.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src packages/db/test/books.test.ts
git commit -m "feat(db): books repository, and the book a context names"
```

### Task 3: The sample household reads the same through its Personal book

**Files:**
- Test: `packages/db/test/books-sample.test.ts`

**Interfaces:**
- Consumes: `seedSampleData`, `personalBook`, `inBook`, `nativeBalances`, `categoryTotalsBetween`, `budgetSheetFor`, `listPrograms`, `programBalance`, `checkLedgerIntegrity`.
- Produces: a guard later tasks must keep green — for a one-book workspace, every figure read with `inBook(ws, personal)` equals the same figure read with `ws`.

- [ ] **Step 1: Write the test**

```ts
// packages/db/test/books-sample.test.ts
import { addMonths, isoDate, monthOf, monthRange } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { budgetSheetFor, categoryTotalsBetween, checkLedgerIntegrity, inBook, listPrograms, listTransactions, nativeBalances, personalBook, programBalance } from '../src/index';
import { setupDb, type TestDb } from './helpers';
import { seedSampleData } from './sample/seed';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

describe('one book changes nothing', () => {
  it('reads every figure of the sample household identically with and without its Personal book', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const today = process.env.SAMPLE_TODAY ?? isoDate();
    await seedSampleData(database, ws, today);
    const book = inBook(ws, (await personalBook(database, ws)).id);

    expect(await checkLedgerIntegrity(database, book)).toEqual([]);
    expect(await nativeBalances(database, book)).toEqual(await nativeBalances(database, ws));
    for (const program of await listPrograms(database, ws)) {
      expect(await programBalance(database, book, program.id, today)).toEqual(await programBalance(database, ws, program.id, today));
    }
    for (const offset of [0, -1, -2]) {
      const month = addMonths(monthOf(today), offset);
      const { from, to } = monthRange(month);
      for (const kind of ['expense', 'income'] as const) {
        expect(await categoryTotalsBetween(database, book, kind, from, to)).toEqual(await categoryTotalsBetween(database, ws, kind, from, to));
      }
      expect(await budgetSheetFor(database, book, month)).toEqual(await budgetSheetFor(database, ws, month));
    }
    expect((await listTransactions(database, book, { limit: 5000 })).map((t) => t.id)).toEqual((await listTransactions(database, ws, { limit: 5000 })).map((t) => t.id));
  }, 60_000);
});
```

- [ ] **Step 2: Run it**

Run: `cd packages/db && npx vitest run test/books-sample.test.ts`
Expected: PASS already (nothing narrows by book yet). It becomes the regression guard for Step 2's tasks.

- [ ] **Step 3: Commit**

```bash
git add packages/db/test/books-sample.test.ts
git commit -m "test(db): one book reads the sample household exactly as the workspace does"
```

### Task 4: The app opens its active book

**Files:**
- Modify: `apps/web/src/db/bootstrap.ts`

**Interfaces:**
- Consumes: `activeBookId`, `inBook`.
- Produces: `AppDb.ws.bookId` is always set in the running app.

- [ ] **Step 1: Implement**

In `openAppDb`, after `ensureDefaultCategorySets(database, ws)`:

```ts
  // The set of books last open, or Personal. Owner-level screens ignore it; book-scoped ones read it.
  const opened = inBook(ws, await activeBookId(database, ws));
```

and return `{ database, ws: opened, workspaceName: workspace!.name }`. Keep `syncLinkedPrograms` on `ws` (owner level).

- [ ] **Step 2: Run the web gate**

Run: `npm run typecheck && cd apps/web && npx playwright test`
Expected: all pass (one book, nothing narrows yet).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/db/bootstrap.ts
git commit -m "feat(web): open the active book"
```

---

## Step 2 — Scoped by book

Every task below keeps `books-sample.test.ts` green and adds a two-book test to `books.test.ts`.

### Task 5: Posting files a transaction into its categories' book

**Files:**
- Modify: `packages/db/src/repos/ledger.ts` (`postTransactionTx`, and the replace path if it re-posts)
- Test: `packages/db/test/books.test.ts`

**Interfaces:**
- Consumes: `bookOfCategory`.
- Produces: `LedgerError('TWO_BOOKS')`; every posted transaction touching a category has exactly one `book_transactions` row.

- [ ] **Step 1: Write the failing tests** (append to `books.test.ts`)

```ts
describe('posting into a book', () => {
  it('files spending into its category’s book and a transfer into none', async () => {
    const { database, ws } = await setupDb();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const meals = await createAccount(database, inBook(ws, business), { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });

    const dinner = await postTransaction(database, ws, {
      occurredOn: '2026-08-15',
      description: 'Supplier dinner',
      lines: [
        { accountId: meals.id, amountMinor: 640_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -640_000, currency: 'IDR' },
      ],
    });
    const payment = await postTransaction(database, ws, {
      occurredOn: '2026-08-20',
      description: 'Card bill',
      lines: [
        { accountId: card.id, amountMinor: 640_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -640_000, currency: 'IDR' },
      ],
    });
    expect(await database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${dinner}`)).toEqual([[business]]);
    expect(await database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${payment}`)).toEqual([]);
  });

  it('refuses one transaction spending in two books', async () => {
    const { database, ws } = await setupDb();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const meals = await createAccount(database, inBook(ws, business), { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });
    const pets = await createAccount(database, ws, { name: 'Pets', kind: 'expense', subtype: 'category', currency: null });
    await expect(
      postTransaction(database, ws, {
        occurredOn: '2026-08-15',
        description: 'Mixed',
        lines: [
          { accountId: meals.id, amountMinor: 100, currency: 'IDR' },
          { accountId: pets.id, amountMinor: 100, currency: 'IDR' },
          { accountId: card.id, amountMinor: -200, currency: 'IDR' },
        ],
      }),
    ).rejects.toThrow(/two workspaces/);
  });
});
```

(Add `postTransaction` to the file's import.)

- [ ] **Step 2: Run and see them fail**

Run: `cd packages/db && npx vitest run test/books.test.ts`
Expected: FAIL — no `book_transactions` row for the dinner.

- [ ] **Step 3: Implement** — in `postTransactionTx`, after the `entries` insert:

```ts
  // A transaction that spends or earns belongs to the book of its categories; one that only moves money between
  // your own accounts belongs to none. It may not straddle two books.
  const categoryIds = found.filter((a) => a.kind === 'income' || a.kind === 'expense').map((a) => a.id);
  const bookIds = new Set<string>();
  for (const categoryId of categoryIds) {
    const bookId = await bookOfCategory(tx, categoryId);
    if (bookId) bookIds.add(bookId);
  }
  if (bookIds.size > 1) throw new LedgerError('TWO_BOOKS', 'A transaction cannot spend in two workspaces at once');
  const [bookId] = [...bookIds];
  if (bookId) await tx.insert(bookTransactions).values({ transactionId: id, workspaceId: ws.workspaceId, bookId });
```

and widen the `found` select to include `kind: accounts.kind`. Place the two-books check before any insert (compute `bookIds` right after `found`) so a refused posting writes nothing.

- [ ] **Step 4: Run** — `cd packages/db && npx vitest run` → all pass, including `books-sample.test.ts`.

- [ ] **Step 5: Commit** — `git commit -am "feat(db): a transaction is filed in its categories' book"`

### Task 6: Categories, totals and category sets narrowed to the book

**Files:**
- Modify: `packages/db/src/repos/reports.ts` (`categoryTotalsBetween`), `packages/db/src/repos/category-sets.ts` (`listCategorySets`, `createCategorySet`)
- Modify: `apps/web/src/lib/queries.ts` (`useAccounts` or its consumers: categories shown are the book's)
- Test: `packages/db/test/books.test.ts`

**Interfaces:**
- Consumes: `categoryIdsOfBook`, `bookCategorySets`.
- Produces: with `ws.bookId`, `categoryTotalsBetween` returns only that book's categories; `listCategorySets` only that book's sets; `createCategorySet` files the set into `ws.bookId` (or Personal).

- [ ] **Step 1: Failing test**

```ts
describe('reading one book', () => {
  it('adds up only the open book’s categories', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const meals = await createAccount(database, inBook(ws, business), { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });
    const pets = await createAccount(database, ws, { name: 'Pets', kind: 'expense', subtype: 'category', currency: null });
    const spend = (categoryId: string, amountMinor: number) =>
      postTransaction(database, ws, { occurredOn: '2026-08-15', description: 'x', lines: [{ accountId: categoryId, amountMinor, currency: 'IDR' }, { accountId: card.id, amountMinor: -amountMinor, currency: 'IDR' }] });
    await spend(meals.id, 640_000);
    await spend(pets.id, 150_000);

    const ids = async (bookId?: string) => (await categoryTotalsBetween(database, bookId ? inBook(ws, bookId) : ws, 'expense', '2026-08-01', '2026-08-31')).map((r) => r.accountId).sort();
    expect(await ids(business)).toEqual([meals.id]);
    expect(await ids(personal)).toEqual([pets.id]);
    expect(await ids()).toEqual([meals.id, pets.id].sort());
  });
});
```

- [ ] **Step 2: Run** → FAIL (business sees both).

- [ ] **Step 3: Implement** — in `categoryTotalsBetween`, add to the `and(...)`:

```ts
        // Narrowed to one set of books when the context names one; the whole workspace otherwise.
        ...(ws.bookId ? [sql`${entries.accountId} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`] : []),
```

In `listCategorySets`, when `ws.bookId`, add `sql\`${categorySets.id} IN (SELECT set_id FROM book_category_sets WHERE book_id = ${ws.bookId})\``. In `createCategorySet`, insert `bookCategorySets` with `ws.bookId ?? (await personalBook(database, ws)).id` inside the same transaction.

In the web app, wherever categories are listed for picking or charting (`useAccounts` consumers that filter `kind === 'expense' | 'income'`), filter to the book: add `useBookCategoryIds()` in `apps/web/src/lib/queries.ts` (`useQuery(['book-categories', ws.bookId], () => categoryIdsOfBook(database, ws.bookId!))`) and apply it in `CategoryOptions`, `SpendingReport`'s `ofKind`, and the category picker. Money accounts are never filtered.

- [ ] **Step 4: Run** — db suite and `npx playwright test` → all pass.

- [ ] **Step 5: Commit** — `git commit -am "feat: categories, totals and sets read the open book"`

### Task 7: Budgets, expected income and bills per book

**Files:**
- Modify: `packages/db/src/repos/budgets.ts`, `budget-sheet.ts`, `budget-settings.ts`, `expense-templates.ts`
- Test: `packages/db/test/books.test.ts`

**Interfaces:**
- Produces: with `ws.bookId`: `listBudgets` and `budgetSheetFor` cover only budgets whose category is in the book; `saveExpectedIncome` / `getBudgetIncome` / `setIncomeOverride` / `clearIncomeOverride` read and write `book_budget_settings` / `book_income_overrides`; `listExpenseTemplates` and `monthlyBills` cover only bills whose category is in the book. Without `ws.bookId`, all behave as today.

- [ ] **Step 1: Failing test**

```ts
  it('keeps budgets, expected income and bills to their own book', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const software = await createAccount(database, inBook(ws, business), { name: 'Software', kind: 'expense', subtype: 'category', currency: null });
    const pets = await createAccount(database, ws, { name: 'Pets', kind: 'expense', subtype: 'category', currency: null });

    await saveBudget(database, inBook(ws, business), { categoryAccountId: software.id, amountMinor: 1_000_000 });
    await saveBudget(database, inBook(ws, personal), { categoryAccountId: pets.id, amountMinor: 500_000 });
    await saveExpectedIncome(database, inBook(ws, business), 20_000_000);
    await saveExpenseTemplate(database, inBook(ws, business), { name: 'Figma', categoryAccountId: software.id, moneyAccountId: bank.id, amountMinor: 260_000, dayOfMonth: 2 });

    expect((await listBudgets(database, inBook(ws, business), '2026-09')).map((b) => b.categoryAccountId)).toEqual([software.id]);
    expect((await getBudgetIncome(database, inBook(ws, business), '2026-09')).expectedMinor).toBe(20_000_000);
    expect((await getBudgetIncome(database, inBook(ws, personal), '2026-09')).expectedMinor).not.toBe(20_000_000);
    expect((await listExpenseTemplates(database, inBook(ws, business))).map((t) => t.name)).toEqual(['Figma']);
    expect(await listExpenseTemplates(database, inBook(ws, personal))).toEqual([]);
  });
```

(Before writing it, read `getBudgetIncome`'s return type in `budget-settings.ts` and use its real field name in place of `expectedMinor`.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — budgets and bills: when `ws.bookId`, add `sql\`${budgets.categoryAccountId} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})\`` (and the same on `expenseTemplates.categoryAccountId`). Budget settings: when `ws.bookId`, read and upsert `bookBudgetSettings` keyed by `bookId`, and `bookIncomeOverrides` keyed by `(bookId, month)`; otherwise the existing tables. `budgetSheetFor` already calls these, so it follows.

- [ ] **Step 4: Run** — db suite, `books-sample.test.ts` included → pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(db): budgets, expected income and bills per book"`

### Task 8: Cashflow's list: the book's transactions, plus transfers

**Files:**
- Modify: `packages/db/src/repos/ledger.ts` (`listTransactions`), `apps/web/src/features/transactions/TransactionsPage.tsx`
- Test: `packages/db/test/books.test.ts`

**Interfaces:**
- Produces: `listTransactions(database, ws, opts)` with `ws.bookId` returns transactions filed in that book **plus** transactions filed in no book (transfers, card payments), never another book's.

- [ ] **Step 1: Failing test**

```ts
  it('lists the book’s transactions and every transfer, never another book’s spending', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const meals = await createAccount(database, inBook(ws, business), { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });
    const post = (description: string, a: string, b: string) =>
      postTransaction(database, ws, { occurredOn: '2026-08-15', description, lines: [{ accountId: a, amountMinor: 1000, currency: 'IDR' }, { accountId: b, amountMinor: -1000, currency: 'IDR' }] });
    await post('Supplier dinner', meals.id, card.id);
    await post('Card bill', card.id, bank.id);

    const names = async (bookId: string) => (await listTransactions(database, inBook(ws, bookId))).map((t) => t.description).sort();
    expect(await names(business)).toEqual(['Card bill', 'Supplier dinner']);
    expect(await names(personal)).toEqual(['Card bill']);
  });
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — in `listTransactions`, when `ws.bookId`:

```ts
  // A book's list: what was filed in it, and what was filed nowhere — moving your own money shows in every book.
  if (ws.bookId) {
    conds.push(sql`${transactions.id} NOT IN (SELECT transaction_id FROM book_transactions WHERE book_id <> ${ws.bookId})`);
  }
```

`TransactionsPage` already passes `ws` from `useApp()`, which now carries `bookId`; no change beyond confirming the query key includes `ws.bookId` (add it to the `['transactions', ...]` key).

- [ ] **Step 4: Run the full gate** — `npm run typecheck && npm test && cd apps/web && npx playwright test` → all pass.

- [ ] **Step 5: Commit** — `git commit -am "feat: a book's list holds its transactions and every transfer"`

---

## Step 3 — Switching (outline; detail in a follow-up plan)

- **Task 9:** `⋯` on Cashflow lists the open workspace first (name, "Workspace ›"), above Not recorded / Paid with / Show deleted; tapping opens a sheet of `listBooks` with this month's spend per book (`categoryTotalsBetween` per book, expense) and "+ New workspace". Choosing calls `setActiveBook` and reloads the app context (invalidate all queries with the new `ws`). Phone test: switch to a second book and see its empty chart.
- **Task 10:** New workspace sheet: name, kind (Personal / Business / Family / Shared), base currency, categories (Start empty / Copy from …), "Count event spending in this workspace's monthly budget". Calls `createBook` then `setActiveBook`.
- **Task 11:** Settings → Workspaces: rename, archive (`archiveBook`), base currency per workspace, and your own base currency. Book base currency conversion: Cashflow, budgets and bills convert each amount from the owner base into the book base at the rate on its date (`fx_rates`); owner-level screens untouched. Core helper + tests for the conversion.

## Step 4 — Across workspaces (outline)

- **Task 12:** Event screen switch: All, then one tab per book that has spending in the event (book via `book_transactions`); ring, plan and history narrowed by tab.
- **Task 13:** `count_events_in_budget`: `categoryTotalsBetween(..., { excludeEvents })` and `budgetSheetFor` exclude event-tagged spending only when the book's flag is 0.
- **Task 14:** Card statement rows carry a workspace badge (join `book_transactions` → `books.name`); only shown when more than one book exists.

## Step 5 — Recording (outline)

- **Task 15:** Add Transaction Option B rebuild (its own plan): workspace row on Expense and Income (default the open book; changing it reloads the category list), none on Transfer and Buy / sell; Event under Add more details (B3); flag currency picker with "Charged in" row (C1–C3); Money Lover category picker with New category filed into the chosen book (B7, B7a).
