/* 0074 — when an asset was acquired, as precisely as its owner typed it: a year, a month, or a whole day. The ledger
   still posts on a whole day (the opening balance, a past purchase), so a year alone posts on 1 January and a month on
   its 1st; this row says how much of that day was typed, so the asset's page shows "2024" or "Mar 2024" rather than a
   1 January nobody chose. The tax report reads only the year, as before, from asset_profiles.acquired_year.

   No row means a whole day: every asset added before this was typed to the day, from the opening entry's date.

   A table of its own for the reason 0028 and 0061 give (a column on asset_profiles would break a database still at an
   older version), with no REFERENCES clause, as in 0061 and 0063. Kept on this device like the asset's other settings.
   Safe to run again. */
CREATE TABLE IF NOT EXISTS asset_acquired (
  account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  acquired_on TEXT NOT NULL CHECK (acquired_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  precision TEXT NOT NULL CHECK (precision IN ('year', 'month', 'day')),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS asset_acquired_workspace ON asset_acquired (workspace_id);
