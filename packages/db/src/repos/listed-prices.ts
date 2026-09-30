import type { ListedPriceChoice } from '@expanses/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { prices } from '../schema-assets';
import { holdingLinks, securityPriceChoices, securityPrices } from '../schema-securities';
import { markAccountDirtyTx } from '../sync/capture';
import { AssetError } from './assets';
import type { SourcedPrice } from './prices';
import { securityByIdTx, securityTablesExist } from './securities';

/*
 * A listed share's price from outside the app: Yahoo Finance's daily close, fetched, or IDX's daily file, imported
 * (0062). Both land where a typed price does, marked with where they came from. A price the owner typed for a day is
 * that day's price, and neither ever replaces it; a later fetch or import replaces an earlier one for the same day.
 */

/** Every holding of a security is worth something else when its price moves (joint net worth §9). */
async function markHoldersDirtyTx(tx: Db, ws: WorkspaceContext, securityId: string): Promise<void> {
  const held = await tx.select({ accountId: holdingLinks.accountId }).from(holdingLinks).where(and(eq(holdingLinks.securityId, securityId), eq(holdingLinks.workspaceId, ws.workspaceId)));
  for (const { accountId } of held) markAccountDirtyTx(tx, accountId);
}

export type OutsideSource = 'yahoo' | 'idx';

/** Stores one outside close in an open transaction: 'kept' when a typed price for that day stands in its way. */
async function recordCloseTx(tx: Db, ws: WorkspaceContext, input: { securityId: string; onDate: string; priceMicro: number; source: OutsideSource }): Promise<'saved' | 'kept'> {
  if (!Number.isSafeInteger(input.priceMicro) || input.priceMicro <= 0) throw new AssetError('A closing price is above zero');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.onDate)) throw new AssetError('Choose a date');
  await securityByIdTx(tx, ws, input.securityId);
  const [present] = await tx
    .select({ source: securityPrices.source })
    .from(securityPrices)
    .where(and(eq(securityPrices.securityId, input.securityId), eq(securityPrices.onDate, input.onDate), eq(securityPrices.workspaceId, ws.workspaceId)));
  if (present?.source === 'manual') return 'kept';
  const row = { securityId: input.securityId, workspaceId: ws.workspaceId, onDate: input.onDate, priceMicro: input.priceMicro, source: input.source, createdAt: new Date().toISOString() };
  await tx.insert(securityPrices).values(row).onConflictDoUpdate({ target: [securityPrices.securityId, securityPrices.onDate], set: row });
  await markHoldersDirtyTx(tx, ws, input.securityId);
  return 'saved';
}

/** One outside close for a security. A typed price for that day stays, and the answer says so. */
export function recordListedClose(
  database: Database,
  ws: WorkspaceContext,
  input: { securityId: string; onDate: string; priceMicro: number; source: OutsideSource },
): Promise<'saved' | 'kept'> {
  return database.transaction((tx) => recordCloseTx(tx, ws, input));
}

/** Many closes from one source for one day, all or nothing — an IDX file's. The securities kept are named. */
export function recordListedCloses(
  database: Database,
  ws: WorkspaceContext,
  input: { onDate: string; source: OutsideSource; closes: { securityId: string; priceMicro: number }[] },
): Promise<{ saved: string[]; kept: string[] }> {
  return database.transaction(async (tx) => {
    const saved: string[] = [];
    const kept: string[] = [];
    for (const close of input.closes) {
      const result = await recordCloseTx(tx, ws, { ...close, onDate: input.onDate, source: input.source });
      (result === 'saved' ? saved : kept).push(close.securityId);
    }
    return { saved, kept };
  });
}

/** The choices saved, by security. A security with none follows the default `listedPriceChoice` works out. */
export async function listSecurityPriceChoices(database: Database, ws: WorkspaceContext): Promise<Record<string, ListedPriceChoice>> {
  if (!(await securityTablesExist(database.db))) return {};
  const rows = await database.db.select().from(securityPriceChoices).where(eq(securityPriceChoices.workspaceId, ws.workspaceId));
  return Object.fromEntries(rows.map((row) => [row.securityId, row.choice]));
}

/** Saves where a security takes its price from. The prices it already has are kept, whatever their source. */
export async function setSecurityPriceChoice(database: Database, ws: WorkspaceContext, securityId: string, choice: ListedPriceChoice): Promise<void> {
  await database.transaction(async (tx) => {
    await securityByIdTx(tx, ws, securityId);
    await markHoldersDirtyTx(tx, ws, securityId);
    const row = { securityId, workspaceId: ws.workspaceId, choice };
    await tx.insert(securityPriceChoices).values(row).onConflictDoUpdate({ target: securityPriceChoices.securityId, set: { choice } });
  });
}

/** Each security's latest price with its source, by security. */
export async function latestSecurityPrices(database: Database, ws: WorkspaceContext): Promise<Record<string, SourcedPrice>> {
  if (!(await securityTablesExist(database.db))) return {};
  const rows = await database.db
    .select({ securityId: securityPrices.securityId, onDate: securityPrices.onDate, priceMicro: securityPrices.priceMicro, source: securityPrices.source })
    .from(securityPrices)
    .where(eq(securityPrices.workspaceId, ws.workspaceId))
    .orderBy(desc(securityPrices.onDate));
  const out: Record<string, SourcedPrice> = {};
  for (const { securityId, ...price } of rows) out[securityId] ??= price;
  return out;
}

/** Each of these holdings' own latest price with its source (a holding with no security), by holding. */
export async function latestOwnPrices(database: Database, ws: WorkspaceContext, accountIds: string[]): Promise<Record<string, SourcedPrice>> {
  if (accountIds.length === 0) return {};
  const rows = await database.db
    .select({ accountId: prices.accountId, onDate: prices.onDate, priceMicro: prices.priceMicro, source: prices.source })
    .from(prices)
    .where(and(eq(prices.workspaceId, ws.workspaceId), inArray(prices.accountId, accountIds)))
    .orderBy(desc(prices.onDate));
  const out: Record<string, SourcedPrice> = {};
  for (const { accountId, ...price } of rows) out[accountId] ??= price;
  return out;
}
