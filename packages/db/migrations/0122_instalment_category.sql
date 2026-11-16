/* The category a card instalment plan with no purchase counts in, Each month (owner, 16 Nov 2026): a plan whose purchase
   is older than the card's records in the app has no purchase to take a category from. Null is Uncategorised. Only read
   for a plan with no purchase; one tied to a purchase counts in the purchase's categories.

   card_installments does not sync. A plan with no purchase counts in the owner's Personal workspace only, so nothing of
   it reaches another phone. */

ALTER TABLE card_installments ADD COLUMN category_account_id TEXT;
