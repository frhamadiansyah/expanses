/* Four facts from the health-ratio work, each in a table of its own rather than a column on accounts, budgets,
   goal_stages or goal_calculators: the ORM names every column it knows on every insert, so a column there would break
   any database still stopped at an older version (see 0028 and 0048). Nothing is backfilled: an absent row is today's
   behaviour. */

/* Whether a spending category is a need or a choice. No row: take the nearest marked ancestor's, else essential. */
CREATE TABLE category_needs (
  category_account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  need TEXT NOT NULL CHECK (need IN ('essential', 'lifestyle'))
);
CREATE INDEX category_needs_workspace ON category_needs (workspace_id);

/* A cap typed in another unit than a month. budgets.amount_minor still holds the monthly figure every reader uses;
   this keeps what was typed and in what unit. No row: monthly. */
CREATE TABLE budget_frequencies (
  budget_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'quarterly', 'yearly')),
  amount_as_set_minor INTEGER NOT NULL CHECK (amount_as_set_minor > 0)
);

/* What one goal stage assumes beyond the goal: its own return (an education level's), and the key a calculator gave
   it so a re-worked goal keeps the same stage — and its paid mark. No row: the goal's return, not derived. */
CREATE TABLE goal_stage_terms (
  stage_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  return_bps INTEGER CHECK (return_bps IS NULL OR return_bps >= 0),
  derived_key TEXT
);
CREATE INDEX goal_stage_terms_goal ON goal_stage_terms (workspace_id, goal_id);

/* What a calculator that saves no goal was last given (life cover), so the page opens on the figures typed before.
   One row per workspace and calculator; kind is open text so a new calculator needs no table rebuild. No row: the
   calculator's own prefill. */
CREATE TABLE calculator_inputs (
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (length(kind) > 0),
  inputs_json TEXT NOT NULL CHECK (json_valid(inputs_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, kind)
);
