import { type RingColour, sheetSectionOf } from '@expanses/core';
import type { AccountSubtype } from '@expanses/db';
import type { LucideIcon } from 'lucide-react';
import { assetKindTile, debtKindTile } from '../ownables/catalogue-view';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { ownerRing, receivedDebtIcon, type ReceivedItem } from '../networth/joint-rows';
import { debtKind, rowKindOf } from '../networth/sheet-drawers';

/*
 * Accounts' "Andi's, shared" (joint-net-worth §8.2): with separate tax IDs Net worth stays personal, and the other
 * members' shared items are listed here, one section a member, to see and open — never counted in any total.
 */

export interface SharedSection {
  owner: string;
  title: string;
  /** The owner's name, for what a screen reader hears of each row. */
  ownerName: string;
  /** The ring each row's circle wears (`ownerRing`): the owner's colour, the same on both phones. */
  ring: string | null;
  items: { itemId: string; name: string; kindLabel: string; minor: number; currency: string; tile: LucideIcon }[];
}

/** `rings`: each member's ring colour (`useOwnerRings`); empty while it loads, and the rows are drawn without one. */
export function sharedSections(
  mode: 'joint' | 'separate',
  members: readonly string[],
  names: Record<string, string>,
  items: readonly ReceivedItem[],
  rings: Readonly<Record<string, RingColour>> = {},
): SharedSection[] {
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
      ring: ownerRing(rings, owner),
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

/**
 * The drawing the item's kind wears on Net worth, so the same item looks the same on both pages (D12): read off the
 * same facts its row is filed by — its subtype and, when its owner's phone sent them, its `sheet` facts — so gold wears
 * gold's drawing and a home loan a house's, on its row and on its page alike.
 */
export function itemTile(item: Pick<ReceivedItem, 'kind' | 'subtype' | 'sheet'>): LucideIcon {
  if (item.kind === 'liability') return debtKindTile(debtKind(item.sheet?.item ?? null, receivedDebtIcon(item)).key);
  const code = item.sheet?.code ?? null;
  const section = sheetSectionOf({ code, subtype: item.subtype });
  return assetKindTile(section, rowKindOf(section, { accountId: '', code }, () => (item.subtype in SUBTYPE_LABELS ? (item.subtype as AccountSubtype) : undefined)).key);
}
