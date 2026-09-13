/* An occasion that causes spending across many categories and a few weeks: a birth, a wedding, a
   renovation, a trip, Lebaran. Transactions already carry event_id; nothing had ever written it. */
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  /* A figure for the whole occasion, for anyone who would rather not plan it category by category. */
  planned_minor INTEGER,
  /* The goal saved up for it, when there is one. */
  goal_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX events_workspace ON events (workspace_id);

/* What the occasion is expected to cost, category by category. A row here also says the category is
   one the event draws on, which is what makes suggesting its transactions precise. */
CREATE TABLE event_budgets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  category_account_id TEXT NOT NULL REFERENCES accounts(id),
  planned_minor INTEGER,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX event_budgets_category ON event_budgets (workspace_id, event_id, category_account_id);
