/* What a purchase was, beside what it cost.

   Three facts the form now records: whether it was bought online or in a shop, whether it should stay out of the
   chart and the budgets, and the receipt photos kept for it. None of them is a column on transactions: the ORM
   names every column it knows on every insert, so a column there would break any database still stopped at an
   older version (see 0028). Nothing is backfilled — no row means no channel, not excluded, no photos, which is
   what every transaction recorded until now is.

   This migration is applied *after* 0049 on every database that already exists, and before it on every fresh one:
   the runner is set-based, not a high-water mark. So it depends on nothing any other migration made — two CREATE
   TABLEs of their own names, and an index on one of them. */
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
