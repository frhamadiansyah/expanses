-- A personal event may keep its plan in a currency of its own, and each plan item may be priced in one. Both live in
-- tables of their own rather than as columns on events and event_items: the ORM names every column it knows on every
-- insert, so a column there would break a database still stopped at an older version (see 0042).
--
-- No row means the workspace's base currency, which is what every event and item made before this read as: an
-- item's unit_price_minor was always minor units of the base currency (0049), and it still is for an item with no row
-- here. For an item with a row it is minor units of that row's currency. Side tables like sinking_funds (0101), read
-- and written by name and local to the phone: the personal plan is not in the sync log, so neither are these.
CREATE TABLE event_currency (
  event_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  currency TEXT NOT NULL
);

CREATE TABLE event_item_currency (
  item_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  currency TEXT NOT NULL
);
