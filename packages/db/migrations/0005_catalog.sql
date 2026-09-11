-- Card catalogue: original currency on purchases, catalogue links on programs and rows, cycle bonuses, transfer partners.
ALTER TABLE transactions ADD COLUMN original_currency TEXT;
ALTER TABLE transactions ADD COLUMN original_amount_minor INTEGER;

ALTER TABLE reward_programs ADD COLUMN catalog_entry_id TEXT;
ALTER TABLE reward_programs ADD COLUMN catalog_entry_version INTEGER;
ALTER TABLE reward_programs ADD COLUMN catalog_status TEXT CHECK (catalog_status IN ('linked', 'customised'));
ALTER TABLE reward_programs ADD COLUMN catalog_dismissed_version INTEGER;
-- The entry as applied, so update diffs compare applied terms with the bundled ones.
ALTER TABLE reward_programs ADD COLUMN catalog_snapshot_json TEXT;

ALTER TABLE earn_rules ADD COLUMN catalog_key TEXT;
ALTER TABLE redemption_options ADD COLUMN catalog_key TEXT;

CREATE TABLE cycle_bonuses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  program_id TEXT NOT NULL REFERENCES reward_programs(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  tiers_json TEXT NOT NULL,
  match_json TEXT NOT NULL DEFAULT '{}',
  valid_from TEXT,
  valid_to TEXT,
  catalog_key TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX cycle_bonuses_program ON cycle_bonuses (program_id);

CREATE TABLE transfer_partners (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  program_id TEXT NOT NULL REFERENCES reward_programs(id),
  key TEXT NOT NULL,
  program_name TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points > 0),
  partner_units INTEGER NOT NULL CHECK (partner_units > 0),
  increment_points INTEGER NOT NULL CHECK (increment_points > 0),
  valid_from TEXT,
  valid_to TEXT,
  catalog_key TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX transfer_partners_program ON transfer_partners (program_id);
