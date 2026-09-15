/* Which card a draft was made on.

   A row typed into the transactions table can name a card — a supplementary card shares its holder's
   statement — and that has to survive until the draft is recorded, or the purchase lands on the
   account with no way to tell whose spending it was. */
ALTER TABLE draft_transactions ADD COLUMN card_id TEXT REFERENCES cards(id);
