import { type Position, positionAfter, positionInBase } from '@expanses/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries } from '../schema';
import { listTrades, type TradeRow } from './trades';

export interface BaseCosts {
  /** Per holding, cost in the base currency: each buy at its own day's rate (spec §4.2). */
  positions: Record<string, Position>;
  /** Per buy, what the ledger pinned on the holding's line, in base. */
  buyBaseMinor: Record<string, number>;
}

/**
 * Cost in the base currency, read from the ledger: each buy of a foreign holding is what its holding line pinned in
 * base on the day it posted, re-walked by `positionInBase`. A base-currency holding is its own cost. Reads only.
 */
export async function baseCosts(database: Database, ws: WorkspaceContext, upTo?: string): Promise<BaseCosts> {
  const trades = await listTrades(database, ws);
  const rows = await database.db.select({ id: accounts.id, currency: accounts.currency }).from(accounts).where(eq(accounts.workspaceId, ws.workspaceId));
  const currencyOf = new Map(rows.map((row) => [row.id, row.currency ?? ws.baseCurrency]));
  const foreign = (trade: TradeRow) => currencyOf.get(trade.accountId) !== ws.baseCurrency;

  const buyBaseMinor: Record<string, number> = {};
  const foreignBuys = trades.filter((trade) => trade.kind === 'buy' && foreign(trade));
  const posted = foreignBuys.filter((trade) => trade.transactionId);
  if (posted.length > 0) {
    // Keyed by the few foreign holdings, not by every buy's transaction: one bound parameter per holding.
    const holdingIds = [...new Set(posted.map((trade) => trade.accountId))];
    const lines = await database.db
      .select({ transactionId: entries.transactionId, accountId: entries.accountId, amountBaseMinor: entries.amountBaseMinor })
      .from(entries)
      .where(and(eq(entries.workspaceId, ws.workspaceId), inArray(entries.accountId, holdingIds)));
    // Signed lines summed as they are: the holding's line of a buy is one debit, never an absolute value.
    const onHolding = new Map<string, number>();
    for (const line of lines) {
      const key = `${line.transactionId}\u0000${line.accountId}`;
      onHolding.set(key, (onHolding.get(key) ?? 0) + line.amountBaseMinor);
    }
    for (const trade of posted) buyBaseMinor[trade.id] = onHolding.get(`${trade.transactionId}\u0000${trade.accountId}`) ?? 0;
  }
  // A buy that posted nothing (no money moved) cost nothing in any currency.
  for (const trade of foreignBuys) if (!trade.transactionId) buyBaseMinor[trade.id] = 0;
  for (const trade of trades) if (trade.kind === 'buy' && !foreign(trade)) buyBaseMinor[trade.id] = trade.grossMinor + trade.feeMinor + trade.taxMinor;

  const byAccount = new Map<string, TradeRow[]>();
  for (const trade of trades) byAccount.set(trade.accountId, [...(byAccount.get(trade.accountId) ?? []), trade]);
  const positions: Record<string, Position> = {};
  for (const [accountId, list] of byAccount) {
    positions[accountId] = currencyOf.get(accountId) === ws.baseCurrency ? positionAfter(list, upTo) : positionInBase(list, buyBaseMinor, upTo);
  }
  return { positions, buyBaseMinor };
}
