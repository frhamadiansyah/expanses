import type { AccountRow } from '@expanses/db';

/**
 * The categories a picker may offer: of this kind, still open, not part of a category set, and whatever else
 * the caller keeps — the open book alone for a form that records something, owner-wide for a card's rules.
 *
 * **One filter, read by every picker**, and there is no second. `CategoryOptions` and `CategoryPicker` each
 * carried their own copy of it and their own copy of the grouping below, which is how one bug came to live in
 * two places; `lib/queries.ts` then grew a third under the name `categoryChoices`, whose own docstring also
 * claimed every picker went through it, and the two had already drifted — it had no set-membership test, so
 * the desktop's in-place row editor offered categories belonging to an event that `CategoryPicker` hid, against
 * §6's "Set categories stay out … they belong to an event".
 *
 * `keep` is where a caller says which book it means. Two workspaces can hold copies of the same category —
 * same name, same path, different id — so a list that does not narrow by the open book shows two buttons
 * nothing on screen tells apart, and picking the other workspace's copy files this spending outside the
 * workspace it belongs to. `replaceTransaction` refuses that write; a refusal met *after* choosing is a list
 * that should never have offered the choice. Money accounts are deliberately never narrowed this way: one
 * bank account pays for every book.
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
