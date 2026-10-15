/* A budget set as a share — of the month's take-home, or of its parent category's budget — rather than an amount.
   budgets.amount_minor still holds a monthly figure (the one resolved when it was saved), so a database or a device
   that does not know this table reads a sensible cap. A side table, not a column, for the reason 0053 gives. No row:
   an amount. */
CREATE TABLE IF NOT EXISTS budget_shares (
  budget_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('take-home', 'parent')),
  share_bp INTEGER NOT NULL CHECK (share_bp BETWEEN 1 AND 10000)
);
CREATE INDEX IF NOT EXISTS budget_shares_workspace ON budget_shares (workspace_id);
