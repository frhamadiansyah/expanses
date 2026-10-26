-- The account on this phone a transfer between partners is posted to when its side is one of this person's own accounts
-- that is NOT shared (a partner moving money into or out of the holder's joint account, 0097). The group log names such a
-- side by the owner alone (item id ''), so the account is local, per transfer, and never syncs.
CREATE TABLE member_transfer_accounts (
  book_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  PRIMARY KEY (book_id, transfer_id)
);

-- The last transaction a purchase's lineage had before it was voided, on this phone (local, never synced). A voided
-- lineage keeps no head, so the joint list (0097) reads what a deleted row was, and who deleted it, from here.
CREATE TABLE sync_lineage_last (
  lineage_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL
);
