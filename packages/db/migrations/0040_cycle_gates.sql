/* Qualifying conditions written against the cycle rather than against the rule's own spend.

   An issuer often asks for something the reward itself is not measured on: Permata pays 5% back but only in a
   billing cycle that reached Rp 5.000.000 of spending, online and offline together; Danamon pays 10% at the
   weekend but only in a month holding five purchases of Rp 100.000 or more. min_cycle_spend_minor cannot say
   either, because it counts only the spend its own rule matches.

   These three sit beside it: a floor on the cycle's whole earning spend, and a count of purchases of at least a
   given size. A rule carrying them is in or out for the entire cycle, decided before any spend is allocated. */
ALTER TABLE earn_rules ADD COLUMN min_cycle_total_minor INTEGER;
ALTER TABLE earn_rules ADD COLUMN min_cycle_purchases INTEGER;
ALTER TABLE earn_rules ADD COLUMN min_cycle_purchase_minor INTEGER;
