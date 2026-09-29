-- Joint net worth (spec §5.1, §9). Side tables only, plus one column on book_devices (spec §9's app-version gate).
-- The five synced tables (nw_proposals, nw_answers, nw_items, nw_pending, member_transfers) are keyed by the group
-- log's local book id, not any member's own book: task 4 registers the group log and its `net_worth_group` entity.
-- nw_group_books, nw_share_settings, nw_item_map, nw_sent and member_transfer_postings are local bookkeeping and never sync.

-- The workspace's link to its net-worth group log (task 4): synced in the workspace log as `net_worth_group`.
CREATE TABLE group_logs (
  book_id TEXT PRIMARY KEY,              -- the shared workspace's book id
  group_book_id TEXT NOT NULL UNIQUE,    -- the group log's book id, the same on every device (a shared_books row with no books row)
  relay_book_id TEXT NOT NULL DEFAULT '', -- the group log's relay book; with group_book_id, written once (task 4 review round 1)
  invites_json TEXT NOT NULL DEFAULT '[]' -- relay invites to the group log, each sealed to one admitted device's agreement key
);

-- Local only, never synced (task 4): the group logs this device holds, and the workspace each belongs to. Written
-- when this device makes or joins one, never by a peer, so a rewritten `net_worth_group` row cannot move this device
-- off the group log it is in, or make a workspace book read as a group log.
CREATE TABLE nw_group_books (
  group_book_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL
);

CREATE TABLE nw_proposals (
  book_id TEXT NOT NULL, proposal_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('joint','separate')),
  members_json TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  created_hlc TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, proposal_id)
);

CREATE TABLE nw_answers (
  book_id TEXT NOT NULL, proposal_id TEXT NOT NULL, member_id TEXT NOT NULL,
  answer TEXT NOT NULL CHECK (answer IN ('confirm','decline','left')),
  PRIMARY KEY (book_id, proposal_id, member_id)
);

CREATE TABLE nw_items (
  book_id TEXT NOT NULL, item_id TEXT NOT NULL, owner TEXT NOT NULL, summary_json TEXT NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, item_id)
);

CREATE TABLE nw_pending (
  book_id TEXT NOT NULL, member_id TEXT NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY (book_id, member_id)
);

CREATE TABLE member_transfers (
  book_id TEXT NOT NULL, transfer_id TEXT NOT NULL, occurred_on TEXT NOT NULL,
  amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
  from_json TEXT NOT NULL, to_json TEXT NOT NULL,
  description TEXT,
  void INTEGER NOT NULL DEFAULT 0,
  recorded_by TEXT NOT NULL,
  PRIMARY KEY (book_id, transfer_id)
);

-- Local bookkeeping only: never in SHARED_ENTITIES, never sent.
CREATE TABLE member_transfer_postings (
  book_id TEXT NOT NULL, transfer_id TEXT NOT NULL, transaction_id TEXT NOT NULL,
  PRIMARY KEY (book_id, transfer_id)
);

CREATE TABLE nw_share_settings (
  account_id TEXT PRIMARY KEY, setting TEXT NOT NULL CHECK (setting IN ('total','hidden'))
);

CREATE TABLE nw_item_map (
  account_id TEXT PRIMARY KEY, group_book_id TEXT NOT NULL, item_id TEXT NOT NULL UNIQUE
);

CREATE TABLE nw_sent (
  item_id TEXT PRIMARY KEY, summary_hash TEXT NOT NULL
);

-- The app version a device last wrote its book_devices row at (spec §9's minimum-version gate).
ALTER TABLE book_devices ADD COLUMN app_version TEXT;
