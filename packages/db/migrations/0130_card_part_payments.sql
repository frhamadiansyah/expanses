/* Pay one purchase, own amount (2026-11-25): on a card statement, one purchase ticked and Pay may take less than what
   is left of it. That payment pays part of that one purchase, which keeps the rest to pay, and ticking it later pays the
   rest. A settlement (card_settlements, 0038) means a purchase paid whole, and holds one payment per purchase, so a
   payment that paid part of a purchase is named here instead: which purchase it was for, nothing else.

   How much of it went to the purchase is never stored: it is the payment's own amount, up to what the purchase still
   charged (statements.ts, `poolLinesOf`). Editing either one follows the edit, deleting the payment makes the purchase
   owed again, and deleting the purchase turns the payment into an ordinary card payment.

   A new table, so every row written before reads exactly as it did. This version exists so a linked device on an older
   build (Link my devices, 0126) holds every change made from it until it updates. Card settlements are not shared with
   a household, so neither is this. */
CREATE TABLE card_part_payments (
  payment_transaction_id TEXT PRIMARY KEY REFERENCES transactions(id),
  purchase_transaction_id TEXT NOT NULL REFERENCES transactions(id),
  workspace_id TEXT NOT NULL
);
CREATE INDEX card_part_payments_purchase ON card_part_payments(purchase_transaction_id);
