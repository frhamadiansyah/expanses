import { displayAmount } from '@expanses/core';
import { and, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';

/**
 * Per-category totals in base currency for posted transactions in [from, to], sign-normalized so
 * spending and income are positive.
 *
 * `excludeEvents` leaves out anything tagged to an event. Only the monthly budget asks for that:
 * a wedding would otherwise read as every category blown at once, when the money was always meant to
 * go. Everywhere else the spending is real and is shown.
 */
export async function categoryTotalsBetween(
  database: Database,
  ws: WorkspaceContext,
  kind: 'expense' | 'income',
  from: string,
  to: string,
  opts: { excludeEvents?: boolean } = {},
): Promise<{ accountId: string; amountBaseMinor: number; transactions: number }[]> {
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
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        eq(accounts.kind, kind),
        gte(transactions.occurredOn, from),
        lte(transactions.occurredOn, to),
        ...(opts.excludeEvents ? [isNull(transactions.eventId)] : []),
        // Narrowed to one book when the context names one; the whole workspace otherwise. Set categories are filed in
        // book_categories too (into their set's book), so this one path covers them.
        ...(ws.bookId ? [sql`${entries.accountId} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`] : []),
      ),
    )
    .groupBy(entries.accountId);
  return rows
    .map((r) => ({ accountId: r.accountId, amountBaseMinor: displayAmount(kind, Number(r.total)), transactions: Number(r.count) }))
    .filter((r) => r.amountBaseMinor !== 0);
}

/**
 * What the month's events cost in total.
 *
 * The budget leaves this out of its caps, so it has to be shown and subtracted somewhere: money spent
 * on a wedding is money gone, however deliberately it went.
 */
export async function eventSpendingBetween(database: Database, ws: WorkspaceContext, from: string, to: string): Promise<number> {
  const [row] = await database.db
    .select({ total: sql<number>`sum(${entries.amountBaseMinor})` })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        eq(accounts.kind, 'expense'),
        gte(transactions.occurredOn, from),
        lte(transactions.occurredOn, to),
        isNotNull(transactions.eventId),
      ),
    );
  return displayAmount('expense', Number(row?.total ?? 0));
}
