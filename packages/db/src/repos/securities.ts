import { assetItem, cashItem, isSupportedCurrency, type PriceRow, type SecurityKind, uuidv7 } from '@expanses/core';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { assetProfiles, prices } from '../schema-assets';
import { holdingLinks, securities, securityPrices } from '../schema-securities';
import { markAccountDirtyTx } from '../sync/capture';
import { createAccountTx } from './accounts';
import { AssetError, saveAssetProfileTx } from './assets';
import { type RecordTradeInput, type TradeResult, writeTradeTx } from './trades';

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
 * clears it. Linking a security moves the holding's own prices to it (the security's own price on a date stands),
 * removes the holding's own rows and sets the holding's lot size to the security's. Unlinking gives the holding the
 * security's latest price as its own (ruling m12).
 */
export async function linkHoldingTx(
  tx: Db,
  ws: WorkspaceContext,
  input: { accountId: string; securityId?: string | null; brokerAccountId?: string | null },
): Promise<void> {
  await requireTables(tx);
  markAccountDirtyTx(tx, input.accountId); // joint net worth §9: priced from elsewhere now
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
      .where(and(eq(accounts.id, brokerAccountId), eq(accounts.workspaceId, ws.workspaceId), isNull(accounts.archivedAt)));
    if (!broker) throw new AssetError('Broker account not found in this workspace');
    /* The owner's ruling: a broker is its cash account, subtype `fund`. A mutual fund is also held at a bank or a fund
       app (spec 2026-10-19-fund-by-amount, "Held at"), so a fund may name a bank, a savings or a digital-wallet
       account as well. A pocket is its parent's money in one currency, so the parent is the place and the pocket
       never is. */
    const [profile] = await tx
      .select({ assetKind: assetProfiles.assetKind })
      .from(assetProfiles)
      .where(and(eq(assetProfiles.accountId, input.accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
    // A fund or a bond is sold by banks as well as brokers, so either is held at any of those places; a share is kept at a broker.
    const heldAnywhere = profile?.assetKind === 'fund' || profile?.assetKind === 'bond';
    const places: readonly string[] = heldAnywhere ? HELD_AT_SUBTYPES : ['fund'];
    if (broker.kind !== 'asset' || !places.includes(broker.subtype)) {
      throw new AssetError(
        heldAnywhere
          ? 'It is held at a broker, a bank or a fund app — choose one of those accounts'
          : 'A broker is the cash account kept there — choose a fund account',
      );
    }
    if (broker.parentId) {
      const [parent] = await tx.select({ name: accounts.name }).from(accounts).where(and(eq(accounts.id, broker.parentId), eq(accounts.workspaceId, ws.workspaceId)));
      throw new AssetError(`That is a pocket of ${parent?.name ?? 'another account'}; choose ${parent?.name ?? 'the account'} itself as the broker`);
    }
  }
  if (security && brokerAccountId) {
    // Only a live holding clashes: one sold out and archived is history, and holdingAtTx looks past it the same way.
    // Invariant this leaves open (m11): a (security, broker) pair is unique among LIVE holdings only, so an archived
    // holding can still share one with a live holding recorded after it was archived. If a holding is ever
    // unarchived, whoever wires that up for investments must refuse it when its (security, broker) is taken again.
    const [clash] = await tx
      .select({ accountId: holdingLinks.accountId })
      .from(holdingLinks)
      .innerJoin(accounts, eq(accounts.id, holdingLinks.accountId))
      .where(and(
        eq(holdingLinks.workspaceId, ws.workspaceId),
        eq(holdingLinks.securityId, security.id),
        eq(holdingLinks.brokerAccountId, brokerAccountId),
        ne(holdingLinks.accountId, input.accountId),
        isNull(accounts.archivedAt),
      ));
    if (clash) throw new AssetError(`${labelOf(security)} at that broker is already another holding; record the buy on it instead`);
  }

  const now = new Date().toISOString();
  await tx
    .insert(holdingLinks)
    .values({ accountId: input.accountId, workspaceId: ws.workspaceId, securityId, brokerAccountId, createdAt: now })
    .onConflictDoUpdate({ target: holdingLinks.accountId, set: { securityId, brokerAccountId } });

  if (security && security.id !== existing?.securityId) {
    // Ruling m12: the holding's own prices move to the security — the security's own price stands on any day it has
    // one — and then the holding's rows are removed, so no stale series is left to come back on an unlink.
    const own = await tx.select().from(prices).where(and(eq(prices.accountId, input.accountId), eq(prices.workspaceId, ws.workspaceId)));
    for (const row of own) {
      await tx
        .insert(securityPrices)
        .values({ securityId: security.id, workspaceId: ws.workspaceId, onDate: row.onDate, priceMicro: row.priceMicro, source: 'manual', createdAt: now })
        .onConflictDoNothing();
    }
    await tx.delete(prices).where(and(eq(prices.accountId, input.accountId), eq(prices.workspaceId, ws.workspaceId)));
    await tx
      .update(assetProfiles)
      .set({ lotSize: security.lotSize, updatedAt: now })
      .where(and(eq(assetProfiles.accountId, input.accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
  }
  if (!security && existing?.securityId) {
    // Unlinked: the holding is priced by its own rows again, and it has none (m12), so it takes the security's latest
    // price as its own — the value it showed a moment ago, never an old series of its own.
    const [latest] = await tx
      .select({ onDate: securityPrices.onDate, priceMicro: securityPrices.priceMicro })
      .from(securityPrices)
      .where(and(eq(securityPrices.securityId, existing.securityId), eq(securityPrices.workspaceId, ws.workspaceId)))
      .orderBy(desc(securityPrices.onDate))
      .limit(1);
    if (latest) {
      const row = { accountId: input.accountId, workspaceId: ws.workspaceId, onDate: latest.onDate, priceMicro: latest.priceMicro, source: 'manual' as const, createdAt: now };
      await tx.insert(prices).values(row).onConflictDoUpdate({ target: [prices.accountId, prices.onDate], set: row });
    }
  }
}

/** The same, recording the security first when it is handed as a new one. One database transaction. */
/** The accounts a mutual fund or a bond can be held at: a broker's cash, a bank, a savings account or a fund app's wallet. */
export const HELD_AT_SUBTYPES: readonly string[] = ['fund', 'bank', 'savings', 'ewallet'];

/**
 * The same fund at two places (spec 2026-10-19-fund-by-amount): this holding joins `otherAccountId` under one fund —
 * the other's security, or one made for it from its name — so the fund reads as one total with each place below it.
 * Null takes this holding out of any fund it shared. Each place keeps its own money, value and trades.
 */
export function sameFundAs(database: Database, ws: WorkspaceContext, accountId: string, otherAccountId: string | null): Promise<void> {
  return database.transaction(async (tx) => {
    if (otherAccountId === null) {
      await linkHoldingTx(tx, ws, { accountId, securityId: null });
      return;
    }
    if (otherAccountId === accountId) throw new AssetError('Choose another holding of the same fund');
    const [other] = await tx
      .select({ name: accounts.name, currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, otherAccountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!other) throw new AssetError('That holding is not in this workspace');
    const [link] = await tx.select({ securityId: holdingLinks.securityId }).from(holdingLinks).where(eq(holdingLinks.accountId, otherAccountId));
    let securityId = link?.securityId ?? null;
    if (!securityId) {
      const made = await ensureSecurityTx(tx, ws, {
        ticker: null,
        name: other.name,
        market: '',
        currency: other.currency ?? ws.baseCurrency,
        lotSize: null,
        kind: 'other',
        source: 'owner',
      });
      securityId = made.id;
      await linkHoldingTx(tx, ws, { accountId: otherAccountId, securityId });
    }
    await linkHoldingTx(tx, ws, { accountId, securityId });
  });
}

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
  // Joint net worth §9: every holding of the security is worth something else now.
  const held = await tx.select({ accountId: holdingLinks.accountId }).from(holdingLinks).where(and(eq(holdingLinks.securityId, input.securityId), eq(holdingLinks.workspaceId, ws.workspaceId)));
  for (const { accountId } of held) markAccountDirtyTx(tx, accountId);
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

export interface AddHoldingInput {
  /** A security already recorded, or one to record now — from a bundled list, or named by the owner. */
  security: { id: string } | NewSecurity;
  /** Where it is kept: a money account already open, a broker account to open now, or no broker. */
  broker: { accountId: string } | { name: string; currency: string } | null;
  /**
   * The buy: the charged amount on it (`withCharged`), the rates `tradeRatesForSave` worked out, and its goal and
   * set-aside answer. Null adds the holding with nothing bought yet, as Add asset adds a fund with no purchase: its
   * buys are recorded on it after.
   */
  buy: Omit<RecordTradeInput, 'accountId' | 'kind'> | null;
}

export interface AddHoldingResult {
  accountId: string;
  securityId: string;
  brokerAccountId: string | null;
  /** False when the buy went on a holding of this security at this broker that already existed. */
  created: boolean;
  /** Null when nothing was bought. */
  trade: TradeResult | null;
}

/**
 * Every live holding of a security at a broker (or at no broker), oldest first. At a named broker the clash rule
 * (`linkHoldingTx`) already keeps this to at most one row. With no broker there can legitimately be several (§7.6
 * links legacy holdings with "No broker", and the clash rule does not apply to them) — ordered oldest first, so the
 * choice is deterministic rather than whichever row SQLite happens to return.
 *
 * `holdingAtTx` (where a buy lands) and `brokerlessHoldingsOf` (what the form names) both read this one query, so the
 * holding the form names is always the holding the buy lands on.
 */
async function liveHoldingsTx(tx: Db, ws: WorkspaceContext, securityId: string, brokerAccountId: string | null): Promise<string[]> {
  const rows = await tx
    .select({ accountId: holdingLinks.accountId })
    .from(holdingLinks)
    .innerJoin(accounts, eq(accounts.id, holdingLinks.accountId))
    .where(and(
      eq(holdingLinks.workspaceId, ws.workspaceId),
      eq(holdingLinks.securityId, securityId),
      brokerAccountId ? eq(holdingLinks.brokerAccountId, brokerAccountId) : isNull(holdingLinks.brokerAccountId),
      isNull(accounts.archivedAt),
    ))
    .orderBy(asc(accounts.createdAt), asc(accounts.id));
  return rows.map((row) => row.accountId);
}

/** The live holding a buy of this security at this broker (or at no broker) lands on, if there is one. */
async function holdingAtTx(tx: Db, ws: WorkspaceContext, securityId: string, brokerAccountId: string | null): Promise<string | null> {
  return (await liveHoldingsTx(tx, ws, securityId, brokerAccountId))[0] ?? null;
}

/** Every live broker-less holding of a security, oldest first; the first is the one a no-broker buy in `addHolding` lands on. */
export async function brokerlessHoldingsOf(database: Database, ws: WorkspaceContext, securityId: string): Promise<string[]> {
  if (!(await securityTablesExist(database.db))) return [];
  return liveHoldingsTx(database.db, ws, securityId, null);
}

/**
 * A broker opened by name where a holding is being put: a fund account, with the profile Add account gives a broker's
 * cash — its kas row, where its RDN bank is named.
 */
async function openBrokerTx(tx: Db, ws: WorkspaceContext, broker: { name: string; currency: string }) {
  const opened = await createAccountTx(tx, ws, { name: broker.name, kind: 'asset', subtype: 'fund', currency: broker.currency });
  await saveAssetProfileTx(tx, ws, { accountId: opened.id, assetKind: 'cash', planGroup: 'liquid', coretaxSection: 'kas', coretaxCode: cashItem('fund').code });
  return opened;
}

/** Opens a broker by name, for a holding's Broker row — the "Another broker…" Add a holding already offers. */
export function openBroker(database: Database, ws: WorkspaceContext, broker: { name: string; currency: string }) {
  const name = broker.name.trim();
  if (!name) throw new AssetError('Name the broker');
  return database.transaction((tx) => openBrokerTx(tx, ws, { ...broker, name }));
}

/**
 * Record the security, open the broker, open and link the holding, record the buy — all or nothing (spec §7.5). The buy
 * goes through `writeTradeTx` untouched, so its `goalId` and `setAside` answer post exactly as `recordTrade`'s do.
 */
export function addHolding(database: Database, ws: WorkspaceContext, input: AddHoldingInput): Promise<AddHoldingResult> {
  return database.transaction(async (tx) => {
    await requireTables(tx);
    const security = 'id' in input.security ? await securityByIdTx(tx, ws, input.security.id) : await ensureSecurityTx(tx, ws, input.security);

    let brokerAccountId: string | null = null;
    let brokerName: string | null = null;
    if (input.broker && 'accountId' in input.broker) {
      const [broker] = await tx
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(and(eq(accounts.id, input.broker.accountId), eq(accounts.workspaceId, ws.workspaceId), isNull(accounts.archivedAt)));
      if (!broker) throw new AssetError('Broker account not found in this workspace');
      brokerAccountId = broker.id;
      brokerName = broker.name;
    } else if (input.broker) {
      const opened = await openBrokerTx(tx, ws, input.broker);
      brokerAccountId = opened.id;
      brokerName = opened.name;
    }

    const existing = await holdingAtTx(tx, ws, security.id, brokerAccountId);
    let accountId = existing;
    if (!accountId) {
      const holding = await createAccountTx(tx, ws, {
        name: brokerName ? `${labelOf(security)} · ${brokerName}` : labelOf(security),
        kind: 'asset',
        subtype: 'investment',
        currency: security.currency,
      });
      const item = assetItem('stock');
      await saveAssetProfileTx(tx, ws, {
        accountId: holding.id,
        assetKind: 'stock',
        unitKind: 'shares',
        lotSize: security.lotSize,
        coretaxSection: item.section,
        coretaxCode: item.code,
      });
      // Validates the broker (a money account in this workspace) before anything is bought.
      await linkHoldingTx(tx, ws, { accountId: holding.id, securityId: security.id, brokerAccountId });
      accountId = holding.id;
    }
    const trade = input.buy ? await writeTradeTx(tx, ws, { ...input.buy, accountId, kind: 'buy' }, null) : null;
    return { accountId, securityId: security.id, brokerAccountId, created: existing === null, trade };
  });
}
