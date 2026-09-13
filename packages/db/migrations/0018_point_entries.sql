-- The points ledger: what was earned, spent, expired or corrected, and what is left.
--
-- Earn entries are derived from the best evidence a cycle has — the figures the issuer showed per
-- purchase, else the statement total, else the app's own working — and are rewritten when better
-- evidence arrives. Everything the owner records themselves (a redemption, a snapshot correction) is
-- never rewritten by that derivation.

CREATE TABLE point_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  -- The purchase this belongs to, when it belongs to one. A statement total names no purchase.
  transaction_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('earn', 'redeem', 'expire', 'adjust', 'transfer')),
  -- Signed: earning and a positive correction add; spending, expiring and transferring out take away.
  -- Real, because issuers credit half points and the ledger must agree with what was typed in.
  quantity REAL NOT NULL,
  occurred_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('posted', 'projected')),
  source TEXT NOT NULL CHECK (source IN ('transaction', 'statement', 'snapshot', 'projected', 'manual')),
  -- The earn batch a consumption draws against; null on an earn itself.
  batch_id TEXT,
  -- When this batch dies. Null while the program has no expiry policy, which is the default.
  expires_on TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX point_entries_program ON point_entries (workspace_id, program_id, occurred_on);

-- What the owner read in the issuer's app. Kept apart from the correction it produced, so the reading
-- survives any later recomputation.
CREATE TABLE point_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  balance REAL NOT NULL,
  observed_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Nothing expires until the owner says how, because a wrong expiry warning burns points that were
-- never dying and teaches them to ignore the true one.
ALTER TABLE reward_programs ADD COLUMN expiry_policy TEXT NOT NULL DEFAULT 'none' CHECK (expiry_policy IN ('none', 'months_from_earn', 'fixed_annual'));
ALTER TABLE reward_programs ADD COLUMN expiry_months INTEGER;
