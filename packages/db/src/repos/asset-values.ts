import {
  type AssetValue,
  assetValueAt,
  convertMinor,
  isoDate,
  isStaleValue,
  monthOf,
  type SheetAsset,
  type SheetLiability,
  type PlanGroup,
  type Position,
  positionAfter,
  type PriceRow,
  presetFor,
  type ValuationMode,
  type ValuationRow,
  sumToBase,
} from '@expanses/core';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { assetProfiles, prices, valuations } from '../schema-assets';
import { BALANCE_SUBTYPES, pocketParentIds } from './accounts';
import { installmentTotals } from './installments';
import { nativeBalances } from './ledger';
import { scheduleFor } from './loans';
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
  // Broker cash and a wallet balance are both money you can withdraw, so they sit with cash, not with holdings.
  fund: 'liquid',
  ewallet: 'liquid',
  // A deposit cannot be paid from, but it is money and it comes back, so net worth counts it with cash.
  time_deposit: 'liquid',
  other_cash: 'liquid',
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
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'asset')))
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));
  // A pocket parent holds nothing, so it is no asset: net worth, the tax report, idle cash and goals all read here.
  // Archived rows are read too, so a parent whose pockets are all archived is still recognised.
  const parents = pocketParentIds(rows);
  const assetsAccounts = rows.filter((row) => row.archivedAt === null && assetSubtypes.includes(row.subtype) && !parents.has(row.id));
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

/**
 * Assets, debts and the two netted, in the workspace currency — or null, with the missing rate named in `missing`,
 * when a figure needs a rate there is none for. Never a partial sum with the unconvertible part counted as 0.
 */
export interface NetWorth {
  assetsMinor: number | null;
  liabilitiesMinor: number | null;
  netWorthMinor: number | null;
  /** Currencies without a rate to the workspace currency, sorted, once each. Empty when every figure is whole. */
  missing: string[];
}

/** Assets at their value minus what is still owed, both through `sumToBase`: every rate, or no figure. */
export async function netWorthAt(database: Database, ws: WorkspaceContext, date: string, ratesToBase: Record<string, number>): Promise<NetWorth> {
  const values = await assetValuesAt(database, ws, date);
  const assets = sumToBase({ amounts: values.map((row) => ({ minor: row.valueMinor, currency: row.currency })), baseCurrency: ws.baseCurrency, ratesToBase });

  const liabilitySubtypes = BALANCE_SUBTYPES.liability as readonly string[];
  const rows = await database.db
    .select({ id: accounts.id, currency: accounts.currency, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'liability'), isNull(accounts.archivedAt)));
  const balances = await nativeBalances(database, ws, date);
  const owed = rows.filter((row) => liabilitySubtypes.includes(row.subtype)).map((row) => ({ minor: -(balances[row.id] ?? 0), currency: row.currency ?? ws.baseCurrency }));
  const liabilities = sumToBase({ amounts: owed, baseCurrency: ws.baseCurrency, ratesToBase });

  const missing = [...new Set([...assets.missing, ...liabilities.missing])].sort();
  const netWorthMinor = assets.totalMinor !== null && liabilities.totalMinor !== null ? assets.totalMinor - liabilities.totalMinor : null;
  return { assetsMinor: assets.totalMinor, liabilitiesMinor: liabilities.totalMinor, netWorthMinor, missing };
}

/**
 * One figure in the workspace currency for the balance sheet's rows. A currency without a rate is added to `missing`
 * and its row reads 0 — the caller must show `missing` rather than a total built from those rows.
 */
function toBase(amountMinor: number, currency: string, ws: WorkspaceContext, ratesToBase: Record<string, number>, missing: Set<string>): number {
  if (currency === ws.baseCurrency) return amountMinor;
  const rate = ratesToBase[currency];
  if (rate === undefined || !(rate > 0)) {
    missing.add(currency);
    return 0;
  }
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

export interface NetWorthPoint extends NetWorth {
  month: string;
  /** Date the point was measured: the last day of the month, or today for the month we are in. */
  onDate: string;
}

/** Net worth at the end of each month given as YYYY-MM, oldest first. Computed, never stored. */
export async function netWorthSeries(
  database: Database,
  ws: WorkspaceContext,
  months: string[],
  ratesToBase: Record<string, number>,
  today: string = isoDate(),
): Promise<NetWorthPoint[]> {
  const currentMonth = monthOf(today);
  const points: NetWorthPoint[] = [];
  for (const month of months) {
    const onDate = month === currentMonth ? today : lastDayOf(month);
    const worth = await netWorthAt(database, ws, onDate, ratesToBase);
    points.push({ month, onDate, ...worth });
  }
  return points;
}

export interface SheetInputs {
  assets: SheetAsset[];
  liabilities: SheetLiability[];
  /** Currencies with no rate: their rows read 0, so no total built from these rows may be shown while non-empty. */
  missing: string[];
}

/**
 * The rows the balance sheet needs on a date. Until the Loans slice knows each loan's schedule,
 * cards and personal debts are due within a year and loans are long-term in full.
 */
export async function sheetInputsAt(
  database: Database,
  ws: WorkspaceContext,
  date: string,
  ratesToBase: Record<string, number> = {},
): Promise<SheetInputs> {
  const values = await assetValuesAt(database, ws, date);
  const missing = new Set<string>();
  const assets: SheetAsset[] = values.map((row) => ({
    accountId: row.accountId,
    name: row.name,
    planGroup: row.planGroup,
    valueMinor: toBase(row.valueMinor, row.currency, ws, ratesToBase, missing),
  }));

  const liabilitySubtypes = BALANCE_SUBTYPES.liability as readonly string[];
  const rows = await database.db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'liability'), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));
  const balances = await nativeBalances(database, ws, date);

  const installments = await installmentTotals(database, ws, date);

  const liabilities: SheetLiability[] = [];
  for (const row of rows) {
    if (!liabilitySubtypes.includes(row.subtype)) continue;
    const balanceMinor = toBase(-(balances[row.id] ?? 0), row.currency ?? ws.baseCurrency, ws, ratesToBase, missing);
    if (balanceMinor <= 0) continue;
    const subtype = row.subtype as SheetLiability['subtype'];
    liabilities.push({
      accountId: row.id,
      name: row.name,
      subtype,
      balanceMinor,
      dueWithinYearMinor: await dueWithinYear(database, ws, row.id, subtype, balanceMinor, date, installments),
      note: null,
    });
  }
  return { assets, liabilities, missing: [...missing].sort() };
}

/**
 * What a debt actually asks for within twelve months. A loan owes the principal its schedule names,
 * and a card owes everything except the instalments falling due beyond the year. A loan with no
 * terms yet has no schedule to read, so all of it counts as due.
 */
async function dueWithinYear(
  database: Database,
  ws: WorkspaceContext,
  accountId: string,
  subtype: SheetLiability['subtype'],
  balanceMinor: number,
  date: string,
  installments: Awaited<ReturnType<typeof installmentTotals>>,
): Promise<number> {
  if (subtype === 'loan') {
    const rows = await scheduleFor(database, ws, accountId, date);
    if (rows.length === 0) return balanceMinor;
    const nextTwelve = rows.slice(0, 12).reduce((total, row) => total + row.principalMinor, 0);
    return Math.min(nextTwelve, balanceMinor);
  }
  const beyond = installments[accountId]?.unbilledBeyond12Minor ?? 0;
  return Math.max(0, balanceMinor - beyond);
}
