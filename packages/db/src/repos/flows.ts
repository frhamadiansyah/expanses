import { addMonths, displayAmount, monthOf, type PeriodFlows } from '@expanses/core';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { categoryIdsByKey } from './categories';

export interface MonthFlow {
  month: string;
  incomeMinor: number;
  spendingMinor: number;
  debtPaymentsMinor: number;
}

export interface PeriodFlowsResult extends PeriodFlows {
  from: string;
  to: string;
  byMonth: MonthFlow[];
}

const MAX_MONTHS = 12;

function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = monthOf(from); month <= monthOf(to); month = addMonths(month, 1)) months.push(month);
  return months;
}

/**
 * Take-home income, spending and debt payments over a period, in base currency.
 * Transfers and opening balances never appear, because only income and expense categories are counted.
 */
export async function periodFlows(
  database: Database,
  ws: WorkspaceContext,
  range: { from: string; to: string },
  opts: { homeLoanAccountIds?: string[] } = {},
): Promise<PeriodFlowsResult> {
  const keys = await categoryIdsByKey(database, ws);
  const realizedGainsId = keys['income.realized_gains'];
  const finalTaxId = keys['government.final_tax'];
  const interestId = keys['fees.interest'];
  const homeLoans = new Set(opts.homeLoanAccountIds ?? []);

  const rows = await database.db
    .select({
      transactionId: entries.transactionId,
      accountId: entries.accountId,
      amountBaseMinor: entries.amountBaseMinor,
      kind: accounts.kind,
      subtype: accounts.subtype,
      occurredOn: transactions.occurredOn,
    })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        gte(transactions.occurredOn, range.from),
        lte(transactions.occurredOn, range.to),
      ),
    );

  const byMonth = new Map(monthsBetween(range.from, range.to).map((month) => [month, { month, incomeMinor: 0, spendingMinor: 0, debtPaymentsMinor: 0 }]));
  /** A loan payment is one transaction: principal off the loan, interest as an expense. */
  const perTransaction = new Map<string, { month: string; principalMinor: number; interestMinor: number; touchesHomeLoan: boolean }>();

  for (const row of rows) {
    const month = monthOf(row.occurredOn);
    const bucket = byMonth.get(month);
    if (row.kind === 'income' && row.accountId !== realizedGainsId) {
      if (bucket) bucket.incomeMinor += displayAmount('income', row.amountBaseMinor);
    } else if (row.kind === 'expense' && row.accountId !== finalTaxId) {
      if (bucket) bucket.spendingMinor += displayAmount('expense', row.amountBaseMinor);
    }
    const payment = perTransaction.get(row.transactionId) ?? { month, principalMinor: 0, interestMinor: 0, touchesHomeLoan: false };
    if (row.subtype === 'loan' && row.amountBaseMinor > 0) payment.principalMinor += row.amountBaseMinor;
    if (row.accountId === interestId) payment.interestMinor += displayAmount('expense', row.amountBaseMinor);
    if (homeLoans.has(row.accountId)) payment.touchesHomeLoan = true;
    perTransaction.set(row.transactionId, payment);
  }

  let debtPaymentsMinor = 0;
  let nonMortgageDebtPaymentsMinor = 0;
  for (const payment of perTransaction.values()) {
    // Interest only counts as a debt payment when the same transaction also pays down a loan.
    if (payment.principalMinor <= 0) continue;
    const total = payment.principalMinor + payment.interestMinor;
    debtPaymentsMinor += total;
    if (!payment.touchesHomeLoan) nonMortgageDebtPaymentsMinor += total;
    const bucket = byMonth.get(payment.month);
    if (bucket) bucket.debtPaymentsMinor += total;
  }

  const totals = [...byMonth.values()].reduce(
    (sum, month) => ({
      incomeMinor: sum.incomeMinor + month.incomeMinor,
      spendingMinor: sum.spendingMinor + month.spendingMinor,
    }),
    { incomeMinor: 0, spendingMinor: 0 },
  );

  // A month counts only when money actually moved in or out; an opening balance alone is not a month of cash flow.
  const monthsWithFlows = [...byMonth.values()].filter((month) => month.incomeMinor !== 0 || month.spendingMinor !== 0 || month.debtPaymentsMinor !== 0).length;

  return {
    from: range.from,
    to: range.to,
    months: Math.min(monthsWithFlows, MAX_MONTHS),
    incomeMinor: totals.incomeMinor,
    spendingMinor: totals.spendingMinor,
    debtPaymentsMinor,
    nonMortgageDebtPaymentsMinor,
    byMonth: [...byMonth.values()],
  };
}
