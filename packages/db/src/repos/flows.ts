import { addMonths, displayAmount, monthOf, type PeriodFlows, type PlanGroup } from '@expanses/core';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { assetProfiles, investmentTrades } from '../schema-assets';
import { categoryIdsByKey } from './categories';
import { listInstallments } from './installments';
import { homeLoanAccountIds } from './loans';

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
/* Deliberately not the ledger's spendable list, which is one list of accounts that hold money: this splits
   that list in two. Money that reaches a savings pot or a broker is money put away; money in a wallet, a
   current account or a pocket is spending money, and a top-up is not saving. */
const SAVINGS_SUBTYPES = ['savings', 'fund'];
const SPENDING_SUBTYPES = ['cash', 'bank', 'ewallet'];

function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = monthOf(from); month <= monthOf(to); month = addMonths(month, 1)) months.push(month);
  return months;
}

interface TransactionRoll {
  month: string;
  principalMinor: number;
  interestMinor: number;
  touchesHomeLoan: boolean;
  /** Net change on accounts where money waits to grow: a savings pot, a deposit, or broker cash. */
  intoSavingsMinor: number;
  /** True when everyday money funded it, so a move between two savings pots counts nothing. */
  fromSpendingMoney: boolean;
}

/**
 * Take-home income, spending, debt payments, and what actually went into savings and investments
 * over a period, in base currency. Transfers and opening balances never reach income or spending,
 * because only categories are counted there.
 */
export async function periodFlows(
  database: Database,
  ws: WorkspaceContext,
  range: { from: string; to: string },
  opts: { homeLoanAccountIds?: string[] } = {},
): Promise<PeriodFlowsResult> {
  const keys = await categoryIdsByKey(database, ws);
  const realizedGainsId = keys['income.realized_gains'];
  const finalTaxId = keys['government_taxes.estimated_tax'];
  const interestId = keys['miscellaneous.interest'];
  // A caller may name the home loans; otherwise the loans say so themselves, by what they bought.
  const homeLoans = new Set(opts.homeLoanAccountIds ?? (await homeLoanAccountIds(database, ws)));

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

  const profiles = await database.db
    .select({ accountId: assetProfiles.accountId, planGroup: assetProfiles.planGroup })
    .from(assetProfiles)
    .where(eq(assetProfiles.workspaceId, ws.workspaceId));
  const groupOf = new Map<string, PlanGroup>(profiles.map((profile) => [profile.accountId, profile.planGroup]));
  const isSavingsDestination = (accountId: string, subtype: string) => groupOf.get(accountId) === 'invest' || SAVINGS_SUBTYPES.includes(subtype);
  const isSpendingMoney = (accountId: string, subtype: string) => SPENDING_SUBTYPES.includes(subtype) && groupOf.get(accountId) !== 'invest';

  const byMonth = new Map(monthsBetween(range.from, range.to).map((month) => [month, { month, incomeMinor: 0, spendingMinor: 0, debtPaymentsMinor: 0 }]));
  const perTransaction = new Map<string, TransactionRoll>();

  for (const row of rows) {
    const month = monthOf(row.occurredOn);
    const bucket = byMonth.get(month);
    if (row.kind === 'income' && row.accountId !== realizedGainsId) {
      if (bucket) bucket.incomeMinor += displayAmount('income', row.amountBaseMinor);
    } else if (row.kind === 'expense' && row.accountId !== finalTaxId) {
      if (bucket) bucket.spendingMinor += displayAmount('expense', row.amountBaseMinor);
    }
    const roll: TransactionRoll =
      perTransaction.get(row.transactionId) ??
      { month, principalMinor: 0, interestMinor: 0, touchesHomeLoan: false, intoSavingsMinor: 0, fromSpendingMoney: false };
    if (row.subtype === 'loan' && row.amountBaseMinor > 0) roll.principalMinor += row.amountBaseMinor;
    if (row.accountId === interestId) roll.interestMinor += displayAmount('expense', row.amountBaseMinor);
    if (homeLoans.has(row.accountId)) roll.touchesHomeLoan = true;
    if (row.kind === 'asset' && isSavingsDestination(row.accountId, row.subtype)) roll.intoSavingsMinor += row.amountBaseMinor;
    if (row.kind === 'asset' && isSpendingMoney(row.accountId, row.subtype) && row.amountBaseMinor < 0) roll.fromSpendingMoney = true;
    perTransaction.set(row.transactionId, roll);
  }

  // Purchases keep their own record, so their ledger transaction must not be counted a second time.
  const tradeRows = await database.db
    .select({
      transactionId: investmentTrades.transactionId,
      kind: investmentTrades.kind,
      cashAccountId: investmentTrades.cashAccountId,
      grossMinor: investmentTrades.grossMinor,
      feeMinor: investmentTrades.feeMinor,
      taxMinor: investmentTrades.taxMinor,
    })
    .from(investmentTrades)
    .where(
      and(
        eq(investmentTrades.workspaceId, ws.workspaceId),
        eq(investmentTrades.status, 'active'),
        gte(investmentTrades.occurredOn, range.from),
        lte(investmentTrades.occurredOn, range.to),
      ),
    );
  const tradeTransactions = new Set(tradeRows.map((trade) => trade.transactionId).filter((id): id is string => id !== null));

  let debtPaymentsMinor = 0;
  let nonMortgageDebtPaymentsMinor = 0;
  let putAwayMinor = 0;

  for (const [transactionId, roll] of perTransaction) {
    if (roll.principalMinor > 0) {
      // Interest only counts as a debt payment when the same transaction also pays down a loan.
      const total = roll.principalMinor + roll.interestMinor;
      debtPaymentsMinor += total;
      if (!roll.touchesHomeLoan) nonMortgageDebtPaymentsMinor += total;
      const bucket = byMonth.get(roll.month);
      if (bucket) bucket.debtPaymentsMinor += total;
      // Principal builds equity, so it is money put away; the interest is spending.
      putAwayMinor += roll.principalMinor;
    }
    if (tradeTransactions.has(transactionId) || roll.intoSavingsMinor === 0) continue;
    // Money moved from everyday accounts into a savings pot or broker cash, and money taken back out.
    if (roll.intoSavingsMinor > 0) {
      if (roll.fromSpendingMoney) putAwayMinor += roll.intoSavingsMinor;
    } else {
      putAwayMinor += roll.intoSavingsMinor;
    }
  }

  // A purchase paid from everyday money, a credit card included, is money put to work. Money that
  // already sat in a savings pot or at the broker was counted when it moved there, so it is not counted again.
  const savingsAccounts = new Set<string>();
  for (const row of rows) if (row.kind === 'asset' && isSavingsDestination(row.accountId, row.subtype)) savingsAccounts.add(row.accountId);
  for (const trade of tradeRows) {
    if (trade.kind !== 'buy' || trade.cashAccountId === null) continue;
    if (savingsAccounts.has(trade.cashAccountId)) continue;
    putAwayMinor += trade.grossMinor + trade.feeMinor + trade.taxMinor;
  }

  // An instalment billed in the period is a debt payment, though the purchase was spending once,
  // on the day it happened. The card balance carries the debt in between.
  for (const plan of await listInstallments(database, ws)) {
    for (let index = 0; index < plan.months; index += 1) {
      const month = addMonths(plan.firstBilledMonth, index);
      const bucket = byMonth.get(month);
      if (!bucket) continue;
      debtPaymentsMinor += plan.monthlyMinor;
      nonMortgageDebtPaymentsMinor += plan.monthlyMinor;
      bucket.debtPaymentsMinor += plan.monthlyMinor;
    }
  }

  const totals = [...byMonth.values()].reduce(
    (sum, month) => ({ incomeMinor: sum.incomeMinor + month.incomeMinor, spendingMinor: sum.spendingMinor + month.spendingMinor }),
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
    putAwayMinor,
    byMonth: [...byMonth.values()],
  };
}
