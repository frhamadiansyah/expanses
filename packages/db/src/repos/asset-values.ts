import {
  type AssetValue,
  assetValueAt,
  convertMinor,
  isStaleValue,
  type PlanGroup,
  type Position,
  positionAfter,
  type PriceRow,
  presetFor,
  type ValuationMode,
  type ValuationRow,
} from '@expanses/core';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { assetProfiles, prices, valuations } from '../schema-assets';
import { BALANCE_SUBTYPES } from './accounts';
import { nativeBalances } from './ledger';
import { listTrades } from './trades';

export interface AssetValueRow extends AssetValue {
  name: string;
  currency: string;
  planGroup: PlanGroup;
  mode: ValuationMode;
  /** Units held on the date, for holdings measured in units, shares or grams. */
  unitsMicro: number | null;
  /** The owner should type a fresh price or estimate. */
  stale: boolean;
}

const GROUP_BY_SUBTYPE: Record<string, PlanGroup> = {
  cash: 'liquid',
  bank: 'liquid',
  savings: 'liquid',
  investment: 'invest',
  receivable: 'owed',
  property: 'use',
  vehicle: 'use',
};

const lastDayOf = (month: string): string => {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year!, m!, 0));
  return date.toISOString().slice(0, 10);
};

/** What every asset account is worth on a date, with where the number came from. */
export async function assetValuesAt(database: Database, ws: WorkspaceContext, date: string): Promise<AssetValueRow[]> {
  const assetSubtypes = BALANCE_SUBTYPES.asset as readonly string[];
  const rows = await database.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'asset'), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));
  const assetsAccounts = rows.filter((row) => assetSubtypes.includes(row.subtype));
  if (assetsAccounts.length === 0) return [];

  const profiles = await database.db.select().from(assetProfiles).where(eq(assetProfiles.workspaceId, ws.workspaceId));
  const profileByAccount = new Map(profiles.map((profile) => [profile.accountId, profile]));
  const balances = await nativeBalances(database, ws, date);
  const trades = await listTrades(database, ws);
  const tradesByAccount = new Map<string, typeof trades>();
  for (const trade of trades) tradesByAccount.set(trade.accountId, [...(tradesByAccount.get(trade.accountId) ?? []), trade]);
  const priceRows = await database.db.select().from(prices).where(eq(prices.workspaceId, ws.workspaceId));
  const valuationRows = await database.db.select().from(valuations).where(eq(valuations.workspaceId, ws.workspaceId));

  return assetsAccounts.map((account) => {
    const profile = profileByAccount.get(account.id);
    const mode: ValuationMode = profile ? presetFor(profile.assetKind).valuationMode : account.valuationMode;
    const position: Position | undefined = mode === 'market' ? positionAfter(tradesByAccount.get(account.id) ?? [], date) : undefined;
    const accountPrices: PriceRow[] = priceRows.filter((row) => row.accountId === account.id).map((row) => ({ onDate: row.onDate, priceMicro: row.priceMicro }));
    const accountValuations: ValuationRow[] = valuationRows
      .filter((row) => row.accountId === account.id)
      .map((row) => ({ asOf: row.asOf, valueMinor: row.valueMinor, basis: row.basis }));
    const value = assetValueAt(
      {
        accountId: account.id,
        mode,
        currency: account.currency ?? ws.baseCurrency,
        ledgerBalanceMinor: balances[account.id] ?? 0,
        position,
        prices: accountPrices,
        valuations: accountValuations,
      },
      date,
    );
    return {
      ...value,
      name: account.name,
      currency: account.currency ?? ws.baseCurrency,
      planGroup: profile?.planGroup ?? GROUP_BY_SUBTYPE[account.subtype] ?? 'use',
      mode,
      unitsMicro: position ? position.unitsMicro : null,
      stale: isStaleValue(value, date),
    };
  });
}

export interface NetWorth {
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
}

/** Assets at their value minus what is still owed, both in the workspace currency. */
export async function netWorthAt(database: Database, ws: WorkspaceContext, date: string, ratesToBase: Record<string, number>): Promise<NetWorth> {
  const values = await assetValuesAt(database, ws, date);
  const assetsMinor = values.reduce((total, row) => total + toBase(row.valueMinor, row.currency, ws, ratesToBase), 0);

  const liabilitySubtypes = BALANCE_SUBTYPES.liability as readonly string[];
  const rows = await database.db
    .select({ id: accounts.id, currency: accounts.currency, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'liability'), isNull(accounts.archivedAt)));
  const balances = await nativeBalances(database, ws, date);
  const liabilitiesMinor = rows
    .filter((row) => liabilitySubtypes.includes(row.subtype))
    .reduce((total, row) => total - toBase(balances[row.id] ?? 0, row.currency ?? ws.baseCurrency, ws, ratesToBase), 0);

  return { assetsMinor, liabilitiesMinor, netWorthMinor: assetsMinor - liabilitiesMinor };
}

function toBase(amountMinor: number, currency: string, ws: WorkspaceContext, ratesToBase: Record<string, number>): number {
  if (currency === ws.baseCurrency) return amountMinor;
  const rate = ratesToBase[currency];
  if (rate === undefined) return 0;
  return convertMinor(amountMinor, currency, ws.baseCurrency, rate);
}

/** Value of one asset at the end of each month given as YYYY-MM, for the 12-month chart. */
export async function monthEndValues(database: Database, ws: WorkspaceContext, accountId: string, months: string[]): Promise<number[]> {
  const values: number[] = [];
  for (const month of months) {
    const rows = await assetValuesAt(database, ws, lastDayOf(month));
    values.push(rows.find((row) => row.accountId === accountId)?.valueMinor ?? 0);
  }
  return values;
}
