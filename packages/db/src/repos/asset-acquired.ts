import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { entries, transactions } from '../schema';
import { assetAcquired, assetProfiles } from '../schema-assets';
import { markAccountDirtyTx } from '../sync/capture';
import { systemAccountId } from './accounts';
import { AssetError, assertAccountInWorkspace } from './assets';
import { replaceTransactionTx } from './ledger';

export type AcquiredPrecision = 'year' | 'month' | 'day';

export interface AcquiredDate {
  /** The whole day the ledger posts on: 1 January for a year alone, the 1st for a month. */
  on: string;
  /** How much of that day the owner typed. */
  precision: AcquiredPrecision;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRECISIONS: AcquiredPrecision[] = ['year', 'month', 'day'];

async function tableExists(tx: Db): Promise<boolean> {
  const rows = await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'asset_acquired'`);
  return rows.length > 0;
}

function check(date: AcquiredDate): void {
  if (!DAY.test(date.on)) throw new AssetError('An acquired date is YYYY-MM-DD');
  if (!PRECISIONS.includes(date.precision)) throw new AssetError(`Unknown precision "${date.precision}"`);
}

/** Writes how precisely an asset's acquired day was typed, inside a transaction already running. */
export async function saveAcquiredTx(tx: Db, ws: WorkspaceContext, accountId: string, date: AcquiredDate): Promise<void> {
  check(date);
  const row = { accountId, workspaceId: ws.workspaceId, acquiredOn: date.on, precision: date.precision, updatedAt: new Date().toISOString() };
  await tx.insert(assetAcquired).values(row).onConflictDoUpdate({ target: assetAcquired.accountId, set: row });
}

/** `saveAcquiredTx` with a transaction of its own: what the add form calls once the asset is open. */
export async function saveAcquired(database: Database, ws: WorkspaceContext, accountId: string, date: AcquiredDate): Promise<void> {
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, accountId, 'Asset');
    await saveAcquiredTx(tx, ws, accountId, date);
  });
}

/** Every asset's acquired day as typed, by account. An asset with no row was typed to the day (or never dated). */
export async function acquiredDates(database: Database, ws: WorkspaceContext): Promise<Record<string, AcquiredDate>> {
  if (!(await tableExists(database.db))) return {};
  const rows = await database.db
    .select({ accountId: assetAcquired.accountId, on: assetAcquired.acquiredOn, precision: assetAcquired.precision })
    .from(assetAcquired)
    .where(eq(assetAcquired.workspaceId, ws.workspaceId));
  return Object.fromEntries(rows.map((row) => [row.accountId, { on: row.on, precision: row.precision }]));
}

/** The account's opening entry, if it has one: the earliest posted transaction against Opening Balances. */
async function openingOfTx(tx: Tx, ws: WorkspaceContext, accountId: string) {
  const equityId = await systemAccountId(tx, ws, 'opening_balance');
  const equityTxs = tx
    .select({ id: entries.transactionId })
    .from(entries)
    .where(and(eq(entries.workspaceId, ws.workspaceId), eq(entries.accountId, equityId)));
  const [row] = await tx
    .select({ id: transactions.id, occurredOn: transactions.occurredOn, description: transactions.description })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(entries.accountId, accountId),
        eq(transactions.status, 'posted'),
        inArray(entries.transactionId, equityTxs),
      ),
    )
    .orderBy(asc(transactions.occurredOn), asc(transactions.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Changes when an asset valued by its owner was acquired, from its Edit screen: the precision row, the tax report's
 * year, and the opening entry's day, so the cost still sits from the day it says. The opening entry keeps its lines
 * and the rate it was posted at — only the day moves — and is replaced rather than edited in place, as every edit is.
 */
export async function changeAcquired(database: Database, ws: WorkspaceContext, accountId: string, date: AcquiredDate, today: string): Promise<void> {
  check(date);
  if (date.on > today) throw new AssetError('It cannot be acquired after today');
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, accountId, 'Asset');
    await saveAcquiredTx(tx, ws, accountId, date);
    const [profile] = await tx
      .select({ accountId: assetProfiles.accountId })
      .from(assetProfiles)
      .where(and(eq(assetProfiles.accountId, accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
    if (profile) {
      markAccountDirtyTx(tx, accountId);
      await tx
        .update(assetProfiles)
        .set({ acquiredYear: Number(date.on.slice(0, 4)), updatedAt: new Date().toISOString() })
        .where(eq(assetProfiles.accountId, accountId));
    }
    const opening = await openingOfTx(tx, ws, accountId);
    if (!opening || opening.occurredOn === date.on) return;
    const lines = await tx
      .select({ accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency, fxRateToBase: entries.fxRateToBase, amountBaseMinor: entries.amountBaseMinor, memo: entries.memo })
      .from(entries)
      .where(and(eq(entries.transactionId, opening.id), eq(entries.workspaceId, ws.workspaceId)));
    const ratesToBase = Object.fromEntries(lines.filter((line) => line.currency !== ws.baseCurrency).map((line) => [line.currency, line.fxRateToBase]));
    await replaceTransactionTx(tx, ws, opening.id, {
      occurredOn: date.on,
      description: opening.description,
      lines: lines.map((line) => ({ accountId: line.accountId, amountMinor: line.amountMinor, currency: line.currency, memo: line.memo, amountBaseMinor: line.amountBaseMinor })),
      ratesToBase,
    });
  });
}
