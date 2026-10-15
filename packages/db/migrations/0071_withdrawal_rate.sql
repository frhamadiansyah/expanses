/* Withdrawal rate (spec 2026-10-15 §6, rulings R1 and R18). Foreign money is spent at what it cost, oldest first; each
   entry keeps its cost-based figure in entries.amount_base_minor, rewritten in place by the recalculation. These five
   tables are this phone's own bookkeeping about that and never sync (none is a shared entity):

   - fx_lot_uses: which lots each outflow used, and what they cost (the receipt's "From the 12 Nov withdrawal", and the
     lots a move between pockets carries with their dates).
   - fx_shortfalls: what an outflow spent that no recorded withdrawal covers.
   - fx_day_values: the figure a line was first posted at, kept the first time a recalculation overwrites it; what an
     uncovered part is valued at (ruling R4).
   - fx_gain_loss: the gain or loss pair a recalculation added to an exchange (ruling R8).
   - fx_recalc_pending: accounts waiting to be recalculated — after sync apply (ruling R9), past the chain's limit
     (R10), and every foreign account once, on the first run after this update (R18).

   0070 is budget shares; this is 0071. */

CREATE TABLE fx_lot_uses (
  account_id TEXT NOT NULL,
  out_entry_id TEXT NOT NULL,
  lot_entry_id TEXT NOT NULL,
  minor INTEGER NOT NULL CHECK (minor > 0),
  cost_base_minor INTEGER NOT NULL,
  PRIMARY KEY (out_entry_id, lot_entry_id)
);
CREATE INDEX fx_lot_uses_account ON fx_lot_uses (account_id);

CREATE TABLE fx_shortfalls (
  account_id TEXT NOT NULL,
  entry_id TEXT PRIMARY KEY,
  uncovered_minor INTEGER NOT NULL CHECK (uncovered_minor > 0)
);
CREATE INDEX fx_shortfalls_account ON fx_shortfalls (account_id);

CREATE TABLE fx_day_values (
  entry_id TEXT PRIMARY KEY,
  base_minor INTEGER NOT NULL,
  rate REAL NOT NULL
);

CREATE TABLE fx_gain_loss (
  transaction_id TEXT PRIMARY KEY,
  category_entry_id TEXT NOT NULL,
  exchange_entry_id TEXT NOT NULL
);

CREATE TABLE fx_recalc_pending (
  account_id TEXT PRIMARY KEY,
  /* NULL: from the account's first entry. */
  from_date TEXT
);

/* The first run (R18): every foreign money account of the owner's own that holds entries. The money kinds are
   CASH_ITEMS (R2); a household placeholder is another member's. */
INSERT INTO fx_recalc_pending (account_id, from_date)
SELECT a.id, NULL
FROM accounts a
JOIN workspaces w ON w.id = a.workspace_id
WHERE a.kind = 'asset'
  AND a.subtype IN ('cash', 'bank', 'savings', 'time_deposit', 'ewallet', 'fund', 'other_cash')
  AND a.currency IS NOT NULL
  AND a.currency <> w.base_currency
  AND a.id NOT IN (SELECT account_id FROM book_member_accounts)
  AND EXISTS (SELECT 1 FROM entries e WHERE e.account_id = a.id);

INSERT OR IGNORE INTO settings (key, value)
SELECT 'fx.withdrawal_rate_notice', 'due' WHERE EXISTS (SELECT 1 FROM fx_recalc_pending);
