import { displayAmount } from '@expanses/core';
import { and, eq, gte, isNotNull, isNull, lte, type SQL, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { attributedOn, billTablesExist } from './bill-months';
import { bookMoneyFor, type Unconverted } from './book-currency';

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
  opts: { excludeEvents?: boolean; billMonths?: boolean },
): Promise<{ where: SQL; onDate: SQL<string> }> {
  // The budget and Cashflow ask for bills in the month they came out; every other reader keeps the day paid.
  const byBillMonth = opts.billMonths === true && (await billTablesExist(database.db));
  const inPeriod = byBillMonth
    ? [
        // The first test keeps the date index in play; the second moves a bill paid in another month onto its own.
        sql`(${transactions.occurredOn} BETWEEN ${from} AND ${to} OR ${transactions.id} IN (SELECT transaction_id FROM bill_payments WHERE bill_month BETWEEN ${from.slice(0, 7)} AND ${to.slice(0, 7)}))`,
        sql`${attributedOn()} BETWEEN ${from} AND ${to}`,
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
    )!,
    // The day an amount is converted on is the day it is counted on. Under billMonths that is the out day of the
    // month whose bill it settles, not the day the payment was made — so August's internet paid on 3 September is
    // counted in August and converted at August's rate, which is the month the figure speaks for.
    onDate: byBillMonth ? sql<string>`${attributedOn()}` : sql<string>`${transactions.occurredOn}`,
  };
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
  opts: { excludeEvents?: boolean; billMonths?: boolean } = {},
): Promise<CategoryTotal[]> {
  const { where } = await categoryRows(database, ws, kind, from, to, opts);
  const rows = await database.db
    .select({
      accountId: entries.accountId,
      total: sql<number>`sum(${entries.amountBaseMinor})`,
      // How many transactions made up the total, for a report that says "14 transactions", not just a sum.
      count: sql<number>`count(distinct ${transactions.id})`,
    })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(where)
    .groupBy(entries.accountId);
  return rows
    .map((r) => ({ accountId: r.accountId, amountBaseMinor: displayAmount(kind, Number(r.total)), transactions: Number(r.count) }))
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
  opts: { excludeEvents?: boolean; billMonths?: boolean } = {},
): Promise<{ rows: CategoryTotal[]; currency: string; missing: Unconverted[] }> {
  const money = await bookMoneyFor(database, ws);
  if (!money.converts) return { rows: await categoryTotalsBetween(database, ws, kind, from, to, opts), currency: money.currency, missing: [] };

  const { where, onDate } = await categoryRows(database, ws, kind, from, to, opts);
  const rows = await database.db
    .select({
      accountId: entries.accountId,
      amountMinor: entries.amountMinor,
      currency: entries.currency,
      onDate,
      transactionId: transactions.id,
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
    held.amountBaseMinor += converted;
    held.transactions.add(row.transactionId);
    totals.set(row.accountId, held);
  }
  return {
    rows: [...totals]
      .map(([accountId, held]) => ({ accountId, amountBaseMinor: held.amountBaseMinor, transactions: held.transactions.size }))
      .filter((row) => row.amountBaseMinor !== 0),
    currency: money.currency,
    missing: money.missing(),
  };
}

/**
 * What the month's events cost in total, in the currency the open workspace reads in.
 *
 * The budget leaves this out of its caps, so it has to be shown and subtracted somewhere: money spent
 * on a wedding is money gone, however deliberately it went.
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
