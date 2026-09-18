import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const assetProfiles = sqliteTable('asset_profiles', {
  accountId: text('account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  assetKind: text('asset_kind', { enum: ['fund', 'stock', 'bond', 'gold', 'property', 'vehicle', 'other', 'cash'] }).notNull(),
  planGroup: text('plan_group', { enum: ['liquid', 'invest', 'owed', 'use'] }).notNull(),
  unitKind: text('unit_kind', { enum: ['units', 'shares', 'grams', 'face'] }),
  lotSize: integer('lot_size'),
  risk: text('risk', { enum: ['low', 'medium', 'high'] }),
  coretaxSection: text('coretax_section', { enum: ['kas', 'piutang', 'investasi', 'bergerak', 'tidak_bergerak', 'lainnya'] }),
  coretaxCode: text('coretax_code'),
  /** JSON of the Coretax detail fields for the section. */
  coretaxFieldsJson: text('coretax_fields_json').notNull(),
  acquiredYear: integer('acquired_year'),
  /** 1 unless the owner says this asset is not reported as harta. */
  reportable: integer('reportable').notNull().default(1),
  /** How this holding's income is taxed. Null until the owner says; never guessed. */
  taxTreatment: text('tax_treatment', { enum: ['final', 'not_object', 'ordinary'] }),
  updatedAt: text('updated_at').notNull(),
});

/** What a time deposit was opened on: the day it comes back and what it pays. One row per deposit account. */
export const depositTerms = sqliteTable('deposit_terms', {
  accountId: text('account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  /** The day the money comes back. Nothing is automated off it: the owner moves it with a transfer. */
  maturesOn: text('matures_on').notNull(),
  rateBps: integer('rate_bps').notNull(),
  createdAt: text('created_at').notNull(),
});

export const investmentTrades = sqliteTable('investment_trades', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  accountId: text('account_id').notNull(),
  transactionId: text('transaction_id'),
  kind: text('kind', { enum: ['buy', 'sell', 'income', 'unit_change'] }).notNull(),
  occurredOn: text('occurred_on').notNull(),
  unitsMicro: integer('units_micro').notNull(),
  grossMinor: integer('gross_minor').notNull(),
  feeMinor: integer('fee_minor').notNull(),
  taxMinor: integer('tax_minor').notNull(),
  cashAccountId: text('cash_account_id'),
  goalId: text('goal_id'),
  /** Declared reinvestment of a dividend, and the holding it was declared into. */
  reinvestedMinor: integer('reinvested_minor'),
  reinvestedIntoAccountId: text('reinvested_into_account_id'),
  templateId: text('template_id'),
  status: text('status', { enum: ['active', 'replaced', 'deleted'] }).notNull(),
  replacesTradeId: text('replaces_trade_id'),
  createdAt: text('created_at').notNull(),
});

export const prices = sqliteTable('prices', {
  accountId: text('account_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  onDate: text('on_date').notNull(),
  priceMicro: integer('price_micro').notNull(),
  source: text('source', { enum: ['manual'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const valuations = sqliteTable('valuations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  accountId: text('account_id').notNull(),
  asOf: text('as_of').notNull(),
  valueMinor: integer('value_minor').notNull(),
  basis: text('basis', { enum: ['estimate', 'appraisal', 'listing', 'njop', 'purchase'] }).notNull(),
  note: text('note'),
  createdAt: text('created_at').notNull(),
});

export const tradeTemplates = sqliteTable('trade_templates', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  accountId: text('account_id').notNull(),
  cashAccountId: text('cash_account_id').notNull(),
  amountMinor: integer('amount_minor'),
  unitsMicro: integer('units_micro'),
  dayOfMonth: integer('day_of_month').notNull(),
  active: integer('active').notNull(),
  goalId: text('goal_id'),
  kind: text('kind', { enum: ['buy', 'move'] }).notNull(),
  createdAt: text('created_at').notNull(),
});
