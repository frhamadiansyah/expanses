-- A sinking fund: money a yearly bill saves up each month, set aside in an account the owner already has. One row per
-- bill. Nothing moves: what is set aside is worked out from the day (monthly x months begun + extra, up to the bill's
-- amount) and counted against that account's free money. Local to the owner's phone: a partner never sees it, so
-- nothing here syncs. A side table so the ORM's tables are untouched (see 0097).
CREATE TABLE sinking_funds (
  bill_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  monthly_minor INTEGER NOT NULL,
  started_month TEXT NOT NULL,
  extra_minor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
