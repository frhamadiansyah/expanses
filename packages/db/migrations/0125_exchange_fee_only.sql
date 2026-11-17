/*
 * An exchange with a typed fee counts the fee alone (owner, 17 Nov 2026). The withdrawal rate's recalculation now values
 * such a fee at its own units' cost and leaves what the bank's rate kept on the Currency Exchange account; before, the
 * whole gap landed on the fee. Nothing is rewritten here: each of the owner's own foreign money accounts that paid such a
 * fee is queued for recalculation from its first one, and the queue's next run (on open, or after a sync) values those
 * fees again. Balances, net worth and every other line stay as they are; the withdrawal-rate notice is not asked for.
 */
INSERT INTO fx_recalc_pending (account_id, from_date)
SELECT account_id, from_date FROM (
  SELECT e.account_id AS account_id, MIN(t.occurred_on) AS from_date
  FROM entries e
  JOIN accounts a ON a.id = e.account_id
  JOIN workspaces w ON w.id = a.workspace_id
  JOIN transactions t ON t.id = e.transaction_id
  WHERE a.kind = 'asset'
    AND a.subtype IN ('cash', 'bank', 'savings', 'time_deposit', 'ewallet', 'fund', 'other_cash')
    AND a.currency IS NOT NULL
    AND a.currency <> w.base_currency
    AND a.id NOT IN (SELECT account_id FROM book_member_accounts)
    AND e.amount_minor < 0
    AND t.status = 'posted'
    AND EXISTS (SELECT 1 FROM entries x JOIN accounts xa ON xa.id = x.account_id WHERE x.transaction_id = t.id AND xa.system_key = 'currency_exchange')
    AND EXISTS (SELECT 1 FROM entries f JOIN accounts fa ON fa.id = f.account_id WHERE f.transaction_id = t.id AND fa.kind = 'expense' AND f.currency = e.currency AND f.amount_minor > 0)
  GROUP BY e.account_id
) WHERE true
ON CONFLICT (account_id) DO UPDATE SET from_date = CASE
  WHEN fx_recalc_pending.from_date IS NULL OR excluded.from_date IS NULL THEN NULL
  WHEN excluded.from_date < fx_recalc_pending.from_date THEN excluded.from_date
  ELSE fx_recalc_pending.from_date
END;
