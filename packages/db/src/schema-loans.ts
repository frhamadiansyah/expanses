import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const loanTerms = sqliteTable('loan_terms', {
  accountId: text('account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  lenderName: text('lender_name').notNull(),
  lenderNpwp: text('lender_npwp'),
  purpose: text('purpose'),
  originalMinor: integer('original_minor').notNull(),
  firstPaymentOn: text('first_payment_on').notNull(),
  tenorMonths: integer('tenor_months').notNull(),
  method: text('method', { enum: ['annuity', 'flat', 'zero'] }).notNull(),
  paymentDay: integer('payment_day').notNull(),
  /** The house or car this loan bought. A property makes it a home loan. */
  assetAccountId: text('asset_account_id'),
  coretaxCode: text('coretax_code').notNull(),
  status: text('status', { enum: ['open', 'paid_off'] }).notNull(),
  statusOn: text('status_on'),
  createdAt: text('created_at').notNull(),
});

/**
 * Which kind of loan a loan is, as the catalogue named it: `home_mortgage`, `vehicle_leasing`,
 * `online_loan`. A row of its own rather than a column on `loan_terms`, so a database still stopped at an
 * older version keeps working (see 0028). No row means the loan was never classified, and it reads as what its
 * own facts say — a loan against a property is a mortgage, one against a vehicle is a lease.
 */
export const loanItems = sqliteTable('loan_items', {
  accountId: text('account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  itemId: text('item_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const loanRatePeriods = sqliteTable('loan_rate_periods', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  fromOn: text('from_on').notNull(),
  rateBps: integer('rate_bps').notNull(),
  kind: text('kind', { enum: ['fixed', 'floating'] }).notNull(),
  /** What the bank asks for under this rate. 0 means "work it out from the balance". */
  paymentMinor: integer('payment_minor').notNull(),
});

export const cardInstallments = sqliteTable('card_installments', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  cardAccountId: text('card_account_id').notNull(),
  /** The purchase this plan was converted from, when it is known. */
  transactionId: text('transaction_id'),
  description: text('description').notNull(),
  totalMinor: integer('total_minor').notNull(),
  months: integer('months').notNull(),
  monthlyMinor: integer('monthly_minor').notNull(),
  firstBilledMonth: text('first_billed_month').notNull(),
  rateBps: integer('rate_bps').notNull(),
  conversionFeeMinor: integer('conversion_fee_minor').notNull(),
  /** 1 when the converted purchase still earns points; many issuers pay none. */
  earnsPoints: integer('earns_points').notNull(),
  createdAt: text('created_at').notNull(),
});
