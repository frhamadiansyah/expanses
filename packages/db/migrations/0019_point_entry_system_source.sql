-- Writing off dead points is the app's own act, not something the owner typed, and 'manual' would
-- claim otherwise. SQLite cannot alter a CHECK, so the table is rebuilt to admit 'system'.

CREATE TABLE point_entries_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  transaction_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('earn', 'redeem', 'expire', 'adjust', 'transfer')),
  quantity REAL NOT NULL,
  occurred_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('posted', 'projected')),
  source TEXT NOT NULL CHECK (source IN ('transaction', 'statement', 'snapshot', 'projected', 'manual', 'system')),
  batch_id TEXT,
  expires_on TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO point_entries_new (id, workspace_id, program_id, transaction_id, kind, quantity, occurred_on, status, source, batch_id, expires_on, note, created_at)
  SELECT id, workspace_id, program_id, transaction_id, kind, quantity, occurred_on, status, source, batch_id, expires_on, note, created_at FROM point_entries;

DROP TABLE point_entries;

ALTER TABLE point_entries_new RENAME TO point_entries;

CREATE INDEX point_entries_program ON point_entries (workspace_id, program_id, occurred_on);
