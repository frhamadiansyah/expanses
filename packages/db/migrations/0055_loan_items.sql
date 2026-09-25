/* Which kind of loan a loan is, as the catalogue named it when the debt was opened: "Home mortgage",
   "Vehicle leasing", "Online loan or paylater", "Personal loan" and the rest.

   A side table rather than a column on loan_terms, because the ORM names every column it knows on every insert
   and a new one would break a database still stopped at an older version (see 0028, 0048, 0053). No row means the
   loan was never classified: it reads as what its own facts say — a loan against a property is a mortgage, one
   against a vehicle is a lease, anything else is a loan — which is what every loan was until now, so nothing is
   backfilled.

   No REFERENCES clause, as in 0048 and 0054, so a later rebuild of accounts never has to defer keys for it.
   Pure CREATE statements, so it lands in any order beside any later migration: migrate() is set-based and simply
   applies 0055 to a database already at a higher version. */
CREATE TABLE loan_items (
  account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  item_id TEXT NOT NULL CHECK (length(item_id) > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX loan_items_workspace ON loan_items (workspace_id);
