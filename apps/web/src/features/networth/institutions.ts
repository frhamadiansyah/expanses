import type { AccountRow, AssetProfileRow } from '@expanses/db';

/** The money accounts an institution is named by: a bank, savings, a deposit, a wallet, a broker's cash. */
const AT_AN_INSTITUTION = new Set(['bank', 'savings', 'time_deposit', 'ewallet', 'fund']);

/**
 * The institution a money account is at: its bank's name as the account keeps it (the kas row's Nama institusi), else
 * its own name. A broker's cash is named by its broker — its institution field names the custodian bank instead.
 */
export function institutionOf(account: Pick<AccountRow, 'name' | 'subtype'>, profile: Pick<AssetProfileRow, 'coretaxFields'> | undefined): string {
  if (account.subtype === 'fund') return account.name;
  return profile?.coretaxFields.inst?.trim() || account.name;
}

/**
 * Every institution a bond or fund may be held at, by name: those the money accounts are at, and those already named
 * on a holding. One of each, whatever its case, in alphabetical order.
 */
export function institutionChoices(accounts: readonly AccountRow[], profiles: readonly AssetProfileRow[]): string[] {
  const profileOf = new Map(profiles.map((profile) => [profile.accountId, profile]));
  const names = [
    ...accounts
      .filter((a) => a.kind === 'asset' && AT_AN_INSTITUTION.has(a.subtype) && a.parentId === null && a.archivedAt === null)
      .map((a) => institutionOf(a, profileOf.get(a.id))),
    ...profiles.filter((p) => p.assetKind === 'fund' || p.assetKind === 'bond').map((p) => p.coretaxFields.inst?.trim() ?? ''),
  ].filter((name) => name !== '');
  const byKey = new Map<string, string>();
  for (const name of names) if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/** Whether two institution names are the same place, whatever their case or spacing. */
export const sameInstitution = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a?.trim()) && a!.trim().toLowerCase() === b?.trim().toLowerCase();
