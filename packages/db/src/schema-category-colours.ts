import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** A colour picked by hand for a top-level category (0060). No row: the colour the app works out. */
export const categoryColours = sqliteTable('category_colours', {
  categoryAccountId: text('category_account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  colour: text('colour').notNull(),
});
