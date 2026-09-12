-- The yearly Coretax report: a draft follows the ledger, a frozen one is a copy that stops
-- following it, and a filed one is read-only and becomes next year's carry-over base.

CREATE TABLE tax_year_reports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'frozen', 'filed')),
  frozen_at TEXT,
  filed_on TEXT,
  npwp TEXT,
  taxpayer_name TEXT,
  property_basis TEXT NOT NULL DEFAULT 'cost' CHECK (property_basis IN ('cost', 'estimate', 'njop', 'appraisal')),
  repeat_rows TEXT NOT NULL DEFAULT 'holding' CHECK (repeat_rows IN ('holding', 'year')),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX tax_year_reports_year ON tax_year_reports (workspace_id, tax_year);

CREATE TABLE tax_year_rows (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES tax_year_reports(id),
  workspace_id TEXT NOT NULL,
  -- A harta section, or 'utang' for Bagian B.
  section TEXT NOT NULL,
  code TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id),
  row_key TEXT NOT NULL,
  name TEXT NOT NULL,
  acquired_year INTEGER,
  sort INTEGER NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '{}',
  cost_minor INTEGER NOT NULL DEFAULT 0,
  value_minor INTEGER NOT NULL DEFAULT 0,
  balance_minor INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'edited', 'manual')),
  -- Marks a row that was already on a return filed before this app was used.
  already_filed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX tax_year_rows_report ON tax_year_rows (report_id, sort);

-- SQLite cannot alter a CHECK constraint, so fx_rates is rebuilt to admit the KMK rate:
-- the rate the Ministry publishes for 31 December, which the report needs and a market rate cannot replace.
CREATE TABLE fx_rates_new (
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  on_date TEXT NOT NULL,
  rate REAL NOT NULL CHECK (rate > 0),
  source TEXT NOT NULL CHECK (source IN ('frankfurter', 'manual', 'kmk')),
  source_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (from_currency, to_currency, on_date)
);

INSERT INTO fx_rates_new (from_currency, to_currency, on_date, rate, source, source_date, fetched_at)
  SELECT from_currency, to_currency, on_date, rate, source, source_date, fetched_at FROM fx_rates;

DROP TABLE fx_rates;

ALTER TABLE fx_rates_new RENAME TO fx_rates;

-- asset_profiles was created with a four-digit CHECK on coretax_code, back when the codes in this
-- project were placeholders. Real kode harta are three digits, so the table is rebuilt to match.
CREATE TABLE asset_profiles_new (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('fund', 'stock', 'bond', 'gold', 'property', 'vehicle', 'other', 'cash')),
  plan_group TEXT NOT NULL CHECK (plan_group IN ('liquid', 'invest', 'owed', 'use')),
  unit_kind TEXT CHECK (unit_kind IS NULL OR unit_kind IN ('units', 'shares', 'grams', 'face')),
  lot_size INTEGER CHECK (lot_size IS NULL OR lot_size > 0),
  risk TEXT CHECK (risk IS NULL OR risk IN ('low', 'medium', 'high')),
  coretax_section TEXT CHECK (coretax_section IS NULL OR coretax_section IN ('kas', 'piutang', 'investasi', 'bergerak', 'tidak_bergerak', 'lainnya')),
  coretax_code TEXT CHECK (coretax_code IS NULL OR (length(coretax_code) = 3 AND coretax_code GLOB '[0-9][0-9][0-9]')),
  coretax_fields_json TEXT NOT NULL DEFAULT '{}',
  acquired_year INTEGER CHECK (acquired_year IS NULL OR (acquired_year >= 1900 AND acquired_year <= 2999)),
  updated_at TEXT NOT NULL
);

-- The codes are corrected on the way across, so no row ever has to satisfy both shapes at once.
INSERT INTO asset_profiles_new (account_id, workspace_id, asset_kind, plan_group, unit_kind, lot_size, risk, coretax_section, coretax_code, coretax_fields_json, acquired_year, updated_at)
  SELECT account_id, workspace_id, asset_kind, plan_group, unit_kind, lot_size, risk, coretax_section,
    CASE coretax_code
      WHEN '0102' THEN '012'
      WHEN '0306' THEN '036'
      WHEN '0302' THEN '032'
      WHEN '0304' THEN '034'
      WHEN '0701' THEN '051'
      WHEN '0502' THEN '061'
      WHEN '0403' THEN '043'
      WHEN '0799' THEN '059'
      ELSE coretax_code
    END,
    coretax_fields_json, acquired_year, updated_at
  FROM asset_profiles;

DROP TABLE asset_profiles;

ALTER TABLE asset_profiles_new RENAME TO asset_profiles;

-- Placeholder codes written by slice 4, corrected to the verified three-digit ones.
-- A code the owner already changed by hand is left alone: only the exact placeholders are rewritten.
UPDATE debt_profiles SET coretax_code = '021' WHERE coretax_code = '0201';
UPDATE debt_profiles SET coretax_code = '022' WHERE coretax_code = '0202';
UPDATE debt_profiles SET coretax_code = '104' WHERE coretax_code = '109';
