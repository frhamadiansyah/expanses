/* How many of a card instalment plan's instalments are paid (owner, 17 Nov 2026), for a plan with no purchase in the
   app: set when the plan is added — every instalment whose payment was due before that day — and changed by ticking
   the plan's list. The rest is owed: posted once on the card as a balance line (external_ref plan-owed:<plan>), billed
   on the statements, and the only instalments that count as spending. A plan tied to a purchase keeps 0: the purchase
   put its debt on the card, and the card's payments mark its instalments paid.

   card_installments does not sync; another phone counts the same instalments from plan_spreads.records_from. Plans
   from before this migration are set once on opening the app, from the day each was added
   (repairPlanPaidSoFar). */

ALTER TABLE card_installments ADD COLUMN paid_so_far INTEGER NOT NULL DEFAULT 0;
