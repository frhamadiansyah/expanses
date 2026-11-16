/* A third mark on a spending category, Debts & savings (owner, 16 Nov 2026): insurance, donations, loan interest —
   spending that is neither essential nor lifestyle. category_needs took only 'essential' and 'lifestyle' (0053), and
   SQLite cannot change a CHECK in place, so the table is rebuilt and every row copied as it is: same category ids, same
   workspace, same mark. Its index is made again under the same name.

   category_needs syncs (the category_need entity, keyed by category_account_id). Its clocks and tombstones live in
   sync_field_clocks / sync_tombstones, keyed by that id and never by rowid, so the rebuild leaves every one of them
   standing. An older build's table still refuses the new value, so a phone never sends it into a shared book until
   every other phone there says it runs a build with this migration (NEEDS_THIRD_MARK_MIN_APP_VERSION, sync/capture.ts),
   and sends it again then (sync/repairs.ts, R7). */

CREATE TABLE category_needs_new (
  category_account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  need TEXT NOT NULL CHECK (need IN ('essential', 'lifestyle', 'debts_savings'))
);

INSERT INTO category_needs_new (category_account_id, workspace_id, need)
SELECT category_account_id, workspace_id, need FROM category_needs;

DROP TABLE category_needs;
ALTER TABLE category_needs_new RENAME TO category_needs;
CREATE INDEX category_needs_workspace ON category_needs (workspace_id);
