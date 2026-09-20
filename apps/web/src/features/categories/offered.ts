import type { AccountRow } from '@expanses/db';

/**
 * The categories a picker may offer: of this kind, still open, not part of a category set, and whatever else
 * the caller keeps — the open book alone for a form that records something, owner-wide for a card's rules.
 *
 * One filter, read by every picker. `CategoryOptions` and `CategoryPicker` each carried their own copy of it
 * and their own copy of the grouping below, which is how one bug came to live in two places.
 */
export function offeredCategories(
  accounts: readonly AccountRow[],
  kind: 'expense' | 'income',
  membership: Record<string, unknown>,
  keep: (a: AccountRow) => boolean,
): AccountRow[] {
  return accounts.filter((a) => a.kind === kind && a.archivedAt === null && membership[a.id] === undefined && keep(a));
}

/**
 * Those categories the way a tree reads: each root, then what hangs off it.
 *
 * A child whose parent is not itself offered stands as its own root. Grouping strictly under parents dropped
 * such a child from the list altogether — put a parent in a category set, or archive it, and a child that
 * passed every test of its own became unreachable because of its parent's state. Nothing a picker may offer
 * is hidden by something it may not.
 */
export function categoryGroups(offered: readonly AccountRow[]): { root: AccountRow; children: AccountRow[] }[] {
  const ids = new Set(offered.map((a) => a.id));
  return offered
    .filter((a) => a.parentId === null || !ids.has(a.parentId))
    .map((root) => ({ root, children: offered.filter((a) => a.parentId === root.id) }));
}
