import { cashItem, type MoneyAccountSubtype, transferLines } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { AccountError, type AccountRow, createAccountTx, SPENDABLE_SUBTYPES } from './accounts';
import { saveAssetProfileTx } from './assets';
import { saveDepositTermsTx } from './deposit-terms';
import { postTransactionTx } from './ledger';

export interface OpenCashAccountInput {
  /** A `MoneyAccountSubtype` from the catalogue: which of the seven kinds of money account this is. */
  item: MoneyAccountSubtype;
  name: string;
  currency: string;
  openingBalanceMinor?: number;
  openedOn?: string;
  openingRateToBase?: number;
  /** The bank or institution holding it, kept as the kas table's "Nama bank/institusi". */
  bank?: string;
  /** Time deposit only. */
  maturesOn?: string;
  rateBps?: number;
  /** The account this is a pocket of. Only `openPocketedAccount` and `addPocket` pass it. */
  parentId?: string;
  /** A pocket's place among its account's pockets. Only `openPocketedAccount` and `addPocket` pass it. */
  sortOrder?: number;
  /**
   * The account the opening balance moves from. Left out, the balance is posted against Opening Balances equity:
   * money that was already there, which no account of the owner's loses. Given, the money moves — a transfer from
   * that account, dated the same day, so both balances follow and the money is not counted twice.
   */
  sourceAccountId?: string;
}

/** Opens a money account with the code and the behaviour its catalogue item fixes. */
export function openCashAccount(database: Database, ws: WorkspaceContext, input: OpenCashAccountInput): Promise<AccountRow> {
  return database.transaction((tx) => openCashAccountTx(tx, ws, input));
}

/** `openCashAccount` inside a transaction already running, so several accounts can open as one step. */
export async function openCashAccountTx(tx: Db, ws: WorkspaceContext, input: OpenCashAccountInput): Promise<AccountRow> {
  const item = cashItem(input.item);
  const { behaviour } = item;
  // Every row of CASH_ITEMS opens money; saying so is what narrows the catalogue's union for the compiler.
  if (behaviour.opens !== 'money') throw new AccountError(`${item.label} is not a money account`);
  if (behaviour.valuedBy === 'deposit' && !input.maturesOn) throw new AccountError('Say when the deposit matures');
  const opening = input.openingBalanceMinor ?? 0;
  // Only a balance is worth asking about: nothing can move into an account opened at zero, a source or not.
  const source = input.sourceAccountId && opening !== 0 ? await fundingSourceTx(tx, ws, input.sourceAccountId, input.currency) : null;
  const account = await createAccountTx(tx, ws, {
    name: input.name,
    kind: 'asset',
    subtype: behaviour.subtype,
    currency: input.currency,
    // Money that came out of one of the owner's accounts is not an opening balance: it is the transfer posted
    // below, and the equity account must not be touched — the money was already inside the books.
    openingBalanceMinor: source ? 0 : opening,
    openedOn: input.openedOn,
    openingRateToBase: input.openingRateToBase,
    parentId: input.parentId ?? null,
    sortOrder: input.sortOrder,
  });
  await saveAssetProfileTx(tx, ws, {
    accountId: account.id,
    assetKind: 'cash',
    planGroup: 'liquid',
    coretaxSection: 'kas',
    coretaxCode: item.code,
    // The one detail the form can answer while opening the account; the rest of the kas row is filled in later.
    coretaxFields: input.bank ? { inst: input.bank } : undefined,
  });
  if (behaviour.valuedBy === 'deposit') {
    await saveDepositTermsTx(tx, ws, { accountId: account.id, maturesOn: input.maturesOn!, rateBps: input.rateBps ?? 0 });
  }
  if (source) {
    await postTransactionTx(tx, ws, {
      occurredOn: input.openedOn ?? new Date().toISOString().slice(0, 10),
      description: 'Transfer',
      lines: transferLines({ fromAccountId: source.id, toAccountId: account.id, amountMinor: opening, currency: input.currency }),
      // A foreign balance was opened at a rate the form settled; the transfer that moved it tells the same story.
      ratesToBase: input.openingRateToBase ? { [input.currency]: input.openingRateToBase } : {},
    });
  }
  return account;
}

/** The account a balance is funded from, checked: one the owner can move money from, unarchived, in the same currency. */
async function fundingSourceTx(tx: Db, ws: WorkspaceContext, id: string, currency: string): Promise<{ id: string; name: string }> {
  const [row] = await tx
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency, subtype: accounts.subtype, archivedAt: accounts.archivedAt })
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row || row.archivedAt) throw new AccountError('That account is not open; choose another for where the money comes from');
  // Both dates and both figures read off the same statement only when both sides are one currency; a cross-currency
  // move needs a rate the bank used, which no form here can invent (the transfer form asks for the received amount).
  if (row.currency !== currency) throw new AccountError(`${row.name} holds ${row.currency}; a ${currency} balance cannot come out of it`);
  if (!(SPENDABLE_SUBTYPES as readonly string[]).includes(row.subtype)) throw new AccountError(`${row.name} cannot move money; pick an account you can spend from`);
  return { id: row.id, name: row.name };
}
