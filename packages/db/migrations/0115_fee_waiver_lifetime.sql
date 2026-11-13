/* Free for life (owner, 13 Nov 2026): a card whose annual fee is always waived. card_fee_waivers took only a yearly
   amount ('automatic') or a challenge, each with an amount above nothing; a lifetime waiver has nothing to spend, so its
   amount is NULL. SQLite cannot change a CHECK in place, so the table is rebuilt and every row copied as it is, fee_year
   (0113) included.

   card_fee_waivers is this phone's own and never synced (see 0113): no sync entity, clock or outbox row names it, so
   the rebuild touches nothing another phone reads.

   One waived mark per fee year (owner ruling, 13 Nov 2026): card_terms.annual_fee_waived_year keeps one year, so a
   second "Waived, not charged" overwrote the first. card_fee_waived_years keeps one row per card and year, filled from
   the year card_terms holds; card_terms goes on holding the latest one for the readers that read it. Like card_terms
   (never synced: no sync entity names it), it is this phone's own. */

CREATE TABLE card_fee_waivers_new (
  account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('automatic', 'challenge', 'lifetime')),
  amount_minor INTEGER CHECK ((kind = 'lifetime' AND (amount_minor IS NULL OR amount_minor = 0)) OR (kind != 'lifetime' AND amount_minor > 0)),
  counted_from TEXT,
  spend_by TEXT,
  -- JSON array of category ids that count; '[]' = every purchase.
  category_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  fee_year INTEGER
);

INSERT INTO card_fee_waivers_new (account_id, workspace_id, kind, amount_minor, counted_from, spend_by, category_ids, created_at, fee_year)
SELECT account_id, workspace_id, kind, amount_minor, counted_from, spend_by, category_ids, created_at, fee_year FROM card_fee_waivers;

DROP TABLE card_fee_waivers;
ALTER TABLE card_fee_waivers_new RENAME TO card_fee_waivers;

CREATE TABLE card_fee_waived_years (
  account_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  fee_year INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, fee_year)
);

INSERT INTO card_fee_waived_years (account_id, workspace_id, fee_year, created_at)
SELECT account_id, workspace_id, annual_fee_waived_year, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM card_terms WHERE annual_fee_waived_year IS NOT NULL;
