CREATE TABLE card_terms (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  credit_limit_minor INTEGER,
  statement_day INTEGER NOT NULL CHECK (statement_day BETWEEN 1 AND 31),
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  annual_fee_minor INTEGER
);

CREATE TABLE reward_programs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  card_account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('points', 'miles', 'cashback')),
  cycle_anchor TEXT NOT NULL DEFAULT 'statement' CHECK (cycle_anchor IN ('statement', 'calendar')),
  archived_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX reward_programs_card ON reward_programs (card_account_id);

CREATE TABLE earn_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  program_id TEXT NOT NULL REFERENCES reward_programs(id),
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  stackable INTEGER NOT NULL DEFAULT 0 CHECK (stackable IN (0, 1)),
  match_json TEXT NOT NULL DEFAULT '{}',
  rate_num INTEGER NOT NULL CHECK (rate_num >= 0),
  rate_den INTEGER NOT NULL CHECK (rate_den > 0),
  rounding TEXT NOT NULL CHECK (rounding IN ('per_transaction_floor', 'per_cycle_sum')),
  cap_spend_minor INTEGER CHECK (cap_spend_minor IS NULL OR cap_spend_minor >= 0),
  cap_points INTEGER CHECK (cap_points IS NULL OR cap_points >= 0),
  min_transaction_minor INTEGER,
  valid_from TEXT,
  valid_to TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX earn_rules_program ON earn_rules (program_id);

CREATE TABLE redemption_options (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  program_id TEXT NOT NULL REFERENCES reward_programs(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cashback', 'voucher', 'miles_transfer', 'statement_credit')),
  value_minor INTEGER NOT NULL CHECK (value_minor > 0),
  per_points INTEGER NOT NULL CHECK (per_points > 0),
  currency TEXT NOT NULL
);

CREATE TABLE cycle_actuals (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  program_id TEXT NOT NULL REFERENCES reward_programs(id),
  cycle_start TEXT NOT NULL,
  actual_points INTEGER NOT NULL CHECK (actual_points >= 0),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (program_id, cycle_start)
);
