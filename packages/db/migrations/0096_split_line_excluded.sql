-- A line of a purchase left out of its workspace's reports on its own (the split sheet's Exclude from report, one switch
-- per line): the chart, the budgets, the category totals, Financial health and an event's spending. Two lines of one
-- workspace (Groceries and Gift) are two switches; before this, a workspace's lines were one part (0090) and switched
-- together. The card keeps the whole charge — its balance, statement, points and instalments never read this.
--
-- One row per excluded line, by the line's category. Only a line left out alone is a row here: a workspace whose every
-- line is out stays what 0090 wrote (book_transaction_splits.excluded on a split across workspaces, transaction_flags
-- .excluded on a purchase in one), so a build before this reads those exactly as it did, and a purchase saved with a part
-- excluded under 0090 reads here as every line of that workspace excluded, with nothing to move or rewrite.
--
-- Read and written by name, never through drizzle, and guarded by whether the table is there, so a database stopped
-- before this migration reads every such line counted. It travels as the purchase's `excludedLines` field.
CREATE TABLE IF NOT EXISTS transaction_line_excluded (
  transaction_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  PRIMARY KEY (transaction_id, account_id)
);
