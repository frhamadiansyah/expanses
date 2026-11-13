/**
 * The joint accounts as Cashflow's transfer rule reads them (owner 2026-11-13): the ones the holder made joint, every
 * pocket of one, and the account a joint pocket belongs to (with its other pockets). The switch is kept per account id
 * and a pocket made later has no row of its own; this reads, never writes. Display only.
 */
export function jointWithPockets(jointIds: ReadonlySet<string>, accounts: readonly { id: string; parentId: string | null }[]): ReadonlySet<string> {
  if (jointIds.size === 0) return jointIds;
  const parents = new Set<string>();
  for (const account of accounts) {
    if (!jointIds.has(account.id)) continue;
    parents.add(account.parentId ?? account.id);
  }
  const joint = new Set(jointIds);
  for (const account of accounts) {
    if (parents.has(account.id) || (account.parentId !== null && parents.has(account.parentId))) joint.add(account.id);
  }
  return joint;
}
