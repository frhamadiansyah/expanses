import { type GoldPriceChoice, type PriceRow, type PriceSource, uuidv7, type ValuationBasis, type ValuationRow } from '@expanses/core';
import { and, desc, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { goldPriceChoices, prices, valuations } from '../schema-assets';
import { markAccountDirtyTx } from '../sync/capture';
import { AssetError, assertAccountInWorkspace } from './assets';
import { securityPrices } from '../schema-securities';
import { securityOfHolding, upsertSecurityPriceTx } from './securities';

export interface ValuationWithNote extends ValuationRow {
  id: string;
  note: string | null;
}

/** Stores the price the owner typed for a holding on a date. One price per date; typing again replaces it. */
export async function upsertPrice(database: Database, ws: WorkspaceContext, input: { accountId: string; onDate: string; priceMicro: number }): Promise<void> {
  if (!Number.isSafeInteger(input.priceMicro) || input.priceMicro < 0) throw new AssetError('A price cannot be negative');
  const row = {
    accountId: input.accountId,
    workspaceId: ws.workspaceId,
    onDate: input.onDate,
    priceMicro: input.priceMicro,
    source: 'manual' as const,
    createdAt: new Date().toISOString(),
  };
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, input.accountId, 'Asset');
    markAccountDirtyTx(tx, input.accountId); // joint net worth §9: its value changed
    // A linked holding's price is its security's: one entry values every broker that holds it (spec §3.2).
    const securityId = await securityOfHolding(tx, ws, input.accountId);
    if (securityId) {
      await upsertSecurityPriceTx(tx, ws, { securityId, onDate: input.onDate, priceMicro: input.priceMicro });
      return;
    }
    await tx.insert(prices).values(row).onConflictDoUpdate({ target: [prices.accountId, prices.onDate], set: row });
  });
}

/**
 * Stores the world price fetched for a holding on a date, marked as fetched. A price the owner typed for that day is
 * the day's price and stays: the fetch writes only where nothing is stored yet, or over an earlier fetch. A holding
 * linked to a security takes its price from the security, so nothing is written for it.
 */
export async function recordWorldPrice(database: Database, ws: WorkspaceContext, input: { accountId: string; onDate: string; priceMicro: number }): Promise<void> {
  if (!Number.isSafeInteger(input.priceMicro) || input.priceMicro <= 0) throw new AssetError('A world price is above zero');
  const row = {
    accountId: input.accountId,
    workspaceId: ws.workspaceId,
    onDate: input.onDate,
    priceMicro: input.priceMicro,
    source: 'world' as const,
    createdAt: new Date().toISOString(),
  };
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, input.accountId, 'Asset');
    if (await securityOfHolding(tx, ws, input.accountId)) return;
    markAccountDirtyTx(tx, input.accountId); // joint net worth §9: its value may have changed
    await tx
      .insert(prices)
      .values(row)
      .onConflictDoUpdate({ target: [prices.accountId, prices.onDate], set: row, setWhere: eq(prices.source, 'world') });
  });
}

/** Where a gold holding takes its price from. No choice saved is the world price. */
export async function goldPriceChoiceOf(database: Database, ws: WorkspaceContext, accountId: string): Promise<GoldPriceChoice> {
  const [row] = await database.db
    .select({ choice: goldPriceChoices.choice })
    .from(goldPriceChoices)
    .where(and(eq(goldPriceChoices.accountId, accountId), eq(goldPriceChoices.workspaceId, ws.workspaceId)));
  return row?.choice ?? 'world';
}

/** Saves where a gold holding takes its price from. The prices it already has are kept either way. */
export async function setGoldPriceChoice(database: Database, ws: WorkspaceContext, accountId: string, choice: GoldPriceChoice): Promise<void> {
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, accountId, 'Asset');
    markAccountDirtyTx(tx, accountId); // joint net worth §9: the price it is valued at may change
    const row = { accountId, workspaceId: ws.workspaceId, choice };
    await tx.insert(goldPriceChoices).values(row).onConflictDoUpdate({ target: goldPriceChoices.accountId, set: { choice } });
  });
}

export interface SourcedPrice extends PriceRow {
  /** Typed by the owner, fetched as the world price, or — a security's — from Yahoo Finance or IDX's daily file. */
  source: PriceSource;
}

/** Prices for one holding, newest first, each with where it came from. A linked holding's are its security's. */
export async function listPrices(database: Database, ws: WorkspaceContext, accountId: string): Promise<SourcedPrice[]> {
  const securityId = await securityOfHolding(database.db, ws, accountId);
  if (securityId) {
    return database.db
      .select({ onDate: securityPrices.onDate, priceMicro: securityPrices.priceMicro, source: securityPrices.source })
      .from(securityPrices)
      .where(and(eq(securityPrices.securityId, securityId), eq(securityPrices.workspaceId, ws.workspaceId)))
      .orderBy(desc(securityPrices.onDate));
  }
  const rows = await database.db
    .select({ onDate: prices.onDate, priceMicro: prices.priceMicro, source: prices.source })
    .from(prices)
    .where(and(eq(prices.accountId, accountId), eq(prices.workspaceId, ws.workspaceId)))
    .orderBy(desc(prices.onDate));
  return rows;
}

/** Records what the owner thinks a property, vehicle or other asset is worth, keeping the earlier estimates. */
export async function recordValuation(
  database: Database,
  ws: WorkspaceContext,
  input: { accountId: string; asOf: string; valueMinor: number; basis: ValuationBasis; note?: string | null },
): Promise<string> {
  if (!Number.isSafeInteger(input.valueMinor) || input.valueMinor < 0) throw new AssetError('A value cannot be negative');
  const id = uuidv7();
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, input.accountId, 'Asset');
    markAccountDirtyTx(tx, input.accountId); // joint net worth §9: its value changed
    await tx.insert(valuations).values({
      id,
      workspaceId: ws.workspaceId,
      accountId: input.accountId,
      asOf: input.asOf,
      valueMinor: input.valueMinor,
      basis: input.basis,
      note: input.note ?? null,
      createdAt: new Date().toISOString(),
    });
  });
  return id;
}

/** Estimates for one asset, newest first. */
export async function listValuations(database: Database, ws: WorkspaceContext, accountId: string): Promise<ValuationWithNote[]> {
  const rows = await database.db
    .select()
    .from(valuations)
    .where(and(eq(valuations.accountId, accountId), eq(valuations.workspaceId, ws.workspaceId)))
    .orderBy(desc(valuations.asOf), desc(valuations.createdAt));
  return rows.map((row) => ({ id: row.id, asOf: row.asOf, valueMinor: row.valueMinor, basis: row.basis, note: row.note }));
}
