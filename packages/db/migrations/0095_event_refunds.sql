-- A refund in a shared event is an expense below zero (money back, the purchase's shape, signed). The table was made
-- with CHECK (amount_minor > 0), which SQLite cannot drop in place, so the table is rebuilt without it and every row
-- copied as it is. An older build keeps its check: a refund op reaching it fails that check, which its sync records as a
-- skipped op (a deterministic refusal) rather than stopping.
CREATE TABLE event_expenses_new (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  currency TEXT NOT NULL,
  rate_to_event TEXT NOT NULL,
  payer_person_id TEXT NOT NULL,
  payer_member_id TEXT,
  voided_at TEXT,
  PRIMARY KEY (book_id, id)
);

INSERT INTO event_expenses_new (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
SELECT book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at FROM event_expenses;

DROP TABLE event_expenses;
ALTER TABLE event_expenses_new RENAME TO event_expenses;
