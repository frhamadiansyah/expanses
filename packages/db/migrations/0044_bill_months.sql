/* A recurring bill's window, and the month each payment settles.

   A bill comes out on one day and may be paid by a later one, sometimes in the next month (out on the 28th, pay by
   the 5th). So a payment made on 3 September can settle August's bill, and the calendar month it was paid in no
   longer says which bill it paid.

   Both facts live in tables of their own rather than in columns on expense_templates or transactions: the ORM names
   every column it knows on every insert, so a column there would break any database still stopped at an older
   version (see 0028). */
CREATE TABLE bill_windows (
  template_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  /* 1-31, or NULL: due on the day it comes out. Earlier than the out day means the following month. */
  pay_by_day INTEGER,
  /* YYYY-MM: the first month this bill can be owed for, so an upgrade never raises a debt from before it. */
  starts_month TEXT NOT NULL
);

CREATE TABLE bill_payments (
  transaction_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  /* YYYY-MM: the month whose bill this payment settles. */
  bill_month TEXT NOT NULL
);
CREATE INDEX bill_payments_template ON bill_payments (workspace_id, template_id, bill_month);

INSERT INTO bill_windows (template_id, workspace_id, pay_by_day, starts_month)
SELECT id, workspace_id, NULL, strftime('%Y-%m', 'now', 'localtime') FROM expense_templates;

/* Until now a payment settled the calendar month it was made in; filing it there changes no figure. */
INSERT INTO bill_payments (transaction_id, workspace_id, template_id, bill_month)
SELECT id, workspace_id, template_id, substr(occurred_on, 1, 7) FROM transactions
WHERE template_id IS NOT NULL AND template_id IN (SELECT id FROM expense_templates);
