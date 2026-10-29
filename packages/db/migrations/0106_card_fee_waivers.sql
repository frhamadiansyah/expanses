-- How a credit card's annual fee gets waived. One row per card: either a yearly spending target the bank waives the
-- fee for by itself ('automatic'), or a challenge the bank gave after a call ('challenge': spend this much between
-- two days). Side tables, read and written by name, so the ORM's tables are untouched (see 0097, 0101).
CREATE TABLE card_fee_waivers (
  account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('automatic', 'challenge')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  counted_from TEXT,
  spend_by TEXT,
  -- JSON array of category ids that count; '[]' = every purchase.
  category_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

-- A reached challenge the bank refunded: the refund receipt it posted, the year of the fee it refunded, and the
-- challenge as it stood, so Undo can put it back.
CREATE TABLE card_fee_refunds (
  transaction_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  fee_year INTEGER NOT NULL,
  challenge_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
