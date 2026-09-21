import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const categoryNeeds = sqliteTable('category_needs', {
  categoryAccountId: text('category_account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  need: text('need', { enum: ['essential', 'lifestyle'] }).notNull(),
});

export const budgetFrequencies = sqliteTable('budget_frequencies', {
  budgetId: text('budget_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  frequency: text('frequency', { enum: ['daily', 'weekly', 'quarterly', 'yearly'] }).notNull(),
  amountAsSetMinor: integer('amount_as_set_minor').notNull(),
});

export const goalStageTerms = sqliteTable('goal_stage_terms', {
  stageId: text('stage_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  goalId: text('goal_id').notNull(),
  returnBps: integer('return_bps'),
  derivedKey: text('derived_key'),
});

/** The last figures a goal-less calculator (life cover) was given, one row per workspace and calculator. */
export const calculatorInputs = sqliteTable(
  'calculator_inputs',
  {
    workspaceId: text('workspace_id').notNull(),
    kind: text('kind').notNull(),
    inputsJson: text('inputs_json').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.kind] })],
);
