/* 0051 — securities. A holding points at a security (ticker, market, currency, lot size) and names the broker it
   is kept at; a price belongs to the security, so one price values every broker that holds it.

   Three tables of their own and nothing else: no column on accounts, asset_profiles or prices, because the ORM
   names every column it knows on every insert (see 0028). Nothing is backfilled — a holding with no link reads
   exactly as it did. Pure CREATE statements, so it lands in any order beside 0050, 0053, 0054 and any later one:
   migrate() is set-based, so on a database already at 0054 it simply applies 0051. */
CREATE TABLE securities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ticker TEXT,
  name TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL,
  lot_size INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('share', 'etf', 'other')),
  source TEXT NOT NULL CHECK (source IN ('catalogue', 'owner')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX securities_ticker ON securities (workspace_id, market, ticker) WHERE ticker IS NOT NULL;

CREATE TABLE holding_links (
  account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  security_id TEXT,
  broker_account_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX holding_links_security ON holding_links (workspace_id, security_id);

CREATE TABLE security_prices (
  security_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  on_date TEXT NOT NULL,
  price_micro INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (security_id, on_date)
);
