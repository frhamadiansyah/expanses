/* A transfer recorded in a household-shared workspace, listed on a shared event instead (trip withdrawal, owner, 13 Nov
   2026): an ATM withdrawal for a trip leaves the workspace's list on every phone and shows on the trip, not counted.
   event_book_id is that event's book id, the same on every phone in it, and travels with the row (book_transfer's
   eventBookId); its recorder alone writes it. Null is in the workspace, as every row before this was. The ledger
   transaction itself is untouched: the accounts' history and balances stay as they were.

   No build before this one has the column. An older build that took the field would keep its clock and drop the value,
   so a clock under that name here is none of this build's: it is dropped, and the value, sent again, is written. */
ALTER TABLE shared_transfers ADD COLUMN event_book_id TEXT;
DELETE FROM sync_field_clocks WHERE entity = 'book_transfer' AND field = 'eventBookId';
