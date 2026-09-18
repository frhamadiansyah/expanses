/* Two more kinds of account that hold money. A time deposit (a deposito) holds money it cannot be paid
   from: the bank keeps it until it matures, so it is never offered as a source or a destination, and the
   money leaves it by a transfer on the day it comes back. Other cash equivalents are the rest of what a
   tax return files under kas: a cheque, a wesel, commercial paper — held, and spendable like cash.

   0001 wrote the list of subtypes as a CHECK, and SQLite cannot alter a CHECK, so the table is rebuilt: every
   row aside, the table dropped, a new one created with the wider CHECK and the same columns and defaults, the
   rows back, and both of 0001's indexes recreated — accounts_system_key in the narrowed form 0043 left it in.

   The usual rebuild creates the new table under a temporary name and renames it afterwards. That cannot be
   done here. The migration runner has already opened a transaction, where PRAGMA foreign_keys cannot be
   turned off, so foreign keys have to be deferred instead — and a deferred check only balances out if the
   rows come back into a table called `accounts`, the name entries, trades and parent_id all point at. Dropped
   and recreated under its own name, every reference that the drop left dangling is satisfied again by the
   copy-back, and the commit finds nothing outstanding. The rows wait meanwhile in a plain table with no
   constraints of its own, which nothing references. */
PRAGMA defer_foreign_keys = ON;

CREATE TABLE accounts_rebuild_0047 AS SELECT * FROM accounts;

DROP TABLE accounts;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  parent_id TEXT REFERENCES accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability', 'income', 'expense', 'equity')),
  subtype TEXT NOT NULL CHECK (subtype IN ('cash', 'bank', 'credit_card', 'savings', 'fund', 'ewallet', 'time_deposit',
    'other_cash', 'investment', 'property', 'vehicle', 'receivable', 'payable', 'loan', 'category', 'equity')),
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
  system_key, sort_order, archived_at, created_at FROM accounts_rebuild_0047;

DROP TABLE accounts_rebuild_0047;

CREATE INDEX accounts_workspace_kind ON accounts (workspace_id, kind);
CREATE UNIQUE INDEX accounts_system_key ON accounts (workspace_id, system_key)
  WHERE system_key IS NOT NULL AND kind NOT IN ('income', 'expense');

-- After the rebuild, so its foreign key never points at a table that is about to be dropped.
CREATE TABLE deposit_terms (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  matures_on TEXT NOT NULL,
  rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (rate_bps >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX deposit_terms_workspace ON deposit_terms (workspace_id, matures_on);
