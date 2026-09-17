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
