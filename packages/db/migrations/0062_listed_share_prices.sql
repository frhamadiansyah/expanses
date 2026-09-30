/* 0062 — a listed share's price can come from Yahoo Finance's daily close (fetched by the app, for now) or from IDX's
   daily Ringkasan Saham file (imported by the owner), beside the prices the owner types; and each security says which
   of the three it follows.

   A fetched or imported close is stored where a typed one is, one row per security per day, with `source` saying
   which it is — so every reader of security prices values a holding the same way whatever the price's origin, and the
   page can still say "Yahoo Finance close" or "IDX closing price". SQLite cannot widen a CHECK in place, so
   security_prices is rebuilt, as 0061 rebuilt prices, with 'yahoo' and 'idx' allowed beside 'manual' and every row
   copied across unchanged. No other table references security_prices. Holdings with no security (a mutual fund) have
   no ticker to look up and keep `prices` as 0061 left it.

   The choice is the security's, not a holding's: the price is one per security, valuing every broker that holds it
   (0051). It sits in a table of its own, for the reason 0028 and 0061 give (a column would be named on every insert
   and break a database still at an older version). No row means Yahoo Finance where the app can use it, IDX's file
   for an IDX share where it cannot. No REFERENCES clause, as in 0061.

   Safe to run again: the rebuild copies the rows across unchanged a second time, and the choices table and its index
   are created only if they are not there. Safe to run before 0051, too (a database that meets 0051 after its later
   migrations, as 0051 allows): the table is made here, empty, and 0051 then leaves it be. */
CREATE TABLE IF NOT EXISTS security_prices (
  security_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  on_date TEXT NOT NULL,
  price_micro INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (security_id, on_date)
);
DROP TABLE IF EXISTS security_prices_new;
CREATE TABLE security_prices_new (
  security_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  on_date TEXT NOT NULL,
  price_micro INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'yahoo', 'idx')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (security_id, on_date)
);
INSERT INTO security_prices_new (security_id, workspace_id, on_date, price_micro, source, created_at)
  SELECT security_id, workspace_id, on_date, price_micro, source, created_at FROM security_prices;
DROP TABLE security_prices;
ALTER TABLE security_prices_new RENAME TO security_prices;

CREATE TABLE IF NOT EXISTS security_price_choices (
  security_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('yahoo', 'idx', 'typed'))
);
CREATE INDEX IF NOT EXISTS security_price_choices_workspace ON security_price_choices (workspace_id);
