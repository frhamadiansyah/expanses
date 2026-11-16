import { addMonths, displayAmount, type MonthStartDay, type PartWeight, type PeriodFlows, periodMonthOf, type PlanGroup } from '@expanses/core';
import { and, eq, gte, lte, type SQL, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { assetProfiles, investmentTrades } from '../schema-assets';
import { bookMoneyFor, type Unconverted } from './book-currency';
import { eventOnlyExists, notEventOnly } from './event-only';
import { categoryIdsOfBook, hasBooks } from './books';
import { monthStartFor } from './month-start';
import { categoryIdsByKeyAll } from './categories';
import { resolvedCategoryNeeds } from './category-needs';
import { plansWithStatementDays, purchaseWholes, spreadLinesIn, spreadPurchaseIds } from './instalment-spending';
import { homeLoanAccountIds } from './loans';
import { extrasTablesExist } from './transaction-extras';
import { lineExclusionExists, splitExclusionExists } from './book-splits';

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
  /** The currency these figures read in: the open workspace's own, else the owner's. */
  currency: string;
  /** Amounts left out because no rate reaches `currency` for that date or earlier. */
  missing: Unconverted[];
}

const MAX_MONTHS = 12;
/* Deliberately not the ledger's spendable list, which is one list of accounts that hold money: this splits
   that list in two. Money that reaches a savings pot or a broker is money put away; money in a wallet, a
   current account or a pocket is spending money, and a top-up is not saving. */
const SAVINGS_SUBTYPES = ['savings', 'fund', 'time_deposit'];
const SPENDING_SUBTYPES = ['cash', 'bank', 'ewallet', 'emoney', 'other_cash'];

/** The months a range touches, each named as the workspace's months are (`periodMonthOf`). */
function monthsBetween(from: string, to: string, startDay: MonthStartDay): string[] {
  const months: string[] = [];
  for (let month = periodMonthOf(from, startDay); month <= periodMonthOf(to, startDay); month = addMonths(month, 1)) months.push(month);
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
  opts: {
    homeLoanAccountIds?: string[];
    /**
     * The day the months of `byMonth` start on ("Month starts on", 0118). Defaults to the open workspace's own; an
     * owner-wide read (no workspace open) is calendar months unless a caller names the day, as Financial health does.
     */
    monthStart?: MonthStartDay;
  } = {},
): Promise<PeriodFlowsResult> {
  const startDay = opts.monthStart ?? (await monthStartFor(database, ws));
  // Flows are the owner's whole picture, so a key means every workspace's copy of it, not one workspace's.
  const keys = await categoryIdsByKeyAll(database, ws);
  const realizedGains = new Set(keys['income.realized_gains'] ?? []);
  const finalTax = new Set(keys['government_taxes.estimated_tax'] ?? []);
  const interest = new Set(keys['miscellaneous.interest'] ?? []);
  // A caller may name the home loans; otherwise the loans say so themselves, by what they bought.
  const homeLoans = new Set(opts.homeLoanAccountIds ?? (await homeLoanAccountIds(database, ws)));

  // Income and spending are what this workspace earned and spent; savings and debt are facts about your own
  // accounts, which no workspace owns. So only the two category sides are narrowed to the open book.
  const ofBook = ws.bookId && (await hasBooks(database.db)) ? new Set(await categoryIdsOfBook(database, ws.bookId)) : null;
  const counts = (accountId: string) => ofBook === null || ofBook.has(accountId);
  // Which spending is a choice rather than a need, read for the owner's whole tree as the keys above are.
  const lifestyle = new Set(
    Object.entries(await resolvedCategoryNeeds(database.db, ws))
      .filter(([, need]) => need === 'lifestyle')
      .map(([id]) => id),
  );
  let lifestyleSpendingMinor = 0;

  // Each figure is read in the workspace's own currency: an entry from the currency it was paid in, on its own day;
  // anything already kept in the owner's currency (an instalment, a trade) from there, on the day it falls.
  const money = await bookMoneyFor(database, ws);
  const intoRead = (amountMinor: number, onDate: string) => (money.converts ? (money.convert(amountMinor, ws.baseCurrency, onDate) ?? 0) : amountMinor);

  // What a shared event put in this phone's books is in no workspace's Cashflow (shared events §5.1).
  const eventOnly = await eventOnlyExists(database.db);
  const rows = await database.db
    .select({
      transactionId: entries.transactionId,
      accountId: entries.accountId,
      amountMinor: entries.amountMinor,
      currency: entries.currency,
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
        ...(eventOnly ? [notEventOnly(transactions.id)] : []),
      ),
    );

  const profiles = await database.db
    .select({ accountId: assetProfiles.accountId, planGroup: assetProfiles.planGroup })
    .from(assetProfiles)
    .where(eq(assetProfiles.workspaceId, ws.workspaceId));
  const groupOf = new Map<string, PlanGroup>(profiles.map((profile) => [profile.accountId, profile.planGroup]));
  const isSavingsDestination = (accountId: string, subtype: string) => groupOf.get(accountId) === 'invest' || SAVINGS_SUBTYPES.includes(subtype);
  const isSpendingMoney = (accountId: string, subtype: string) => SPENDING_SUBTYPES.includes(subtype) && groupOf.get(accountId) !== 'invest';

  const byMonth = new Map(monthsBetween(range.from, range.to, startDay).map((month) => [month, { month, incomeMinor: 0, spendingMinor: 0, debtPaymentsMinor: 0 }]));
  const perTransaction = new Map<string, TransactionRoll>();

  // What was marked "not my spending". Narrowed the same two ways `rows` above is: this workspace, this period — or,
  // for the purchases a plan spreads each month, those purchases whatever their date.
  const extras = await extrasTablesExist(database.db);
  const excludedWhere = async (which: SQL) =>
    new Set<string>(
      extras
        ? (
            await database.db.values<[string]>(sql`
              SELECT tf.transaction_id FROM transaction_flags tf
              JOIN transactions t ON t.id = tf.transaction_id
              WHERE tf.excluded = 1
                AND tf.workspace_id = ${ws.workspaceId}
                AND t.workspace_id = ${ws.workspaceId}
                AND ${which}`)
          ).map((row) => String(row[0]))
        : [],
    );
  const inRange = sql`t.occurred_on BETWEEN ${range.from} AND ${range.to}`;
  const excludedIds = await excludedWhere(inRange);

  // One workspace's part of a purchase split across workspaces, marked out of its reports on its own (0090), and a single
  // line marked out on its own (0096): their category lines, by transaction. The other lines count; balances, debt and
  // savings below never read this.
  const splitExclusion = await splitExclusionExists(database.db);
  const lineExclusion = await lineExclusionExists(database.db);
  const excludedPartsWhere = async (which: SQL) => {
    const parts = new Set<string>(
      splitExclusion
        ? (
            await database.db.values<[string, string]>(sql`
              SELECT s.transaction_id, c.category_account_id FROM book_transaction_splits s
              JOIN book_categories c ON c.book_id = s.book_id
              JOIN transactions t ON t.id = s.transaction_id
              WHERE s.excluded = 1
                AND t.workspace_id = ${ws.workspaceId}
                AND ${which}`)
          ).map(([transactionId, accountId]) => `${transactionId}:${accountId}`)
        : [],
    );
    if (lineExclusion) {
      const lines = await database.db.values<[string, string]>(sql`
        SELECT l.transaction_id, l.account_id FROM transaction_line_excluded l
        JOIN transactions t ON t.id = l.transaction_id
        WHERE t.workspace_id = ${ws.workspaceId}
          AND ${which}`);
      for (const [transactionId, accountId] of lines) parts.add(`${transactionId}:${accountId}`);
    }
    return parts;
  };
  const excludedParts = await excludedPartsWhere(inRange);

  // Card instalments counting each month (0120): the purchase they spread counts nothing on its own day; its
  // instalments count instead, below. The purchase still moves the card's balance as ever.
  const plans = await plansWithStatementDays(database.db, ws);
  const spread = new Set(spreadPurchaseIds(plans));

  for (const row of rows) {
    const month = periodMonthOf(row.occurredOn, startDay);
    const bucket = byMonth.get(month);
    // What the entry is worth in the read currency. Null means no rate reaches that day, so it counts as nothing
    // and is named in `missing`; which side of the ledger a row is on is still read from the owner's figure, so a
    // missing rate never turns a loan payment into something else.
    const read = (money.converts ? money.convert(row.amountMinor, row.currency, row.occurredOn) : row.amountBaseMinor) ?? 0;
    const counted = !excludedIds.has(row.transactionId) && !excludedParts.has(`${row.transactionId}:${row.accountId}`);
    if (row.kind === 'expense' && spread.has(row.transactionId)) {
      // spread over its plan's months: counted below, one instalment at a time
    } else if (counted && row.kind === 'income' && !realizedGains.has(row.accountId) && counts(row.accountId)) {
      if (bucket) bucket.incomeMinor += displayAmount('income', read);
    } else if (counted && row.kind === 'expense' && !finalTax.has(row.accountId) && counts(row.accountId)) {
      if (bucket) {
        const spent = displayAmount('expense', read);
        bucket.spendingMinor += spent;
        if (lifestyle.has(row.accountId)) lifestyleSpendingMinor += spent;
      }
    }
    // The rolls below are a separate statement, not an `else` on this chain, so they are unreachable from it and
    // go on counting an excluded row — which is what §15.5 asks for: they are facts about balances, not spending.
    const roll: TransactionRoll =
      perTransaction.get(row.transactionId) ??
      { month, principalMinor: 0, interestMinor: 0, touchesHomeLoan: false, intoSavingsMinor: 0, fromSpendingMoney: false };
    if (row.subtype === 'loan' && row.amountBaseMinor > 0) roll.principalMinor += read;
    if (interest.has(row.accountId)) roll.interestMinor += displayAmount('expense', read);
    if (homeLoans.has(row.accountId)) roll.touchesHomeLoan = true;
    if (row.kind === 'asset' && isSavingsDestination(row.accountId, row.subtype)) roll.intoSavingsMinor += read;
    if (row.kind === 'asset' && isSpendingMoney(row.accountId, row.subtype) && row.amountBaseMinor < 0) roll.fromSpendingMoney = true;
    perTransaction.set(row.transactionId, roll);
  }

  // Purchases keep their own record, so their ledger transaction must not be counted a second time.
  const tradeRows = await database.db
    .select({
      transactionId: investmentTrades.transactionId,
      kind: investmentTrades.kind,
      cashAccountId: investmentTrades.cashAccountId,
      occurredOn: investmentTrades.occurredOn,
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
  let debtPrincipalMinor = 0;
  let putAwayMinor = 0;

  for (const [transactionId, roll] of perTransaction) {
    if (roll.principalMinor > 0) {
      // Interest only counts as a debt payment when the same transaction also pays down a loan.
      const total = roll.principalMinor + roll.interestMinor;
      debtPaymentsMinor += total;
      if (!roll.touchesHomeLoan) nonMortgageDebtPaymentsMinor += total;
      const bucket = byMonth.get(roll.month);
      if (bucket) bucket.debtPaymentsMinor += total;
      // Principal builds equity, so it is money put away; the interest is spending. That is also why the
      // principal is kept on its own: it is the only half of the payment spending does not already hold.
      putAwayMinor += roll.principalMinor;
      debtPrincipalMinor += roll.principalMinor;
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
    putAwayMinor += intoRead(trade.grossMinor + trade.feeMinor + trade.taxMinor, trade.occurredOn);
  }

  // Each month (0120): each instalment is that month's spending, on its statement date, in the purchase's categories —
  // read through the same filters as any spending row here (this workspace's categories, nothing excluded, no final
  // tax), whatever day the purchase was made. It is not also a debt payment: that would count the money twice.
  if (plans.some(({ plan }) => plan.countMode === 'each_month')) {
    const ids = [...spread];
    const parts = new Map<string, PartWeight[]>();
    if (ids.length > 0) {
      const which = sql`t.id IN ${ids}`;
      const [excludedSpread, excludedSpreadParts] = [await excludedWhere(which), await excludedPartsWhere(which)];
      const lines = await database.db.values<[string, string, number]>(sql`
        SELECT e.transaction_id, e.account_id, SUM(e.amount_base_minor) FROM entries e
        JOIN accounts a ON a.id = e.account_id JOIN transactions t ON t.id = e.transaction_id
        WHERE a.kind = 'expense' AND t.status = 'posted' AND e.workspace_id = ${ws.workspaceId} AND ${which}
        GROUP BY e.transaction_id, e.account_id`);
      for (const [transactionId, accountId, total] of lines) {
        if (excludedSpread.has(transactionId) || excludedSpreadParts.has(`${transactionId}:${accountId}`)) continue;
        if (finalTax.has(accountId) || !counts(accountId)) continue;
        const weight = displayAmount('expense', Number(total));
        if (weight > 0) parts.set(transactionId, [...(parts.get(transactionId) ?? []), { key: accountId, weight }]);
      }
      if (eventOnly) {
        // What a shared event put in this phone's books is in no workspace's Cashflow (shared events §5.1).
        const onlyEvent = await database.db.values<[string]>(sql`SELECT t.id FROM transactions t WHERE ${which} AND NOT (${notEventOnly(sql`t.id`)})`);
        for (const [id] of onlyEvent) parts.delete(id);
      }
    }
    const wholes = await purchaseWholes(database.db, ids);
    for (const line of await spreadLinesIn(database.db, ws, plans, range.from, range.to, parts, wholes)) {
      if (!counts(line.categoryId)) continue;
      const bucket = byMonth.get(periodMonthOf(line.statementOn, startDay));
      if (!bucket) continue;
      const spent = intoRead(line.amountBaseMinor, line.statementOn);
      bucket.spendingMinor += spent;
      if (lifestyle.has(line.categoryId)) lifestyleSpendingMinor += spent;
    }
  }

  // At purchase: an instalment billed in the period is a debt payment, though the purchase was spending once, on the day
  // it happened. The card balance carries the debt in between.
  for (const { plan } of plans) {
    if (plan.countMode === 'each_month') continue;
    for (let index = 0; index < plan.months; index += 1) {
      const month = addMonths(plan.firstBilledMonth, index);
      const bucket = byMonth.get(month);
      if (!bucket) continue;
      const billed = intoRead(plan.monthlyMinor, `${month}-01`);
      debtPaymentsMinor += billed;
      nonMortgageDebtPaymentsMinor += billed;
      // A plan books no interest of its own, and the purchase was spent in the month it happened, so the
      // whole instalment sits outside this period's spending.
      debtPrincipalMinor += billed;
      bucket.debtPaymentsMinor += billed;
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
    lifestyleSpendingMinor,
    debtPaymentsMinor,
    nonMortgageDebtPaymentsMinor,
    debtPrincipalMinor,
    putAwayMinor,
    byMonth: [...byMonth.values()],
    currency: money.currency,
    missing: money.missing(),
  };
}
