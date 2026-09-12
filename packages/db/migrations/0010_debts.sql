-- Money lent to a person and money borrowed from one. The balance lives on an ordinary
-- receivable or payable account; this table only adds who, why, and by when.

CREATE TABLE debt_profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL,
  person_name TEXT NOT NULL,
  -- NIK or NPWP, needed by the Coretax piutang and utang tables. Optional until the report is filed.
  person_id_number TEXT,
  reason TEXT,
  due_on TEXT,
  -- The ledger balance decides open against settled; 'forgiven' is written once and stays.
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'forgiven')),
  status_on TEXT,
  -- Receivable 0201 default, 0202 related party; payable 109 default, 103 related party.
  coretax_code TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX debt_profiles_workspace ON debt_profiles (workspace_id, person_name);
