/* When a card purchase reached the statement, and which purchases a payment paid.

   A purchase made on the 19th with a statement on the 20th is sometimes only posted by the bank on the
   21st, and so appears on the next statement. The purchase date stays what it was, for spending; the
   posting date, when the owner gives one, decides the statement and the points cycle it belongs to.

   A payment is still an ordinary transfer to the card. Settlements only say which purchases it was for,
   so paying a few purchases before the statement is out can be shown as paid.

   Side tables, so older tests that seed transactions at earlier versions keep working. */
CREATE TABLE card_postings (
  transaction_id TEXT PRIMARY KEY REFERENCES transactions(id),
  workspace_id TEXT NOT NULL,
  posted_on TEXT NOT NULL CHECK (posted_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

CREATE TABLE card_settlements (
  purchase_transaction_id TEXT PRIMARY KEY REFERENCES transactions(id),
  payment_transaction_id TEXT NOT NULL REFERENCES transactions(id),
  workspace_id TEXT NOT NULL
);
CREATE INDEX card_settlements_payment ON card_settlements(payment_transaction_id);
