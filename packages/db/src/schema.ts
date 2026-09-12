import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['personal', 'shared', 'business', 'travel'] }).notNull(),
  baseCurrency: text('base_currency').notNull(),
  plan: text('plan', { enum: ['free'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const workspaceMembers = sqliteTable('workspace_members', {
  workspaceId: text('workspace_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role', { enum: ['owner', 'admin', 'member', 'viewer'] }).notNull(),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  parentId: text('parent_id'),
  kind: text('kind', { enum: ['asset', 'liability', 'income', 'expense', 'equity'] }).notNull(),
  subtype: text('subtype', {
    enum: ['cash', 'bank', 'credit_card', 'savings', 'investment', 'property', 'vehicle', 'receivable', 'payable', 'loan', 'category', 'equity'],
  }).notNull(),
  name: text('name').notNull(),
  icon: text('icon'),
  currency: text('currency'),
  valuationMode: text('valuation_mode', { enum: ['derived', 'snapshot', 'market'] }).notNull(),
  systemKey: text('system_key'),
  sortOrder: integer('sort_order').notNull(),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
});

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  occurredOn: text('occurred_on').notNull(),
  description: text('description').notNull(),
  source: text('source', { enum: ['manual', 'csv', 'voice', 'receipt', 'email'] }).notNull(),
  externalRef: text('external_ref'),
  eventId: text('event_id'),
  status: text('status', { enum: ['posted', 'void'] }).notNull(),
  replacesTransactionId: text('replaces_transaction_id'),
  /** Currency and amount of a card purchase before the issuer converted it, when it differs from the card currency. */
  originalCurrency: text('original_currency'),
  originalAmountMinor: integer('original_amount_minor'),
  /** Merchant category code typed for a card purchase. */
  mcc: text('mcc'),
  /** Goal a tagged transfer funds. Ordinary payments never carry one. */
  goalId: text('goal_id'),
  createdAt: text('created_at').notNull(),
});

export const entries = sqliteTable('entries', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  transactionId: text('transaction_id').notNull(),
  accountId: text('account_id').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  fxRateToBase: real('fx_rate_to_base').notNull(),
  amountBaseMinor: integer('amount_base_minor').notNull(),
  memo: text('memo'),
  /** Category of a card purchase whose other side is an asset, so points still count. */
  spendCategoryId: text('spend_category_id'),
});

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  payloadJson: text('payload_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const fxRates = sqliteTable('fx_rates', {
  fromCurrency: text('from_currency').notNull(),
  toCurrency: text('to_currency').notNull(),
  onDate: text('on_date').notNull(),
  rate: real('rate').notNull(),
  source: text('source', { enum: ['frankfurter', 'manual', 'kmk'] }).notNull(),
  sourceDate: text('source_date').notNull(),
  fetchedAt: text('fetched_at').notNull(),
});
