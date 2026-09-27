-- Household sharing (spec §4.2). Side tables only; no column is added to any existing table.

CREATE TABLE shared_books (
  book_id       TEXT PRIMARY KEY,
  relay_book_id TEXT NOT NULL,
  epoch         INTEGER NOT NULL,   -- the epoch this device writes under
  member_id     TEXT NOT NULL,      -- this device's member
  state         TEXT NOT NULL,      -- 'active' | 'needs_invite' | 'unshared'
  shared_at     TEXT NOT NULL
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

CREATE TABLE sync_outbox (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL, hlc TEXT NOT NULL, entry_json TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE sync_cursor (
  book_id TEXT PRIMARY KEY, applied_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sync_field_clocks (
  book_id TEXT NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, hlc TEXT NOT NULL,
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
