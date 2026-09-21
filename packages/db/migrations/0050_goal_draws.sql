/* What was taken from a goal, and why.

   A set-aside (goal_earmarks) is a promise; nothing records what happens when money leaves an account that holds one.
   Each row here is an answer given at that moment, beside the transaction that caused it:
     borrow — the goal lent it and wants it back; nothing else changes, and the goal reads short until the account is
              topped up again (worked out fresh, never stored);
     spend  — this is what the goal was for; the promise was lowered by amount_minor, and stage_id (when set) was marked
              paid on occurred_on;
     move   — a transfer took the promise with it; amount_minor left account_id's promise and to_amount_minor joined
              to_account_id's.
   Amounts are in account_id's own currency (to_amount_minor in to_account_id's). was_whole and whole_since are a
   snapshot of the goal at the moment of a borrow — a fact about the past, not a flag anything current reads.

   Not a column anywhere: the ORM names every column it knows on every insert (see 0028). Depends on nothing any other
   migration made, because the runner is set-based and this may be applied after 0051-0054 on an existing install. */
CREATE TABLE goal_draws (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  intent TEXT NOT NULL CHECK (intent IN ('borrow', 'spend', 'move')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  to_account_id TEXT,
  to_amount_minor INTEGER,
  stage_id TEXT,
  was_whole INTEGER NOT NULL DEFAULT 0,
  whole_since TEXT,
  occurred_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX goal_draws_account ON goal_draws (workspace_id, account_id);
CREATE INDEX goal_draws_transaction ON goal_draws (transaction_id);
