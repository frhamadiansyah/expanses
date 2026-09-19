/* An event's plan is a list of things to buy, not a set of category caps.

   An item is a name, how many, and a price each — the estimate is the product, derived on every read, because two
   integers cannot round and a stored third figure would only be one more thing to keep true. It optionally carries a
   category, a shop link and a note, and, once bought, the purchase that answered it and how much of that purchase it
   is: one receipt can settle several items, so the share lives here and the transaction is never split.

   A table of its own rather than columns on events or transactions: the ORM names every column it knows on every
   insert, so a column there would break any database still stopped at an older version (see 0028). */
CREATE TABLE event_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  /* Above nought. One of something is the ordinary case. */
  quantity INTEGER NOT NULL DEFAULT 1,
  /* Minor units of the workspace base currency, above nought. */
  unit_price_minor INTEGER NOT NULL,
  /* NULL: planned but filed nowhere. It then belongs to no workspace and shows under every tab. */
  category_account_id TEXT,
  /* A shop page for the thing. Stored as typed (with https:// put in front when it had no scheme), never fetched. */
  link TEXT,
  note TEXT,
  /* The posted purchase that answered it, and this item's share of it. Both NULL, or both set. */
  transaction_id TEXT,
  share_minor INTEGER,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX event_items_event ON event_items (workspace_id, event_id, sort_order);
/* Deliberately not unique: one receipt answers many items, each with its own share. */
CREATE INDEX event_items_purchase ON event_items (workspace_id, transaction_id);

/* The per-category caps become one item each, named after the category, so the events already in a database still read
   as plans. A cap with no figure was never a plan — it only said the event drew on that category, which the item's own
   category now says — so it is dropped rather than turned into an item with no price. */
INSERT INTO event_items (id, workspace_id, event_id, name, quantity, unit_price_minor, category_account_id, link, note, transaction_id, share_minor, sort_order, created_at)
SELECT b.id,
       b.workspace_id,
       b.event_id,
       a.name,
       1,
       b.planned_minor,
       b.category_account_id,
       NULL,
       NULL,
       NULL,
       NULL,
       (SELECT count(*) FROM event_budgets b2 WHERE b2.event_id = b.event_id AND b2.planned_minor IS NOT NULL AND b2.created_at < b.created_at),
       b.created_at
FROM event_budgets b
JOIN accounts a ON a.id = b.category_account_id
WHERE b.planned_minor IS NOT NULL;

DROP TABLE event_budgets;
