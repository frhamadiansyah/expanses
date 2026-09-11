import { displayAmount } from '@expanses/core';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';

/** Per-category totals in base currency for posted transactions in [from, to], sign-normalized so spending and income are positive. */
export async function categoryTotalsBetween(
  database: Database,
  ws: WorkspaceContext,
  kind: 'expense' | 'income',
  from: string,
  to: string,
): Promise<{ accountId: string; amountBaseMinor: number }[]> {
  const rows = await database.db
    .select({ accountId: entries.accountId, total: sql<number>`sum(${entries.amountBaseMinor})` })
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
      ),
    )
    .groupBy(entries.accountId);
  return rows
    .map((r) => ({ accountId: r.accountId, amountBaseMinor: displayAmount(kind, Number(r.total)) }))
    .filter((r) => r.amountBaseMinor !== 0);
}
