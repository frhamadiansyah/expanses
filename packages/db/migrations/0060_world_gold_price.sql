/* 0060 — a gold holding's price can come from the world price (Frankfurter's XAU quote, brought down to the gram), and
   each such holding says whether it follows that price or takes only what its owner types.

   A fetched price is stored where a typed one is, one row per holding per day, with `source` saying which it is — so
   every reader of prices values the holding the same way whatever the price's origin, and the page can still say
   "World price" or "Typed". SQLite cannot widen a CHECK in place, so prices is rebuilt with 'world' allowed beside
   'manual' and every row copied across unchanged. No other table references prices, so nothing else is touched.

   The owner's choice sits in a table of its own rather than a column on asset_profiles, for the reason 0028 gives:
   the ORM names every column it knows on every insert, and a column there would break a database still stopped at an
   older version. No row means the world price, which is what a gold holding follows unless told otherwise. No
   REFERENCES clause, as in 0048, 0054 and 0055, so a later rebuild of accounts never has to defer keys for it.

   Numbered 0060 because 0056–0059 are taken; the runner is set-based, so it lands in any order beside them. */
CREATE TABLE prices_new (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  on_date TEXT NOT NULL,
  price_micro INTEGER NOT NULL CHECK (price_micro >= 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'world')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, on_date)
);
INSERT INTO prices_new (account_id, workspace_id, on_date, price_micro, source, created_at)
  SELECT account_id, workspace_id, on_date, price_micro, source, created_at FROM prices;
DROP TABLE prices;
ALTER TABLE prices_new RENAME TO prices;

CREATE TABLE gold_price_choices (
  account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('world', 'typed'))
);
CREATE INDEX gold_price_choices_workspace ON gold_price_choices (workspace_id);
