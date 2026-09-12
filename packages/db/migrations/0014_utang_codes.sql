-- The kode utang, corrected. Migration 0012 moved every payable from 109 to 104 on the strength of
-- a secondary source describing e-Form. DJP's own Petunjuk Pengisian Daftar Rincian Harta dan Utang
-- lists the kode utang as 101, 102, 103 and 109 — there is no 104 at all.
--
-- tax_year_rows is deliberately untouched: a frozen row is what was filed, and rewriting it would
-- change a return after the fact.
UPDATE debt_profiles SET coretax_code = '109' WHERE coretax_code = '104';
