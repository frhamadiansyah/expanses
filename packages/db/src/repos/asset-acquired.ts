import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { openingBalanceLines } from '@expanses/core';
import { accounts, entries, transactions } from '../schema';
import { assetAcquired, assetProfiles } from '../schema-assets';
import { markAccountDirtyTx } from '../sync/capture';
import { systemAccountId } from './accounts';
import { AssetError, assertAccountInWorkspace } from './assets';
import { postTransactionTx, replaceTransactionTx, voidTransactionTx } from './ledger';

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
export async function openingOfTx(tx: Tx, ws: WorkspaceContext, accountId: string) {
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

/**
 * Changes what an asset valued by its owner cost, from its Settings: the original cost is the asset's opening entry,
 * so that entry is the one changed (replaced, as every edit is), at the day and the rate it was posted at. Every
 * figure that reads the cost (the gain, the history's last row, the net worth before the first estimate, the tax
 * report's cost) reads that entry, so none is kept twice.
 *
 * Zero takes the cost away: the asset may be added with no cost, so it may be left with none, and the entry is
 * voided. An asset with no entry yet is given one, on the day it was acquired (else 1 January of its acquired year,
 * else today); in a foreign currency that needs `rateToBase`, as the add form's opening does.
 */
export async function changeOriginalCost(
  database: Database,
  ws: WorkspaceContext,
  accountId: string,
  costMinor: number,
  today: string,
  rateToBase?: number,
): Promise<void> {
  if (!Number.isSafeInteger(costMinor) || costMinor < 0) throw new AssetError('A cost cannot be negative');
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, accountId, 'Asset');
    const [account] = await tx.select({ currency: accounts.currency, name: accounts.name }).from(accounts).where(eq(accounts.id, accountId));
    if (!account?.currency) throw new AssetError('Asset not found');
    markAccountDirtyTx(tx, accountId);
    const opening = await openingOfTx(tx, ws, accountId);
    const equityId = await systemAccountId(tx, ws, 'opening_balance');
    if (opening) {
      const lines = await tx
        .select({ accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency, fxRateToBase: entries.fxRateToBase })
        .from(entries)
        .where(and(eq(entries.transactionId, opening.id), eq(entries.workspaceId, ws.workspaceId)));
      const own = lines.find((line) => line.accountId === accountId);
      if (own && own.amountMinor === costMinor) return;
      if (costMinor === 0) {
        await voidTransactionTx(tx, ws, opening.id);
        return;
      }
      const rate = account.currency !== ws.baseCurrency ? own?.fxRateToBase : undefined;
      await replaceTransactionTx(tx, ws, opening.id, {
        occurredOn: opening.occurredOn,
        description: opening.description,
        lines: openingBalanceLines({ accountId, kind: 'asset', balanceMinor: costMinor, currency: account.currency, equityAccountId: equityId }),
        ratesToBase: rate ? { [account.currency]: rate } : {},
      });
      return;
    }
    if (costMinor === 0) return;
    if (account.currency !== ws.baseCurrency && !rateToBase) throw new AssetError('A rate to the base currency is needed for a cost in another currency');
    let on = today;
    let dated = false;
    if (await tableExists(tx)) {
      const [row] = await tx.select({ on: assetAcquired.acquiredOn }).from(assetAcquired).where(eq(assetAcquired.accountId, accountId));
      if (row) {
        on = row.on;
        dated = true;
      }
    }
    if (!dated) {
      const [profile] = await tx.select({ year: assetProfiles.acquiredYear }).from(assetProfiles).where(eq(assetProfiles.accountId, accountId));
      if (profile?.year) on = `${profile.year}-01-01`;
    }
    await postTransactionTx(tx, ws, {
      occurredOn: on,
      description: `Opening balance: ${account.name}`,
      lines: openingBalanceLines({ accountId, kind: 'asset', balanceMinor: costMinor, currency: account.currency, equityAccountId: equityId }),
      ratesToBase: rateToBase && account.currency !== ws.baseCurrency ? { [account.currency]: rateToBase } : {},
    });
  });
}

/**
 * The day of the first transaction that moves this account's balance, or null: what "As of" may not move past. Left
 * out: the opening entry itself, a purchase recorded as paid off before the app and its settlement (they net to
 * nothing on the account), so a past purchase never holds the day back.
 */
export async function firstCountedDayTx(tx: Db, ws: WorkspaceContext, accountId: string, openingId: string | null): Promise<string | null> {
  const rows = await tx.values<[string | null]>(sql`
    SELECT min(t.occurred_on) FROM transactions t
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'
      AND t.id IN (SELECT transaction_id FROM entries WHERE account_id = ${accountId})
      AND t.id <> ${openingId ?? ''}
      AND (t.external_ref IS NULL OR t.external_ref NOT LIKE 'before-app:%')
      AND NOT EXISTS (SELECT 1 FROM transactions s WHERE s.external_ref = 'before-app:' || t.id AND s.status = 'posted')`);
  return rows[0]?.[0] ?? null;
}

/** `firstCountedDayTx` for a screen: the latest day As of may take, besides today. */
export async function firstCountedDay(database: Database, ws: WorkspaceContext, accountId: string): Promise<string | null> {
  return database.transaction(async (tx) => {
    const opening = await openingOfTx(tx, ws, accountId);
    return firstCountedDayTx(tx, ws, accountId, opening?.id ?? null);
  });
}

/** Said when As of would move past a transaction already counted: every day before it would read wrong (owner, 13 Nov 2026). */
export function asOfPastText(firstDay: string): string {
  return `Transactions from ${firstDay} come before it. Change the balance instead, or pick ${firstDay} or earlier.`;
}

/**
 * Moves the day a money account's balance is counted from ("As of"): its opening entry is replaced on the new day with
 * the same lines and rate. Only the default for new purchases follows (a purchase dated before it starts out past);
 * nothing already recorded is recounted or rewritten. An account with no opening entry has no day to move.
 */
export async function changeOpeningDate(database: Database, ws: WorkspaceContext, accountId: string, on: string, today: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) throw new AssetError('That is not a date');
  if (on > today) throw new AssetError('It cannot be counted from after today');
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, accountId, 'Account');
    const opening = await openingOfTx(tx, ws, accountId);
    if (!opening || opening.occurredOn === on) return;
    // Later than a counted transaction, the days before the start would read without it (13 Nov 2026): refused.
    const first = await firstCountedDayTx(tx, ws, accountId, opening.id);
    if (first !== null && on > first) throw new AssetError(asOfPastText(first));
    const lines = await tx
      .select({ accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency, fxRateToBase: entries.fxRateToBase, amountBaseMinor: entries.amountBaseMinor, memo: entries.memo })
      .from(entries)
      .where(and(eq(entries.transactionId, opening.id), eq(entries.workspaceId, ws.workspaceId)));
    const ratesToBase = Object.fromEntries(lines.filter((line) => line.currency !== ws.baseCurrency).map((line) => [line.currency, line.fxRateToBase]));
    await replaceTransactionTx(tx, ws, opening.id, {
      occurredOn: on,
      description: opening.description,
      lines: lines.map((line) => ({ accountId: line.accountId, amountMinor: line.amountMinor, currency: line.currency, memo: line.memo, amountBaseMinor: line.amountBaseMinor })),
      ratesToBase,
    });
  });
}

/**
 * Changes a money account's starting balance (Settings › Balance, the figure on its "As of" day): the opening entry is
 * replaced on the same day at the same rate with the new amount, in one database transaction, as `changeOpeningDate`
 * replaces it for the day. Nothing else is rewritten — every balance from that day on moves by the difference, and
 * Cashflow, which never counts an opening, stays as it was.
 *
 * An account opened at nothing has no entry: it is given one on its As of day (`counted_from`, else the day it was
 * added); in a foreign currency that needs `rateToBase`, as the add form's opening does. Zero takes the entry away and
 * keeps its day as the As of day. An account with pockets holds nothing itself, so it has no balance to change.
 */
export async function changeOpeningBalance(
  database: Database,
  ws: WorkspaceContext,
  accountId: string,
  balanceMinor: number,
  rateToBase?: number,
): Promise<void> {
  if (!Number.isSafeInteger(balanceMinor)) throw new AssetError('That is not an amount');
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, accountId, 'Account');
    const [account] = await tx
      .select({ kind: accounts.kind, currency: accounts.currency, name: accounts.name, createdAt: accounts.createdAt })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!account || account.kind !== 'asset' || !account.currency) throw new AssetError('Only money held has a starting balance here');
    const pockets = await tx.values(sql`SELECT 1 FROM accounts WHERE parent_id = ${accountId} AND kind = 'asset' LIMIT 1`);
    if (pockets.length > 0) throw new AssetError('Each pocket keeps its own starting balance');
    const equityId = await systemAccountId(tx, ws, 'opening_balance');
    const opening = await openingOfTx(tx, ws, accountId);
    if (opening) {
      const lines = await tx
        .select({ accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency, fxRateToBase: entries.fxRateToBase })
        .from(entries)
        .where(and(eq(entries.transactionId, opening.id), eq(entries.workspaceId, ws.workspaceId)));
      const own = lines.find((line) => line.accountId === accountId);
      // Only the plain two-line opening is rewritten: anything more was posted by something else, and is left to it.
      if (!own || lines.length !== 2 || !lines.some((line) => line.accountId === equityId)) throw new AssetError('This opening entry has more than one part, so it is left as it is');
      if (own.amountMinor === balanceMinor) return;
      if (balanceMinor === 0) {
        await voidTransactionTx(tx, ws, opening.id);
        // The day stays the As of day: an account opened at nothing keeps its own (0107).
        if (await countedColumnExists(tx)) await tx.run(sql`UPDATE accounts SET counted_from = ${opening.occurredOn} WHERE id = ${accountId}`);
        return;
      }
      await replaceTransactionTx(tx, ws, opening.id, {
        occurredOn: opening.occurredOn,
        description: opening.description,
        lines: openingBalanceLines({ accountId, kind: 'asset', balanceMinor, currency: own.currency, equityAccountId: equityId }),
        ratesToBase: own.currency !== ws.baseCurrency ? { [own.currency]: own.fxRateToBase } : {},
      });
      return;
    }
    if (balanceMinor === 0) return;
    if (account.currency !== ws.baseCurrency && !rateToBase) throw new AssetError('A rate to the base currency is needed for a balance in another currency');
    let on = account.createdAt.slice(0, 10);
    if (await countedColumnExists(tx)) {
      const [row] = await tx.values<[string | null]>(sql`SELECT counted_from FROM accounts WHERE id = ${accountId}`);
      if (row?.[0]) on = row[0];
    }
    await postTransactionTx(tx, ws, {
      occurredOn: on,
      description: `Opening balance: ${account.name}`,
      lines: openingBalanceLines({ accountId, kind: 'asset', balanceMinor, currency: account.currency, equityAccountId: equityId }),
      ratesToBase: account.currency !== ws.baseCurrency ? { [account.currency]: rateToBase! } : {},
    });
  });
}

const countedColumn = new WeakMap<object, boolean>();
async function countedColumnExists(tx: Db): Promise<boolean> {
  if (countedColumn.get(tx)) return true;
  const rows = await tx.values<[number]>(sql`SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'counted_from'`);
  if (rows.length > 0) countedColumn.set(tx, true);
  return rows.length > 0;
}

/**
 * The "As of" day of each account opened at nothing (0107), by account id: only the accounts that have one are listed.
 * Read by name, as card_tier is: a database stopped before 0107 has no such column and there no account has a day.
 */
export async function listCountedFrom(database: Database, ws: WorkspaceContext): Promise<Record<string, string>> {
  if (!(await countedColumnExists(database.db))) return {};
  const rows = await database.db.values<[string, string]>(
    sql`SELECT id, counted_from FROM accounts WHERE workspace_id = ${ws.workspaceId} AND counted_from IS NOT NULL`,
  );
  return Object.fromEntries(rows);
}

/**
 * Sets the day a money account with no opening entry is counted from, or clears it with null. Only the default for
 * new purchases follows (one dated before it starts out past); nothing is posted, recounted or rewritten. An account
 * that has an opening entry keeps its day there (`changeOpeningDate`), so it is refused here.
 */
export async function setCountedFrom(database: Database, ws: WorkspaceContext, accountId: string, on: string | null, today: string): Promise<void> {
  if (on !== null) {
    if (!DAY.test(on)) throw new AssetError('That is not a date');
    if (on > today) throw new AssetError('It cannot be counted from after today');
  }
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, accountId, 'Account');
    if (await openingOfTx(tx, ws, accountId)) throw new AssetError('Its day is the opening entry’s: change that one');
    if (!(await countedColumnExists(tx))) throw new AssetError('This database cannot keep that yet');
    if (on !== null) {
      const first = await firstCountedDayTx(tx, ws, accountId, null);
      if (first !== null && on > first) throw new AssetError(asOfPastText(first));
    }
    await tx.run(sql`UPDATE accounts SET counted_from = ${on} WHERE id = ${accountId}`);
  });
}
