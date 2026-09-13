import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const expenseTemplates = sqliteTable('expense_templates', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  categoryAccountId: text('category_account_id').notNull(),
  moneyAccountId: text('money_account_id').notNull(),
  /** Null when the amount differs every month, such as electricity. */
  amountMinor: integer('amount_minor'),
  dayOfMonth: integer('day_of_month').notNull(),
  /** A default here matters: without one drizzle names the column and sends null. */
  active: integer('active').notNull().default(1),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
});
