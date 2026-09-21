import { cashItem, type MoneyAccountSubtype } from '@expanses/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { AccountError, type AccountRow, createAccountTx, pocketName, systemAccountId } from './accounts';
import { getAssetProfileTx } from './assets';
import { openCashAccountTx } from './cash-accounts';

export interface PocketInput {
  currency: string;
  openingBalanceMinor?: number;
  /** Settled by the screen before saving (`openingRateFor`): typed and checked, or resolved for the opening date. */
  openingRateToBase?: number;
}

export interface OpenPocketedAccountInput {
  item: MoneyAccountSubtype;
  name: string;
  bank?: string;
  openedOn?: string;
  pockets: PocketInput[];
}

/**
 * One account holding several currencies: a parent that holds nothing, and one ordinary money account per currency
 * under it. All of it in one transaction — a pocket that cannot be opened leaves no parent and no other pocket.
 */
export async function openPocketedAccount(
  database: Database,
  ws: WorkspaceContext,
  input: OpenPocketedAccountInput,
): Promise<{ parent: AccountRow; pockets: AccountRow[] }> {
  const item = cashItem(input.item);
  const { behaviour } = item;
  if (behaviour.opens !== 'money') throw new AccountError(`${item.label} is not a money account`);
  if (behaviour.valuedBy === 'deposit') throw new AccountError('A time deposit holds one currency. Open one deposit per currency.');
  const codes = input.pockets.map((pocket) => pocket.currency);
  const twice = codes.find((code, i) => codes.indexOf(code) !== i);
  if (twice) throw new AccountError(`${twice} is listed twice. One pocket per currency.`);
  if (codes.length < 2) throw new AccountError('An account with pockets holds at least two currencies. Add a second, or open it as a plain account.');
  const { subtype } = behaviour;
  return database.transaction(async (tx) => {
    // The table requires a currency on every asset; the parent's is never read as money (spec §3.1).
    const parent = await createAccountTx(tx, ws, { name: input.name, kind: 'asset', subtype, currency: ws.baseCurrency });
    const pockets: AccountRow[] = [];
    for (const [sortOrder, pocket] of input.pockets.entries()) {
      pockets.push(
        await openCashAccountTx(tx, ws, {
          item: input.item,
          name: pocketName(parent.name, pocket.currency),
          currency: pocket.currency,
          openingBalanceMinor: pocket.openingBalanceMinor,
          openedOn: input.openedOn,
          openingRateToBase: pocket.openingRateToBase,
          bank: input.bank,
          parentId: parent.id,
          sortOrder,
        }),
      );
    }
    return { parent, pockets };
  });
}

export interface AddPocketInput {
  parentId: string;
  currency: string;
  openingBalanceMinor?: number;
  openedOn?: string;
  openingRateToBase?: number;
}

/** One more currency in an account that already has pockets. A plain account does not become a parent (spec §17.1). */
export async function addPocket(database: Database, ws: WorkspaceContext, input: AddPocketInput): Promise<AccountRow> {
  return database.transaction(async (tx) => {
    const [parent] = await tx.select().from(accounts).where(and(eq(accounts.id, input.parentId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!parent) throw new AccountError('Account not found');
    const siblings = await tx
      .select({ id: accounts.id, sortOrder: accounts.sortOrder })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, parent.id), eq(accounts.kind, 'asset')))
      .orderBy(asc(accounts.sortOrder), asc(accounts.id));
    const first = siblings[0];
    if (!first) throw new AccountError(`${parent.name} has no pockets. Open a new account with pockets instead.`);
    const inst = (await getAssetProfileTx(tx, ws, first.id))?.coretaxFields.inst;
    const bank = inst?.trim() ? inst : undefined;
    return openCashAccountTx(tx, ws, {
      item: parent.subtype as MoneyAccountSubtype,
      name: pocketName(parent.name, input.currency),
      currency: input.currency,
      openingBalanceMinor: input.openingBalanceMinor,
      openedOn: input.openedOn,
      openingRateToBase: input.openingRateToBase,
      bank,
      parentId: parent.id,
      // After every pocket it has, archived ones included, so a re-added currency does not jump the queue.
      sortOrder: Math.max(...siblings.map((row) => row.sortOrder)) + 1,
    });
  });
}

export interface Opening {
  occurredOn: string;
  amountMinor: number;
  currency: string;
  /** The rate the opening balance was posted at: what "Opened at" shows. */
  fxRateToBase: number;
}

/** Each account's opening balance — the earliest posted entry that met the Opening balance equity account. */
export async function openingsOf(database: Database, ws: WorkspaceContext, accountIds: readonly string[]): Promise<Record<string, Opening>> {
  if (accountIds.length === 0) return {};
  const equityId = await systemAccountId(database.db, ws, 'opening_balance');
  const openingTxs = (
    await database.db.select({ id: entries.transactionId }).from(entries).where(and(eq(entries.workspaceId, ws.workspaceId), eq(entries.accountId, equityId)))
  ).map((row) => row.id);
  if (openingTxs.length === 0) return {};
  const rows = await database.db
    .select({
      accountId: entries.accountId,
      occurredOn: transactions.occurredOn,
      amountMinor: entries.amountMinor,
      currency: entries.currency,
      fxRateToBase: entries.fxRateToBase,
    })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        inArray(entries.accountId, [...accountIds]),
        inArray(entries.transactionId, openingTxs),
      ),
    )
    .orderBy(asc(transactions.occurredOn), asc(transactions.createdAt));
  const out: Record<string, Opening> = {};
  for (const row of rows) if (!(row.accountId in out)) out[row.accountId] = { occurredOn: row.occurredOn, amountMinor: row.amountMinor, currency: row.currency, fxRateToBase: row.fxRateToBase };
  return out;
}
