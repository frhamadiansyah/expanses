-- A bond's coupon terms: its rate a year on par, how often it is paid and on which day of the month, when it next pays
-- and when it matures, the tax withheld, the account it is paid into, and whether the app records it on that day. One
-- row per bond, kept on the phone that holds the bond (assets do not travel between phones), so a coupon is recorded once.
CREATE TABLE bond_coupons (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL,
  rate_bps INTEGER NOT NULL CHECK (rate_bps > 0 AND rate_bps <= 100000),
  per_year INTEGER NOT NULL CHECK (per_year IN (1, 2, 4, 12)),
  pay_day INTEGER NOT NULL CHECK (pay_day BETWEEN 1 AND 31),
  next_on TEXT NOT NULL,
  matures_on TEXT,
  tax_bps INTEGER NOT NULL DEFAULT 1000 CHECK (tax_bps BETWEEN 0 AND 10000),
  cash_account_id TEXT REFERENCES accounts(id),
  auto INTEGER NOT NULL DEFAULT 1 CHECK (auto IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE INDEX bond_coupons_workspace ON bond_coupons (workspace_id);
