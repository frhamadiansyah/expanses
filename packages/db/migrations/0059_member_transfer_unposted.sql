-- Joint net worth §7.2 (task 8): why this device posted nothing for a transfer between partners it is a party of — the
-- group not active, the transfer's author not a group member, its item not mapped here, no rate. Local only, never
-- synced; the row goes once the transfer posts here. `author` is the member whose change was not followed, so a retry
-- (after each group-log sync, after a rate is saved) judges it by the same author.
CREATE TABLE member_transfer_unposted (
  book_id TEXT NOT NULL, transfer_id TEXT NOT NULL, reason TEXT NOT NULL, author TEXT,
  PRIMARY KEY (book_id, transfer_id)
);
