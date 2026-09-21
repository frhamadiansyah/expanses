import { isSupportedCurrency, type PriceRow, type SecurityKind, uuidv7 } from '@expanses/core';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { assetProfiles, prices } from '../schema-assets';
import { holdingLinks, securities, securityPrices } from '../schema-securities';
import { AssetError } from './assets';

/**
 * Whether migration 0051 has run. Every read and write of the three tables asks first, so a database stopped at an
 * older version behaves exactly as it does today. Only a positive answer is remembered: migrate() may still run on
 * the same handle.
 */
const tablesSeen = new WeakMap<Db, boolean>();

export async function securityTablesExist(db: Db): Promise<boolean> {
  if (tablesSeen.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'securities'`);
  if (rows.length > 0) tablesSeen.set(db, true);
  return rows.length > 0;
}

async function requireTables(db: Db): Promise<void> {
  if (!(await securityTablesExist(db))) throw new AssetError('This data has not been updated for tickers yet. Reopen the app and try again.');
}

export interface SecurityRow {
  id: string;
  ticker: string | null;
  name: string;
  market: string;
  currency: string;
  lotSize: number | null;
  kind: SecurityKind;
  source: 'catalogue' | 'owner';
}
export type NewSecurity = Omit<SecurityRow, 'id'>;

export interface HoldingLinkRow {
  accountId: string;
  securityId: string | null;
  brokerAccountId: string | null;
}

const toSecurity = (row: typeof securities.$inferSelect): SecurityRow => ({
  id: row.id, ticker: row.ticker, name: row.name, market: row.market, currency: row.currency, lotSize: row.lotSize, kind: row.kind, source: row.source,
});

const labelOf = (security: SecurityRow) => security.ticker ?? security.name;

/** The security for a market and ticker, recorded now if it is not yet. A ticker's facts are never rewritten. */
export async function ensureSecurityTx(tx: Db, ws: WorkspaceContext, input: NewSecurity): Promise<SecurityRow> {
  await requireTables(tx);
  const ticker = input.ticker?.trim().toUpperCase() || null;
  const market = input.market.trim().toUpperCase();
  const name = input.name.trim();
  if (!name) throw new AssetError('Give it a name');
  if (!isSupportedCurrency(input.currency)) throw new AssetError(`"${input.currency}" is not a currency this app knows`);
  if (input.lotSize !== null && (!Number.isInteger(input.lotSize) || input.lotSize < 1)) throw new AssetError('A lot is a whole number of shares, one or more');
  if (ticker && !/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)) throw new AssetError('A ticker is letters and digits, up to twelve');
  if (ticker) {
    const [found] = await tx
      .select()
      .from(securities)
      .where(and(eq(securities.workspaceId, ws.workspaceId), eq(securities.market, market), eq(securities.ticker, ticker)));
    if (found) return toSecurity(found);
  }
  const row = {
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    ticker,
    name,
    market,
    currency: input.currency,
    // A lot of one share is no lots at all.
    lotSize: input.lotSize === 1 ? null : input.lotSize,
    kind: input.kind,
    source: input.source,
    createdAt: new Date().toISOString(),
  };
  await tx.insert(securities).values(row);
  return toSecurity(row);
}

export async function securityByIdTx(tx: Db, ws: WorkspaceContext, id: string): Promise<SecurityRow> {
  await requireTables(tx);
  const [row] = await tx.select().from(securities).where(and(eq(securities.id, id), eq(securities.workspaceId, ws.workspaceId)));
  if (!row) throw new AssetError('That security is not in this workspace');
  return toSecurity(row);
}

export async function listSecurities(database: Database, ws: WorkspaceContext): Promise<SecurityRow[]> {
  if (!(await securityTablesExist(database.db))) return [];
  const rows = await database.db.select().from(securities).where(eq(securities.workspaceId, ws.workspaceId));
  return rows.map(toSecurity).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
}

export async function listHoldingLinks(database: Database, ws: WorkspaceContext): Promise<HoldingLinkRow[]> {
  if (!(await securityTablesExist(database.db))) return [];
  return database.db
    .select({ accountId: holdingLinks.accountId, securityId: holdingLinks.securityId, brokerAccountId: holdingLinks.brokerAccountId })
    .from(holdingLinks)
    .where(eq(holdingLinks.workspaceId, ws.workspaceId));
}

/** The security a holding points at, or null — including on a database without the tables. */
export async function securityOfHolding(db: Db, ws: WorkspaceContext, accountId: string): Promise<string | null> {
  if (!(await securityTablesExist(db))) return null;
  const [row] = await db
    .select({ securityId: holdingLinks.securityId })
    .from(holdingLinks)
    .where(and(eq(holdingLinks.accountId, accountId), eq(holdingLinks.workspaceId, ws.workspaceId)));
  return row?.securityId ?? null;
}

/**
 * Points a holding at a security, a broker, or both. An argument left undefined keeps what the link had; null
 * clears it. Linking a security carries the holding's own prices to it (the security's own price on a date stands)
 * and sets the holding's lot size to the security's.
 */
export async function linkHoldingTx(
  tx: Db,
  ws: WorkspaceContext,
  input: { accountId: string; securityId?: string | null; brokerAccountId?: string | null },
): Promise<void> {
  await requireTables(tx);
  const [holding] = await tx
    .select({ id: accounts.id, kind: accounts.kind, subtype: accounts.subtype, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!holding) throw new AssetError('Asset not found in this workspace');
  if (holding.kind !== 'asset' || holding.subtype !== 'investment') throw new AssetError('Only a holding can have a ticker or a broker');
  const [existing] = await tx
    .select()
    .from(holdingLinks)
    .where(and(eq(holdingLinks.accountId, input.accountId), eq(holdingLinks.workspaceId, ws.workspaceId)));
  const securityId = input.securityId === undefined ? (existing?.securityId ?? null) : input.securityId;
  const brokerAccountId = input.brokerAccountId === undefined ? (existing?.brokerAccountId ?? null) : input.brokerAccountId;

  const security = securityId ? await securityByIdTx(tx, ws, securityId) : null;
  const holdingCurrency = holding.currency ?? ws.baseCurrency;
  if (security && security.currency !== holdingCurrency) {
    throw new AssetError(`${labelOf(security)} is in ${security.currency}; this holding is in ${holdingCurrency}`);
  }
  if (brokerAccountId) {
    const [broker] = await tx
      .select({ kind: accounts.kind, subtype: accounts.subtype, parentId: accounts.parentId })
      .from(accounts)
      .where(and(eq(accounts.id, brokerAccountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!broker) throw new AssetError('Broker account not found in this workspace');
    // The owner's ruling: a broker is its cash account, subtype `fund`. A pocket is its parent's money in one
    // currency, so the parent is the broker and the pocket never is.
    if (broker.kind !== 'asset' || broker.subtype !== 'fund') {
      throw new AssetError('A broker is the cash account you keep there — choose a fund account');
    }
    if (broker.parentId) {
      const [parent] = await tx.select({ name: accounts.name }).from(accounts).where(and(eq(accounts.id, broker.parentId), eq(accounts.workspaceId, ws.workspaceId)));
      throw new AssetError(`That is a pocket of ${parent?.name ?? 'another account'}; choose ${parent?.name ?? 'the account'} itself as the broker`);
    }
  }
  if (security && brokerAccountId) {
    const [clash] = await tx
      .select({ accountId: holdingLinks.accountId })
      .from(holdingLinks)
      .where(and(
        eq(holdingLinks.workspaceId, ws.workspaceId),
        eq(holdingLinks.securityId, security.id),
        eq(holdingLinks.brokerAccountId, brokerAccountId),
        ne(holdingLinks.accountId, input.accountId),
      ));
    if (clash) throw new AssetError(`${labelOf(security)} at that broker is already another holding; record the buy on it instead`);
  }

  const now = new Date().toISOString();
  await tx
    .insert(holdingLinks)
    .values({ accountId: input.accountId, workspaceId: ws.workspaceId, securityId, brokerAccountId, createdAt: now })
    .onConflictDoUpdate({ target: holdingLinks.accountId, set: { securityId, brokerAccountId } });

  if (security && security.id !== existing?.securityId) {
    const own = await tx.select().from(prices).where(and(eq(prices.accountId, input.accountId), eq(prices.workspaceId, ws.workspaceId)));
    for (const row of own) {
      await tx
        .insert(securityPrices)
        .values({ securityId: security.id, workspaceId: ws.workspaceId, onDate: row.onDate, priceMicro: row.priceMicro, source: 'manual', createdAt: now })
        .onConflictDoNothing();
    }
    await tx
      .update(assetProfiles)
      .set({ lotSize: security.lotSize, updatedAt: now })
      .where(and(eq(assetProfiles.accountId, input.accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
  }
}

/** The same, recording the security first when it is handed as a new one. One database transaction. */
export function linkHolding(
  database: Database,
  ws: WorkspaceContext,
  input: { accountId: string; security?: { id: string } | NewSecurity | null; brokerAccountId?: string | null },
): Promise<void> {
  return database.transaction(async (tx) => {
    let securityId: string | null | undefined;
    if (input.security === null) securityId = null;
    else if (input.security) securityId = 'id' in input.security ? input.security.id : (await ensureSecurityTx(tx, ws, input.security)).id;
    await linkHoldingTx(tx, ws, { accountId: input.accountId, securityId, brokerAccountId: input.brokerAccountId });
  });
}

export async function upsertSecurityPriceTx(tx: Db, ws: WorkspaceContext, input: { securityId: string; onDate: string; priceMicro: number }): Promise<void> {
  if (!Number.isSafeInteger(input.priceMicro) || input.priceMicro < 0) throw new AssetError('A price cannot be negative');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.onDate)) throw new AssetError('Choose a date');
  await securityByIdTx(tx, ws, input.securityId);
  const row = { securityId: input.securityId, workspaceId: ws.workspaceId, onDate: input.onDate, priceMicro: input.priceMicro, source: 'manual' as const, createdAt: new Date().toISOString() };
  await tx.insert(securityPrices).values(row).onConflictDoUpdate({ target: [securityPrices.securityId, securityPrices.onDate], set: row });
}

/** One price for a security on a date; typing again replaces it. It values every holding of the security. */
export function upsertSecurityPrice(database: Database, ws: WorkspaceContext, input: { securityId: string; onDate: string; priceMicro: number }): Promise<void> {
  return database.transaction((tx) => upsertSecurityPriceTx(tx, ws, input));
}

/** Newest first. */
export async function listSecurityPrices(database: Database, ws: WorkspaceContext, securityId: string): Promise<PriceRow[]> {
  if (!(await securityTablesExist(database.db))) return [];
  return database.db
    .select({ onDate: securityPrices.onDate, priceMicro: securityPrices.priceMicro })
    .from(securityPrices)
    .where(and(eq(securityPrices.securityId, securityId), eq(securityPrices.workspaceId, ws.workspaceId)))
    .orderBy(desc(securityPrices.onDate));
}

export async function allSecurityPrices(database: Database, ws: WorkspaceContext): Promise<{ securityId: string; onDate: string; priceMicro: number }[]> {
  if (!(await securityTablesExist(database.db))) return [];
  return database.db
    .select({ securityId: securityPrices.securityId, onDate: securityPrices.onDate, priceMicro: securityPrices.priceMicro })
    .from(securityPrices)
    .where(eq(securityPrices.workspaceId, ws.workspaceId));
}
