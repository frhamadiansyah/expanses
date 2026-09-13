import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const incomeSources = sqliteTable('income_sources', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  scheme: text('scheme', { enum: ['umkm_final', 'nppn'] }).notNull(),
  /** The wallet the business is run through; its income postings are the turnover. */
  accountId: text('account_id').notNull(),
  /** NPPN only: the norma percentage for this trade, in basis points. */
  normaRateBps: integer('norma_rate_bps'),
  kluCode: text('klu_code'),
  /** A default here matters: without one drizzle names the column and sends null. */
  thresholdApplies: integer('threshold_applies').notNull().default(1),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
});
