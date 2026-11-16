/* How an instalment plan's spending counts (owner, 16 Nov 2026, card instalments option C): 'each_month' counts each
   instalment as that month's spending on its statement date, in the purchase's category, and the purchase it came from
   counts nothing; 'at_purchase' counts the purchase in full on its day, as before, each instalment being only a
   repayment of the card. New plans count each month.

   A plan the app saved before this had no way to name its purchase (the plan sheet never asked), so almost every plan
   kept has none. Counted each month, such a plan would count its instalments under Uncategorised on top of the purchase,
   which is still recorded on its own day: the same money twice. So a plan with no purchase keeps counting as it always
   did (at purchase, which for a plan without one counts nothing), and one tied to its purchase moves to each month, as
   the owner asked. Choosing the purchase on the plan's page and then Each month spreads it.

   card_installments does not sync (no sync entity), so the new column goes to no other phone. */

ALTER TABLE card_installments ADD COLUMN count_mode TEXT NOT NULL DEFAULT 'each_month' CHECK (count_mode IN ('at_purchase', 'each_month'));

UPDATE card_installments SET count_mode = 'at_purchase' WHERE transaction_id IS NULL;
