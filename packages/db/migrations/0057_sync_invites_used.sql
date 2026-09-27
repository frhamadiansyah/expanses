-- Household sharing, task 5 fix rounds 1–2 (spec §5.4, §8.2, §8.4, §8.5). Unreleased with 0056.
--
-- Each invite introduces at most one device. Apply records the invite an accepted introduction used; a later
-- introduction on the same invite is refused on every device alike.
CREATE TABLE sync_invites_used (
  book_id   TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  PRIMARY KEY (book_id, invite_id)
);

-- The authority view: who is an owner and which devices are in, as the log says it, entry by entry in seq order —
-- this device's own entries included, at their seq. It changes only when log entries are applied, never with a local
-- edit not yet synced, so every device decides every removal, role, member delete and introduction alike. Each field
-- keeps the hlc it last changed at, so the view merges like the rows do.
CREATE TABLE sync_authority (
  book_id  TEXT NOT NULL,
  member_id TEXT NOT NULL,
  role     TEXT NOT NULL,
  role_hlc TEXT NOT NULL,
  deleted  INTEGER NOT NULL DEFAULT 0,
  row_hlc  TEXT NOT NULL,
  PRIMARY KEY (book_id, member_id)
);
CREATE TABLE sync_authority_devices (
  book_id     TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  removed_seq INTEGER,                 -- the seq of the removal entry that removed it
  PRIMARY KEY (book_id, device_id)
);
