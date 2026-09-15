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

/** The date the bank posted a card purchase, when it differs from the purchase date. See migration 0038. */
export const cardPostings = sqliteTable('card_postings', {
  transactionId: text('transaction_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  postedOn: text('posted_on').notNull(),
});

/** Which purchases a payment to the card was for. */
export const cardSettlements = sqliteTable('card_settlements', {
  purchaseTransactionId: text('purchase_transaction_id').primaryKey(),
  paymentTransactionId: text('payment_transaction_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
});
