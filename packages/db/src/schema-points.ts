import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const cardTerms = sqliteTable('card_terms', {
  accountId: text('account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  creditLimitMinor: integer('credit_limit_minor'),
  statementDay: integer('statement_day').notNull(),
  dueDay: integer('due_day').notNull(),
  annualFeeMinor: integer('annual_fee_minor'),
});

export const rewardPrograms = sqliteTable('reward_programs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  cardAccountId: text('card_account_id').notNull(),
  name: text('name').notNull(),
  unit: text('unit', { enum: ['points', 'miles', 'cashback'] }).notNull(),
  cycleAnchor: text('cycle_anchor', { enum: ['statement', 'calendar'] }).notNull(),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
});

export const earnRules = sqliteTable('earn_rules', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  programId: text('program_id').notNull(),
  name: text('name').notNull(),
  priority: integer('priority').notNull(),
  stackable: integer('stackable').notNull(),
  matchJson: text('match_json').notNull(),
  rateNum: real('rate_num').notNull(),
  rateDen: integer('rate_den').notNull(),
  rounding: text('rounding', { enum: ['per_transaction_floor', 'per_cycle_sum', 'per_increment'] }).notNull(),
  capSpendMinor: integer('cap_spend_minor'),
  capPoints: integer('cap_points'),
  minTransactionMinor: integer('min_transaction_minor'),
  validFrom: text('valid_from'),
  validTo: text('valid_to'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
});

export const redemptionOptions = sqliteTable('redemption_options', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  programId: text('program_id').notNull(),
  name: text('name').notNull(),
  type: text('type', { enum: ['cashback', 'voucher', 'miles_transfer', 'statement_credit'] }).notNull(),
  valueMinor: integer('value_minor').notNull(),
  perPoints: integer('per_points').notNull(),
  currency: text('currency').notNull(),
});

export const cycleActuals = sqliteTable('cycle_actuals', {
  workspaceId: text('workspace_id').notNull(),
  programId: text('program_id').notNull(),
  cycleStart: text('cycle_start').notNull(),
  actualPoints: integer('actual_points').notNull(),
  recordedAt: text('recorded_at').notNull(),
});
