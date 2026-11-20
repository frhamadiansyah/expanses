-- Link my devices (spec 2026-11-19 §3.1): the self channel's own tables. Between the owner's own devices, which start as
-- byte copies of one another, every row travels as it is (table, primary key, columns); these keep what that needs.
--
-- This install's own (never sent, taken out of a copy handed to a new device):
--   self_state    'capture' (this device has linked devices: the triggers are on) and 'quiet' (an apply is running)
--   self_pending  what the triggers marked since the last collect: a table, a row's key, which columns ('*' made, '-' gone),
--                 and when
--   self_outbox   change-sets collected and not yet sent
--   self_notes    what an apply settled by itself (two rows merged, a possible duplicate, an edit made twice)
-- Kept alike on every device by apply, and carried in the copy a new device starts from:
--   self_clocks     the clock each column of a row last changed at ('' = when the row was made)
--   self_tombstones rows taken away, and when
--   self_aliases    a row merged into another (rule 5): its old key, and the key it went into
CREATE TABLE self_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE self_pending (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,
  cols TEXT NOT NULL,
  -- when, in ms since 1970: the change-set's clock is the latest of these, so an edit is dated when it was made
  at INTEGER NOT NULL DEFAULT (CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER))
);
CREATE TABLE self_outbox (
  id TEXT PRIMARY KEY,
  hlc TEXT NOT NULL,
  change_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX self_outbox_hlc ON self_outbox (hlc);
CREATE TABLE self_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,
  other_pk TEXT
);
CREATE TABLE self_clocks (
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,
  col TEXT NOT NULL,
  hlc TEXT NOT NULL,
  PRIMARY KEY (tbl, pk, col)
);
CREATE TABLE self_tombstones (
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,
  hlc TEXT NOT NULL,
  PRIMARY KEY (tbl, pk)
);
CREATE TABLE self_aliases (
  tbl TEXT NOT NULL,
  from_pk TEXT NOT NULL,
  to_pk TEXT NOT NULL,
  PRIMARY KEY (tbl, from_pk)
);

-- The group itself (Drop 2). This install's own: which relay book its linked devices share, the epoch it writes under,
-- how far into that book's log it has applied, and whether it is still linked ('active') or was unlinked by another of
-- the owner's devices ('unlinked': it stops syncing and keeps its data). One row at most.
CREATE TABLE self_group (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  relay_book_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (state IN ('active', 'unlinked')),
  joined_at TEXT NOT NULL
);
-- Every device of the group, as each device wrote its own row: sent to all of them, so the Devices list reads the same
-- everywhere. Its keys are the ones a rotation seals the next epoch for. removed_at is set by the device that unlinked it.
CREATE TABLE self_devices (
  device_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('phone', 'tablet', 'mac', 'other')),
  sign_jwk TEXT NOT NULL,
  agree_jwk TEXT NOT NULL,
  app_version TEXT,
  added_at TEXT NOT NULL,
  last_synced_at TEXT,
  removed_at TEXT
);
