-- Selling an asset valued by an estimate (a car, a house, land). One row per asset sold: what it sold for, the costs
-- taken off, the original cost it is measured against, the account the money went into and the ledger transaction that
-- put it there. The asset leaves net worth and the tax report's year-end list from sold_on; Undo sale deletes the row
-- and voids the transaction, which puts everything back as it was. Nothing here is synced: like asset_acquired, it is
-- this workspace's own record.
CREATE TABLE asset_sales (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  sold_on TEXT NOT NULL,
  sold_for_minor INTEGER NOT NULL CHECK (sold_for_minor > 0),
  costs_minor INTEGER NOT NULL DEFAULT 0 CHECK (costs_minor >= 0 AND costs_minor < sold_for_minor),
  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
  cash_account_id TEXT NOT NULL REFERENCES accounts(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  goal_id TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX asset_sales_account ON asset_sales (account_id);
CREATE INDEX asset_sales_workspace ON asset_sales (workspace_id, sold_on);
CREATE INDEX asset_sales_transaction ON asset_sales (transaction_id);
