import { inArray, sql } from 'drizzle-orm';
import type { Database } from '../database';
import { accounts, transactions } from '../schema';

/**
 * How much is on this device, across every workspace: real accounts (assets and debts — categories are accounts too,
 * and a fresh install already has those) and transactions. The iCloud backup asks it to tell a fresh install from
 * one holding someone's money, and the first-open screen shows it for the copy it offers.
 */
export async function dataCounts(database: Database): Promise<{ accounts: number; transactions: number }> {
  const [held] = await database.db
    .select({ n: sql<number>`count(*)` })
    .from(accounts)
    .where(inArray(accounts.kind, ['asset', 'liability']));
  const [moved] = await database.db.select({ n: sql<number>`count(*)` }).from(transactions);
  return { accounts: Number(held?.n ?? 0), transactions: Number(moved?.n ?? 0) };
}
