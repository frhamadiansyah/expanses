-- A transfer recorded in a household-shared workspace, as the partner may see it: date, amount, currency and a label,
-- never the accounts. transfer_id is the root of the transfer's replaces chain; book_id is the shared workspace's book
-- id (the same on every phone). transaction_id is local only: the recorder's own live transfer, so its own list shows the
-- real row and never this shadow.
CREATE TABLE shared_transfers (
  book_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  void INTEGER NOT NULL DEFAULT 0,
  -- Only an account the recorder shares with the household (net-worth setting 'total') is named; a private side is null.
  from_name TEXT,
  to_name TEXT,
  transaction_id TEXT,
  PRIMARY KEY (book_id, transfer_id)
);
CREATE INDEX shared_transfers_tx ON shared_transfers(transaction_id);
