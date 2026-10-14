-- A transaction's place within its day, when it was moved there by hand. NULL for a row never moved: it sorts above the
-- placed rows of its day, newest first, so a transaction just recorded still lands on top. A drag writes the moved row
-- alone, halfway between its neighbours; changing the date clears it. Synced as part of a purchase (`dayOrder`).
ALTER TABLE transactions ADD COLUMN day_order REAL;
