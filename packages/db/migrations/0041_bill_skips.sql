/* A month you deliberately did not pay a recurring bill.

   Without this, a skipped bill is indistinguishable from a forgotten one: it stays owed for ever, and the
   count of what is paid never reaches the end. A row here says "this month, on purpose, nothing" — it is not
   a transaction, because no money moved. */
CREATE TABLE bill_skips (
  workspace_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  /* The month it applies to, as YYYY-MM: a skip belongs to a month, not to a day. */
  month TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, template_id, month)
);
