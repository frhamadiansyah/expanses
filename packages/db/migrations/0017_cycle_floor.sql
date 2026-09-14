-- A rule can require the whole cycle to reach a spend floor before it earns at all, the way Danamon lifts
-- D-Point to 3x only once the month's retail transactions reach Rp 1.500.000. Unlike min_transaction_minor
-- this is not a floor per purchase: once the cycle reaches it, the rule earns over every matching purchase.
ALTER TABLE earn_rules ADD COLUMN min_cycle_spend_minor INTEGER;
