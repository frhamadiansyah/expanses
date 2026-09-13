-- How each holding's income is taxed, and which dividends were reinvested.
--
-- Nothing here is inferred. An ORI coupon is final, a corporate coupon is final, a foreign bond's is
-- not, and a dividend is final unless it was reinvested — no fact about "this holding is a bond"
-- decides that, so the owner sets it once and the report repeats it.

ALTER TABLE asset_profiles ADD COLUMN tax_treatment TEXT CHECK (tax_treatment IS NULL OR tax_treatment IN ('final', 'not_object', 'ordinary'));

-- A reinvested dividend is a declaration, not a trail. The money lands in a broker account and mixes
-- with everything else there; no rule can say which rupiah bought the instrument, and DJP does not
-- ask. What the Laporan Realisasi Investasi wants is how much went where, which is what these hold.
ALTER TABLE investment_trades ADD COLUMN reinvested_minor INTEGER;
ALTER TABLE investment_trades ADD COLUMN reinvested_into_account_id TEXT REFERENCES accounts(id);
