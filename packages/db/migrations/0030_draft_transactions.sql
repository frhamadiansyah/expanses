/* Captured spending waiting to be confirmed.

   Every capture source — a CSV, a bank email, a statement, one day a photographed receipt — produces
   drafts rather than ledger entries, and one review queue turns them into transactions through the
   same postTransaction() the manual form uses. Nothing here is money until someone says so, which is
   what makes a parser safe to be wrong: a bank that changes its layout produces bad drafts, never bad
   books.

   raw_payload keeps what the source actually said, so a mis-parse can be read back and understood.
   It is purged on the date in raw_purge_after, because a kept bank email is a liability. */
CREATE TABLE draft_transactions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'csv', 'voice', 'receipt', 'email')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'dismissed')),
  /* What the source said, verbatim. Null once purged. */
  raw_payload TEXT,
  /* The date after which raw_payload is deleted. */
  raw_purge_after TEXT,
  /* What was read out of it: the fields a transaction needs, as far as they are known. */
  occurred_on TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  /* Where it would post. Either may be unknown until the queue is worked through. */
  account_id TEXT REFERENCES accounts(id),
  category_account_id TEXT REFERENCES accounts(id),
  /* How sure the extractor was, 0 to 100. A parser that does not know says so. */
  confidence INTEGER,
  /* Shared with transactions, so a draft can be recognised as already posted. */
  external_ref TEXT,
  /* The transaction it became, once confirmed. */
  transaction_id TEXT REFERENCES transactions(id),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX draft_transactions_pending ON draft_transactions (workspace_id, status, occurred_on);
CREATE UNIQUE INDEX draft_transactions_ref ON draft_transactions (workspace_id, external_ref) WHERE external_ref IS NOT NULL;
