-- Some assets are yours but are not reported as harta. BPJS Ketenagakerjaan JHT is the case that
-- forced this: the balance enters Daftar Harta only once it has been disbursed and received, not
-- while it sits at BPJS. Without a flag it would fall to a default code and be filed as property.
ALTER TABLE asset_profiles ADD COLUMN reportable INTEGER NOT NULL DEFAULT 1;
