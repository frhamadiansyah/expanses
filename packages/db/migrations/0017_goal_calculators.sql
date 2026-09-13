-- A goal whose target was worked out rather than typed.
--
-- The row exists only while the link holds: typing an amount by hand deletes it, and the goal keeps
-- whatever was typed. Inputs are kept so the working can be reopened and one assumption changed.

CREATE TABLE goal_calculators (
  goal_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('emergency', 'education', 'retirement')),
  inputs_json TEXT NOT NULL,
  -- What it came to when it was last worked out. An emergency fund counts months instead, and stores 0.
  computed_minor INTEGER NOT NULL,
  computed_at TEXT NOT NULL
);
