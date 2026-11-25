import type { AccountRow, AssetProfileRow } from '@expanses/db';
import { brokerNameOf } from '../../lib/account-name';

/** The money accounts an institution is named by: a bank, savings, a deposit, a broker's cash. */
const AT_AN_INSTITUTION = new Set(['bank', 'savings', 'time_deposit', 'fund']);

/** The money accounts that are their institution: a broker. */
const NAMED_BY_ITSELF = new Set(['fund']);

/**
 * The institution a money account is at: its bank's name as the account keeps it (the kas row's Nama institusi), else
 * its own name. A broker's cash is named by its broker — its institution field names the custodian bank instead.
 */
export function institutionOf(account: Pick<AccountRow, 'name' | 'subtype' | 'typedName'>, profile: Pick<AssetProfileRow, 'coretaxFields'> | undefined): string {
  if (account.subtype === 'fund') return brokerNameOf(account);
  return profile?.coretaxFields.inst?.trim() || account.name;
}

/**
 * Every institution a bond or fund may be held at, by name: those the money accounts are at, and those already named
 * on a holding. One of each, whatever its case, in alphabetical order. A bank, savings or deposit account offers its
 * bank only once its Nama institusi names one — never its own name, which read as the account itself (owner, 23 Oct):
 * Held at is a name, not a link to an account. A broker is its own institution, so its name stands; a digital wallet is never offered (owner, 23 Oct).
 */
export function institutionChoices(accounts: readonly AccountRow[], profiles: readonly AssetProfileRow[]): string[] {
  const profileOf = new Map(profiles.map((profile) => [profile.accountId, profile]));
  const names = [
    ...accounts
      .filter((a) => a.kind === 'asset' && AT_AN_INSTITUTION.has(a.subtype) && a.parentId === null && a.archivedAt === null)
      .map((a) => (NAMED_BY_ITSELF.has(a.subtype) ? brokerNameOf(a) : (profileOf.get(a.id)?.coretaxFields.inst?.trim() ?? ''))),
    ...profiles.filter((p) => p.assetKind === 'fund' || p.assetKind === 'bond').map((p) => p.coretaxFields.inst?.trim() ?? ''),
  ].filter((name) => name !== '');
  const byKey = new Map<string, string>();
  for (const name of names) if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/** Whether two institution names are the same place, whatever their case or spacing. */
export const sameInstitution = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a?.trim()) && a!.trim().toLowerCase() === b?.trim().toLowerCase();
