-- A shared event's plan item may be paid for several times too (as 0078 did for an owner's own events). Its payments
-- travel as one field of the item row — a JSON array of {expenseId, shareMinor} — beside a done mark, rather than as a
-- table of their own: a phone a version behind ignores fields it does not know, but stalls for good on an entity it
-- does not know. NULL purchases_json is an item written before this: its one expense_id/share_minor pair is read as
-- its only payment, and as done. expense_id/share_minor stay written — the largest payment, while the item is done —
-- so a phone a version behind still reads a done item as bought; a pair it changes since is read as the last word.
ALTER TABLE event_items_shared ADD COLUMN purchases_json TEXT;
ALTER TABLE event_items_shared ADD COLUMN done_at TEXT;
