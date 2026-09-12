import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const taxYearReports = sqliteTable('tax_year_reports', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  taxYear: integer('tax_year').notNull(),
  status: text('status', { enum: ['draft', 'frozen', 'filed'] }).notNull(),
  frozenAt: text('frozen_at'),
  filedOn: text('filed_on'),
  npwp: text('npwp'),
  taxpayerName: text('taxpayer_name'),
  propertyBasis: text('property_basis', { enum: ['cost', 'estimate', 'njop', 'appraisal'] }).notNull(),
  repeatRows: text('repeat_rows', { enum: ['holding', 'year'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const taxYearRows = sqliteTable('tax_year_rows', {
  id: text('id').primaryKey(),
  reportId: text('report_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  /** A harta section, or 'utang' for Bagian B. */
  section: text('section').notNull(),
  code: text('code').notNull(),
  accountId: text('account_id'),
  /** The row's own key, which carries the account and the year when rows are split. */
  rowKey: text('row_key').notNull(),
  name: text('name').notNull(),
  acquiredYear: integer('acquired_year'),
  sort: integer('sort').notNull(),
  fieldsJson: text('fields_json').notNull(),
  costMinor: integer('cost_minor').notNull(),
  valueMinor: integer('value_minor').notNull(),
  balanceMinor: integer('balance_minor').notNull(),
  source: text('source', { enum: ['auto', 'edited', 'manual'] }).notNull(),
  /** 1 when the row was already on a return filed before this app was used. */
  alreadyFiled: integer('already_filed').notNull(),
  createdAt: text('created_at').notNull(),
});
