import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  startsOn: text('starts_on').notNull(),
  endsOn: text('ends_on').notNull(),
  /** A figure for the whole event, instead of planning category by category. */
  plannedMinor: integer('planned_minor'),
  goalId: text('goal_id'),
  /** The category set the event draws on, when it draws on one rather than the monthly categories. */
  setId: text('set_id'),
  /** When the owner called it done. Null while it is still running. */
  finishedAt: text('finished_at'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
});

export const eventBudgets = sqliteTable('event_budgets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  eventId: text('event_id').notNull(),
  categoryAccountId: text('category_account_id').notNull(),
  /** Null means the category belongs to the event but carries no figure yet. */
  plannedMinor: integer('planned_minor'),
  createdAt: text('created_at').notNull(),
});
