-- Household sharing (spec §4.2). Side tables only; no column is added to any existing table.

CREATE TABLE shared_books (
  book_id       TEXT PRIMARY KEY,
  relay_book_id TEXT NOT NULL,
  epoch         INTEGER NOT NULL,   -- the epoch this device writes under
  member_id     TEXT NOT NULL,      -- this device's member
  state         TEXT NOT NULL,      -- 'active' | 'needs_invite' | 'unshared'
  shared_at     TEXT NOT NULL,
  synced_at     TEXT,               -- when this device last finished a sync of the book (§11)
  unshared_by   TEXT,               -- the member who ended the sharing here (§8.4, §8.6): the owner who stopped it, or this device's own member when it left
  unshared_reason TEXT              -- how it ended: 'stopped' (§8.6) | 'left' (§8.4) | 'removed' (this device was removed, §8.4)
);

CREATE TABLE book_members (
  book_id TEXT NOT NULL, member_id TEXT NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL,               -- 'owner' | 'member'
  joined_at TEXT NOT NULL,
  PRIMARY KEY (book_id, member_id)
);

CREATE TABLE book_devices (
  book_id TEXT NOT NULL, device_id TEXT NOT NULL, member_id TEXT NOT NULL, name TEXT NOT NULL,
  sign_jwk TEXT NOT NULL, agree_jwk TEXT NOT NULL,     -- pinned public keys (§5.4)
  added_at TEXT NOT NULL, removed_at TEXT,
  PRIMARY KEY (book_id, device_id)
);

CREATE TABLE book_member_accounts (                     -- the hidden placeholder account per other member and currency
  account_id TEXT PRIMARY KEY, book_id TEXT NOT NULL, member_id TEXT NOT NULL, currency TEXT NOT NULL,
  UNIQUE (book_id, member_id, currency)                 -- ruled O2
);

CREATE TABLE book_epoch_keys (
  book_id TEXT NOT NULL, epoch INTEGER NOT NULL, key_sealed TEXT NOT NULL,   -- §5.5
  PRIMARY KEY (book_id, epoch)
);

CREATE TABLE sync_lineage (                             -- purchase -> its current head
  lineage_id TEXT PRIMARY KEY, book_id TEXT NOT NULL,
  head_transaction_id TEXT,                             -- NULL once void
  paid_by TEXT NOT NULL, paid_label TEXT NOT NULL
);
CREATE INDEX sync_lineage_head ON sync_lineage (head_transaction_id);   -- a transaction's lineage, on every post and read

CREATE TABLE sync_outbox (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL, hlc TEXT NOT NULL, entry_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX sync_outbox_book_hlc ON sync_outbox (book_id, hlc);        -- drained per book in hlc order (§9.4)

CREATE TABLE sync_cursor (
  book_id TEXT PRIMARY KEY, applied_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sync_field_clocks (
  book_id TEXT NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, hlc TEXT NOT NULL,
  PRIMARY KEY (book_id, entity, id, field)
);

-- A book's field clocks as they stood when this device stopped keeping them (recovery review, N2): written once, when
-- the book goes needs_invite or its sync state is dropped (stop sharing, keep as my own copy), with each field's value
-- then. Sharing it again or rejoining takes each field back at its own clock when its value is unchanged since, and at a
-- fresh one when it changed while nothing was captured; then the rows go.
CREATE TABLE sync_kept_clocks (
  book_id TEXT NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, hlc TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (book_id, entity, id, field)
);

CREATE TABLE sync_tombstones (
  book_id TEXT NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, hlc TEXT NOT NULL,
  last_json TEXT,                                       -- a revivable row's last values, kept for a revive to merge with
  PRIMARY KEY (book_id, entity, id)
);

CREATE TABLE sync_skipped (                             -- an op apply refused deterministically (§7.1): kept, never silent
  book_id TEXT NOT NULL, seq INTEGER NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, error TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX sync_skipped_book ON sync_skipped (book_id, seq);

-- Each invite introduces at most one device (§8.2): apply records the invite an accepted introduction used; a later
-- introduction on the same invite is refused on every device alike.
CREATE TABLE sync_invites_used (
  book_id   TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  PRIMARY KEY (book_id, invite_id)
);

-- The authority view (§8.5): who is an owner and which devices are in, as the log says it, entry by entry in seq
-- order — this device's own entries included, at their seq. It changes only when log entries are applied, never with
-- a local edit not yet synced, so every device decides every removal, role, member delete and introduction alike.
-- Each field keeps the hlc it last changed at, so the view merges like the rows do.
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
  added_seq   INTEGER,                 -- the seq of the entry that admitted it (its introduction; the creator's seed is 1), for §8.4's leave
  PRIMARY KEY (book_id, device_id)
);
