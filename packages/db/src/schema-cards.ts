import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Which bank issued a card account. A side table: see migration 0034. */
export const cardIdentity = sqliteTable('card_identity', {
  accountId: text('account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  issuer: text('issuer'),
});

export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  accountId: text('account_id').notNull(),
  /** Exactly four digits, or null when the owner would rather not record them. */
  last4: text('last4'),
  holderName: text('holder_name'),
  isPrimary: integer('is_primary').notNull(),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
});
