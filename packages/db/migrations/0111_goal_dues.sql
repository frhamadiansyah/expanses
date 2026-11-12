/* A goal's Monthly that comes due like a bill (owner, 12 Nov 2026): each month from the month it was turned on, the
   goal's Monthly amount waits for a tap — Set aside, Transfer or Skip. Nothing happens by itself.

   Both tables are this phone's own (owner scope) and are never synced: on a shared goal each phone keeps its own
   due settings and months for its own person, and the set-aside or transfer a month makes goes through the paths
   that already sync. Additive only.

   goal_dues: one row per goal. day is 1–31; a month shorter than it comes due on its last day (31 = "Last day").
   mode 'set_aside' keeps the money in account_id, promised to the goal; 'transfer' moves it from account_id to
   to_account_id. started_month (YYYY-MM) is the first month due; active 0 is the switch turned off.

   goal_due_months: what was done with one month. No row is an open month. 'done' carries the amount, the day, the
   account(s) and the transfer it posted (transaction_id, transfer mode only); 'skipped' carries nothing else. */

CREATE TABLE goal_dues (
  goal_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
  mode TEXT NOT NULL CHECK (mode IN ('set_aside', 'transfer')),
  account_id TEXT,
  to_account_id TEXT,
  started_month TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX goal_dues_workspace ON goal_dues (workspace_id);

CREATE TABLE goal_due_months (
  goal_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  month TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('done', 'skipped')),
  mode TEXT CHECK (mode IN ('set_aside', 'transfer')),
  amount_minor INTEGER,
  occurred_on TEXT,
  account_id TEXT,
  to_account_id TEXT,
  transaction_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (goal_id, month)
);

CREATE INDEX goal_due_months_workspace ON goal_due_months (workspace_id, month);
