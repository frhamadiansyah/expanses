-- Electronic money: a prepaid chip card — Flazz, Mandiri e-money, Brizzi, TapCash — as a kind of money account of its
-- own, beside the digital wallet (an app on a phone: GoPay, OVO, DANA). Both are electronic money on the tax report
-- (kas 0105) and both are spent from; only a wallet has a phone number, and a chip card is drawn in Wallet as one.
--
-- The kinds are a CHECK on accounts.subtype, which SQLite cannot alter: the table is rebuilt as 0069 rebuilt it, with
-- 'emoney' added and every column since kept — number_last4 (0080), for_spending (0086) and card_tier (0087) with their
-- own checks — and its indexes made again.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE accounts_rebuild_0089 AS SELECT * FROM accounts;

DROP TABLE accounts;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  parent_id TEXT REFERENCES accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability', 'income', 'expense', 'equity')),
  subtype TEXT NOT NULL CHECK (subtype IN ('cash', 'bank', 'credit_card', 'savings', 'fund', 'ewallet', 'emoney', 'time_deposit',
    'other_cash', 'investment', 'property', 'vehicle', 'receivable', 'payable', 'loan', 'category', 'equity', 'event_balance')),
  name TEXT NOT NULL,
  icon TEXT,
  currency TEXT,
  valuation_mode TEXT NOT NULL DEFAULT 'derived' CHECK (valuation_mode IN ('derived', 'snapshot', 'market')),
  system_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  number_last4 TEXT CHECK (number_last4 IS NULL OR (length(number_last4) = 4 AND number_last4 GLOB '[0-9][0-9][0-9][0-9]')),
  for_spending INTEGER NOT NULL DEFAULT 1 CHECK (for_spending IN (0, 1)),
  card_tier TEXT,
  CHECK (kind IN ('income', 'expense', 'equity') OR currency IS NOT NULL)
);

INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode,
  system_key, sort_order, archived_at, created_at, number_last4, for_spending, card_tier)
SELECT id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode,
  system_key, sort_order, archived_at, created_at, number_last4, for_spending, card_tier FROM accounts_rebuild_0089;

DROP TABLE accounts_rebuild_0089;

CREATE INDEX accounts_workspace_kind ON accounts (workspace_id, kind);
CREATE UNIQUE INDEX accounts_system_key ON accounts (workspace_id, system_key)
  WHERE system_key IS NOT NULL AND kind NOT IN ('income', 'expense');

-- A digital wallet that is plainly a chip card becomes one: called by exactly a card's name (the names Wallet already
-- drew the e-money face for), with no phone number kept for it — a chip card has none, and a wallet's digits are kept
-- on a cards row. Anything else — "Flazz kantor", a wallet with a phone number — stays a digital wallet. The tax code
-- is 0105 either way, so the report does not change.
UPDATE accounts SET subtype = 'emoney'
WHERE kind = 'asset' AND subtype = 'ewallet' AND parent_id IS NULL
  AND lower(trim(name)) IN ('flazz', 'bca flazz', 'e-money', 'emoney', 'e money', 'mandiri e-money', 'brizzi', 'bri brizzi',
    'tapcash', 'tap cash', 'bni tapcash', 'jakcard', 'jak card')
  AND id NOT IN (SELECT account_id FROM cards);
