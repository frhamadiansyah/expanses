/* Free for life (owner, 13 Nov 2026): a card whose annual fee is always waived. card_fee_waivers took only a yearly
   amount ('automatic') or a challenge, each with an amount above nothing; a lifetime waiver has nothing to spend, so its
   amount is NULL. SQLite cannot change a CHECK in place, so the table is rebuilt and every row copied as it is, fee_year
   (0113) included.

   card_fee_waivers is this phone's own and never synced (see 0113): no sync entity, clock or outbox row names it, so
   the rebuild touches nothing another phone reads. */

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
