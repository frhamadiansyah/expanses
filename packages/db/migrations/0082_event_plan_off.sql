-- An event can be kept without a plan: a trip that is only ever added up, never shopped for. Off, its page draws the
-- ring alone, with no gauge against a plan and no list of things to buy. Its items, if it had any, stay in place for
-- the day the plan is turned back on.
ALTER TABLE events ADD COLUMN plan_off INTEGER NOT NULL DEFAULT 0 CHECK (plan_off IN (0, 1));
