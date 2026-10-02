import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const draftTransactions = sqliteTable('draft_transactions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  source: text('source', { enum: ['manual', 'csv', 'voice', 'receipt', 'email', 'notification', 'screen', 'photo'] }).notNull(),
  /** What the posting will be: an expense out of an account, money received into one, or a move between two. */
  kind: text('kind', { enum: ['expense', 'income', 'transfer'] }).notNull().default('expense'),
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
  /** Where a transfer's money went. Null for an expense or money received. */
  toAccountId: text('to_account_id'),
  categoryAccountId: text('category_account_id'),
  /** The card it was made on, when the account carries more than one. */
  cardId: text('card_id'),
  /** The source this capture was recognised as, once there is one. */
  sourceId: text('source_id'),
  /** The captures it was read out of, as a JSON array of ids. */
  captureIds: text('capture_ids'),
  /** The picture it came from, when it came from one. */
  imageFile: text('image_file'),
  /** What the reader made of it, as it made it: the values, their confidences and the lines they came from. */
  readingJson: text('reading_json'),
  /** Set on a draft that was found to be a duplicate of another: it leaves the queue and can be unmerged. */
  mergedInto: text('merged_into'),
  /** How sure the extractor was, 0 to 100. Null when it does not say. */
  confidence: integer('confidence'),
  externalRef: text('external_ref'),
  transactionId: text('transaction_id'),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
});
