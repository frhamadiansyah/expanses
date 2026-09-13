CREATE TABLE income_sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  scheme TEXT NOT NULL CHECK (scheme IN ('umkm_final', 'nppn')),
  /* The wallet the business is run through: its income postings are the turnover. */
  account_id TEXT NOT NULL REFERENCES accounts(id),
  norma_rate_bps INTEGER,
  klu_code TEXT,
  threshold_applies INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX income_sources_workspace ON income_sources (workspace_id);
CREATE UNIQUE INDEX income_sources_account ON income_sources (workspace_id, account_id);
