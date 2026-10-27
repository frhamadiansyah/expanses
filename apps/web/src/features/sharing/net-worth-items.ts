import type { ReviewItem } from '@expanses/db';
import { SUBTYPE_LABELS } from '../../lib/account-types';

/*
 * The Shared list (Net worth page → Shared): every asset and debt of this person, one group per kind, each with a switch.
 * Pure, so the search, the grouping and the count are tested without a screen.
 */

export interface ItemKind {
  key: string;
  label: string;
  items: ReviewItem[];
}

/** Items by kind, in the order the kinds first appear: assets before liabilities, as Net worth reads. */
export function byKind(items: readonly ReviewItem[]): ItemKind[] {
  const drawers = new Map<string, ItemKind>();
  for (const item of [...items].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'asset' ? -1 : 1))) {
    const label = SUBTYPE_LABELS[item.subtype as keyof typeof SUBTYPE_LABELS] ?? 'Other';
    const drawer = drawers.get(item.subtype) ?? { key: item.subtype, label, items: [] };
    drawer.items.push(item);
    drawers.set(item.subtype, drawer);
  }
  return [...drawers.values()];
}

/** The kinds that still have a row whose name holds the query (case-insensitive); an empty query keeps all. */
export function filterKinds(kinds: readonly ItemKind[], query: string): ItemKind[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...kinds];
  return kinds.map((kind) => ({ ...kind, items: kind.items.filter((item) => item.name.toLowerCase().includes(needle)) })).filter((kind) => kind.items.length > 0);
}

/** How many of the items are shared: not in the set of private ids. */
export function sharedCount(items: readonly Pick<ReviewItem, 'accountId'>[], hidden: ReadonlySet<string>): number {
  return items.filter((item) => !hidden.has(item.accountId)).length;
}

/** The Shared row's value: "All 14" when nothing is private, "12 of 14" otherwise. */
export function sharedValue(shared: number, total: number): string {
  return shared === total ? `All ${total}` : `${shared} of ${total}`;
}

/** The ids of the private items, from stored settings. */
export function hiddenIds(items: readonly Pick<ReviewItem, 'accountId' | 'setting'>[]): string[] {
  return items.filter((item) => item.setting === 'hidden').map((item) => item.accountId);
}

/** Switches one item in a draft's private ids. */
export function withShared(hidden: readonly string[], accountId: string, shared: boolean): string[] {
  const without = hidden.filter((id) => id !== accountId);
  return shared ? without : [...without, accountId];
}

/**
 * A new asset or debt starts Shared whenever this person's net worth sharing is active (they are in the active group):
 * the add forms' Shared switch is shown then, and only then, and is on until turned off.
 */
export function newItemShared(inActiveGroup: boolean): boolean | null {
  return inActiveGroup ? true : null;
}
