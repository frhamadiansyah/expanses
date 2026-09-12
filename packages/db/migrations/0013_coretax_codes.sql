-- The Coretax codes, corrected. Slice 6 converted every stored code to the old e-Form three-digit
-- list, which Coretax does not use; these are the four-digit codes from DJP's own guide.
--
-- tax_year_rows is deliberately untouched: a frozen row is what was filed, and rewriting it would
-- change a return after the fact.

-- SQLite cannot alter a CHECK, so asset_profiles is rebuilt again — back to four digits.
CREATE TABLE asset_profiles_new (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('fund', 'stock', 'bond', 'gold', 'property', 'vehicle', 'other', 'cash')),
  plan_group TEXT NOT NULL CHECK (plan_group IN ('liquid', 'invest', 'owed', 'use')),
  unit_kind TEXT CHECK (unit_kind IS NULL OR unit_kind IN ('units', 'shares', 'grams', 'face')),
  lot_size INTEGER CHECK (lot_size IS NULL OR lot_size > 0),
  risk TEXT CHECK (risk IS NULL OR risk IN ('low', 'medium', 'high')),
  coretax_section TEXT CHECK (coretax_section IS NULL OR coretax_section IN ('kas', 'piutang', 'investasi', 'bergerak', 'tidak_bergerak', 'lainnya')),
  coretax_code TEXT CHECK (coretax_code IS NULL OR (length(coretax_code) = 4 AND coretax_code GLOB '[0-9][0-9][0-9][0-9]')),
  coretax_fields_json TEXT NOT NULL DEFAULT '{}',
  acquired_year INTEGER CHECK (acquired_year IS NULL OR (acquired_year >= 1900 AND acquired_year <= 2999)),
  updated_at TEXT NOT NULL
);

-- Codes are converted on the way across, so no row has to satisfy both shapes at once.
-- Four mappings are a judgement, because Coretax splits what e-Form lumped together:
--   052 batu mulia    -> 0705 permata
--   053 seni dan antik -> 0706 barang-barang seni dan antik
--   055 elektronik/furnitur -> 0708 peralatan elektronik, losing the furniture sense of 0709
--   054 kapal pesiar/pesawat/olahraga -> 0799, since Coretax splits it across 0412, 0408 and 0707
-- The owner can change any of them per asset; none is silently assigned a specific wrong thing.
INSERT INTO asset_profiles_new (account_id, workspace_id, asset_kind, plan_group, unit_kind, lot_size, risk, coretax_section, coretax_code, coretax_fields_json, acquired_year, updated_at)
  SELECT account_id, workspace_id, asset_kind, plan_group, unit_kind, lot_size, risk, coretax_section,
    CASE coretax_code
      WHEN '011' THEN '0101'
      WHEN '012' THEN '0102'
      WHEN '013' THEN '0103'
      WHEN '014' THEN '0104'
      WHEN '015' THEN '0109'
      WHEN '019' THEN '0109'
      WHEN '021' THEN '0201'
      WHEN '022' THEN '0202'
      WHEN '029' THEN '0209'
      WHEN '031' THEN '0301'
      WHEN '032' THEN '0303'
      WHEN '033' THEN '0304'
      WHEN '034' THEN '0305'
      WHEN '035' THEN '0306'
      WHEN '036' THEN '0307'
      WHEN '037' THEN '0308'
      WHEN '038' THEN '0309'
      WHEN '039' THEN '0399'
      WHEN '041' THEN '0401'
      WHEN '042' THEN '0402'
      WHEN '043' THEN '0403'
      WHEN '049' THEN '0499'
      WHEN '051' THEN '0701'
      WHEN '052' THEN '0705'
      WHEN '053' THEN '0706'
      WHEN '054' THEN '0799'
      WHEN '055' THEN '0708'
      WHEN '059' THEN '0799'
      WHEN '061' THEN '0502'
      WHEN '062' THEN '0506'
      WHEN '063' THEN '0505'
      WHEN '069' THEN '0509'
      WHEN '071' THEN '0601'
      WHEN '072' THEN '0602'
      WHEN '073' THEN '0603'
      WHEN '079' THEN '0699'
      ELSE coretax_code
    END,
    coretax_fields_json, acquired_year, updated_at
  FROM asset_profiles;

DROP TABLE asset_profiles;

ALTER TABLE asset_profiles_new RENAME TO asset_profiles;

-- Receivables carry a kode harta and are corrected with the rest. Payables keep their e-Form codes:
-- the Coretax guide publishes no utang table and no utang converter, so nothing better is known yet.
UPDATE debt_profiles SET coretax_code = '0201' WHERE coretax_code = '021';
UPDATE debt_profiles SET coretax_code = '0202' WHERE coretax_code = '022';
UPDATE debt_profiles SET coretax_code = '0209' WHERE coretax_code = '029';
