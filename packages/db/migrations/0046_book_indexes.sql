/* book_category_sets is read by set id and written by book; the book side had no index, so listing a
   workspace's category sets scanned the table. Index only — no column, no figure. */
CREATE INDEX IF NOT EXISTS book_category_sets_book ON book_category_sets (book_id);
