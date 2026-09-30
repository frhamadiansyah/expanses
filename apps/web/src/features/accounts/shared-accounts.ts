import type { AccountSubtype } from '@expanses/db';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { ownerRing, type ReceivedItem } from '../networth/joint-rows';

/*
 * Accounts' "Andi's, shared" (joint-net-worth §8.2): with separate tax IDs Net worth stays personal, and the other
 * members' shared items are listed here, one section a member, to see and open — never counted in any total.
 */

export interface SharedSection {
  owner: string;
  title: string;
  items: { itemId: string; name: string; kindLabel: string; minor: number; currency: string; ring: string | null }[];
}

export function sharedSections(mode: 'joint' | 'separate', members: readonly string[], names: Record<string, string>, items: readonly ReceivedItem[]): SharedSection[] {
  // With one tax ID the items are the household's Net worth itself, so they are not listed a second time here.
  if (mode === 'joint') return [];
  const sections: SharedSection[] = [];
  for (const owner of members) {
    const own = items.filter((item) => item.owner === owner);
    if (own.length === 0) continue;
    sections.push({
      owner,
      title: `${names[owner] ?? 'Someone'}'s, shared`,
      items: own.map((item) => ({
        itemId: item.itemId,
        name: item.name,
        kindLabel: SUBTYPE_LABELS[item.subtype as AccountSubtype] ?? item.subtype,
        minor: item.balanceMinor,
        currency: item.currency,
        ring: ownerRing(members, owner),
      })),
    });
  }
  return sections;
}
