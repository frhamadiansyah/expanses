import type { ValuationBasis } from '@expanses/core';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { type CreateAccountInput, createAccountTx } from './accounts';
import { type AcquiredDate, saveAcquiredTx } from './asset-acquired';
import { type SaveAssetProfileInput, saveAssetProfileTx } from './assets';
import { recordValuationTx } from './prices';
import { linkHoldingTx } from './securities';
import { type RecordTradeInput, type TradeResult, writeTradeTx } from './trades';

export interface OpenAssetInput {
  account: CreateAccountInput;
  profile: Omit<SaveAssetProfileInput, 'accountId'>;
  /** How precisely the day it was acquired was typed, when it was. */
  acquired?: AcquiredDate | null;
  /**
   * Its buys, oldest first: past purchases against Opening Balances (`cashAccountId: null`), or the one purchase made
   * now, paid from an account or charged to a card — each written by `writeTradeTx`, exactly as `recordTrade` writes it.
   */
  trades: readonly Omit<RecordTradeInput, 'accountId'>[];
  /** A first estimate of what it is worth now. */
  valuation?: { asOf: string; valueMinor: number; basis: ValuationBasis } | null;
  /** A fund's or bond's Institution picked as a broker's cash account (owner, 25 Nov 2026): linked as it is opened. */
  heldAtAccountId?: string | null;
}

/**
 * Add asset's save: the account, its profile, how its acquired day was typed, its buys and a first estimate — all or
 * nothing, so a buy that cannot be recorded never leaves a half-made holding behind. The result is the same as opening
 * the holding empty and recording each buy with `recordTrade`.
 */
export function openAsset(database: Database, ws: WorkspaceContext, input: OpenAssetInput): Promise<{ accountId: string; trades: TradeResult[] }> {
  return database.transaction(async (tx) => {
    const account = await createAccountTx(tx, ws, input.account);
    await saveAssetProfileTx(tx, ws, { ...input.profile, accountId: account.id });
    if (input.acquired) await saveAcquiredTx(tx, ws, account.id, input.acquired);
    if (input.heldAtAccountId) await linkHoldingTx(tx, ws, { accountId: account.id, brokerAccountId: input.heldAtAccountId });
    const trades: TradeResult[] = [];
    for (const trade of input.trades) trades.push(await writeTradeTx(tx, ws, { ...trade, accountId: account.id }, null));
    if (input.valuation) await recordValuationTx(tx, ws, { accountId: account.id, ...input.valuation });
    return { accountId: account.id, trades };
  });
}
