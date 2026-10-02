import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const securities = sqliteTable('securities', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  ticker: text('ticker'),
  name: text('name').notNull(),
  market: text('market').notNull(),
  currency: text('currency').notNull(),
  lotSize: integer('lot_size'),
  kind: text('kind', { enum: ['share', 'etf', 'other'] }).notNull(),
  source: text('source', { enum: ['catalogue', 'owner'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const holdingLinks = sqliteTable('holding_links', {
  accountId: text('account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  securityId: text('security_id'),
  brokerAccountId: text('broker_account_id'),
  createdAt: text('created_at').notNull(),
});

export const securityPrices = sqliteTable('security_prices', {
  securityId: text('security_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  onDate: text('on_date').notNull(),
  priceMicro: integer('price_micro').notNull(),
  /** Typed by the owner, fetched from Yahoo Finance, or read from IDX's daily file (0062). */
  source: text('source', { enum: ['manual', 'yahoo', 'idx'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

/** Where a security takes its price from (0062): Yahoo Finance, IDX's daily file, or only what is typed. */
export const securityPriceChoices = sqliteTable('security_price_choices', {
  securityId: text('security_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  choice: text('choice', { enum: ['yahoo', 'idx', 'typed'] }).notNull(),
});
