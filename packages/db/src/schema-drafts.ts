import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const draftTransactions = sqliteTable('draft_transactions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  source: text('source', { enum: ['manual', 'csv', 'voice', 'receipt', 'email'] }).notNull(),
  status: text('status', { enum: ['pending', 'confirmed', 'dismissed'] }).notNull(),
  /** What the source said, verbatim. Null once purged. */
  rawPayload: text('raw_payload'),
  /** The date after which rawPayload is deleted. */
  rawPurgeAfter: text('raw_purge_after'),
  occurredOn: text('occurred_on').notNull(),
  description: text('description').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  accountId: text('account_id'),
  categoryAccountId: text('category_account_id'),
  /** How sure the extractor was, 0 to 100. Null when it does not say. */
  confidence: integer('confidence'),
  externalRef: text('external_ref'),
  transactionId: text('transaction_id'),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
});
