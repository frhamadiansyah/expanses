/* A bill that comes round every month: the phone, the water, the gas. The amount may be left open,
   because an electricity bill differs every month while a subscription does not. */
CREATE TABLE expense_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category_account_id TEXT NOT NULL REFERENCES accounts(id),
  money_account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_minor INTEGER,
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  active INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX expense_templates_workspace ON expense_templates (workspace_id);

/* Which bill a payment settled, so a month already paid stops being asked for. */
ALTER TABLE transactions ADD COLUMN template_id TEXT;
