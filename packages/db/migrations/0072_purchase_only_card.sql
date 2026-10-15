/* The card an older purchase was made with. Paid with offered a card account with one card as one row naming no card,
   so purchases made while an account had one card were saved with card_id null; once a supplementary was added and
   the old primary removed, they read as made on no card at all. Each such purchase is given the one card that could
   have made it on its date, and left alone when none or several could.

   A purchase: posted, naming no card, spent under an expense category and charged to exactly one credit-card account.

   A card could have made it when the purchase falls inside the card's time on the account: not after the card was
   removed, and not before it was recorded — except the account's first card, which is taken to have been in use from
   the start, because a card is often recorded after the account and after purchases typed in from before. A card's
   dates are UTC timestamps and a purchase's date is the owner's own day, so each end is read with a day's slack;
   slack only ever adds candidates, so a purchase near the day a card came or went is left alone rather than guessed.

   Only card_id null is ever written, so a purchase that names a card is never touched and running this again changes
   nothing. card_id is this device's alone (it is never synced), so nothing else has to follow. */
WITH purchase AS (
  SELECT t.id AS transaction_id, t.occurred_on, MIN(e.account_id) AS account_id
  FROM transactions t
  JOIN entries e ON e.transaction_id = t.id
  JOIN accounts a ON a.id = e.account_id AND a.subtype = 'credit_card'
  WHERE t.status = 'posted'
    AND t.card_id IS NULL
    AND EXISTS (SELECT 1 FROM entries x JOIN accounts xa ON xa.id = x.account_id WHERE x.transaction_id = t.id AND xa.kind = 'expense')
  GROUP BY t.id, t.occurred_on
  HAVING COUNT(DISTINCT e.account_id) = 1
),
could_have AS (
  SELECT p.transaction_id, c.id AS card_id
  FROM purchase p
  JOIN cards c ON c.account_id = p.account_id
  WHERE (c.archived_at IS NULL OR date(c.archived_at, '+1 day') >= p.occurred_on)
    AND (date(c.created_at, '-1 day') <= p.occurred_on
      OR c.created_at = (SELECT MIN(f.created_at) FROM cards f WHERE f.account_id = c.account_id))
),
sole AS (
  SELECT transaction_id, MIN(card_id) AS card_id FROM could_have GROUP BY transaction_id HAVING COUNT(*) = 1
)
UPDATE transactions
SET card_id = (SELECT sole.card_id FROM sole WHERE sole.transaction_id = transactions.id)
WHERE card_id IS NULL AND id IN (SELECT transaction_id FROM sole);
