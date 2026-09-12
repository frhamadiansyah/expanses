import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const debtProfiles = sqliteTable('debt_profiles', {
  accountId: text('account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  personName: text('person_name').notNull(),
  /** NIK or NPWP, for the Coretax piutang and utang tables. */
  personIdNumber: text('person_id_number'),
  reason: text('reason'),
  dueOn: text('due_on'),
  status: text('status', { enum: ['open', 'settled', 'forgiven'] }).notNull(),
  statusOn: text('status_on'),
  /** Receivable 0201 default, 0202 related party; payable 109 default, 103 related party. */
  coretaxCode: text('coretax_code').notNull(),
  createdAt: text('created_at').notNull(),
});
