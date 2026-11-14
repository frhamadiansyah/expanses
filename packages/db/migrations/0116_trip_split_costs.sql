/* Split costs and Plan, two trip-wide switches of a shared event (owner, 14 Nov 2026). Both are the event's own fields,
   on its shared_events row, synced as `splitOff` and `planOff` of the shared_event entity: one value on every phone,
   the later write winning as the event's name and dates do.

   split_off = 1 is "one pot": no shares, balances or settling up are shown, and new spending is recorded with the whole
   amount on its payer, so nothing is owed. The splits already recorded stay as they are; switching back on shows them.
   plan_off = 1 hides the shared plan. Every event shared before this one splits costs and has a plan: both 0. */
ALTER TABLE shared_events ADD COLUMN split_off INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shared_events ADD COLUMN plan_off INTEGER NOT NULL DEFAULT 0;

/* No build before this one has the columns. An older build that applied a switch kept its clock and dropped the value —
   but it also kept the event's row as the log made it (sync/events/log-rows.ts: `shared-events.log.<book>|shared_event|
   <book>` in settings), every field the op carried with its clock, the switches included. Where that saved clock is the
   very clock the field holds, the saved value is the one the clock stands for: it is written now, and the clock stays,
   so the phone agrees with the others from its first open. */
UPDATE shared_events SET split_off = (
  SELECT CASE WHEN CAST(json_extract(s.value, '$.values.splitOff') AS INTEGER) = 1 THEN 1 ELSE 0 END
  FROM settings s JOIN sync_field_clocks c ON c.book_id = shared_events.book_id AND c.entity = 'shared_event' AND c.id = shared_events.book_id AND c.field = 'splitOff'
  WHERE s.key = 'shared-events.log.' || shared_events.book_id || '|shared_event|' || shared_events.book_id
    AND json_valid(s.value) AND json_extract(s.value, '$.clocks.splitOff') = c.hlc AND json_type(s.value, '$.values.splitOff') IS NOT NULL)
WHERE EXISTS (
  SELECT 1 FROM settings s JOIN sync_field_clocks c ON c.book_id = shared_events.book_id AND c.entity = 'shared_event' AND c.id = shared_events.book_id AND c.field = 'splitOff'
  WHERE s.key = 'shared-events.log.' || shared_events.book_id || '|shared_event|' || shared_events.book_id
    AND json_valid(s.value) AND json_extract(s.value, '$.clocks.splitOff') = c.hlc AND json_type(s.value, '$.values.splitOff') IS NOT NULL);

UPDATE shared_events SET plan_off = (
  SELECT CASE WHEN CAST(json_extract(s.value, '$.values.planOff') AS INTEGER) = 1 THEN 1 ELSE 0 END
  FROM settings s JOIN sync_field_clocks c ON c.book_id = shared_events.book_id AND c.entity = 'shared_event' AND c.id = shared_events.book_id AND c.field = 'planOff'
  WHERE s.key = 'shared-events.log.' || shared_events.book_id || '|shared_event|' || shared_events.book_id
    AND json_valid(s.value) AND json_extract(s.value, '$.clocks.planOff') = c.hlc AND json_type(s.value, '$.values.planOff') IS NOT NULL)
WHERE EXISTS (
  SELECT 1 FROM settings s JOIN sync_field_clocks c ON c.book_id = shared_events.book_id AND c.entity = 'shared_event' AND c.id = shared_events.book_id AND c.field = 'planOff'
  WHERE s.key = 'shared-events.log.' || shared_events.book_id || '|shared_event|' || shared_events.book_id
    AND json_valid(s.value) AND json_extract(s.value, '$.clocks.planOff') = c.hlc AND json_type(s.value, '$.values.planOff') IS NOT NULL);

/* A clock whose value cannot be found that way is none of this build's: it is dropped, and the value, sent again once
   this phone says its version (sync/repairs.ts, R5 trip switches), is written then. */
DELETE FROM sync_field_clocks
WHERE entity = 'shared_event' AND field IN ('splitOff', 'planOff')
  AND NOT EXISTS (
    SELECT 1 FROM settings s
    WHERE s.key = 'shared-events.log.' || sync_field_clocks.book_id || '|shared_event|' || sync_field_clocks.id
      AND json_valid(s.value) AND json_extract(s.value, '$.clocks.' || sync_field_clocks.field) = sync_field_clocks.hlc
      AND json_type(s.value, '$.values.' || sync_field_clocks.field) IS NOT NULL);
