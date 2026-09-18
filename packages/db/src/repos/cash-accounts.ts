import { cashItem, type MoneyAccountSubtype } from '@expanses/core';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { AccountError, type AccountRow, createAccountTx } from './accounts';
import { saveAssetProfileTx } from './assets';
import { saveDepositTermsTx } from './deposit-terms';

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
}

/** Opens a money account with the code and the behaviour its catalogue item fixes. */
export async function openCashAccount(database: Database, ws: WorkspaceContext, input: OpenCashAccountInput): Promise<AccountRow> {
  const item = cashItem(input.item);
  const { behaviour } = item;
  // Every row of CASH_ITEMS opens money; saying so is what narrows the catalogue's union for the compiler.
  if (behaviour.opens !== 'money') throw new AccountError(`${item.label} is not a money account`);
  if (behaviour.valuedBy === 'deposit' && !input.maturesOn) throw new AccountError('Say when the deposit matures');
  return database.transaction(async (tx) => {
    const account = await createAccountTx(tx, ws, {
      name: input.name,
      kind: 'asset',
      subtype: behaviour.subtype,
      currency: input.currency,
      openingBalanceMinor: input.openingBalanceMinor,
      openedOn: input.openedOn,
      openingRateToBase: input.openingRateToBase,
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
    return account;
  });
}
