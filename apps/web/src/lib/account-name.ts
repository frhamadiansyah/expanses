import { accountDisplayName } from '@expanses/core';
import type { AccountRow } from '@expanses/db';

/**
 * Accounts as every screen reads them: `name` is what the account is shown by — "Mandiri Xpresi", its bank in front of
 * the name typed (`accountDisplayName`, the one rule) — and `typedName` the name as typed, which is what is stored.
 *
 * Done once, where the lists are read (`useAccounts`), so Paid with, Wallet, Cashflow, transfers and every other list
 * print the same name without each asking. A screen that writes a name back — a Name field in Settings, a description
 * made from the name — reads `typedName` (`typedNameOf`): what is stored never takes the bank.
 */
export function shownAccounts(rows: readonly AccountRow[]): AccountRow[] {
  return rows.map((row) => ({ ...row, name: accountDisplayName(row), typedName: row.typedName ?? row.name }));
}

/** The name as typed, for a row from `shownAccounts` or straight from the database alike. */
export function typedNameOf(account: Pick<AccountRow, 'name' | 'typedName'>): string {
  return account.typedName ?? account.name;
}

/**
 * Rows of any other list naming accounts by id (the values on Assets), given the accounts as the database lists them
 * (with their banks): a row named by its account's typed name takes the shown one, the typed one kept beside it. A row
 * named anything else — a holding called by its security — is left as it is.
 */
export function withShownNames<T extends { accountId: string; name: string }>(rows: readonly T[], accounts: readonly AccountRow[]): (T & { typedName: string })[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return rows.map((row) => {
    const account = byId.get(row.accountId);
    const name = account && typedNameOf(account) === row.name ? accountDisplayName({ ...account, name: row.name }) : row.name;
    return { ...row, name, typedName: row.name };
  });
}
