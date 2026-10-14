-- The exact figure of an amount typed with cents in a currency with no minor unit (rupiah, yen, won): 12.500,30 is
-- 1250030, in hundredths of the currency unit. The ledger keeps the whole figure (rounded up for money out, down for
-- money in); this is kept beside it, for card points, which a bank works out on the amount rounded down. Always
-- positive (the sign is on the lines), NULL when the amount had no cents. Synced as part of a purchase
-- (`exactHundredths`). A draft read from a capture or a statement keeps its own until it is confirmed.
ALTER TABLE transactions ADD COLUMN exact_hundredths INTEGER;
ALTER TABLE draft_transactions ADD COLUMN exact_hundredths INTEGER;
