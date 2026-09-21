import { monthRange, uuidv7 } from '@expanses/core';
import { and, eq, gte, lte, type SQL, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { investmentTrades } from '../schema-assets';
import { goalContributions } from '../schema-budget';

/* Where money that reaches a goal can sit without being fresh saving when it moves on. Narrower than the
   ledger's spendable list on purpose: a buy paid from a broker's cash was already counted when the money
   was parked there, while a buy paid from a wallet or a current account is fresh money. */
const PARKED = ['savings', 'investment', 'fund'];

/** Records a change to a set-aside, dated today unless told otherwise. Nothing is written when the amount did not move. */
export async function recordContributionTx(
  tx: Db,
  ws: WorkspaceContext,
  goalId: string,
  accountId: string,
  deltaMinor: number,
  occurredOn?: string,
): Promise<void> {
  if (deltaMinor === 0) return;
  const now = new Date();
  await tx.insert(goalContributions).values({
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    goalId,
    accountId,
    deltaMinor,
    occurredOn: occurredOn ?? now.toISOString().slice(0, 10),
    source: 'earmark',
    createdAt: now.toISOString(),
  });
}

export interface ContributionEvent {
  goalId: string;
  kind: 'earmark' | 'transfer' | 'buy';
  occurredOn: string;
  /** Exactly the figure the monthly total adds for this event. */
  amountMinor: number;
  accountId: string | null;
}

/** Every dated event that reached a goal: a set-aside change, a tagged transfer's arrival, a tagged buy from everyday money. */
export async function goalContributionEvents(database: Database, ws: WorkspaceContext, range: { from?: string; to?: string } = {}): Promise<ContributionEvent[]> {
  const within = (column: typeof goalContributions.occurredOn | typeof transactions.occurredOn | typeof investmentTrades.occurredOn): SQL[] => [
    ...(range.from ? [gte(column, range.from)] : []),
    ...(range.to ? [lte(column, range.to)] : []),
  ];
  const events: ContributionEvent[] = [];

  const changes = await database.db
    .select({ goalId: goalContributions.goalId, accountId: goalContributions.accountId, deltaMinor: goalContributions.deltaMinor, occurredOn: goalContributions.occurredOn })
    .from(goalContributions)
    .where(and(eq(goalContributions.workspaceId, ws.workspaceId), ...within(goalContributions.occurredOn)));
  for (const row of changes) events.push({ goalId: row.goalId, kind: 'earmark', occurredOn: row.occurredOn, amountMinor: row.deltaMinor, accountId: row.accountId });

  // A tagged transfer is the only thing that writes a goal onto a transaction.
  const arrivals = await database.db
    .select({ goalId: transactions.goalId, accountId: entries.accountId, occurredOn: transactions.occurredOn, amountBaseMinor: entries.amountBaseMinor })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(and(eq(entries.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), ...within(transactions.occurredOn), sql`${transactions.goalId} is not null`, sql`${entries.amountBaseMinor} > 0`));
  for (const row of arrivals) if (row.goalId) events.push({ goalId: row.goalId, kind: 'transfer', occurredOn: row.occurredOn, amountMinor: row.amountBaseMinor, accountId: row.accountId });

  const parked = new Set(
    (await database.db.select({ id: accounts.id, subtype: accounts.subtype }).from(accounts).where(eq(accounts.workspaceId, ws.workspaceId)))
      .filter((account) => PARKED.includes(account.subtype))
      .map((account) => account.id),
  );
  const buys = await database.db
    .select({ goalId: investmentTrades.goalId, cashAccountId: investmentTrades.cashAccountId, occurredOn: investmentTrades.occurredOn, grossMinor: investmentTrades.grossMinor, feeMinor: investmentTrades.feeMinor, taxMinor: investmentTrades.taxMinor })
    .from(investmentTrades)
    .where(and(eq(investmentTrades.workspaceId, ws.workspaceId), eq(investmentTrades.kind, 'buy'), eq(investmentTrades.status, 'active'), ...within(investmentTrades.occurredOn), sql`${investmentTrades.goalId} is not null`));
  for (const buy of buys) {
    if (!buy.goalId || buy.cashAccountId === null || parked.has(buy.cashAccountId)) continue;
    events.push({ goalId: buy.goalId, kind: 'buy', occurredOn: buy.occurredOn, amountMinor: buy.grossMinor + buy.feeMinor + buy.taxMinor, accountId: buy.cashAccountId });
  }
  return events;
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
  for (const event of await goalContributionEvents(database, ws, { from, to })) total[event.goalId] = (total[event.goalId] ?? 0) + event.amountMinor;
  return total;
}
