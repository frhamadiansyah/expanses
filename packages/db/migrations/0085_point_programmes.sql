-- A points programme is a balance of its own, not a card's.
--
-- Until now `reward_programs` was one per card and was two things at once: the card's earning setup (its rules,
-- bonuses, partners, catalogue link, crediting, cycle) and the points balance (the ledger, the snapshots read from the
-- issuer's app, the expiry policy). A bank card earns into the bank's programme, a co-brand card straight into the
-- airline's or the hotel's, two cards can earn into one, and points move from one programme into another at that
-- programme's ratio — so the balance is lifted out into `point_programmes`, and the card says which one it earns into.
--
-- The earning setup stays where it is: `reward_programs` and everything keyed by it (earn_rules, cycle_bonuses,
-- redemption_options, transfer_partners, cycle_actuals, transaction_point_actuals, catalog_category_choices) is the
-- card's and is untouched. The ledger keeps its column: `point_entries.program_id` and `point_snapshots.program_id`
-- now name the balance programme.
--
-- Every existing program becomes a programme with the same id, name, unit and expiry, earning into itself. Because the
-- ids are the same, not one ledger row or snapshot is rewritten: each card's balance is exactly what it was.
CREATE TABLE point_programmes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('points', 'miles', 'cashback')),
  expiry_policy TEXT NOT NULL DEFAULT 'none' CHECK (expiry_policy IN ('none', 'months_from_earn', 'fixed_annual')),
  expiry_months INTEGER,
  archived_at TEXT,
  created_at TEXT NOT NULL
);

-- Which programme a card's earning goes into: one row per reward program. A table of its own rather than a column on
-- reward_programs, so a database stopped at an older version still reads and writes reward_programs as it did.
CREATE TABLE earns_into (
  program_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  programme_id TEXT NOT NULL
);
CREATE INDEX earns_into_programme ON earns_into (programme_id);

-- Which card's rules earned an entry. Two cards earning into one programme each rewrite only their own points when
-- a cycle is worked out again. Null on anything that is not an earn.
ALTER TABLE point_entries ADD COLUMN earned_by_id TEXT;
-- The two sides of one conversion share this id — the points that left one programme and what arrived in the other —
-- so removing either removes both.
ALTER TABLE point_entries ADD COLUMN conversion_id TEXT;
CREATE INDEX point_entries_conversion ON point_entries (conversion_id);

INSERT INTO point_programmes (id, workspace_id, name, unit, expiry_policy, expiry_months, archived_at, created_at)
  SELECT id, workspace_id, name, unit, expiry_policy, expiry_months, archived_at, created_at FROM reward_programs;
INSERT INTO earns_into (program_id, workspace_id, programme_id)
  SELECT id, workspace_id, id FROM reward_programs;
UPDATE point_entries SET earned_by_id = program_id WHERE kind = 'earn';
