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
  // Null on a row written before 0091: the workspace's base currency.
  currency: text('currency'),
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

export const goalDraws = sqliteTable('goal_draws', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  transactionId: text('transaction_id').notNull(),
  goalId: text('goal_id').notNull(),
  accountId: text('account_id').notNull(),
  intent: text('intent', { enum: ['borrow', 'spend', 'move'] }).notNull(),
  amountMinor: integer('amount_minor').notNull(),
  toAccountId: text('to_account_id'),
  toAmountMinor: integer('to_amount_minor'),
  stageId: text('stage_id'),
  wasWhole: integer('was_whole').notNull(),
  wholeSince: text('whole_since'),
  occurredOn: text('occurred_on').notNull(),
  createdAt: text('created_at').notNull(),
});

/** The goals table as it stood before 0091 (no currency), for writing to a database that has not reached it. */
export const goalsBefore0091 = sqliteTable('goals', {
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

/** A goal's Monthly that comes due like a bill (0111): this phone's own, never synced. */
export const goalDues = sqliteTable('goal_dues', {
  goalId: text('goal_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  day: integer('day').notNull(),
  mode: text('mode', { enum: ['set_aside', 'transfer'] }).notNull(),
  accountId: text('account_id'),
  toAccountId: text('to_account_id'),
  startedMonth: text('started_month').notNull(),
  active: integer('active').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** What was done with one due month of a goal (0111). No row is an open month. */
export const goalDueMonths = sqliteTable('goal_due_months', {
  goalId: text('goal_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  month: text('month').notNull(),
  state: text('state', { enum: ['done', 'skipped'] }).notNull(),
  mode: text('mode', { enum: ['set_aside', 'transfer'] }),
  amountMinor: integer('amount_minor'),
  occurredOn: text('occurred_on'),
  accountId: text('account_id'),
  toAccountId: text('to_account_id'),
  transactionId: text('transaction_id'),
  createdAt: text('created_at').notNull(),
});
