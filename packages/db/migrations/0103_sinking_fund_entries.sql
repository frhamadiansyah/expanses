-- A sinking fund's history (v2): what was already saved when it was set up, one-off money put in, months skipped, and
-- the monthly figure from a month on. The earmark is still worked out from the day (packages/core bills/sinking.ts
-- walks these); nothing moves. `kind` is 'opening' | 'extra' | 'skip' | 'plan'. `month` is YYYY-MM for a skip or the month a plan
-- takes effect. A fund made under 0101 keeps working: its extra_minor reads as one extra entry. A side table like
-- sinking_funds (0101), read and written by name, local to the owner's phone: it does not sync.
CREATE TABLE sinking_fund_entries (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  month TEXT,
  amount_minor INTEGER NOT NULL DEFAULT 0,
  occurred_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sinking_fund_entries_bill ON sinking_fund_entries (bill_id);
-- 1 when the owner typed the monthly figure: a skip then leaves it alone instead of recalculating.
ALTER TABLE sinking_funds ADD COLUMN monthly_custom INTEGER NOT NULL DEFAULT 0;
