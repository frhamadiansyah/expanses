import { type ReceivedItem, memberName } from './joint-rows';

/*
 * What the other members share, as the Assets page lists it: their assets only (a shared card or loan is a debt and
 * belongs to Net worth's debts), read-only, grouped under "Shared by <Name>". Only items the owner agreed to share
 * ever reach `items` (nw_items); this never reads another account. Pure, so the page only draws it.
 */

export interface SharedAssetGroup {
  owner: string;
  /** "Shared by Rina". */
  header: string;
  items: { itemId: string; name: string; currency: string; balanceMinor: number }[];
}

/** The assets of members other than `me`, one group per owner in the group's member order, each sorted by name. */
export function sharedAssetGroups(
  shared: { group: { me: string; members: readonly string[] }; items: readonly ReceivedItem[]; names: Record<string, string> } | null,
): SharedAssetGroup[] {
  if (!shared) return [];
  const owners = shared.group.members.filter((member) => member !== shared.group.me);
  return owners
    .map((owner) => ({
      owner,
      header: `Shared by ${memberName(shared.names, owner)}`,
      items: shared.items
        .filter((item) => item.owner === owner && item.kind === 'asset')
        .map((item) => ({ itemId: item.itemId, name: item.name, currency: item.currency, balanceMinor: item.balanceMinor }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.items.length > 0);
}
