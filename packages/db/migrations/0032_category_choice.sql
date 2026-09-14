-- A card can pay double on one category the holder picks from a menu the bank publishes, changeable every
-- billing cycle. Which option is running belongs to the holder, and it is dated: a cycle that has closed keeps
-- the category that was running while it ran.
--
-- It is its own table rather than a column because re-applying an entry rewrites every catalogue rule. Holding
-- the stretches here lets the apply rebuild the whole history, instead of rewriting the past with today's pick.
CREATE TABLE catalog_category_choices (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  program_id TEXT NOT NULL REFERENCES reward_programs(id),
  option_key TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX catalog_category_choices_program ON catalog_category_choices (workspace_id, program_id, valid_from);
