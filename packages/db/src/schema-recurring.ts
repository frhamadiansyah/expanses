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

/** A month in which a recurring bill was deliberately not paid, so it stops being owed. */
export const billSkips = sqliteTable('bill_skips', {
  workspaceId: text('workspace_id').notNull(),
  templateId: text('template_id').notNull(),
  /** YYYY-MM: a skip belongs to a month rather than to a day. */
  month: text('month').notNull(),
  createdAt: text('created_at').notNull(),
});

/** A bill's pay-by day and the first month it is tracked for. One row per bill. */
export const billWindows = sqliteTable('bill_windows', {
  templateId: text('template_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  payByDay: integer('pay_by_day'),
  startsMonth: text('starts_month').notNull(),
});

/** The month a bill payment settles. */
export const billPayments = sqliteTable('bill_payments', {
  transactionId: text('transaction_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  templateId: text('template_id').notNull(),
  billMonth: text('bill_month').notNull(),
});
