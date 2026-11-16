import { type DayTotal, displayAmount, installmentSchedule, instalmentsFrom, type PartWeight } from '@expanses/core';
import { and, eq, gte, inArray, isNotNull, isNull, lte, notInArray, type SQL, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { attributedOn, billTablesExist } from './bill-months';
import { monthStartFor } from './month-start';
import { bookMoneyFor, type Unconverted } from './book-currency';
import { partCountedWhere } from './book-splits';
import { eventOnlyExists, notEventOnly } from './event-only';
import { extrasTablesExist, notExcluded } from './transaction-extras';
import { isInvestmentPlan, type PlanWithDay, plansWithStatementDays, purchaseWholes, type SpreadLine, spreadLinesIn, spreadPurchaseIds } from './instalment-spending';

/** What narrows a category total beyond its kind and its dates. */
export interface CategoryTotalsOptions {
  excludeEvents?: boolean;
  billMonths?: boolean;
  /**
   * Only what this account paid for: Cashflow's donut following the list's Paid with filter (statement check S11).
   * A transaction counts when it has an entry on the account, and only by the account's share of what paid for it.
   */
  paidAccountId?: string;
}

export interface CategoryTotal {
  accountId: string;
  amountBaseMinor: number;
  transactions: number;
}

/**
 * The rows a category total is made of, and the day each of them counts on.
 *
 * Both readings below stand on this: one adds the rows up in SQL, the other converts each amount first and adds
 * them up here. Sharing the where clause is what keeps the two answers the same question.
 */
async function categoryRows(
  database: Database,
  ws: WorkspaceContext,
  kind: 'expense' | 'income',
  from: string,
  to: string,
  opts: CategoryTotalsOptions,
  /**
   * The purchases a plan spreads each month (`spreadPurchaseIds`), left out here: their instalments count instead
   * (`spreadIn`). Null reads them as any other row — what working out a spread purchase's parts asks for.
   */
  spread: readonly string[] | null = [],
): Promise<{ where: SQL; onDate: SQL<string>; share: SQL<number> }> {
  // The budget and Cashflow ask for bills in the month they came out; every other reader keeps the day paid.
  const byBillMonth = opts.billMonths === true && (await billTablesExist(database.db));
  // Whether a bill paid inside its own month counts on the day paid is asked of the workspace's months (0118).
  const startDay = byBillMonth ? await monthStartFor(database, ws) : 1;
  const paid = opts.paidAccountId;
  // What the filtered account put into a transaction, in base: one entry, or the sum of several on the same account.
  const ownSum = sql`(SELECT sum(own.amount_base_minor) FROM entries own WHERE own.transaction_id = ${transactions.id} AND own.account_id = ${paid ?? null})`;
  const inPeriod = byBillMonth
    ? [
        // The first test keeps the date index in play; the second moves a bill paid in another month onto its own.
        sql`(${transactions.occurredOn} BETWEEN ${from} AND ${to} OR ${transactions.id} IN (SELECT transaction_id FROM bill_payments WHERE bill_month BETWEEN ${from.slice(0, 7)} AND ${to.slice(0, 7)}))`,
        sql`${attributedOn(startDay)} BETWEEN ${from} AND ${to}`,
      ]
    : [gte(transactions.occurredOn, from), lte(transactions.occurredOn, to)];
  return {
    where: and(
      eq(entries.workspaceId, ws.workspaceId),
      eq(transactions.status, 'posted'),
      eq(accounts.kind, kind),
      ...inPeriod,
      ...(opts.excludeEvents ? [isNull(transactions.eventId)] : []),
      // Narrowed to one book when the context names one; the whole workspace otherwise. Set categories are filed in
      // book_categories too (into their set's book), so this one path covers them.
      ...(ws.bookId ? [sql`${entries.accountId} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`] : []),
      // What was marked "not my spending" leaves the chart, the rings and the budgets. It is still on the card,
      // still in the balance, still earning points: only this reading of it changes.
      ...((await extrasTablesExist(database.db)) ? [notExcluded(ws)] : []),
      // …and so does one workspace's part of a purchase split across workspaces, marked so on its own (0090): the
      // other parts count, each in its own workspace.
      ...(await partCountedWhere(database.db, transactions.id, entries.accountId)),
      // What a shared event put in this phone's books is no workspace's spending (shared events §5.1), owner-wide too.
      ...((await eventOnlyExists(database.db)) ? [notEventOnly(transactions.id)] : []),
      ...(paid ? [sql`${transactions.id} IN (SELECT transaction_id FROM entries WHERE account_id = ${paid})`] : []),
      ...(kind === 'expense' && spread && spread.length > 0 ? [notInArray(transactions.id, [...spread])] : []),
    )!,
    // The day an amount is converted on is the day it is counted on. Under billMonths that is the out day of the
    // month whose bill it settles, not the day the payment was made — so August's internet paid on 3 September is
    // counted in August and converted at August's rate, which is the month the figure speaks for.
    onDate: byBillMonth ? sql<string>`${attributedOn(startDay)}` : sql<string>`${transactions.occurredOn}`,
    // The part of each transaction the account paid: its own entry over the payers' entries — money-side entries (not
    // a category) with the same sign as its own. A purchase split 80/20 between a card and a bank, or with a friend who
    // paid part, counts 80% on the card. A bill the card paid for friends too is not divided: their receivables are
    // where the card's money went, so the owner's own part was all paid by the card. Ratios are read from base
    // amounts, so a split across currencies is weighed in one unit.
    share: paid
      ? sql<number>`abs(${ownSum}) * 1.0 / NULLIF((SELECT sum(abs(side.amount_base_minor)) FROM entries side INNER JOIN accounts side_account ON side_account.id = side.account_id WHERE side.transaction_id = ${transactions.id} AND side_account.kind NOT IN ('expense', 'income') AND side.amount_base_minor * ${ownSum} > 0), 0)`
      : sql<number>`1`,
  };
}

/** The plans of the workspace and the purchases those counting each month spread, read once per reading. */
async function spreadPlans(database: Database, ws: WorkspaceContext, kind: 'expense' | 'income'): Promise<{ plans: PlanWithDay[]; ids: string[] }> {
  if (kind !== 'expense') return { plans: [], ids: [] };
  const plans = await plansWithStatementDays(database.db, ws);
  return { plans, ids: spreadPurchaseIds(plans) };
}

/**
 * The instalments of plans counting each month whose statement date falls in [from, to], in the purchase's categories,
 * as far as the reading's own filters let the purchase count: each purchase's category lines are read through the same
 * where clause as every other row (book, excluded, events held out, a part split off, Paid with), whatever its date, and
 * each instalment counts that share of itself. In the owner's currency.
 */
async function spreadIn(
  database: Database,
  ws: WorkspaceContext,
  kind: 'expense' | 'income',
  from: string,
  to: string,
  opts: CategoryTotalsOptions,
  spread: { plans: PlanWithDay[]; ids: string[] },
): Promise<SpreadLine[]> {
  if (kind !== 'expense' || !spread.plans.some(({ plan }) => plan.countMode === 'each_month')) return [];
  const parts = new Map<string, PartWeight[]>();
  if (spread.ids.length > 0) {
    const { where, share } = await categoryRows(database, ws, kind, '0000-01-01', '9999-12-31', opts, null);
    const rows = await database.db
      .select({ transactionId: transactions.id, accountId: entries.accountId, total: sql<number>`sum(${entries.amountBaseMinor} * ${share})` })
      .from(entries)
      .innerJoin(transactions, eq(entries.transactionId, transactions.id))
      .innerJoin(accounts, eq(entries.accountId, accounts.id))
      .where(and(where, inArray(transactions.id, spread.ids)))
      .groupBy(transactions.id, entries.accountId);
    for (const row of rows) {
      const weight = displayAmount(kind, Number(row.total));
      if (!(weight > 0)) continue;
      parts.set(row.transactionId, [...(parts.get(row.transactionId) ?? []), { key: row.accountId, weight }]);
    }
  }
  const wholes = await purchaseWholes(database.db, spread.ids);
  return spreadLinesIn(database.db, ws, spread.plans, from, to, parts, wholes, { paidAccountId: opts.paidAccountId });
}

/** An instalment of a plan counting At purchase: a repayment of the card, never spending (option C). */
export interface InstalmentRepayment {
  /** An investment's (TF 139): saving, never spending — a "Saving" row. Otherwise a repayment of the card. */
  investment: boolean;
  planId: string;
  cardAccountId: string;
  transactionId: string | null;
  description: string;
  number: number;
  of: number;
  statementOn: string;
  amountMinor: number;
}

/**
 * The instalments of the card plans in [from, to], as Cashflow lists them (option C): those of plans counting each month
 * are spending, in the categories and through the filters a category total reads them by, so the list adds up to the
 * rings (`lines`); those of plans counting at purchase are repayments of the card, listed with the transfers
 * (`repayments`). `spreadPurchaseIds` are the purchases that count nothing on their own day.
 */
export async function instalmentSpendingIn(
  database: Database,
  ws: WorkspaceContext,
  from: string,
  to: string,
  opts: CategoryTotalsOptions = {},
): Promise<{ lines: SpreadLine[]; repayments: InstalmentRepayment[]; spreadPurchaseIds: string[]; spreadMonths: Record<string, number> }> {
  const spread = await spreadPlans(database, ws, 'expense');
  const repayments: InstalmentRepayment[] = [];
  for (const { plan, statementDay, recordsFrom } of spread.plans) {
    if (plan.countMode === 'each_month') continue;
    // With no purchase, only what the card bills from its start in the app.
    for (const bill of instalmentsFrom(installmentSchedule(plan, statementDay), plan.transactionId ? null : (recordsFrom ?? null))) {
      if (bill.statementOn < from || bill.statementOn > to) continue;
      repayments.push({
        investment: isInvestmentPlan(plan),
        planId: plan.id,
        cardAccountId: plan.cardAccountId,
        transactionId: plan.transactionId,
        description: plan.description,
        number: bill.number,
        of: plan.months,
        statementOn: bill.statementOn,
        amountMinor: bill.amountMinor,
      });
    }
  }
  // How many months each spread purchase is spread over, by its id: a plan of this phone's or one the payer's phone sent.
  const spreadMonths: Record<string, number> = {};
  for (const { plan } of spread.plans) if (plan.countMode === 'each_month' && plan.transactionId) spreadMonths[plan.transactionId] = plan.months;
  return { lines: await spreadIn(database, ws, 'expense', from, to, opts, spread), repayments, spreadPurchaseIds: spread.ids, spreadMonths };
}

/**
 * Per-category totals in base currency for posted transactions in [from, to], sign-normalized so
 * spending and income are positive.
 *
 * `excludeEvents` leaves out anything tagged to an event. Only the monthly budget asks for that:
 * a wedding would otherwise read as every category blown at once, when the money was always meant to
 * go. Everywhere else the spending is real and is shown.
 *
 * `billMonths` counts a bill payment in the month whose bill it settled (see the recurring bills spec, decision A).
 */
export async function categoryTotalsBetween(
  database: Database,
  ws: WorkspaceContext,
  kind: 'expense' | 'income',
  from: string,
  to: string,
  opts: CategoryTotalsOptions = {},
): Promise<CategoryTotal[]> {
  const spread = await spreadPlans(database, ws, kind);
  const { where, share } = await categoryRows(database, ws, kind, from, to, opts, spread.ids);
  const rows = await database.db
    .select({
      accountId: entries.accountId,
      total: sql<number>`sum(${entries.amountBaseMinor} * ${share})`,
      // How many transactions made up the total, for a report that says "14 transactions", not just a sum.
      count: sql<number>`count(distinct ${transactions.id})`,
    })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(where)
    .groupBy(entries.accountId);
  const totals = new Map(rows.map((r) => [r.accountId, { amountBaseMinor: displayAmount(kind, Math.round(Number(r.total))), transactions: Number(r.count) }]));
  // Each instalment of a plan counting each month is spending in its purchase's category, one transaction of its own.
  for (const line of await spreadIn(database, ws, kind, from, to, opts, spread)) {
    const held = totals.get(line.categoryId) ?? { amountBaseMinor: 0, transactions: 0 };
    held.amountBaseMinor += line.amountBaseMinor;
    held.transactions += 1;
    totals.set(line.categoryId, held);
  }
  return [...totals]
    .map(([accountId, held]) => ({ accountId, ...held }))
    .filter((r) => r.amountBaseMinor !== 0);
}

/**
 * The same totals, read in the currency the open workspace keeps its books in.
 *
 * A workspace whose currency is the owner's takes the grouped-in-SQL path above, untouched. One that reads in
 * another currency cannot: a rate belongs to a day, so the conversion is per amount and the sum moves out of SQL.
 * What no rate reaches is left out rather than guessed at, and named in `missing` so the screen can say so.
 */
export async function categoryTotalsIn(
  database: Database,
  ws: WorkspaceContext,
  kind: 'expense' | 'income',
  from: string,
  to: string,
  opts: CategoryTotalsOptions = {},
): Promise<{ rows: CategoryTotal[]; currency: string; missing: Unconverted[] }> {
  const money = await bookMoneyFor(database, ws);
  if (!money.converts) return { rows: await categoryTotalsBetween(database, ws, kind, from, to, opts), currency: money.currency, missing: [] };

  const spread = await spreadPlans(database, ws, kind);
  const { where, onDate, share } = await categoryRows(database, ws, kind, from, to, opts, spread.ids);
  const rows = await database.db
    .select({
      accountId: entries.accountId,
      amountMinor: entries.amountMinor,
      currency: entries.currency,
      onDate,
      transactionId: transactions.id,
      share,
    })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(where);

  const totals = new Map<string, { amountBaseMinor: number; transactions: Set<string> }>();
  for (const row of rows) {
    const converted = money.convert(displayAmount(kind, Number(row.amountMinor)), row.currency, row.onDate);
    if (converted === null) continue; // left out, and named by money.missing()
    const held = totals.get(row.accountId) ?? { amountBaseMinor: 0, transactions: new Set<string>() };
    held.amountBaseMinor += converted * Number(row.share ?? 0);
    held.transactions.add(row.transactionId);
    totals.set(row.accountId, held);
  }
  // An instalment is kept in the owner's currency and read on its statement date.
  for (const line of await spreadIn(database, ws, kind, from, to, opts, spread)) {
    const converted = money.convert(line.amountBaseMinor, ws.baseCurrency, line.statementOn);
    if (converted === null) continue;
    const held = totals.get(line.categoryId) ?? { amountBaseMinor: 0, transactions: new Set<string>() };
    held.amountBaseMinor += converted;
    held.transactions.add(`${line.planId}#${line.number}`);
    totals.set(line.categoryId, held);
  }
  return {
    rows: [...totals]
      .map(([accountId, held]) => ({ accountId, amountBaseMinor: Math.round(held.amountBaseMinor), transactions: held.transactions.size }))
      .filter((row) => row.amountBaseMinor !== 0),
    currency: money.currency,
    missing: money.missing(),
  };
}

/**
 * The same money as `categoryTotalsIn`, added up by day instead of by category: the bars on the Cashflow card.
 *
 * It stands on the same rows, so the days of a month add up to what its donut says it came to. Under `billMonths` a
 * bill counts on the day it is attributed to, not the day it was paid.
 */
export async function dailyTotalsIn(
  database: Database,
  ws: WorkspaceContext,
  kind: 'expense' | 'income',
  from: string,
  to: string,
  opts: { excludeEvents?: boolean; billMonths?: boolean } = {},
): Promise<{ days: DayTotal[]; currency: string; missing: Unconverted[] }> {
  const money = await bookMoneyFor(database, ws);
  const spread = await spreadPlans(database, ws, kind);
  const { where, onDate } = await categoryRows(database, ws, kind, from, to, opts, spread.ids);

  const byDay = new Map<string, number>();
  if (!money.converts) {
    const rows = await database.db
      .select({ onDate, total: sql<number>`sum(${entries.amountBaseMinor})` })
      .from(entries)
      .innerJoin(transactions, eq(entries.transactionId, transactions.id))
      .innerJoin(accounts, eq(entries.accountId, accounts.id))
      .where(where)
      .groupBy(onDate);
    for (const row of rows) byDay.set(row.onDate, displayAmount(kind, Number(row.total)));
  } else {
    // A rate belongs to a day, so each amount is converted on its own before the day is added up.
    const rows = await database.db
      .select({ onDate, amountMinor: entries.amountMinor, currency: entries.currency })
      .from(entries)
      .innerJoin(transactions, eq(entries.transactionId, transactions.id))
      .innerJoin(accounts, eq(entries.accountId, accounts.id))
      .where(where);
    for (const row of rows) {
      const converted = money.convert(displayAmount(kind, Number(row.amountMinor)), row.currency, row.onDate);
      if (converted === null) continue; // left out, and named by money.missing()
      byDay.set(row.onDate, (byDay.get(row.onDate) ?? 0) + converted);
    }
  }
  // Each instalment of a plan counting each month falls on its statement date.
  for (const line of await spreadIn(database, ws, kind, from, to, opts, spread)) {
    const amountMinor = money.converts ? money.convert(line.amountBaseMinor, ws.baseCurrency, line.statementOn) : line.amountBaseMinor;
    if (amountMinor === null) continue;
    byDay.set(line.statementOn, (byDay.get(line.statementOn) ?? 0) + amountMinor);
  }
  return {
    days: [...byDay]
      .filter(([, amountMinor]) => amountMinor !== 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amountMinor]) => ({ date, amountMinor })),
    currency: money.currency,
    missing: money.converts ? money.missing() : [],
  };
}

/**
 * The first day money went out (or came in), read through the same rows as the totals above.
 *
 * The bars compare a period only with periods this side was being kept for. An opening balance from years before
 * the first purchase was recorded says nothing about when the spending started.
 */
export async function firstDayOf(
  database: Database,
  ws: WorkspaceContext,
  kind: 'expense' | 'income',
  opts: { excludeEvents?: boolean; billMonths?: boolean } = {},
): Promise<string | null> {
  const spread = await spreadPlans(database, ws, kind);
  const { where, onDate } = await categoryRows(database, ws, kind, '0000-01-01', '9999-12-31', opts, spread.ids);
  const [row] = await database.db
    .select({ first: sql<string | null>`min(${onDate})` })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(where);
  const firstSpread = (await spreadIn(database, ws, kind, '0000-01-01', '9999-12-31', opts, spread)).reduce<string | null>(
    (first, line) => (first === null || line.statementOn < first ? line.statementOn : first),
    null,
  );
  const first = row?.first ?? null;
  return first === null ? firstSpread : firstSpread !== null && firstSpread < first ? firstSpread : first;
}

/**
 * What the month's events cost in total, in the currency the open workspace reads in.
 *
 * The budget leaves this out of its caps, so it has to be shown and subtracted somewhere: money spent
 * on a wedding is money gone, however deliberately it went.
 *
 * Narrowed to one workspace when the context names one, exactly as the category totals are: a holiday whose
 * hotels were filed in Personal and whose dinners were filed in Business is two figures, not one shown twice.
 */
export async function eventSpendingBetween(
  database: Database,
  ws: WorkspaceContext,
  from: string,
  to: string,
): Promise<{ amountMinor: number; currency: string; missing: Unconverted[] }> {
  const money = await bookMoneyFor(database, ws);
  const where = and(
    eq(entries.workspaceId, ws.workspaceId),
    eq(transactions.status, 'posted'),
    eq(accounts.kind, 'expense'),
    gte(transactions.occurredOn, from),
    lte(transactions.occurredOn, to),
    isNotNull(transactions.eventId),
    ...(ws.bookId ? [sql`${entries.accountId} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`] : []),
    // Same clause as `categoryRows`: the event's Spent and the category report must drop the same rows.
    ...((await extrasTablesExist(database.db)) ? [notExcluded(ws)] : []),
    ...(await partCountedWhere(database.db, transactions.id, entries.accountId)),
    // A shared event's own share is counted on the event page, never on a workspace's event line (§5.1).
    ...((await eventOnlyExists(database.db)) ? [notEventOnly(transactions.id)] : []),
  );
  if (!money.converts) {
    const [row] = await database.db
      .select({ total: sql<number>`sum(${entries.amountBaseMinor})` })
      .from(entries)
      .innerJoin(transactions, eq(entries.transactionId, transactions.id))
      .innerJoin(accounts, eq(entries.accountId, accounts.id))
      .where(where);
    return { amountMinor: displayAmount('expense', Number(row?.total ?? 0)), currency: money.currency, missing: [] };
  }

  const rows = await database.db
    .select({ amountMinor: entries.amountMinor, currency: entries.currency, onDate: transactions.occurredOn })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(where);
  let amountMinor = 0;
  for (const row of rows) {
    const converted = money.convert(displayAmount('expense', Number(row.amountMinor)), row.currency, row.onDate);
    if (converted !== null) amountMinor += converted;
  }
  return { amountMinor, currency: money.currency, missing: money.missing() };
}
