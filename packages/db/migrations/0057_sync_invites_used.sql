-- Household sharing, task 5 fix round 1 (spec §8.2, C3): each invite introduces at most one device. Apply records the
-- invite an accepted introduction used; a later introduction on the same invite is refused on every device alike.
CREATE TABLE sync_invites_used (
  book_id   TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  PRIMARY KEY (book_id, invite_id)
);
