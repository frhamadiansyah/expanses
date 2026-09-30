/* A colour picked by hand for a top-level category. No row means the colour the app works out for it, which is what
   every category has had until now, so nothing is backfilled.

   A side table rather than a column on accounts, for the reason 0028 gives: the ORM names every column it knows on
   every insert, and accounts is the table a new workspace seeds, so a column there would break any database still
   stopped at an older version. Numbered 0060 because 0056–0059 (household sharing and joint net worth, on main) are taken.
   It first shipped to dev builds as 0059; the runner drops a version recorded under another name and runs this one
   again, so the table and index are created only if they are not there already.

   Only a top-level category carries one — its subcategories are drawn in shades of it — and that rule is kept by the
   code that writes here (setCategoryColour, and moveCategory, which drops the row when the category gains a parent).
   The colour is one of the palette's lowercase #rrggbb values; the check keeps anything else out.

   No REFERENCES clause, as in 0048, 0054 and 0055, so a later rebuild of accounts never has to defer keys for it. */
CREATE TABLE IF NOT EXISTS category_colours (
  category_account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  colour TEXT NOT NULL CHECK (colour GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')
);
CREATE INDEX IF NOT EXISTS category_colours_workspace ON category_colours (workspace_id);
