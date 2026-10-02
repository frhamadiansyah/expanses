/* What a captured row is, and where the capture came from.

   A draft used to be an expense: a category, a payment account and an amount out. A phone notification is not always
   that. "Dana masuk Rp5.000.000" is money arriving, "Transfer Rp250.000 ke Jenius" is your own money moving, and
   neither has a spending category. So a draft carries a kind, and the confirmation posts the lines that kind means.

   SQLite cannot widen a CHECK constraint in place, so draft_transactions is rebuilt: the rows are copied with kind
   'expense' — every draft that existed before this migration was one — and the two indexes 0030 and 0037 created are
   recreated exactly.

   A capture also remembers where it came from: the source it was recognised as (source_id → capture_sources), the
   captures it was read out of (capture_ids), the picture it was photographed from (image_file) and what the reader
   made of it (reading_json). merged_into points at the draft this one was found to be a duplicate of, which is how a
   merged row leaves the queue and how an Unmerge can find it again.

   capture_sources, capture_skipped and capture_settings are local to the device and never synced: what the owner's
   own screens and receipts look like is nobody else's business, and the spec keeps them out of SHARED_ENTITIES. */

CREATE TABLE capture_sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  /* A notification is recognised by its app; an image by the layout fingerprint of its top band and the account
     digits it prints. */
  key_kind TEXT NOT NULL CHECK (key_kind IN ('app', 'fingerprint')),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  /* Which account this source's captures come out of, learned from the first answer. */
  account_id TEXT,
  /* Where each field was found last time it was corrected: { amount?: Anchor, name?: Anchor, date?: Anchor }. */
  template_json TEXT,
  captured_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

/* A capture the reader would not record, kept so the same offer is not offered again. */
CREATE TABLE capture_skipped (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('promo', 'expenses-only')),
  capture_json TEXT NOT NULL,
  reading_json TEXT NOT NULL,
  skipped_at TEXT NOT NULL
);

/* Settings the capture screens own, as key/value: 'scope' is everything or expenses-only. */
CREATE TABLE capture_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE draft_transactions_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'csv', 'voice', 'receipt', 'email', 'notification', 'screen', 'photo')),
  kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'income', 'transfer')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'dismissed')),
  raw_payload TEXT,
  raw_purge_after TEXT,
  occurred_on TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id),
  /* Where a transfer's money went. Null for anything else. */
  to_account_id TEXT REFERENCES accounts(id),
  category_account_id TEXT REFERENCES accounts(id),
  card_id TEXT REFERENCES cards(id),
  source_id TEXT,
  /* The captures this draft was read out of, as a JSON array of ids. */
  capture_ids TEXT,
  image_file TEXT,
  reading_json TEXT,
  merged_into TEXT,
  confidence INTEGER,
  external_ref TEXT,
  transaction_id TEXT REFERENCES transactions(id),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

INSERT INTO draft_transactions_new
  (id, workspace_id, source, kind, status, raw_payload, raw_purge_after, occurred_on, description, amount_minor,
   currency, account_id, to_account_id, category_account_id, card_id, source_id, capture_ids, image_file,
   reading_json, merged_into, confidence, external_ref, transaction_id, created_at, resolved_at)
SELECT
  id, workspace_id, source, 'expense', status, raw_payload, raw_purge_after, occurred_on, description, amount_minor,
  currency, account_id, NULL, category_account_id, card_id, NULL, NULL, NULL,
  NULL, NULL, confidence, external_ref, transaction_id, created_at, resolved_at
FROM draft_transactions;

DROP TABLE draft_transactions;
ALTER TABLE draft_transactions_new RENAME TO draft_transactions;

CREATE INDEX draft_transactions_pending ON draft_transactions (workspace_id, status, occurred_on);
CREATE UNIQUE INDEX draft_transactions_ref ON draft_transactions (workspace_id, external_ref) WHERE external_ref IS NOT NULL;
