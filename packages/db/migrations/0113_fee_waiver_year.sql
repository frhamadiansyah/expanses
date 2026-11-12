/* The fee year a challenge is for (owner, 12 Nov 2026): the year of the annual fee charge the bank's spending challenge
   waives, kept when the challenge is saved, so Fee waived is offered for that fee and no other — a challenge given
   after the fee posted (spend by three months later) is still that fee's, and a short one is never two years'.

   card_fee_waivers is this phone's own (never synced), so the column is too. A row saved before this has none: it is
   read as the year of the charge its last day covers. Additive only.

   The index serves the walk from an edited refund back to what it replaced (transactions.replaces_transaction_id). */

ALTER TABLE card_fee_waivers ADD COLUMN fee_year INTEGER;
CREATE INDEX IF NOT EXISTS transactions_replaces_idx ON transactions (replaces_transaction_id);
