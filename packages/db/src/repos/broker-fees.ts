import { type BrokerFees, brokerFeeDefaults } from '@expanses/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { brokerFees, investmentTrades } from '../schema-assets';
import { AssetError } from './assets';

/** A broker's fees as saved, or its defaults by its cash account's name; `saved` says which. */
export async function brokerFeesOf(database: Database, ws: WorkspaceContext, accountId: string): Promise<BrokerFees & { saved: boolean }> {
  const [row] = await database.db
    .select({ buyPpm: brokerFees.buyPpm, sellPpm: brokerFees.sellPpm, minDailyMinor: brokerFees.minDailyMinor })
    .from(brokerFees)
    .where(and(eq(brokerFees.accountId, accountId), eq(brokerFees.workspaceId, ws.workspaceId)));
  if (row) return { ...row, saved: true };
  const [account] = await database.db.select({ name: accounts.name }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  return { ...brokerFeeDefaults(account?.name ?? ''), saved: false };
}

/** Saves what a broker charges, on its cash account. */
export async function saveBrokerFees(database: Database, ws: WorkspaceContext, accountId: string, fees: BrokerFees): Promise<void> {
  const whole = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (!whole(fees.buyPpm) || !whole(fees.sellPpm) || fees.buyPpm > 100_000 || fees.sellPpm > 100_000) throw new AssetError('A fee is a percentage under 10%');
  if (fees.minDailyMinor !== null && !whole(fees.minDailyMinor)) throw new AssetError('A minimum fee cannot be negative');
  await database.transaction(async (tx) => {
    const [account] = await tx.select({ subtype: accounts.subtype }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!account) throw new AssetError('Account not found in this workspace');
    if (account.subtype !== 'fund') throw new AssetError('Fees are set on a broker’s cash account');
    const row = { accountId, workspaceId: ws.workspaceId, ...fees, updatedAt: new Date().toISOString() };
    await tx.insert(brokerFees).values(row).onConflictDoUpdate({ target: brokerFees.accountId, set: row });
  });
}

/**
 * What a broker has already charged on a day — the fee and the tax of every buy and sell recorded through its cash
 * account then — for the daily minimum. Recorded trades only; nothing is guessed.
 */
export async function chargedAtBrokerOn(database: Database, ws: WorkspaceContext, brokerAccountId: string, onDate: string): Promise<number> {
  const [row] = await database.db
    .select({ total: sql<number>`coalesce(sum(${investmentTrades.feeMinor} + ${investmentTrades.taxMinor}), 0)` })
    .from(investmentTrades)
    .where(
      and(
        eq(investmentTrades.workspaceId, ws.workspaceId),
        eq(investmentTrades.cashAccountId, brokerAccountId),
        eq(investmentTrades.occurredOn, onDate),
        eq(investmentTrades.status, 'active'),
        inArray(investmentTrades.kind, ['buy', 'sell']),
      ),
    );
  return Number(row?.total ?? 0);
}
