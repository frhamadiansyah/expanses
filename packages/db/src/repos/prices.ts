import { type PriceRow, uuidv7, type ValuationBasis, type ValuationRow } from '@expanses/core';
import { and, desc, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { prices, valuations } from '../schema-assets';
import { AssetError, assertAccountInWorkspace } from './assets';

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
    await tx.insert(prices).values(row).onConflictDoUpdate({ target: [prices.accountId, prices.onDate], set: row });
  });
}

/** Prices for one holding, newest first. */
export async function listPrices(database: Database, ws: WorkspaceContext, accountId: string): Promise<PriceRow[]> {
  const rows = await database.db
    .select({ onDate: prices.onDate, priceMicro: prices.priceMicro })
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
