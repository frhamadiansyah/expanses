/* Month starts on (owner, 16 Nov 2026): the day a workspace's months begin, for a salary paid on the 25th. 1 is the
   calendar month, which is every workspace's until the setting is changed; 2–28 are those days, and 31 is "Last day of
   the month". It only regroups what Cashflow, Budget, bills and reports count in a month: no transaction, bill month,
   statement cycle or loan schedule is changed by it. A shared workspace's value is the book's own, synced as
   `monthStartDay` of the book entity: one value on every phone, the later change winning as the name does.

   (0117 is income_category_names, on another branch.) */
ALTER TABLE books ADD COLUMN month_start_day INTEGER NOT NULL DEFAULT 1;

/* No build before this one has the column. One that applied a change from a newer phone kept the field's clock and
   dropped the value, so the value sent again would lose to the clock it already holds. Those clocks are none of this
   build's: they go, and the value is written when it is sent again — each phone sends it once it sees this one at
   MONTH_START_MIN_APP_VERSION (sync/repairs.ts, R6 month start). */
DELETE FROM sync_field_clocks WHERE entity = 'book' AND field = 'monthStartDay';
