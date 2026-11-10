/* Sharing one goal with the partner in a shared workspace (spec 2026-11-10-shared-goals-design, section 7.2).

   goal_shares says which goals are shared, into which book, by whom, and whether sharing is on. The row is never
   deleted: the state changes instead, so a goal can be turned off and on again (a deleted row could never come back).
   goal_share_leaves, goal_member_funding and goal_member_moves are each written only by the member they name; the
   money behind them (accounts, balances, transactions) never leaves the phone. goal_share_log is local only.
   Depends on no table another migration made, so the set-based runner can apply it in any order, as 0050. */

-- Which goals are shared, into which book, by whom, and whether sharing is on. One row per goal, never deleted.
CREATE TABLE goal_shares (
  goal_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  shared_by TEXT NOT NULL,                 -- member id of the sharer; written once
  state TEXT NOT NULL CHECK (state IN ('on', 'off', 'deleted')),
  state_on TEXT NOT NULL,                  -- YYYY-MM-DD
  round INTEGER NOT NULL DEFAULT 1 CHECK (round >= 1)  -- +1 each time it is turned on again (C32)
);
CREATE INDEX goal_shares_book ON goal_shares (book_id, state);

-- A member who left a shared goal, and in which round. Written only by that member, never by the sharer.
CREATE TABLE goal_share_leaves (
  goal_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  left_on TEXT NOT NULL,
  PRIMARY KEY (goal_id, member_id)
);

-- What one member's money does for a shared goal, as that member's phone worked it out. Written only by that member.
CREATE TABLE goal_member_funding (
  goal_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  -- [{ ref, name, kind: 'earmark' | 'tagged', amountMinor: number | null, risk: 'low' | 'medium' | 'high' | null }]
  -- amountMinor in the goal's currency, null when the owner's phone had no rate. ref is stable per line, not an id.
  lines_json TEXT NOT NULL,
  planned_monthly_minor INTEGER NOT NULL DEFAULT 0,   -- goal currency (C17)
  as_of TEXT NOT NULL,
  PRIMARY KEY (goal_id, member_id)
);

-- One History line of a member's, for a shared goal. id is stable from its local source (a contribution, a draw,
-- a tagged transfer), so a line written twice is the same line; an undone source deletes it.
CREATE TABLE goal_member_moves (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('set-aside', 'taken-back', 'borrowed', 'spent', 'moved')),
  occurred_on TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,           -- signed, in `currency` (display only)
  currency TEXT NOT NULL,
  text TEXT NOT NULL,                      -- account name, or a spend's description (C8)
  stage_id TEXT                            -- the stage a spend paid, so it cannot be removed
);
CREATE INDEX goal_member_moves_goal ON goal_member_moves (goal_id, occurred_on);

-- Local only, never synced: the share's own History lines ("Shared with Rina", "Rina left", "Stopped sharing",
-- "No longer shared by Bima"). A private copy (C30) keeps its lines under its new goal id.
CREATE TABLE goal_share_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('shared', 'stopped', 'left', 'unshared', 'ended')),
  member_name TEXT NOT NULL,
  amount_minor INTEGER,                    -- goal currency: the member's last counted total, when one stops counting
  copied_from TEXT,                        -- on a private copy's 'unshared' line: the shared goal's id (C30)
  occurred_on TEXT NOT NULL
);
