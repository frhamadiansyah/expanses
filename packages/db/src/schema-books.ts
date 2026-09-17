import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['personal', 'business', 'family', 'shared'] }).notNull(),
  baseCurrency: text('base_currency').notNull(),
  /** A default here matters: without one drizzle names the column and sends null. */
  countEventsInBudget: integer('count_events_in_budget').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
});

export const bookCategories = sqliteTable('book_categories', {
  categoryAccountId: text('category_account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  bookId: text('book_id').notNull(),
});

export const bookTransactions = sqliteTable('book_transactions', {
  transactionId: text('transaction_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  bookId: text('book_id').notNull(),
});

export const bookCategorySets = sqliteTable('book_category_sets', {
  setId: text('set_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  bookId: text('book_id').notNull(),
});

export const bookBudgetSettings = sqliteTable('book_budget_settings', {
  bookId: text('book_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  expectedIncomeMinor: integer('expected_income_minor').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const bookIncomeOverrides = sqliteTable(
  'book_income_overrides',
  {
    bookId: text('book_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    month: text('month').notNull(),
    amountMinor: integer('amount_minor').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.month] })],
);
