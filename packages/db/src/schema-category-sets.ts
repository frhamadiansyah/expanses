import { sql } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const categorySets = sqliteTable('category_sets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
});

export const categorySetMembers = sqliteTable('category_set_members', {
  categoryAccountId: text('category_account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  setId: text('set_id').notNull(),
});

/**
 * Categories of the monthly tree: everything no set has claimed.
 *
 * Written against the accounts table by name because it is a correlated subquery, and every caller
 * applies it to a query already selecting from accounts.
 */
export const NOT_IN_A_SET = sql`NOT EXISTS (SELECT 1 FROM category_set_members m WHERE m.category_account_id = accounts.id)`;
