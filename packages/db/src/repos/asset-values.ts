import {
  byMoneyInputs,
  type AssetValue,
  assetValueAt,
  convertMinor,
  type DebtIcon,
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
  SHEET_SECTIONS,
  type SheetSectionKey,
  sheetSectionOf,
  type ValuationMode,
  type ValuationRow,
  sumToBase,
} from '@expanses/core';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { assetProfiles, prices, valuations } from '../schema-assets';
import { debtProfiles } from '../schema-debts';
import { notPlaceholder, sharingTablesExist } from '../sync/placeholder';
import { BALANCE_SUBTYPES, type AccountSubtype, pocketParentIds } from './accounts';
import { soldOnByAccount } from './asset-sales';
import { installmentTotals } from './installments';
import { nativeBalances } from './ledger';
import { listLoanItems, listLoans, scheduleFor, type LoanTermsRow } from './loans';
import { allSecurityPrices, listHoldingLinks } from './securities';
import { listTrades } from './trades';

export interface AssetValueRow extends AssetValue {
  name: string;
  currency: string;
  planGroup: PlanGroup;
  /** The kind of account it is, which is what a row with no catalogue code is read by. */
  subtype: AccountSubtype;
  mode: ValuationMode;
  /**
   * The catalogue code the asset was opened under — `0303` listed shares, `0701` gold — or null for an account with no
   * profile, which is what a money account is.
   */
  coretaxCode: string | null;
  /** Units held on the date, for holdings measured in units, shares or grams. */
  unitsMicro: number | null;
  /** The owner should type a fresh price or estimate. */
  stale: boolean;
  /**
   * A holding a sell has taken units (or money) out of, by the date: one at nothing is then sold out, where one with
   * nothing bought yet is simply held at nothing. Left out by older readers, which then read any empty holding as sold.
   */
  everSold?: boolean;
  /**
   * Who owes the money, for money owed to you: it is kept by the Lend & borrow ledger, which is where the debt — and
   * the code that says what kind of receivable it is — is administered. Null for everything else.
   */
  person: string | null;
}

const GROUP_BY_SUBTYPE: Record<string, PlanGroup> = {
  cash: 'liquid',
  bank: 'liquid',
  savings: 'liquid',
  // Broker cash and a wallet balance are both money you can withdraw, so they sit with cash, not with holdings.
  fund: 'liquid',
  ewallet: 'liquid',
  emoney: 'liquid',
  // A deposit cannot be paid from, but it is money and it comes back, so net worth counts it with cash.
  time_deposit: 'liquid',
  other_cash: 'liquid',
  investment: 'invest',
  receivable: 'owed',
  event_balance: 'owed',
  property: 'use',
  vehicle: 'use',
};

const lastDayOf = (month: string): string => {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year!, m!, 0));
  return date.toISOString().slice(0, 10);
};

/**
 * What `assetValuesAt` reads that does not depend on the date: the asset accounts, their profiles, trades, prices,
 * estimates and links, each grouped by account once. A series values every month from one read of these instead of
 * reading them all again for each month.
 */
interface AssetInputs {
  /** Every asset account of the workspace, archived ones too, in the order the sheet lists them. */
  rows: (typeof accounts.$inferSelect)[];
  parents: Set<string>;
  soldOn: Map<string, string>;
  profileByAccount: Map<string, typeof assetProfiles.$inferSelect>;
  debtCodeByAccount: Map<string, { accountId: string; personName: string | null; coretaxCode: string | null }>;
  tradesByAccount: Map<string, Awaited<ReturnType<typeof listTrades>>>;
  pricesByAccount: Map<string, PriceRow[]>;
  valuationsByAccount: Map<string, ValuationRow[]>;
  securityOf: Map<string, string>;
  pricesBySecurity: Map<string, PriceRow[]>;
}

/** Groups rows by a key, each group in the rows' own order. */
function groupBy<T, V>(rows: readonly T[], key: (row: T) => string, value: (row: T) => V): Map<string, V[]> {
  const groups = new Map<string, V[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(value(row));
    else groups.set(k, [value(row)]);
  }
  return groups;
}

/** Reads what every asset is valued from. Null when the workspace has no asset account that could be valued at all. */
async function readAssetInputs(database: Database, ws: WorkspaceContext): Promise<AssetInputs | null> {
  const assetSubtypes = BALANCE_SUBTYPES.asset as readonly string[];
  const hidePlaceholders = await sharingTablesExist(database.db);
  const rows = await database.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'asset'), hidePlaceholders ? notPlaceholder(accounts.id) : undefined))
    // Placed accounts (Reorder cards) first, the never-placed (0) after them by name, as on Wallet.
    .orderBy(sql`case when ${accounts.sortOrder} = 0 and ${accounts.parentId} is null then 1 else 0 end`, asc(accounts.sortOrder), asc(accounts.name));
  // A pocket parent holds nothing, so it is no asset: net worth, the tax report, idle cash and goals all read here.
  // Archived rows are read too, so a parent whose pockets are all archived is still recognised.
  const parents = pocketParentIds(rows);
  // A sold asset (0092) is valued no more from the day it was sold; before that day its history stands as it was.
  const soldOn = await soldOnByAccount(database.db, ws);
  // No account that is open, an asset and no parent: nothing on any date, and nothing more worth reading.
  if (!rows.some((row) => row.archivedAt === null && assetSubtypes.includes(row.subtype) && !parents.has(row.id))) return null;

  const profiles = await database.db.select().from(assetProfiles).where(eq(assetProfiles.workspaceId, ws.workspaceId));
  const profileByAccount = new Map(profiles.map((profile) => [profile.accountId, profile]));
  /*
   * Money owed to you keeps its code on the debt's own profile rather than on an asset profile — it was never opened
   * through the asset picker — and that code is what says what kind of receivable it is: a trade debt, an affiliate's,
   * or something else. Read here so every row's kind has one home, whether the account is a holding or a person.
   */
  const debtRows = await database.db
    .select({ accountId: debtProfiles.accountId, personName: debtProfiles.personName, coretaxCode: debtProfiles.coretaxCode })
    .from(debtProfiles)
    .where(eq(debtProfiles.workspaceId, ws.workspaceId));
  const debtCodeByAccount = new Map(debtRows.map((row) => [row.accountId, row]));
  const trades = await listTrades(database, ws);
  const tradesByAccount = groupBy(trades, (trade) => trade.accountId, (trade) => trade);
  const priceRows = await database.db.select().from(prices).where(eq(prices.workspaceId, ws.workspaceId));
  // In the order they were saved (rowid), so two saved in the same millisecond still keep it.
  const valuationRows = await database.db.select().from(valuations).where(eq(valuations.workspaceId, ws.workspaceId)).orderBy(sql`rowid`);
  // A holding with a security is valued from the security's prices alone (spec §3.1); the rest from its own.
  const securityOf = new Map((await listHoldingLinks(database, ws)).filter((link) => link.securityId).map((link) => [link.accountId, link.securityId!]));
  const securityPriceRows = securityOf.size > 0 ? await allSecurityPrices(database, ws) : [];
  const valuationsByAccount = groupBy(valuationRows, (row) => row.accountId, (row) => row);
  return {
    rows,
    parents,
    soldOn,
    profileByAccount,
    debtCodeByAccount,
    tradesByAccount,
    pricesByAccount: groupBy(priceRows, (row) => row.accountId, (row) => ({ onDate: row.onDate, priceMicro: row.priceMicro })),
    // Oldest saved first, so of two values for the same day the one saved last is the one that counts.
    valuationsByAccount: new Map(
      [...valuationsByAccount].map(([accountId, list]) => [
        accountId,
        list.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((row) => ({ asOf: row.asOf, valueMinor: row.valueMinor, basis: row.basis, createdAt: row.createdAt })),
      ]),
    ),
    securityOf,
    pricesBySecurity: groupBy(securityPriceRows, (row) => row.securityId, (row) => ({ onDate: row.onDate, priceMicro: row.priceMicro })),
  };
}

/** Every asset's value on `date` from inputs already read and the ledger's balances on that date. */
function assetValuesFrom(inputs: AssetInputs | null, ws: WorkspaceContext, date: string, balances: Record<string, number>): AssetValueRow[] {
  if (!inputs) return [];
  const assetSubtypes = BALANCE_SUBTYPES.asset as readonly string[];
  const { rows, parents, soldOn, profileByAccount, debtCodeByAccount, tradesByAccount, pricesByAccount, valuationsByAccount, securityOf, pricesBySecurity } = inputs;
  const assetsAccounts = rows.filter(
    (row) => row.archivedAt === null && assetSubtypes.includes(row.subtype) && !parents.has(row.id) && !((soldOn.get(row.id) ?? '9999-99-99') <= date),
  );
  return assetsAccounts.map((account) => {
    const profile = profileByAccount.get(account.id);
    const mode: ValuationMode = profile ? presetFor(profile.assetKind).valuationMode : account.valuationMode;
    const trades = tradesByAccount.get(account.id) ?? [];
    const position: Position | undefined = mode === 'market' ? positionAfter(trades, date) : undefined;
    const securityId = securityOf.get(account.id);
    const accountPrices: PriceRow[] = (securityId ? pricesBySecurity.get(securityId) : pricesByAccount.get(account.id)) ?? [];
    const accountValuations: ValuationRow[] = valuationsByAccount.get(account.id) ?? [];
    const value = assetValueAt(
      {
        accountId: account.id,
        mode,
        currency: account.currency ?? ws.baseCurrency,
        ledgerBalanceMinor: balances[account.id] ?? 0,
        position,
        prices: accountPrices,
        valuations: accountValuations,
        // Tracked by money: the last typed value (or past NAV) moved by the buys and sells since.
        ...(mode === 'amount' ? byMoneyInputs(trades, accountPrices, accountValuations, date) : {}),
      },
      date,
    );
    return {
      ...value,
      name: account.name,
      currency: account.currency ?? ws.baseCurrency,
      planGroup: profile?.planGroup ?? GROUP_BY_SUBTYPE[account.subtype] ?? 'use',
      subtype: account.subtype,
      mode,
      coretaxCode: profile?.coretaxCode ?? debtCodeByAccount.get(account.id)?.coretaxCode ?? null,
      person: debtCodeByAccount.get(account.id)?.personName ?? null,
      unitsMicro: position ? position.unitsMicro : null,
      stale: isStaleValue(value, date),
      everSold: trades.some((trade) => trade.kind === 'sell' && trade.occurredOn <= date),
    };
  });
}

/** What every asset account is worth on a date, with where the number came from. */
export async function assetValuesAt(database: Database, ws: WorkspaceContext, date: string): Promise<AssetValueRow[]> {
  const inputs = await readAssetInputs(database, ws);
  return assetValuesFrom(inputs, ws, date, inputs ? await nativeBalances(database, ws, date) : {});
}

/**
 * The ledger's balances on each of `dates`, from one pass over it: what `nativeBalances` gives for each date, without
 * adding up the whole ledger once a date. Each entry is counted in the first date on or after its day, and each
 * date's balance is the running total of those up to it. An account with no entry by a date is left out, as
 * `nativeBalances` leaves it out.
 */
export async function nativeBalancesOn(database: Database, ws: WorkspaceContext, dates: readonly string[]): Promise<Map<string, Record<string, number>>> {
  const sorted = [...new Set(dates)].sort();
  const result = new Map<string, Record<string, number>>();
  if (sorted.length === 0) return result;
  const bucket = sql.join(
    sorted.map((date, index) => sql`when ${transactions.occurredOn} <= ${date} then ${index}`),
    sql` `,
  );
  const rows = await database.db
    .select({ accountId: entries.accountId, bucket: sql<number>`case ${bucket} end`, total: sql<number>`sum(${entries.amountMinor})` })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(and(eq(entries.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), lte(transactions.occurredOn, sorted[sorted.length - 1]!)))
    .groupBy(entries.accountId, sql`2`);
  const byBucket = groupBy(rows, (row) => String(row.bucket), (row) => row);
  const running: Record<string, number> = {};
  sorted.forEach((date, index) => {
    for (const row of byBucket.get(String(index)) ?? []) running[row.accountId] = (running[row.accountId] ?? 0) + Number(row.total);
    result.set(date, { ...running });
  });
  return result;
}

/**
 * One asset's value at each of `dates` (joint net worth §5.2, task 6: a shared item's balance and month-ends), by the
 * same rule `assetValuesAt` values it — its valuation mode, trades, prices (its security's when linked) and estimates —
 * read once instead of once per date. `ledgerAt` is the account's posted ledger balance on a date. Null when the account
 * is not an asset of this workspace.
 */
export async function assetValueSeries(
  database: Database,
  ws: WorkspaceContext,
  accountId: string,
  dates: readonly string[],
  ledgerAt: (date: string) => number,
): Promise<number[] | null> {
  const [account] = await database.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'asset')));
  if (!account) return null;
  const [profile] = await database.db
    .select()
    .from(assetProfiles)
    .where(and(eq(assetProfiles.accountId, accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
  const mode: ValuationMode = profile ? presetFor(profile.assetKind).valuationMode : account.valuationMode;
  const trades = mode === 'market' || mode === 'amount' ? await listTrades(database, ws, { accountId }) : [];
  const securityId = (await listHoldingLinks(database, ws)).find((link) => link.accountId === accountId)?.securityId ?? null;
  const accountPrices: PriceRow[] = securityId
    ? (await allSecurityPrices(database, ws)).filter((row) => row.securityId === securityId).map((row) => ({ onDate: row.onDate, priceMicro: row.priceMicro }))
    : (await database.db.select().from(prices).where(and(eq(prices.accountId, accountId), eq(prices.workspaceId, ws.workspaceId)))).map((row) => ({
        onDate: row.onDate,
        priceMicro: row.priceMicro,
      }));
  // Oldest saved first, as assetValuesAt reads them: of two values for one day the one saved last counts.
  const accountValuations: ValuationRow[] = (
    await database.db.select().from(valuations).where(and(eq(valuations.accountId, accountId), eq(valuations.workspaceId, ws.workspaceId))).orderBy(sql`rowid`)
  )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((row) => ({ asOf: row.asOf, valueMinor: row.valueMinor, basis: row.basis, createdAt: row.createdAt }));
  return dates.map(
    (date) =>
      assetValueAt(
        {
          accountId,
          mode,
          currency: account.currency ?? ws.baseCurrency,
          ledgerBalanceMinor: ledgerAt(date),
          position: mode === 'market' ? positionAfter(trades, date) : undefined,
          prices: accountPrices,
          valuations: accountValuations,
          ...(mode === 'amount' ? byMoneyInputs(trades, accountPrices, accountValuations, date) : {}),
        },
        date,
      ).valueMinor,
  );
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
  /**
   * What the two totals are made of, or null in the months they cannot be added up.
   *
   * The same rows the totals come from, kept apart rather than summed: the assets by the section the sheet draws them
   * in, what is owed by the kind of debt it is. It is what a bar chart needs and what a line cannot say — a month whose
   * figure did not move can be a month where the money moved between two families.
   */
  stack: NetWorthStack | null;
}

/** The kinds a debt is, in the order the Debts screen groups them. */
export type LiabilityKind = (typeof BALANCE_SUBTYPES.liability)[number];

/** A month's money by what it is held in and what it is owed as. Every key is present, zeros and all. */
export interface NetWorthStack {
  assets: Record<SheetSectionKey, number>;
  liabilities: Record<LiabilityKind, number>;
}

/** Every key, at nothing — the shape a month is stacked into before its rows are added to it. */
function emptyAssets(): Record<SheetSectionKey, number> {
  const held = {} as Record<SheetSectionKey, number>;
  for (const section of SHEET_SECTIONS) held[section] = 0;
  return held;
}

/** The open debts' accounts, as net worth reads them: each one's balance is what is still owed. */
async function liabilityAccounts(database: Database, ws: WorkspaceContext): Promise<{ id: string; currency: string | null; subtype: AccountSubtype }[]> {
  return database.db
    .select({ id: accounts.id, currency: accounts.currency, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'liability'), isNull(accounts.archivedAt)));
}

/** Assets at their value minus what is still owed, both through `sumToBase`: every rate, or no figure. */
export async function netWorthAt(database: Database, ws: WorkspaceContext, date: string, ratesToBase: Record<string, number>): Promise<NetWorth> {
  const inputs = await readAssetInputs(database, ws);
  const balances = await nativeBalances(database, ws, date);
  return netWorthFrom(assetValuesFrom(inputs, ws, date, balances), await liabilityAccounts(database, ws), balances, ws, ratesToBase);
}

/** `netWorthAt` from what it reads: the assets' values on the date, the debts' accounts and the ledger on the date. */
function netWorthFrom(
  values: readonly AssetValueRow[],
  rows: readonly { id: string; currency: string | null; subtype: AccountSubtype }[],
  balances: Record<string, number>,
  ws: WorkspaceContext,
  ratesToBase: Record<string, number>,
): NetWorth {
  // A trip balance below zero is money this person owes the group (shared events §5): counted as a payable, never as
  // an asset worth less than nothing. Net worth is the same figure either way; what it is made of is not.
  const owing = values.filter((row) => row.subtype === 'event_balance' && row.valueMinor < 0);
  const held = values.filter((row) => !owing.includes(row));
  const assets = sumToBase({ amounts: held.map((row) => ({ minor: row.valueMinor, currency: row.currency })), baseCurrency: ws.baseCurrency, ratesToBase });

  const liabilitySubtypes = BALANCE_SUBTYPES.liability as readonly string[];
  const owed = [
    ...rows.filter((row) => liabilitySubtypes.includes(row.subtype)).map((row) => ({ minor: -(balances[row.id] ?? 0), currency: row.currency ?? ws.baseCurrency })),
    ...owing.map((row) => ({ minor: -row.valueMinor, currency: row.currency })),
  ];
  const liabilities = sumToBase({ amounts: owed, baseCurrency: ws.baseCurrency, ratesToBase });
  /*
   * The same two lists, kept apart instead of added up. `toBase` rather than `sumToBase`, because a stack is a shape:
   * one family that cannot be converted leaves a gap in the shape, and a shape with a gap in it is not the money. The
   * rate it could not find is collected and the whole month is handed over without a stack, exactly as its totals are
   * handed over as null.
   */
  const stacked = new Set<string>();
  const bySection = emptyAssets();
  for (const row of held) {
    const section = sheetSectionOf({ code: row.coretaxCode, subtype: row.subtype });
    bySection[section] += toBase(row.valueMinor, row.currency, ws, ratesToBase, stacked);
  }
  const byKind = {} as Record<LiabilityKind, number>;
  for (const kind of BALANCE_SUBTYPES.liability) byKind[kind] = 0;
  for (const row of rows) {
    if (!liabilitySubtypes.includes(row.subtype)) continue;
    const kind = row.subtype as LiabilityKind;
    byKind[kind] += toBase(-(balances[row.id] ?? 0), row.currency ?? ws.baseCurrency, ws, ratesToBase, stacked);
  }
  for (const row of owing) byKind.payable += toBase(-row.valueMinor, row.currency, ws, ratesToBase, stacked);
  const missing = [...new Set([...assets.missing, ...liabilities.missing, ...stacked])].sort();
  const netWorthMinor = assets.totalMinor !== null && liabilities.totalMinor !== null ? assets.totalMinor - liabilities.totalMinor : null;
  return {
    assetsMinor: assets.totalMinor,
    liabilitiesMinor: liabilities.totalMinor,
    netWorthMinor,
    missing,
    stack: netWorthMinor === null ? null : { assets: bySection, liabilities: byKind },
  };
}

/**
 * One figure in the workspace currency for the balance sheet's rows. A currency without a rate is added to `missing`
 * and its row reads 0 — the caller must show `missing` rather than a total built from those rows. A zero amount is
 * zero in any currency and needs no rate, as in `sumToBase`.
 */
function toBase(amountMinor: number, currency: string, ws: WorkspaceContext, ratesToBase: Record<string, number>, missing: Set<string>): number {
  if (currency === ws.baseCurrency || amountMinor === 0) return amountMinor;
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

/**
 * Net worth at the end of each month given as YYYY-MM, oldest first. Computed, never stored: what everything is valued
 * from is read once, and the ledger is added up once for every month together, so a five-year line costs about what
 * one month does — each point exactly what `netWorthAt` gives on its day.
 */
export async function netWorthSeries(
  database: Database,
  ws: WorkspaceContext,
  months: string[],
  ratesToBase: Record<string, number>,
  today: string = isoDate(),
): Promise<NetWorthPoint[]> {
  const currentMonth = monthOf(today);
  const days = months.map((month) => ({ month, onDate: month === currentMonth ? today : lastDayOf(month) }));
  if (days.length === 0) return [];
  const inputs = await readAssetInputs(database, ws);
  const debts = await liabilityAccounts(database, ws);
  const ledger = await nativeBalancesOn(database, ws, days.map((day) => day.onDate));
  return days.map(({ month, onDate }) => {
    const balances = ledger.get(onDate) ?? {};
    return { month, onDate, ...netWorthFrom(assetValuesFrom(inputs, ws, onDate, balances), debts, balances, ws, ratesToBase) };
  });
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
  // The ledger is added up once and read by both sides: the assets' balances and the debts'.
  const balances = await nativeBalances(database, ws, date);
  const values = assetValuesFrom(await readAssetInputs(database, ws), ws, date, balances);
  const missing = new Set<string>();
  // A trip balance below zero is a payable (shared events §5), as in `netWorthAt`.
  const owing = values.filter((row) => row.subtype === 'event_balance' && row.valueMinor < 0);
  const assets: SheetAsset[] = values.filter((row) => !owing.includes(row)).map((row) => ({
    accountId: row.accountId,
    name: row.name,
    planGroup: row.planGroup,
    valueMinor: toBase(row.valueMinor, row.currency, ws, ratesToBase, missing),
    code: row.coretaxCode,
    subtype: row.subtype,
  }));

  const liabilitySubtypes = BALANCE_SUBTYPES.liability as readonly string[];
  const rows = await database.db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'liability'), isNull(accounts.archivedAt)))
    // Placed accounts (Reorder cards) first, the never-placed (0) after them by name, as on Wallet.
    .orderBy(sql`case when ${accounts.sortOrder} = 0 and ${accounts.parentId} is null then 1 else 0 end`, asc(accounts.sortOrder), asc(accounts.name));

  const installments = await installmentTotals(database, ws, date);
  /*
   * What kind of debt each liability is: the catalogue item it was opened as, and what the money went on. Read here
   * rather than on the screen, because the same two answers fold the Debts list and the balance sheet's own drawers,
   * and a mortgage must not read as a mortgage on one page and as a plain loan on the other.
   */
  const items = await listLoanItems(database, ws);
  const assetSubtype = new Map(values.map((row) => [row.accountId, row.subtype]));
  const loanTerms = new Map((await listLoans(database, ws)).map((terms) => [terms.accountId, terms]));

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
      item: items[row.id] ?? null,
      icon: debtIcon(subtype, loanTerms.get(row.id), assetSubtype),
    });
  }
  for (const row of owing) {
    const balanceMinor = toBase(-row.valueMinor, row.currency, ws, ratesToBase, missing);
    // Owed to friends from a trip: due at once, like any personal debt.
    liabilities.push({ accountId: row.accountId, name: row.name, subtype: 'payable', balanceMinor, dueWithinYearMinor: balanceMinor, note: null, item: null, icon: debtIcon('payable', undefined, assetSubtype) });
  }
  return { assets, liabilities, missing: [...missing].sort() };
}

/**
 * What a debt is, and what a loan is against: a mortgage is one against a property, a lease one against a vehicle,
 * and anything else is a loan of no particular kind. Cards and personal debts are their own kind already.
 */
function debtIcon(
  subtype: SheetLiability['subtype'],
  terms: LoanTermsRow | undefined,
  assetSubtype: ReadonlyMap<string, AccountSubtype>,
): DebtIcon {
  if (subtype !== 'loan') return subtype === 'credit_card' ? 'card' : 'person';
  if (terms?.isHomeLoan) return 'home';
  return terms?.assetAccountId && assetSubtype.get(terms.assetAccountId) === 'vehicle' ? 'car' : 'loan';
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
