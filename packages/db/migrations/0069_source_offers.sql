-- Whether a source's offers are read for the purchase they report. 0 for every source: an offer is not a payment, and
-- reading one is the owner's choice, made per app in Settings › Capture. Some cards announce a purchase only inside a
-- rewards notification ("you earned 15 points from your card transaction of Rp 102.700"), which is the case this is
-- for; even switched on, an offer naming no transaction is still skipped.
ALTER TABLE capture_sources ADD COLUMN read_offers INTEGER NOT NULL DEFAULT 0;
