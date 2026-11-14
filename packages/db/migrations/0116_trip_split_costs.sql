/* Split costs and Plan, two trip-wide switches of a shared event (owner, 14 Nov 2026). Both are the event's own fields,
   on its shared_events row, synced as `splitOff` and `planOff` of the shared_event entity: one value on every phone,
   the later write winning as the event's name and dates do.

   split_off = 1 is "one pot": no shares, balances or settling up are shown, and new spending is recorded with the whole
   amount on its payer, so nothing is owed. The splits already recorded stay as they are; switching back on shows them.
   plan_off = 1 hides the shared plan. Every event shared before this one splits costs and has a plan: both 0.

   No build before this one has the columns. An older build that took the fields would keep their clocks and drop the
   values, so a clock under those names here is none of this build's: it is dropped, and the values, sent again once
   this phone says its version (sync/repairs.ts, trip settings), are written. */
ALTER TABLE shared_events ADD COLUMN split_off INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shared_events ADD COLUMN plan_off INTEGER NOT NULL DEFAULT 0;
DELETE FROM sync_field_clocks WHERE entity = 'shared_event' AND field IN ('splitOff', 'planOff');
