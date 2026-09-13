/* Reusable collections of categories, kept apart from the monthly tree.

   A renovation, a newborn, a holiday each spend on things the monthly budget has no line for, and
   that sit dormant the rest of the year. Putting them in the monthly tree clutters every category
   picker in the app; giving each event its own private categories makes the same list unusable
   twice. A set is the middle: named once, used by any number of events.

   Membership is a table of its own rather than a column on accounts. The ORM names every column it
   knows on every insert, and accounts is the table a new workspace seeds — so a column here would
   break any database still stopped at an older version. The primary key is the category, which is
   what keeps a category in at most one set. */
CREATE TABLE category_sets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX category_sets_workspace ON category_sets (workspace_id);

CREATE TABLE category_set_members (
  category_account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL,
  set_id TEXT NOT NULL REFERENCES category_sets(id)
);

CREATE INDEX category_set_members_set ON category_set_members (workspace_id, set_id);

/* The set an event draws on, when it draws on one rather than the monthly categories. Events are a
   table from 0026 that no older seed writes, so a column is safe here. */
ALTER TABLE events ADD COLUMN set_id TEXT REFERENCES category_sets(id);
