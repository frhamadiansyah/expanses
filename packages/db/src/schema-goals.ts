import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind', {
    enum: ['emergency', 'hajj', 'umrah', 'education', 'retirement', 'home', 'wedding', 'vehicle', 'holiday', 'other'],
  }).notNull(),
  rank: integer('rank').notNull(),
  growthBps: integer('growth_bps').notNull(),
  returnBps: integer('return_bps').notNull(),
  standingMonthlyMinor: integer('standing_monthly_minor').notNull(),
  standingNote: text('standing_note'),
  status: text('status', { enum: ['active', 'achieved', 'archived'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const goalStages = sqliteTable('goal_stages', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  targetMinor: integer('target_minor'),
  targetMonths: integer('target_months'),
  dueOn: text('due_on').notNull(),
  sort: integer('sort').notNull(),
  paidOn: text('paid_on'),
});

export const goalEarmarks = sqliteTable('goal_earmarks', {
  goalId: text('goal_id').notNull(),
  accountId: text('account_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  amountMinor: integer('amount_minor').notNull(),
});
