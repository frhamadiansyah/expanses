-- A shared account the holder also lets the household record into ("Joint account"). Local, per account: the holder's
-- phone keeps the switch here and sends it to the partner as part of the shared item's summary (`joint`), so nothing in
-- this table syncs. An account that stops being shared (net-worth setting other than 'total') drops out of it.
-- A side table rather than a column on accounts: the ORM names every column it knows on every insert (see 0028/0093).
CREATE TABLE nw_joint_accounts (
  account_id TEXT PRIMARY KEY
);

-- A transfer in a shared workspace names the joint account on either side by its item id (the same name the item's
-- summary goes by), so both phones can list it on the account. Null unless that side is a joint account.
ALTER TABLE shared_transfers ADD COLUMN from_item TEXT;
ALTER TABLE shared_transfers ADD COLUMN to_item TEXT;
