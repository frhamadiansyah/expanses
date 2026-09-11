-- Reference data, not user financial data: shared across workspaces.
CREATE TABLE fx_rates (
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  on_date TEXT NOT NULL,
  rate REAL NOT NULL CHECK (rate > 0),
  source TEXT NOT NULL CHECK (source IN ('frankfurter', 'manual')),
  source_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (from_currency, to_currency, on_date)
);
