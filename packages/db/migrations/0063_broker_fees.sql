/* 0063 — what a broker charges, set on its cash account (a `fund` account): the buy fee and the sell fee as parts per
   million of what changed hands (0,15% is 1500; the sell fee includes IDX's 0,1% final tax), and the smallest fee
   it takes across a day's trades, in rupiah, if it has one. The simple Buy and Sell sheets work every trade's fee out
   from them; the full trade form still takes a fee typed in rupiah.

   No row means the broker's defaults, worked out from its name (Stockbit 0,15% / 0,25%, Mandiri Sekuritas 0,18% /
   0,28% with Rp 5.000 a day, anyone else 0,15% / 0,25%). A table of its own for the reason 0028 and 0061 give, with no
   REFERENCES clause, as in 0061. Kept on this device like the account's other settings (asset_profiles): only the
   trades it helps record are shared. Safe to run again. */
CREATE TABLE IF NOT EXISTS broker_fees (
  account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  buy_ppm INTEGER NOT NULL CHECK (buy_ppm >= 0 AND buy_ppm <= 100000),
  sell_ppm INTEGER NOT NULL CHECK (sell_ppm >= 0 AND sell_ppm <= 100000),
  min_daily_minor INTEGER CHECK (min_daily_minor IS NULL OR min_daily_minor >= 0),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS broker_fees_workspace ON broker_fees (workspace_id);
