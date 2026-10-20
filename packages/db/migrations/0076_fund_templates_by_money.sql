-- Monthly buys of a mutual fund are amounts of money now that funds are tracked by money (spec
-- 2026-10-19-fund-by-amount): a units-only one becomes an amount at the fund's last NAV, and one with no NAV to work
-- it out from is switched off rather than guessed. Only the fund's own NAVs are read: a migration that ran before the
-- securities tables (0051) were there must still run, and a fund's NAV is its own unless it was linked to a security.

-- No NAV: switched off, its units kept as they were.
UPDATE trade_templates
SET active = 0
WHERE units_micro IS NOT NULL
  AND account_id IN (SELECT account_id FROM asset_profiles WHERE asset_kind = 'fund')
  AND NOT EXISTS (SELECT 1 FROM prices p WHERE p.account_id = trade_templates.account_id);

-- Otherwise the units at the last NAV, rounded to a whole minor unit, and no units: one amount, never both.
UPDATE trade_templates
SET amount_minor = MAX(1, CAST(ROUND(units_micro * 1.0 *
      (SELECT price_micro FROM prices p WHERE p.account_id = trade_templates.account_id ORDER BY p.on_date DESC LIMIT 1)
    / 1000000000000.0) AS INTEGER)),
    units_micro = NULL
WHERE units_micro IS NOT NULL
  AND account_id IN (SELECT account_id FROM asset_profiles WHERE asset_kind = 'fund')
  AND EXISTS (SELECT 1 FROM prices p WHERE p.account_id = trade_templates.account_id);
