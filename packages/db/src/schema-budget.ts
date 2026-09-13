import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  categoryAccountId: text('category_account_id').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const budgetOverrides = sqliteTable('budget_overrides', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  budgetId: text('budget_id').notNull(),
  month: text('month').notNull(),
  amountMinor: integer('amount_minor').notNull(),
});

export const budgetSettings = sqliteTable('budget_settings', {
  workspaceId: text('workspace_id').primaryKey(),
  expectedIncomeMinor: integer('expected_income_minor').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const budgetIncomeOverrides = sqliteTable('budget_income_overrides', {
  workspaceId: text('workspace_id').notNull(),
  month: text('month').notNull(),
  amountMinor: integer('amount_minor').notNull(),
});

export const goalContributions = sqliteTable('goal_contributions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  goalId: text('goal_id').notNull(),
  accountId: text('account_id').notNull(),
  deltaMinor: integer('delta_minor').notNull(),
  occurredOn: text('occurred_on').notNull(),
  source: text('source', { enum: ['earmark'] }).notNull(),
  createdAt: text('created_at').notNull(),
});
