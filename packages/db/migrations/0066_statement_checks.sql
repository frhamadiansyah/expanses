/* Statement checks: device-local, never synced (card terms are not synced either). */
CREATE TABLE statement_checks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  card_account_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  closing_minor INTEGER,
  previous_minor INTEGER,
  status TEXT NOT NULL CHECK (status IN ('reconciled', 'differs', 'open')),
  difference_minor INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL
);
CREATE UNIQUE INDEX statement_checks_period ON statement_checks (card_account_id, period_start, period_end);
CREATE TABLE statement_links (
  check_id TEXT NOT NULL REFERENCES statement_checks (id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('matched', 'recorded', 'differs-kept', 'differs-updated', 'payments-untracked')),
  PRIMARY KEY (check_id, transaction_id)
);
CREATE TABLE card_statement_settings (
  card_account_id TEXT PRIMARY KEY,
  track_payments INTEGER NOT NULL DEFAULT 0
);
