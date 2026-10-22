-- One buy or sell split between goals: each goal's lots (or grams, or units), or — a fund tracked by money — its amount
-- of the gross. Rows exist only for a split; a trade with one goal keeps it on investment_trades.goal_id, and then has
-- none here. What no row takes is the trade's own, with no goal.
CREATE TABLE trade_goal_parts (
  trade_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  units_micro INTEGER NOT NULL DEFAULT 0 CHECK (units_micro >= 0),
  money_minor INTEGER NOT NULL DEFAULT 0 CHECK (money_minor >= 0),
  PRIMARY KEY (trade_id, goal_id)
);
CREATE INDEX trade_goal_parts_goal ON trade_goal_parts (goal_id);
