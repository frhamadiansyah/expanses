-- Goals: what the owner is saving toward, funded by the goal tagged on each buy and by money set aside.
-- Stages are free-form: hajj reguler, hajj plus and furoda pay in different steps, so a goal carries as many as it needs.

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('emergency', 'hajj', 'umrah', 'education', 'retirement', 'home', 'wedding', 'vehicle', 'holiday', 'other')),
  rank INTEGER NOT NULL DEFAULT 0,
  -- How fast the cost grows and what the money funding it is expected to earn, in basis points a year.
  growth_bps INTEGER NOT NULL DEFAULT 0 CHECK (growth_bps >= 0),
  return_bps INTEGER NOT NULL DEFAULT 0 CHECK (return_bps >= 0),
  standing_monthly_minor INTEGER NOT NULL DEFAULT 0 CHECK (standing_monthly_minor >= 0),
  standing_note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'archived')),
  created_at TEXT NOT NULL
);
CREATE INDEX goals_workspace ON goals (workspace_id, rank);

CREATE TABLE goal_stages (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  -- Exactly one of the two: an amount in today's money, or months of outgoings for an emergency fund.
  target_minor INTEGER CHECK (target_minor IS NULL OR target_minor >= 0),
  target_months INTEGER CHECK (target_months IS NULL OR target_months > 0),
  due_on TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  paid_on TEXT,
  CHECK ((target_minor IS NULL) <> (target_months IS NULL))
);
CREATE INDEX goal_stages_goal ON goal_stages (goal_id, due_on);

CREATE TABLE goal_earmarks (
  goal_id TEXT NOT NULL REFERENCES goals(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  PRIMARY KEY (goal_id, account_id)
);
CREATE INDEX goal_earmarks_workspace ON goal_earmarks (workspace_id);

-- The goal a buy funds, or the goal a sell takes units from.
ALTER TABLE investment_trades ADD COLUMN goal_id TEXT REFERENCES goals(id);
-- The goal a monthly buy fills in by default; each recorded buy can override it.
ALTER TABLE trade_templates ADD COLUMN goal_id TEXT REFERENCES goals(id);
