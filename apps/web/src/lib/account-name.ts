import { accountDisplayName, CUSTODIAN_NAMED_SUBTYPES } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { SUBTYPE_LABELS } from './account-types';

/**
 * Accounts as every screen reads them: `name` is what the account is shown by — "Mandiri Xpresi", its bank in front of
 * the name typed (`accountDisplayName`, the one rule) — and `typedName` the name as typed, which is what is stored.
 *
 * Done once, where the lists are read (`useAccounts`), so Paid with, Wallet, Cashflow, transfers and every other list
 * print the same name without each asking. A screen that writes a name back — a Name field in Settings, a description
 * made from the name — reads `typedName` (`typedNameOf`): what is stored never takes the bank.
 */
export function shownAccounts(rows: readonly AccountRow[]): AccountRow[] {
  const apart = tellApartOf(rows);
  return rows.map((row) => {
    const shown: AccountRow = { ...row, name: accountDisplayName({ ...row, name: typedNameOf(row) }), typedName: typedNameOf(row) };
    const words = apart.get(row.id);
    if (words) shown.tellApart = words;
    else delete shown.tellApart;
    return shown;
  });
}

/** Whether an account is a broker's cash, shown by its custodian bank where money is listed (`CUSTODIAN_NAMED_SUBTYPES`). */
const custodianNamed = (account: Pick<AccountRow, 'kind' | 'subtype'>) => account.kind === 'asset' && CUSTODIAN_NAMED_SUBTYPES.includes(account.subtype);

/**
 * The brokers to name under a title two of them share: a broker's cash is titled by its custodian bank, so two brokers
 * keeping their money at one bank both read "CIMB Niaga" — each then carries its broker (its typed name), and so does
 * each of its pockets. Only live brokers count, and only by the bank as written, whatever its case; a broker with no
 * bank named is titled by its own name and needs nothing.
 */
function tellApartOf(rows: readonly AccountRow[]): Map<string, string> {
  const brokers = rows.filter((row) => custodianNamed(row) && row.parentId === null && row.archivedAt === null && row.bank?.trim());
  const byBank = new Map<string, AccountRow[]>();
  for (const broker of brokers) {
    const key = broker.bank!.trim().toLowerCase();
    byBank.set(key, [...(byBank.get(key) ?? []), broker]);
  }
  const apart = new Map<string, string>();
  for (const same of byBank.values()) if (same.length > 1) for (const broker of same) apart.set(broker.id, typedNameOf(broker));
  for (const row of rows) {
    const parent = row.parentId ? apart.get(row.parentId) : undefined;
    if (parent && custodianNamed(row)) apart.set(row.id, parent);
  }
  return apart;
}

/**
 * The line under an account's name where a list of money says what kind it is: "Fund account", "Saving account" — and,
 * for a broker's cash sharing its custodian's name with another (`tellApart`), its broker after it: "Fund account ·
 * Mirae Sekuritas".
 */
export function accountKindLine(account: Pick<AccountRow, 'subtype' | 'tellApart'>): string {
  return [SUBTYPE_LABELS[account.subtype], account.tellApart].filter(Boolean).join(' · ');
}

/**
 * A broker's name: a broker's cash account by the name typed (its broker), never the custodian bank it is shown by
 * among money. A stock's Broker, Investments' groups, a fund's institution and every trade row read this.
 */
export function brokerNameOf(account: Pick<AccountRow, 'name' | 'typedName'>): string {
  return typedNameOf(account);
}

/**
 * Rows of a list made straight from the database (the balance sheet's), named as every list of money names them
 * (`shownAccounts`): an account at a bank with its bank in front ("CIMB Niaga Octo Savers", owner 25 Nov 2026: the
 * balance sheet printed the typed name alone, so only accounts typed with their bank read so), a broker's cash by its
 * custodian bank, with its broker in the row's note when another broker shares that bank. A row that is not one of
 * these accounts as typed — a holding, another member's item — is left exactly as it was.
 */
export function withCustodianNames<T extends { accountId: string; name: string; note: string | null }>(rows: readonly T[], accounts: readonly AccountRow[]): T[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return rows.map((row) => {
    const account = byId.get(row.accountId);
    if (!account || typedNameOf(account) !== row.name || account.name === row.name) return row;
    return { ...row, name: account.name, note: row.note ?? (custodianNamed(account) ? (account.tellApart ?? null) : null) };
  });
}

/**
 * An account as a one-line choice names it (a select's option): its name, with what tells it apart from another of the
 * same name after it — "CIMB Niaga · Mirae Sekuritas" beside "CIMB Niaga · Stockbit".
 */
export function accountChoiceName(account: Pick<AccountRow, 'name' | 'tellApart'>): string {
  return account.tellApart ? `${account.name} · ${account.tellApart}` : account.name;
}

/** An account for a list of brokers: a broker's cash named by its broker; every other account as it is shown. */
export function asBroker<T extends AccountRow>(account: T): T {
  return CUSTODIAN_NAMED_SUBTYPES.includes(account.subtype) ? { ...account, name: brokerNameOf(account) } : account;
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
export function withShownNames<T extends { accountId: string; name: string }>(rows: readonly T[], accounts: readonly AccountRow[]): (T & { typedName: string; tellApart?: string })[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const apart = tellApartOf(accounts);
  return rows.map((row) => {
    const account = byId.get(row.accountId);
    const own = account !== undefined && typedNameOf(account) === row.name;
    const name = own ? accountDisplayName({ ...account, name: row.name }) : row.name;
    const words = own ? apart.get(row.accountId) : undefined;
    return words ? { ...row, name, typedName: row.name, tellApart: words } : { ...row, name, typedName: row.name };
  });
}
