import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  startsOn: text('starts_on').notNull(),
  endsOn: text('ends_on').notNull(),
  /** A figure for the whole event, instead of planning category by category. */
  plannedMinor: integer('planned_minor'),
  goalId: text('goal_id'),
  /** The category set the event draws on, when it draws on one rather than the monthly categories. */
  setId: text('set_id'),
  /** When the owner called it done. Null while it is still running. */
  finishedAt: text('finished_at'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
});

/** One thing an event means to buy, and — once it is bought — the purchase that answered it and its share of it. */
export const eventItems = sqliteTable('event_items', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  eventId: text('event_id').notNull(),
  name: text('name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPriceMinor: integer('unit_price_minor').notNull(),
  /** Null: planned but filed in no category, so it belongs to no workspace. */
  categoryAccountId: text('category_account_id'),
  /** A shop page. Never fetched by anything in this app. */
  link: text('link'),
  note: text('note'),
  /** Retired by 0078: its purchases are `eventItemPurchases`. Emptied there, and read by nothing. */
  transactionId: text('transaction_id'),
  /** Retired by 0078 with `transactionId`. */
  shareMinor: integer('share_minor'),
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
  /** Marked done: nothing more is to be bought for it (0078). Null while it is still on the list. */
  doneAt: text('done_at'),
});

/** The purchases that paid for an item, and how much of each this item is (0078). One receipt may answer several. */
export const eventItemPurchases = sqliteTable(
  'event_item_purchases',
  {
    itemId: text('item_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    shareMinor: integer('share_minor').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.transactionId] })],
);
