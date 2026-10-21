-- An item on an event's plan may be paid for several times — souvenirs from three shops — so its purchases move out
-- of event_items' single transaction_id/share_minor pair into a table of their own, one row per purchase it took a
-- share of. Being bought is no longer "has a purchase" but a mark of its own: an item stays on the list, whatever was
-- paid towards it, until it is marked done.
CREATE TABLE event_item_purchases (
  item_id TEXT NOT NULL REFERENCES event_items(id),
  workspace_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  share_minor INTEGER NOT NULL CHECK (share_minor > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_id, transaction_id)
);

CREATE INDEX event_item_purchases_purchase ON event_item_purchases (workspace_id, transaction_id);

ALTER TABLE event_items ADD COLUMN done_at TEXT;

-- What was linked before is carried over as it stood: one purchase, and the item done, exactly as it read.
INSERT INTO event_item_purchases (item_id, workspace_id, transaction_id, share_minor, created_at)
SELECT id, workspace_id, transaction_id, share_minor, created_at
FROM event_items
WHERE transaction_id IS NOT NULL AND share_minor IS NOT NULL AND share_minor > 0;

UPDATE event_items
SET done_at = created_at
WHERE transaction_id IS NOT NULL AND share_minor IS NOT NULL AND share_minor > 0;

-- The old pair is read by nothing from here on; emptied so no copy of the link is left to disagree with the new one.
UPDATE event_items SET transaction_id = NULL, share_minor = NULL;
