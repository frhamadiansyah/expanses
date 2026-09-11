-- SQLite cannot alter a CHECK constraint, so earn_rules is rebuilt to accept per_increment rounding
-- and a fractional rate_num (issuers award e.g. 7,5 points per Rp 50.000 multiple).
CREATE TABLE earn_rules_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  program_id TEXT NOT NULL REFERENCES reward_programs(id),
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  stackable INTEGER NOT NULL DEFAULT 0 CHECK (stackable IN (0, 1)),
  match_json TEXT NOT NULL DEFAULT '{}',
  rate_num REAL NOT NULL CHECK (rate_num >= 0),
  rate_den INTEGER NOT NULL CHECK (rate_den > 0),
  rounding TEXT NOT NULL CHECK (rounding IN ('per_transaction_floor', 'per_cycle_sum', 'per_increment')),
  cap_spend_minor INTEGER CHECK (cap_spend_minor IS NULL OR cap_spend_minor >= 0),
  cap_points INTEGER CHECK (cap_points IS NULL OR cap_points >= 0),
  min_transaction_minor INTEGER,
  valid_from TEXT,
  valid_to TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO earn_rules_new (id, workspace_id, program_id, name, priority, stackable, match_json, rate_num, rate_den, rounding,
  cap_spend_minor, cap_points, min_transaction_minor, valid_from, valid_to, archived_at, created_at)
SELECT id, workspace_id, program_id, name, priority, stackable, match_json, rate_num, rate_den, rounding,
  cap_spend_minor, cap_points, min_transaction_minor, valid_from, valid_to, archived_at, created_at
FROM earn_rules;
DROP TABLE earn_rules;
ALTER TABLE earn_rules_new RENAME TO earn_rules;
CREATE INDEX earn_rules_program ON earn_rules (program_id);
