import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/*
 * Statement checks (migration 0066). Device-local, never synced: they sit beside the card's terms, postings and
 * settlements, none of which sync today. The transactions a check posts are ordinary transactions and sync as usual.
 */

/** One checked statement of a card: its period, what the statement closed at, and whether cicis agreed. */
export const statementChecks = sqliteTable('statement_checks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  cardAccountId: text('card_account_id').notNull(),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  closingMinor: integer('closing_minor'),
  previousMinor: integer('previous_minor'),
  status: text('status', { enum: ['reconciled', 'differs', 'open'] }).notNull(),
  differenceMinor: integer('difference_minor').notNull().default(0),
  checkedAt: text('checked_at').notNull(),
});

export type StatementLinkKind = 'matched' | 'recorded' | 'differs-kept' | 'differs-updated' | 'payments-untracked';

/** Which transaction a check matched, recorded or adjusted. No statement text is kept. */
export const statementLinks = sqliteTable(
  'statement_links',
  {
    checkId: text('check_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    kind: text('kind', { enum: ['matched', 'recorded', 'differs-kept', 'differs-updated', 'payments-untracked'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.checkId, t.transactionId] })],
);

/** Per-card statement settings. Track card payments is off unless the owner turns it on. */
export const cardStatementSettings = sqliteTable('card_statement_settings', {
  cardAccountId: text('card_account_id').primaryKey(),
  trackPayments: integer('track_payments').notNull().default(0),
});
