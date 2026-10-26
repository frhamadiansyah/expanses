import { isoDate, presetFor, uuidv7 } from '@expanses/core';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { accounts, transactions } from '../schema';
import { assetAcquired, assetProfiles, assetSales, valuations } from '../schema-assets';
import { goals } from '../schema-goals';
import { SPENDABLE_SUBTYPES, systemAccountId, unarchiveAccountTx } from './accounts';
import { openingOfTx } from './asset-acquired';
import { AssetError } from './assets';
import { nativeBalancesTx, postTransactionTx, voidTransactionTx } from './ledger';
import { parkForGoalTx } from './set-aside-tx';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface AssetSaleRow {
  id: string;
  accountId: string;
  soldOn: string;
  soldForMinor: number;
  costsMinor: number;
  /** The original cost the sale is measured against, as the ledger held it on the day. */
  costMinor: number;
  cashAccountId: string;
  transactionId: string;
  goalId: string | null;
  /** What reached the account: what it sold for less the costs. */
  totalMinor: number;
  /** The total against the original cost, not against the last estimate. */
  gainMinor: number;
}

export interface SellAssetInput {
  accountId: string;
  soldOn: string;
  soldForMinor: number;
  /** Agent commission, notary and tax, taken off what is received. 0 for none. */
  costsMinor?: number;
  /** The money account the total is paid into, in the asset's own currency. */
  cashAccountId: string;
  goalId?: string | null;
  /** Units of base per major unit, when the asset's currency is not the base currency. */
  rateToBase?: number;
}

/** What a sale comes to and what it made: the one place the sum is done, for the sheet and the ledger alike. */
export function saleFigures(soldForMinor: number, costsMinor: number, costMinor: number): { totalMinor: number; gainMinor: number } {
  const totalMinor = soldForMinor - costsMinor;
  return { totalMinor, gainMinor: totalMinor - costMinor };
}

const toRow = (row: typeof assetSales.$inferSelect): AssetSaleRow => ({
  id: row.id,
  accountId: row.accountId,
  soldOn: row.soldOn,
  soldForMinor: row.soldForMinor,
  costsMinor: row.costsMinor,
  costMinor: row.costMinor,
  cashAccountId: row.cashAccountId,
  transactionId: row.transactionId,
  goalId: row.goalId,
  ...saleFigures(row.soldForMinor, row.costsMinor, row.costMinor),
});

/** The day the asset was acquired, as far as it is known: the typed day, else the opening entry, else 1 January of its year. */
export async function acquiredDayOfTx(tx: Tx, ws: WorkspaceContext, accountId: string): Promise<string | null> {
  if (await tableMissing(tx, 'asset_acquired')) return null;
  const [typed] = await tx.select({ on: assetAcquired.acquiredOn }).from(assetAcquired).where(eq(assetAcquired.accountId, accountId));
  if (typed) return typed.on;
  const opening = await openingOfTx(tx, ws, accountId);
  if (opening) return opening.occurredOn;
  const [profile] = await tx.select({ year: assetProfiles.acquiredYear }).from(assetProfiles).where(eq(assetProfiles.accountId, accountId));
  return profile?.year ? `${profile.year}-01-01` : null;
}

async function tableMissing(db: Db, name: string): Promise<boolean> {
  return (await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`)).length === 0;
}

/**
 * Sells an asset valued by an estimate (a car, a house, land) and records the money in.
 *
 * One ledger transaction on the sale day: the total (sold for less the costs) comes into the chosen money account, the
 * asset's own balance — its original cost — goes out, and the difference, the gain or the loss, is posted against
 * Opening Balances. No spending or income category is touched, so the sale is neither: net worth moves by the gain
 * alone, and the cash account by the total. From `soldOn` the asset is no longer valued (`assetValuesAt`), so net worth
 * and the tax report's year-end list stop counting it; before that day its history stands.
 *
 * Only in the asset's own currency: the money account must hold the asset's currency, so no rate between two accounts
 * is ever guessed. A foreign asset needs `rateToBase` for the day.
 */
export async function sellAsset(database: Database, ws: WorkspaceContext, input: SellAssetInput, today: string = isoDate()): Promise<AssetSaleRow> {
  const costsMinor = input.costsMinor ?? 0;
  if (!DAY.test(input.soldOn)) throw new AssetError('A date is YYYY-MM-DD');
  if (input.soldOn > today) throw new AssetError('It cannot be sold after today');
  if (!Number.isSafeInteger(input.soldForMinor) || input.soldForMinor <= 0) throw new AssetError('Enter what it sold for');
  if (!Number.isSafeInteger(costsMinor) || costsMinor < 0) throw new AssetError('Costs cannot be below zero');
  if (costsMinor >= input.soldForMinor) throw new AssetError('Costs must be less than what it sold for');
  return database.transaction(async (tx) => {
    const [asset] = await tx.select().from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!asset || asset.kind !== 'asset') throw new AssetError('Asset not found in this workspace');
    if (asset.archivedAt !== null) throw new AssetError(`${asset.name} is archived. Restore it before selling.`);
    const [profile] = await tx.select({ kind: assetProfiles.assetKind }).from(assetProfiles).where(eq(assetProfiles.accountId, asset.id));
    const mode = profile ? presetFor(profile.kind).valuationMode : asset.valuationMode;
    if (mode !== 'snapshot') throw new AssetError('Only an asset valued by an estimate is sold this way');
    const [already] = await tx.select({ id: assetSales.id }).from(assetSales).where(eq(assetSales.accountId, asset.id));
    if (already) throw new AssetError(`${asset.name} is already sold`);
    const currency = asset.currency ?? ws.baseCurrency;

    const acquired = await acquiredDayOfTx(tx, ws, asset.id);
    if (acquired && input.soldOn < acquired) throw new AssetError('It cannot be sold before it was acquired');

    const [cash] = await tx.select().from(accounts).where(and(eq(accounts.id, input.cashAccountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!cash || cash.kind !== 'asset' || !SPENDABLE_SUBTYPES.includes(cash.subtype) || cash.archivedAt !== null) throw new AssetError('Choose a money account to be paid into');
    const [pocket] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.parentId, cash.id), eq(accounts.workspaceId, ws.workspaceId))).limit(1);
    if (pocket) throw new AssetError(`${cash.name} holds no money of its own. Choose one of its pockets.`);
    if ((cash.currency ?? ws.baseCurrency) !== currency) throw new AssetError(`${cash.name} does not hold ${currency}. Choose an account in ${currency}.`);
    if (currency !== ws.baseCurrency && !(input.rateToBase && input.rateToBase > 0)) throw new AssetError(`A rate to ${ws.baseCurrency} is needed for a sale in ${currency}`);
    if (input.goalId) {
      const [goal] = await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.id, input.goalId), eq(goals.workspaceId, ws.workspaceId)));
      if (!goal) throw new AssetError('Goal not found in this workspace');
    }

    // The asset's balance in the ledger is its original cost: that is what goes out, so the asset's own balance ends at zero.
    const costMinor = Math.max(0, (await nativeBalancesTx(tx, ws, input.soldOn))[asset.id] ?? 0);
    const { totalMinor } = saleFigures(input.soldForMinor, costsMinor, costMinor);
    const equityId = await systemAccountId(tx, ws, 'opening_balance');
    const lines = [
      { accountId: cash.id, amountMinor: totalMinor, currency },
      ...(costMinor > 0 ? [{ accountId: asset.id, amountMinor: -costMinor, currency }] : []),
      // A gain is credited and a loss debited, to the equity that stands for what was owned before the app.
      ...(costMinor !== totalMinor ? [{ accountId: equityId, amountMinor: costMinor - totalMinor, currency }] : []),
    ];
    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: input.soldOn,
      description: `Sold ${asset.name}`,
      lines,
      ratesToBase: currency !== ws.baseCurrency ? { [currency]: input.rateToBase! } : {},
    });
    if (input.goalId) {
      await parkForGoalTx(tx, ws, transactionId, input.goalId, {
        occurredOn: input.soldOn,
        fromAccountId: asset.id,
        toAccountId: cash.id,
        amountMinor: totalMinor,
        landedMinor: totalMinor,
      });
    }
    const row = {
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      accountId: asset.id,
      soldOn: input.soldOn,
      soldForMinor: input.soldForMinor,
      costsMinor,
      costMinor,
      cashAccountId: cash.id,
      transactionId,
      goalId: input.goalId ?? null,
      createdAt: new Date().toISOString(),
    };
    await tx.insert(assetSales).values(row);
    return toRow(row);
  });
}

/**
 * Takes a sale back: the money in is voided (a goal's set-aside with it) and the sale is forgotten, so the asset is
 * valued again from the day it was sold and every balance reads as it did before the sale.
 */
export async function undoSale(database: Database, ws: WorkspaceContext, accountId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [sale] = await tx.select().from(assetSales).where(and(eq(assetSales.accountId, accountId), eq(assetSales.workspaceId, ws.workspaceId)));
    if (!sale) throw new AssetError('That asset is not sold');
    const [posting] = await tx.select({ status: transactions.status }).from(transactions).where(eq(transactions.id, sale.transactionId));
    if (posting?.status === 'posted') await voidTransactionTx(tx, ws, sale.transactionId, {}, undefined, { assetSale: true });
    await tx.delete(assetSales).where(eq(assetSales.id, sale.id));
  });
}

/** Every sale in the workspace, newest first. */
export async function listAssetSales(database: Database, ws: WorkspaceContext): Promise<AssetSaleRow[]> {
  if (await tableMissing(database.db, 'asset_sales')) return [];
  const rows = await database.db.select().from(assetSales).where(eq(assetSales.workspaceId, ws.workspaceId)).orderBy(desc(assetSales.soldOn), desc(assetSales.createdAt));
  return rows.map(toRow);
}

/** The day each sold asset left, by account: what the value reads, the net worth and the tax report all ask. */
export async function soldOnByAccount(db: Db, ws: WorkspaceContext): Promise<Map<string, string>> {
  if (await tableMissing(db, 'asset_sales')) return new Map();
  const rows = await db.select({ accountId: assetSales.accountId, soldOn: assetSales.soldOn }).from(assetSales).where(eq(assetSales.workspaceId, ws.workspaceId));
  return new Map(rows.map((row) => [row.accountId, row.soldOn]));
}

/** One asset's sale, or null when it is not sold. */
export async function assetSaleOf(database: Database, ws: WorkspaceContext, accountId: string): Promise<AssetSaleRow | null> {
  if (await tableMissing(database.db, 'asset_sales')) return null;
  const [row] = await database.db.select().from(assetSales).where(and(eq(assetSales.accountId, accountId), eq(assetSales.workspaceId, ws.workspaceId)));
  return row ? toRow(row) : null;
}

/** An asset that has left the list: sold, or archived. */
export interface GoneAsset {
  accountId: string;
  name: string;
  currency: string;
  subtype: string;
  coretaxCode: string | null;
  status: 'sold' | 'archived';
  /** What it sold for (sold), or its last known estimate (archived; null when it never had one). */
  figureMinor: number | null;
  soldOn: string | null;
}

/** The kinds of account that are things owned, which is what the Assets list's Sold and archived group holds. */
const OWNED_SUBTYPES = ['investment', 'property', 'vehicle'] as const;

/**
 * Sold and archived assets for the end of the Assets list. They count in nothing: not the list's totals, not net worth.
 * A sold asset's figure is its price; an archived one's is the last estimate typed for it.
 */
export async function goneAssets(database: Database, ws: WorkspaceContext): Promise<GoneAsset[]> {
  const sales = await listAssetSales(database, ws);
  const saleOf = new Map(sales.map((sale) => [sale.accountId, sale]));
  const rows = await database.db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency, subtype: accounts.subtype, archivedAt: accounts.archivedAt })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'asset'), inArray(accounts.subtype, [...OWNED_SUBTYPES])))
    .orderBy(asc(accounts.name));
  const archivedIds = rows.filter((row) => row.archivedAt !== null && !saleOf.has(row.id)).map((row) => row.id);
  const profiles = await database.db.select({ id: assetProfiles.accountId, code: assetProfiles.coretaxCode }).from(assetProfiles).where(eq(assetProfiles.workspaceId, ws.workspaceId));
  const codeOf = new Map(profiles.map((row) => [row.id, row.code]));
  const estimates = archivedIds.length
    ? await database.db
        .select({ accountId: valuations.accountId, valueMinor: valuations.valueMinor, basis: valuations.basis })
        .from(valuations)
        .where(and(eq(valuations.workspaceId, ws.workspaceId), inArray(valuations.accountId, archivedIds)))
        .orderBy(desc(valuations.asOf), desc(valuations.createdAt))
    : [];
  const lastEstimate = new Map<string, number>();
  // Newest first, so the first non-NJOP estimate seen for an account is its last: NJOP is the tax report's, never the value.
  for (const estimate of estimates) if (estimate.basis !== 'njop' && !lastEstimate.has(estimate.accountId)) lastEstimate.set(estimate.accountId, estimate.valueMinor);
  const out: GoneAsset[] = [];
  for (const row of rows) {
    const sale = saleOf.get(row.id);
    if (!sale && row.archivedAt === null) continue;
    out.push({
      accountId: row.id,
      name: row.name,
      currency: row.currency ?? ws.baseCurrency,
      subtype: row.subtype,
      coretaxCode: codeOf.get(row.id) ?? null,
      status: sale ? 'sold' : 'archived',
      figureMinor: sale ? sale.soldForMinor : (lastEstimate.get(row.id) ?? null),
      soldOn: sale?.soldOn ?? null,
    });
  }
  return out;
}

/** Puts an archived asset back on the list. A sold asset is brought back by Undo sale, not by this. */
export async function restoreAsset(database: Database, ws: WorkspaceContext, accountId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [account] = await tx
      .select({ kind: accounts.kind })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId), isNotNull(accounts.archivedAt)));
    if (!account || account.kind !== 'asset') throw new AssetError('That asset is not archived');
    await unarchiveAccountTx(tx, ws, accountId);
  });
}
