-- MCC layer and per-purchase points: typed MCCs, merchant memory, category MCC overrides, crediting, purchase actuals.
ALTER TABLE transactions ADD COLUMN mcc TEXT CHECK (mcc IS NULL OR (length(mcc) = 4 AND mcc GLOB '[0-9][0-9][0-9][0-9]'));

CREATE TABLE merchant_mccs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  pattern TEXT NOT NULL,
  -- Null ignores the bundled merchant with the same pattern.
  mcc TEXT CHECK (mcc IS NULL OR (length(mcc) = 4 AND mcc GLOB '[0-9][0-9][0-9][0-9]')),
  created_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE UNIQUE INDEX merchant_mccs_active_pattern ON merchant_mccs (workspace_id, pattern) WHERE archived_at IS NULL;

CREATE TABLE category_mccs (
  category_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  mcc TEXT NOT NULL CHECK (length(mcc) = 4 AND mcc GLOB '[0-9][0-9][0-9][0-9]')
);

ALTER TABLE reward_programs ADD COLUMN crediting TEXT NOT NULL DEFAULT 'per_statement' CHECK (crediting IN ('per_transaction', 'per_statement'));

CREATE TABLE transaction_point_actuals (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  program_id TEXT NOT NULL REFERENCES reward_programs(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  actual_points REAL NOT NULL,
  edited_after_check INTEGER NOT NULL DEFAULT 0 CHECK (edited_after_check IN (0, 1)),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (program_id, transaction_id)
);
