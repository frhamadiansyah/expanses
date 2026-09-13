-- What actually reached a goal, and when.
--
-- goal_earmarks holds a balance with no history, so changing a set-aside leaves no trace of when the
-- money moved. Tagged transfers and tagged buys are already dated in the ledger and are read from
-- there; only the manual set-aside needs recording, which is what this table is for.

CREATE TABLE goal_contributions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  -- Signed: money set aside is positive, money taken back out is negative.
  delta_minor INTEGER NOT NULL,
  occurred_on TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('earmark')),
  created_at TEXT NOT NULL
);
CREATE INDEX goal_contributions_month ON goal_contributions (workspace_id, occurred_on);
