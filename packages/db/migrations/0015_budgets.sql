-- The monthly budget: a repeating plan, with overrides that belong to exactly one month.
--
-- There is no carry-over by decision: each month starts at the plan, and money that is meant to pile
-- up belongs to a goal, where a target and a date give it meaning.

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  -- An account with subtype 'category'. The repo refuses anything else.
  category_account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX budgets_category ON budgets (workspace_id, category_account_id);

-- A month may be different without changing the plan. 0 is a real value: this month, nothing.
CREATE TABLE budget_overrides (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  month TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0)
);
CREATE UNIQUE INDEX budget_overrides_month ON budget_overrides (budget_id, month);

-- What the owner expects to take home in an ordinary month. Actual income is read from the ledger.
CREATE TABLE budget_settings (
  workspace_id TEXT PRIMARY KEY,
  expected_income_minor INTEGER NOT NULL DEFAULT 0 CHECK (expected_income_minor >= 0),
  updated_at TEXT NOT NULL
);

-- A bonus month is expected income for that month only.
CREATE TABLE budget_income_overrides (
  workspace_id TEXT NOT NULL,
  month TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  PRIMARY KEY (workspace_id, month)
);
