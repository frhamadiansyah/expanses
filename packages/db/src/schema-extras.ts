import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * What a purchase was, beside what it cost. Both tables are keyed by transaction and live beside `transactions`
 * rather than on it: the ORM names every column it knows on every insert, so a new column there would break a
 * database still stopped at an older version. No row means nothing was chosen.
 */
export const transactionFlags = sqliteTable('transaction_flags', {
  transactionId: text('transaction_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  /** 'online', 'offline', or null for "not said". Never guessed. */
  channel: text('channel', { enum: ['online', 'offline'] }),
  /** 1 leaves it out of the chart, the budgets and the category totals; balances and net worth still count it. */
  excluded: integer('excluded').notNull().default(0),
});

/** One picture kept for a transaction: the row is the index, the file in OPFS is the picture. */
export const transactionPhotos = sqliteTable('transaction_photos', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  transactionId: text('transaction_id').notNull(),
  /** The file's name in OPFS under expanses-photos/. The bytes never enter the database. */
  fileName: text('file_name').notNull(),
  mime: text('mime').notNull(),
  byteSize: integer('byte_size').notNull(),
  /** The order the pictures were picked in, so a list of them is a total order and never a tie. */
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
});
