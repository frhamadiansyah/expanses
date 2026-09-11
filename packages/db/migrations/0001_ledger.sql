CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('personal', 'shared', 'business', 'travel')),
  base_currency TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free')),
  created_at TEXT NOT NULL
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  parent_id TEXT REFERENCES accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability', 'income', 'expense', 'equity')),
  subtype TEXT NOT NULL CHECK (subtype IN ('cash', 'bank', 'credit_card', 'savings', 'investment', 'property',
    'vehicle', 'receivable', 'payable', 'loan', 'category', 'equity')),
  name TEXT NOT NULL,
  icon TEXT,
  currency TEXT,
  valuation_mode TEXT NOT NULL DEFAULT 'derived' CHECK (valuation_mode IN ('derived', 'snapshot', 'market')),
  system_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (kind IN ('income', 'expense', 'equity') OR currency IS NOT NULL)
);
CREATE INDEX accounts_workspace_kind ON accounts (workspace_id, kind);
CREATE UNIQUE INDEX accounts_system_key ON accounts (workspace_id, system_key) WHERE system_key IS NOT NULL;

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  occurred_on TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('manual', 'csv', 'voice', 'receipt', 'email')),
  external_ref TEXT,
  event_id TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'void')),
  replaces_transaction_id TEXT REFERENCES transactions(id),
  created_at TEXT NOT NULL
);
CREATE INDEX transactions_workspace_date ON transactions (workspace_id, occurred_on);
CREATE UNIQUE INDEX transactions_external_ref ON transactions (workspace_id, external_ref)
  WHERE external_ref IS NOT NULL AND status = 'posted';

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  currency TEXT NOT NULL,
  fx_rate_to_base REAL NOT NULL CHECK (fx_rate_to_base > 0),
  amount_base_minor INTEGER NOT NULL,
  memo TEXT
);
CREATE INDEX entries_account ON entries (account_id);
CREATE INDEX entries_transaction ON entries (transaction_id);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
