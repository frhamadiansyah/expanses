/* Owner rings (owner, 12 Nov 2026): each member's own ring colour, the same on every phone in the household.

   Two nullable columns on a net-worth group's nw_pending row — the one row of the group log each member alone writes.
   ring_json is the member's pick ({"colour","at","sent"}); ring_devices_json lists the member's devices that read
   rings and what this member last sent their pick to, so a phone updated from an older build (which passed the ring
   over) is sent it again. Additive only: an older build syncs on without them. */

ALTER TABLE nw_pending ADD COLUMN ring_json TEXT;
ALTER TABLE nw_pending ADD COLUMN ring_devices_json TEXT;
