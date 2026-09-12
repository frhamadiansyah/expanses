-- Asset values and buy & sell: what each asset is, what it is worth, and the trades behind holdings.
-- Units are millionths of a unit; prices are millionths of a minor unit, so a NAV of 1.842,11 stays exact.

CREATE TABLE asset_profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('fund', 'stock', 'bond', 'gold', 'property', 'vehicle', 'other', 'cash')),
  plan_group TEXT NOT NULL CHECK (plan_group IN ('liquid', 'invest', 'owed', 'use')),
  unit_kind TEXT CHECK (unit_kind IS NULL OR unit_kind IN ('units', 'shares', 'grams', 'face')),
  lot_size INTEGER CHECK (lot_size IS NULL OR lot_size > 0),
  risk TEXT CHECK (risk IS NULL OR risk IN ('low', 'medium', 'high')),
  coretax_section TEXT CHECK (coretax_section IS NULL OR coretax_section IN ('kas', 'piutang', 'investasi', 'bergerak', 'tidak_bergerak', 'lainnya')),
  coretax_code TEXT CHECK (coretax_code IS NULL OR (length(coretax_code) = 4 AND coretax_code GLOB '[0-9][0-9][0-9][0-9]')),
  coretax_fields_json TEXT NOT NULL DEFAULT '{}',
  -- Overrides the year of the oldest purchase still held.
  acquired_year INTEGER CHECK (acquired_year IS NULL OR (acquired_year >= 1900 AND acquired_year <= 2999)),
  updated_at TEXT NOT NULL
);
CREATE INDEX asset_profiles_workspace ON asset_profiles (workspace_id);

CREATE TABLE investment_trades (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  -- Null for a unit change, which moves no money.
  transaction_id TEXT REFERENCES transactions(id),
  kind TEXT NOT NULL CHECK (kind IN ('buy', 'sell', 'income', 'unit_change')),
  occurred_on TEXT NOT NULL,
  units_micro INTEGER NOT NULL,
  gross_minor INTEGER NOT NULL CHECK (gross_minor >= 0),
  fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  -- Null means the trade was paid from Opening Balances, for holdings owned before the app.
  cash_account_id TEXT REFERENCES accounts(id),
  template_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replaced', 'deleted')),
  replaces_trade_id TEXT REFERENCES investment_trades(id),
  created_at TEXT NOT NULL
);
CREATE INDEX investment_trades_account ON investment_trades (workspace_id, account_id, occurred_on);
CREATE INDEX investment_trades_template ON investment_trades (workspace_id, template_id) WHERE template_id IS NOT NULL;

CREATE TABLE prices (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  on_date TEXT NOT NULL,
  price_micro INTEGER NOT NULL CHECK (price_micro >= 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, on_date)
);

CREATE TABLE valuations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  as_of TEXT NOT NULL,
  value_minor INTEGER NOT NULL CHECK (value_minor >= 0),
  basis TEXT NOT NULL CHECK (basis IN ('estimate', 'appraisal', 'listing', 'njop', 'purchase')),
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX valuations_account ON valuations (account_id, as_of);

CREATE TABLE trade_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  cash_account_id TEXT NOT NULL REFERENCES accounts(id),
  -- Exactly one of the two: a fixed amount of money, or a fixed number of units.
  amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor > 0),
  units_micro INTEGER CHECK (units_micro IS NULL OR units_micro > 0),
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  CHECK ((amount_minor IS NULL) <> (units_micro IS NULL))
);
CREATE INDEX trade_templates_workspace ON trade_templates (workspace_id, active);
