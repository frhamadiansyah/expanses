import { isUncategorisedKey } from '@expanses/core';
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
  /**
   * One set's categories **in place of** the monthly tree: spending recorded into an event that draws on a set is
   * recorded in the set's terms, so a renovation is filed under Flooring & Tiles and not under the weekly shop.
   * The rule the event page's own Add spending form kept, carried to the Add screen with it. Null is the tree.
   */
  setId: string | null = null,
): AccountRow[] {
  // Uncategorised is where "Choose later" files a transaction, never a category to choose: it is left out of every picker.
  const inScope = (a: AccountRow) => (setId ? membership[a.id] === setId : membership[a.id] === undefined);
  return accounts.filter((a) => a.kind === kind && a.archivedAt === null && inScope(a) && !isUncategorisedKey(a.systemKey) && keep(a));
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

/**
 * Whether a category may stand in Category while the spending is recorded into an event that draws on `setId`: one
 * of that set's own, as the picker offers then. With no set (null) anything may, so a form recording into an event
 * with no set — or into none — fills Category exactly as it always has.
 *
 * It is the question the picker's `inScope` asks, put for one category the form did not pick through the picker: a
 * guess from the note's history, or a note suggestion's category. A renovation's Add spending must not quietly file
 * "Indomaret" under the monthly Groceries because that is where the weekly shop went, when the set's list would never
 * have offered Groceries at all.
 */
export function fitsEventSet(categoryId: string, membership: Record<string, unknown>, setId: string | null): boolean {
  return !setId || membership[categoryId] === setId;
}

/**
 * The workspace an event's set categories are filed in, when the open one holds none of them — so an empty picker
 * can say where they are instead of looking like a set with nothing in it. Null when the open workspace offers some,
 * when the set has none at all, or when no workspace name is known for them (one workspace only: nothing to switch).
 *
 * A set belongs to one workspace's book (`fileSetCategoryTx`), and a form records into the open book only, so the
 * picker's `inOpenBook` is right to leave them out; it is the silence that was wrong.
 */
export function setCategoriesElsewhere(
  accounts: readonly AccountRow[],
  membership: Record<string, unknown>,
  setId: string | null,
  inOpenBook: (a: AccountRow) => boolean,
  workspaceOf: (categoryId: string) => string | null,
): string | null {
  if (!setId) return null;
  const inSet = offeredCategories(accounts, 'expense', membership, () => true, setId);
  if (inSet.length === 0 || inSet.some(inOpenBook)) return null;
  return inSet.map((a) => workspaceOf(a.id)).find((name) => !!name) ?? null;
}
