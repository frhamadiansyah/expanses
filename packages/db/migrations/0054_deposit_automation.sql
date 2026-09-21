/* Deposit maturity automation: the settings per deposit, and the log of events the owner confirmed.

   Both are side tables. 0047's deposit_terms keeps exactly its columns, because the ORM names every column it
   knows on every insert and a new one would break a database still stopped at an older version. No row in
   deposit_automation means "off", which is what every deposit was until now, so nothing is backfilled.

   Due events are never stored: they are worked out from deposit_terms, these settings, and deposit_events. There
   are no REFERENCES clauses, as in 0048, so a later rebuild of accounts never has to defer keys for these tables.
   The migration depends on nothing that 0050–0053 make, so it applies in any order among them. */
CREATE TABLE deposit_automation (
  account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  enabled_on TEXT,
  at_maturity TEXT NOT NULL DEFAULT 'principal' CHECK (at_maturity IN ('principal', 'principal_interest', 'close')),
  interest_paid TEXT NOT NULL DEFAULT 'at_maturity' CHECK (interest_paid IN ('monthly', 'at_maturity')),
  payout_account_id TEXT,
  term_months INTEGER NOT NULL DEFAULT 1 CHECK (term_months IN (1, 3, 6, 12)),
  term_started_on TEXT,
  keep_rate INTEGER NOT NULL DEFAULT 1 CHECK (keep_rate IN (0, 1)),
  tax_bps INTEGER NOT NULL DEFAULT 2000 CHECK (tax_bps BETWEEN 0 AND 10000),
  tax_exempt INTEGER NOT NULL DEFAULT 0 CHECK (tax_exempt IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE deposit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('monthly', 'maturity')),
  due_on TEXT NOT NULL,
  principal_minor INTEGER NOT NULL,
  gross_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  net_minor INTEGER NOT NULL,
  interest_transaction_id TEXT,
  principal_transaction_id TEXT,
  /* 1 when the owner said "Recorded it myself": nothing was posted, and the figures are the ones on the card. */
  recorded_by_hand INTEGER NOT NULL DEFAULT 0 CHECK (recorded_by_hand IN (0, 1)),
  confirmed_at TEXT NOT NULL
);
/* One confirmation per event: a second confirm fails here and rolls its whole transaction back. */
CREATE UNIQUE INDEX deposit_events_once ON deposit_events (account_id, kind, due_on);
CREATE INDEX deposit_events_workspace ON deposit_events (workspace_id, account_id);
