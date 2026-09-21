import { type Position, positionAfter, positionInBase } from '@expanses/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries } from '../schema';
import { listTrades, type TradeRow } from './trades';

export interface BaseCosts {
  /** Per holding, cost in the base currency: each buy at its own day's rate (spec §4.2). */
  positions: Record<string, Position>;
  /** Per *foreign* buy, what the ledger pinned on the holding's line, in base — `positionInBase`'s own input.
   * A base-currency buy needs no entry: `positions` walks it with `positionAfter`, which reads its own currency. */
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
    //
    // Mutation note (T7a6/T7a7): dropping the workspace filter here or on `accounts` above still passes the
    // full suite, and is equivalent rather than a gap — every id (`accounts.id`, `entries.transactionId`) is a
    // uuidv7, globally unique, and `holdingIds` is drawn from `trades`, which `listTrades` already scoped to
    // this workspace. A row from another workspace could only be read if it happened to share one of those ids.
    const holdingIds = [...new Set(posted.map((trade) => trade.accountId))];
    const lines = await database.db
      .select({ transactionId: entries.transactionId, accountId: entries.accountId, amountBaseMinor: entries.amountBaseMinor })
      .from(entries)
      .where(and(eq(entries.workspaceId, ws.workspaceId), inArray(entries.accountId, holdingIds)));
    // Signed lines summed as they are: the holding's line of a buy is one debit, never an absolute value.
    //
    // Mutation note (T7a8): summing with `Math.abs` instead is equivalent here too — a buy posts exactly one
    // holding line (`tradePostings`), so the sum of one signed amount and its absolute value agree. Summed
    // unsigned all the same, because a sell's basis line (never read through this map) is a credit, and an
    // `Math.abs` written here would be one accident away from being read as if it walked every kind.
    const onHolding = new Map<string, number>();
    for (const line of lines) {
      const key = `${line.transactionId}\u0000${line.accountId}`;
      onHolding.set(key, (onHolding.get(key) ?? 0) + line.amountBaseMinor);
    }
    for (const trade of posted) buyBaseMinor[trade.id] = onHolding.get(`${trade.transactionId}\u0000${trade.accountId}`) ?? 0;
  }
  // A buy that posted nothing (no money moved) cost nothing in any currency.
  for (const trade of foreignBuys) if (!trade.transactionId) buyBaseMinor[trade.id] = 0;
  // Base-currency buys are never keyed here (m8): `positions` below reads them with `positionAfter`, in their own
  // currency, and `positionInBase` — the only reader of this map — is never called for a base-currency holding.
  // A base-currency entry was written and never read; it is dropped rather than kept as an unread API.

  const byAccount = new Map<string, TradeRow[]>();
  for (const trade of trades) byAccount.set(trade.accountId, [...(byAccount.get(trade.accountId) ?? []), trade]);
  const positions: Record<string, Position> = {};
  for (const [accountId, list] of byAccount) {
    positions[accountId] = currencyOf.get(accountId) === ws.baseCurrency ? positionAfter(list, upTo) : positionInBase(list, buyBaseMinor, upTo);
  }
  return { positions, buyBaseMinor };
}
