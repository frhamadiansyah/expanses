import { presetFor, type PriceRow, type ValuationRow } from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { assetProfiles, prices, valuations } from '../schema-assets';
import { holdingLinks, securityPrices } from '../schema-securities';

/**
 * A holding tracked by money (a mutual fund, spec 2026-10-19-fund-by-amount): read here, inside a transaction, so a
 * trade being saved can value its holding the way `assetValuesAt` does without importing it.
 */

/** Whether the holding is tracked by money: its kind's preset says so. */
export async function isByMoneyTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<boolean> {
  const [profile] = await tx
    .select({ assetKind: assetProfiles.assetKind })
    .from(assetProfiles)
    .where(and(eq(assetProfiles.accountId, accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
  return profile ? presetFor(profile.assetKind).valuationMode === 'amount' : false;
}

/** The holding's NAVs (its security's when linked) and its typed values, oldest saved first. */
export async function byMoneyHistoryTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<{ prices: PriceRow[]; valuations: ValuationRow[] }> {
  const [link] = await tx.select({ securityId: holdingLinks.securityId }).from(holdingLinks).where(eq(holdingLinks.accountId, accountId));
  const priceRows = link?.securityId
    ? await tx.select({ onDate: securityPrices.onDate, priceMicro: securityPrices.priceMicro }).from(securityPrices).where(eq(securityPrices.securityId, link.securityId))
    : await tx.select({ onDate: prices.onDate, priceMicro: prices.priceMicro }).from(prices).where(and(eq(prices.accountId, accountId), eq(prices.workspaceId, ws.workspaceId)));
  const valuationRows = await tx
    .select({ asOf: valuations.asOf, valueMinor: valuations.valueMinor, basis: valuations.basis, createdAt: valuations.createdAt })
    .from(valuations)
    .where(and(eq(valuations.accountId, accountId), eq(valuations.workspaceId, ws.workspaceId)))
    .orderBy(sql`rowid`);
  return {
    prices: priceRows,
    valuations: valuationRows.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

/*
 * `investment_trades.basis_minor` (0075): the money a sell tracked by money took out, fixed when it was saved. Not
 * declared on the drizzle table, as `exact_hundredths` is not (see exact-column.ts): a database stopped before 0075
 * could otherwise no longer list a trade at all. Read and written by name, only where it is.
 */
const seen = new WeakSet<object>();

async function basisColumnExists(db: Db): Promise<boolean> {
  if (seen.has(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM pragma_table_info('investment_trades') WHERE name = 'basis_minor'`);
  if (rows.length === 0) return false;
  seen.add(db);
  return true;
}

/** Every sell's saved cost in the workspace, by trade id. Empty on a database stopped before 0075. */
export async function tradeBasesTx(db: Db, ws: WorkspaceContext): Promise<Map<string, number>> {
  if (!(await basisColumnExists(db))) return new Map();
  const rows = await db.values<[string, number]>(
    sql`SELECT id, basis_minor FROM investment_trades WHERE workspace_id = ${ws.workspaceId} AND basis_minor IS NOT NULL`,
  );
  return new Map(rows.map(([id, basis]) => [id, Number(basis)]));
}

/** Keeps a sell's cost with it. A database stopped before 0075 has nowhere to keep it, and the sell posts all the same. */
export async function setTradeBasisTx(db: Db, tradeId: string, basisMinor: number): Promise<void> {
  if (!(await basisColumnExists(db))) return;
  await db.run(sql`UPDATE investment_trades SET basis_minor = ${basisMinor} WHERE id = ${tradeId}`);
}
