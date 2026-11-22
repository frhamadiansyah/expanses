/* One payment, several bills (2026-11-22): one transaction may settle several bills — a marketplace checkout that pays
   the internet and two phone bills shows as one line on the card. Until now bill_payments was keyed by the transaction
   alone, so a transaction settled one bill at most. Its key becomes the transaction, the bill and the month; the
   columns are the same, and every row is kept as it is.

   The rule "a bill's month is settled by one posted payment" never was a key (a voided payment keeps its row) and is
   still the app's own check before every write.

   Link my devices (0126) names a row by its primary key: the clocks and the pending marks of each row move to its new
   key here. A row already gone keeps its old one-part key; the self channel reads such a key as the transaction's one
   link, as an older device sends it. */
CREATE TABLE bill_payments_new (
  transaction_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  /* YYYY-MM: the month whose bill this payment settles. */
  bill_month TEXT NOT NULL,
  PRIMARY KEY (transaction_id, template_id, bill_month)
);
INSERT INTO bill_payments_new (transaction_id, workspace_id, template_id, bill_month)
SELECT transaction_id, workspace_id, template_id, bill_month FROM bill_payments;
DROP TABLE bill_payments;
ALTER TABLE bill_payments_new RENAME TO bill_payments;
CREATE INDEX bill_payments_template ON bill_payments (workspace_id, template_id, bill_month);

UPDATE self_clocks SET pk = (
  SELECT json_array(b.transaction_id, b.template_id, b.bill_month) FROM bill_payments b WHERE json_array(b.transaction_id) = self_clocks.pk
)
WHERE tbl = 'bill_payments' AND EXISTS (SELECT 1 FROM bill_payments b WHERE json_array(b.transaction_id) = self_clocks.pk);

UPDATE self_pending SET pk = (
  SELECT json_array(b.transaction_id, b.template_id, b.bill_month) FROM bill_payments b WHERE json_array(b.transaction_id) = self_pending.pk
)
WHERE tbl = 'bill_payments' AND EXISTS (SELECT 1 FROM bill_payments b WHERE json_array(b.transaction_id) = self_pending.pk);
