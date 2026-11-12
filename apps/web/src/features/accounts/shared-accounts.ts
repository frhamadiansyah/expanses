import { sheetSectionOf } from '@expanses/core';
import type { AccountSubtype } from '@expanses/db';
import type { LucideIcon } from 'lucide-react';
import { assetKindTile, debtKindTile } from '../ownables/catalogue-view';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { ownerRing, type ReceivedItem } from '../networth/joint-rows';

/*
 * Accounts' "Andi's, shared" (joint-net-worth §8.2): with separate tax IDs Net worth stays personal, and the other
 * members' shared items are listed here, one section a member, to see and open — never counted in any total.
 */

export interface SharedSection {
  owner: string;
  title: string;
    /** The owner's name, for the initial each row wears and what a screen reader hears. */
  ownerName: string;
  /** The owner's colour (`ownerRing`): the initial's ground, the same on both phones. */
  colour: string | null;
  items: { itemId: string; name: string; kindLabel: string; minor: number; currency: string; tile: LucideIcon }[];
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
      ownerName: names[owner] ?? 'Someone',
      colour: ownerRing(members, owner),
      items: own.map((item) => ({
        itemId: item.itemId,
        name: item.name,
        kindLabel: SUBTYPE_LABELS[item.subtype as AccountSubtype] ?? item.subtype,
        minor: item.balanceMinor,
        currency: item.currency,
        tile: itemTile(item),
      })),
    });
  }
  return sections;
}

/** The drawing the item's kind wears on Net worth, so the same item looks the same on both pages (D12). */
export function itemTile(item: Pick<ReceivedItem, 'kind' | 'subtype'>): LucideIcon {
  if (item.kind === 'liability') return debtKindTile(item.subtype === 'credit_card' || item.subtype === 'payable' ? item.subtype : 'other_loans');
  return assetKindTile(sheetSectionOf({ code: null, subtype: item.subtype }), item.subtype);
}
