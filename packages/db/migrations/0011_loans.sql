-- Loans with a schedule, and credit-card purchases converted to instalments.
-- The balance stays on an ordinary loan account; these tables only say on what terms.

CREATE TABLE loan_terms (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL,
  lender_name TEXT NOT NULL,
  lender_npwp TEXT,
  purpose TEXT,
  original_minor INTEGER NOT NULL,
  first_payment_on TEXT NOT NULL,
  tenor_months INTEGER NOT NULL,
  -- Annuity charges interest on what is left, flat on the original, zero has none.
  method TEXT NOT NULL CHECK (method IN ('annuity', 'flat', 'zero')),
  payment_day INTEGER NOT NULL,
  -- The house or car this loan bought, when it bought one. A property makes it a home loan.
  asset_account_id TEXT REFERENCES accounts(id),
  coretax_code TEXT NOT NULL DEFAULT '101',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid_off')),
  status_on TEXT,
  created_at TEXT NOT NULL
);

-- A rate change writes a period. History is never rewritten: earlier months keep the rate they had.
CREATE TABLE loan_rate_periods (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  workspace_id TEXT NOT NULL,
  from_on TEXT NOT NULL,
  rate_bps INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fixed', 'floating')),
  -- What the bank asks for under this rate. 0 means "work it out from the balance".
  payment_minor INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX loan_rate_periods_account ON loan_rate_periods (account_id, from_on);

CREATE TABLE card_installments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  card_account_id TEXT NOT NULL REFERENCES accounts(id),
  -- The purchase this plan was converted from, when it is known.
  transaction_id TEXT REFERENCES transactions(id),
  description TEXT NOT NULL,
  total_minor INTEGER NOT NULL,
  months INTEGER NOT NULL,
  monthly_minor INTEGER NOT NULL,
  first_billed_month TEXT NOT NULL,
  rate_bps INTEGER NOT NULL DEFAULT 0,
  conversion_fee_minor INTEGER NOT NULL DEFAULT 0,
  -- Many issuers pay no points on a converted purchase.
  earns_points INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX card_installments_card ON card_installments (workspace_id, card_account_id);
