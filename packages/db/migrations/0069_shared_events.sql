/* Shared events (shared events spec §3, §5). A trip several people record into is a relay book of its own: a
   shared_books row with no books row, as the net-worth group log is. Its seven synced tables are keyed by that book's
   local id (book_id), which apply writes on insert and which never travels; each record's own id is `id`, so a
   deleted category or plan item is gone for good on every phone (sync rule 3).

   The four local tables never sync: which event books this phone holds and its trip-balance account (event_books), the
   transaction each record put in this phone's own books and the account it was paid from (event_postings), this
   phone's own copy of each event category (event_category_accounts), and the currency lock in log order
   (event_log_currency, ruling R8).

   The trip balance is an asset with a subtype of its own, event_balance: 0001 wrote the subtypes as a CHECK, and SQLite
   cannot alter a CHECK, so the accounts table is rebuilt exactly as 0047 rebuilt it — same columns, same defaults,
   same indexes, foreign keys deferred and the table recreated under its own name — with one more subtype. */

CREATE TABLE shared_events (
  book_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  /* Chosen at creation, fixed after the first expense (D5, ruling R8). */
  currency TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE event_people (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  /* NULL: a person without the app. Otherwise equal to id: the member who claimed this name (ruling R1). */
  member_id TEXT,
  removed_at TEXT,
  PRIMARY KEY (book_id, id)
);

CREATE TABLE event_categories (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  PRIMARY KEY (book_id, id)
);

/* The money of an expense: only its payer's member writes it, when the payer has one (D8, ruling R2). */
CREATE TABLE event_expenses (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  /* Units of the event currency per one unit of `currency`, a decimal string; '1' in the event currency. */
  rate_to_event TEXT NOT NULL,
  payer_person_id TEXT NOT NULL,
  /* NULL: paid outside the app or recorded on someone's behalf; else equal to payer_person_id (ruling R2). */
  payer_member_id TEXT,
  voided_at TEXT,
  PRIMARY KEY (book_id, id)
);

/* The rest of an expense, under the same id: anyone writes it. */
CREATE TABLE event_expense_details (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  note TEXT,
  category_id TEXT,
  split_mode TEXT NOT NULL CHECK (split_mode IN ('equal', 'amounts')),
  split_json TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (book_id, id)
);

CREATE TABLE event_settlements (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  from_person_id TEXT NOT NULL,
  to_person_id TEXT NOT NULL,
  from_member_id TEXT,
  to_member_id TEXT,
  /* In the event currency. */
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  voided_at TEXT,
  PRIMARY KEY (book_id, id)
);

/* The shared plan (D7): one thing to buy, its estimate in the event currency, and the expense that answered it. */
CREATE TABLE event_items_shared (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_minor INTEGER NOT NULL,
  category_id TEXT,
  link TEXT,
  note TEXT,
  expense_id TEXT,
  share_minor INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, id)
);

/* Local only, never synced. */
CREATE TABLE event_books (
  book_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  balance_account_id TEXT NOT NULL
);

CREATE TABLE event_postings (
  book_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'settlement')),
  /* The derived transaction, posted or void; NULL while nothing has been posted. */
  transaction_id TEXT,
  /* The account this person paid from or received into, and its own-currency figure (ruling R5). */
  account_id TEXT,
  account_amount_minor INTEGER,
  /* Why nothing is posted now: 'choose-account', 'no-rate' or 'malformed'. NULL when posted (or nothing to post). */
  unposted TEXT,
  /* The member whose change last replaced the derived transaction, when not this phone's own: "Changed by Andi". */
  changed_by TEXT,
  PRIMARY KEY (book_id, record_id)
);
CREATE INDEX event_postings_transaction ON event_postings (transaction_id);

CREATE TABLE event_category_accounts (
  book_id TEXT NOT NULL,
  /* '' stands for an expense with no category. */
  category_id TEXT NOT NULL,
  account_id TEXT NOT NULL UNIQUE,
  /* The workspace category a card earns by on these purchases (ruling R12), when there is one. */
  earn_category_id TEXT,
  PRIMARY KEY (book_id, category_id)
);

CREATE TABLE event_log_currency (
  book_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0
);

PRAGMA defer_foreign_keys = ON;

CREATE TABLE accounts_rebuild_0069 AS SELECT * FROM accounts;

DROP TABLE accounts;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  parent_id TEXT REFERENCES accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability', 'income', 'expense', 'equity')),
  subtype TEXT NOT NULL CHECK (subtype IN ('cash', 'bank', 'credit_card', 'savings', 'fund', 'ewallet', 'time_deposit',
    'other_cash', 'investment', 'property', 'vehicle', 'receivable', 'payable', 'loan', 'category', 'equity', 'event_balance')),
  name TEXT NOT NULL,
  icon TEXT,
  currency TEXT,
  valuation_mode TEXT NOT NULL DEFAULT 'derived' CHECK (valuation_mode IN ('derived', 'snapshot', 'market')),
  system_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (kind IN ('income', 'expense', 'equity') OR currency IS NOT NULL)
);

INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode,
  system_key, sort_order, archived_at, created_at)
SELECT id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode,
  system_key, sort_order, archived_at, created_at FROM accounts_rebuild_0069;

DROP TABLE accounts_rebuild_0069;

CREATE INDEX accounts_workspace_kind ON accounts (workspace_id, kind);
CREATE UNIQUE INDEX accounts_system_key ON accounts (workspace_id, system_key)
  WHERE system_key IS NOT NULL AND kind NOT IN ('income', 'expense');
