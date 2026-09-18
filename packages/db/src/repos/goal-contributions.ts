import { monthRange, uuidv7 } from '@expanses/core';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { investmentTrades } from '../schema-assets';
import { goalContributions } from '../schema-budget';

/** Where money that reaches a goal can sit without being fresh saving when it moves on. */
const PARKED = ['savings', 'investment', 'fund'];

/** Records a change to a set-aside. Nothing is written when the amount did not move. */
export async function recordContributionTx(
  tx: Db,
  ws: WorkspaceContext,
  goalId: string,
  accountId: string,
  deltaMinor: number,
): Promise<void> {
  if (deltaMinor === 0) return;
  const now = new Date();
  await tx.insert(goalContributions).values({
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    goalId,
    accountId,
    deltaMinor,
    occurredOn: now.toISOString().slice(0, 10),
    source: 'earmark',
    createdAt: now.toISOString(),
  });
}

/**
 * What actually reached each goal in a month, by goal id.
 *
 * Three things count, once each: a change to a set-aside, which only this table remembers; a tagged
 * transfer, which is a dated transaction carrying the goal; and a tagged buy paid from everyday
 * money. A buy paid from a savings pot or from broker cash is not counted, because parking the money
 * there was the saving — the same rule the put-away figure follows.
 */
export async function goalContributionsFor(database: Database, ws: WorkspaceContext, month: string): Promise<Record<string, number>> {
  const { from, to } = monthRange(month);
  const total: Record<string, number> = {};
  const add = (goalId: string, minor: number) => {
    total[goalId] = (total[goalId] ?? 0) + minor;
  };

  const contributions = await database.db
    .select({ goalId: goalContributions.goalId, total: sql<number>`sum(${goalContributions.deltaMinor})` })
    .from(goalContributions)
    .where(
      and(
        eq(goalContributions.workspaceId, ws.workspaceId),
        gte(goalContributions.occurredOn, from),
        lte(goalContributions.occurredOn, to),
      ),
    )
    .groupBy(goalContributions.goalId);
  for (const row of contributions) add(row.goalId, Number(row.total));

  // A tagged transfer is the only thing that writes a goal onto a transaction.
  const transfers = await database.db
    .select({ goalId: transactions.goalId, total: sql<number>`sum(${entries.amountBaseMinor})` })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        gte(transactions.occurredOn, from),
        lte(transactions.occurredOn, to),
        sql`${transactions.goalId} is not null`,
        sql`${entries.amountBaseMinor} > 0`,
      ),
    )
    .groupBy(transactions.goalId);
  for (const row of transfers) if (row.goalId) add(row.goalId, Number(row.total));

  const parked = new Set(
    (
      await database.db
        .select({ id: accounts.id, subtype: accounts.subtype })
        .from(accounts)
        .where(eq(accounts.workspaceId, ws.workspaceId))
    )
      .filter((account) => PARKED.includes(account.subtype))
      .map((account) => account.id),
  );

  const buys = await database.db
    .select({
      goalId: investmentTrades.goalId,
      cashAccountId: investmentTrades.cashAccountId,
      grossMinor: investmentTrades.grossMinor,
      feeMinor: investmentTrades.feeMinor,
      taxMinor: investmentTrades.taxMinor,
    })
    .from(investmentTrades)
    .where(
      and(
        eq(investmentTrades.workspaceId, ws.workspaceId),
        eq(investmentTrades.kind, 'buy'),
        eq(investmentTrades.status, 'active'),
        gte(investmentTrades.occurredOn, from),
        lte(investmentTrades.occurredOn, to),
        sql`${investmentTrades.goalId} is not null`,
      ),
    );
  for (const buy of buys) {
    if (!buy.goalId || buy.cashAccountId === null || parked.has(buy.cashAccountId)) continue;
    add(buy.goalId, buy.grossMinor + buy.feeMinor + buy.taxMinor);
  }

  return total;
}
