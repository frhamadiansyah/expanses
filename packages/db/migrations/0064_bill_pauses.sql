/* 0064 — a month a recurring bill is paused: set aside ahead of time, so no bill comes out for it. It adds nothing to
   what is still to pay, to a budget's committed bills or to the bill counts, and the bill comes back by itself once
   its paused months are past — nothing has to clear it. Paying a paused month on purpose still works, and the payment
   wins, as it does over a skip.

   One row per paused month, the way 0041 keeps a skip: a pause is read as the months it covers, so the history can
   name each one, and resuming deletes the months from today on. Shared like a skip, keyed by (template_id, month).
   Safe to run again. */
CREATE TABLE IF NOT EXISTS bill_pauses (
  workspace_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  /* YYYY-MM: the month no bill comes out for. */
  month TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, template_id, month)
);
