import { type IncomeHolding, type IncomeRow, investmentIncomeFor } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { investmentTrades } from '../schema-assets';
import { listAccounts } from './accounts';
import { AssetError, assertAccountInWorkspace } from './assets';
import { listAssetProfiles } from './assets';
import { depositIncomePayments } from './deposit-automation';
import { listTrades } from './trades';

/**
 * What each holding paid in a year, and what was withheld.
 *
 * Trades come back active only, so a payment that was edited is counted once — as the figure it was
 * corrected to, not the one it replaced. An asset kept off the harta list still appears here: whether
 * it is reported as property and whether it paid income are different questions.
 */
export async function incomeInputsFor(database: Database, ws: WorkspaceContext, year: number): Promise<IncomeRow[]> {
  const [trades, profiles, accounts, deposits] = await Promise.all([
    listTrades(database, ws),
    listAssetProfiles(database, ws),
    listAccounts(database, ws, { includeArchived: true }),
    // A deposit's confirmed or hand-recorded events, shaped as the payments this reader already reads.
    depositIncomePayments(database, ws),
  ]);

  const nameOf = new Map(accounts.map((account) => [account.id, account]));
  const holdings: IncomeHolding[] = profiles.map((profile) => {
    const account = nameOf.get(profile.accountId);
    return {
      accountId: profile.accountId,
      name: account?.name ?? profile.accountId,
      assetKind: profile.assetKind,
      currency: account?.currency ?? ws.baseCurrency,
      // Null until the owner says how this holding's income is taxed; the report never guesses.
      treatment: profile.taxTreatment,
    };
  });

  return investmentIncomeFor({ trades: [...trades, ...deposits], holdings, year, baseCurrency: ws.baseCurrency });
}

export interface DeclareReinvestmentInput {
  /** How much of the payment was put back in. Zero clears the declaration. */
  amountMinor: number;
  /** The holding it went into, which must be one of your own. Null when you would rather not say. */
  intoAccountId: string | null;
}

/**
 * Declares that part of a dividend was reinvested, which is what puts it outside the objects of tax.
 *
 * This is a declaration, not a trail. The payment lands in a broker account and mixes with everything
 * else there, so no rule can say which rupiah bought the instrument — and the Laporan Realisasi
 * Investasi does not ask. It asks how much went where, which is what this records.
 */
export async function declareReinvestment(
  database: Database,
  ws: WorkspaceContext,
  tradeId: string,
  input: DeclareReinvestmentInput,
): Promise<void> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) throw new AssetError('A reinvested amount cannot be below nothing');

  await database.transaction(async (tx) => {
    const [trade] = await tx
      .select({ kind: investmentTrades.kind, grossMinor: investmentTrades.grossMinor })
      .from(investmentTrades)
      .where(and(eq(investmentTrades.id, tradeId), eq(investmentTrades.workspaceId, ws.workspaceId)));
    if (!trade) throw new AssetError('Payment not found in this workspace');
    if (trade.kind !== 'income') throw new AssetError('Only a payment can be reinvested; proceeds from a sale are not a dividend');
    if (input.amountMinor > trade.grossMinor) throw new AssetError('More was reinvested than the payment was worth');
    if (input.intoAccountId) await assertAccountInWorkspace(tx, ws, input.intoAccountId, 'Holding');

    await tx
      .update(investmentTrades)
      .set({
        reinvestedMinor: input.amountMinor === 0 ? null : input.amountMinor,
        reinvestedIntoAccountId: input.amountMinor === 0 ? null : input.intoAccountId,
      })
      .where(eq(investmentTrades.id, tradeId));
  });
}
