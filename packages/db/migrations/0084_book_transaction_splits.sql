-- One purchase split across workspaces: one transaction — one card line, as the bank prints it — whose category lines
-- are filed in two or more workspaces. Such a transaction has no book_transactions row (that row names the one
-- workspace a transaction is in, and is what household sharing, net worth and every single-workspace reader go by);
-- it has a row here for each workspace with a part. Spending, budgets and reports already read a workspace's own
-- category lines only, so each counts its own part; a list shows the purchase in each workspace with a part, once.
CREATE TABLE book_transaction_splits (
  transaction_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  PRIMARY KEY (transaction_id, book_id)
);
CREATE INDEX book_transaction_splits_book ON book_transaction_splits (book_id);
