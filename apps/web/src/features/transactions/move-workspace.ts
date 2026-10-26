import type { AccountRow } from '@expanses/db';
import type { FormDraft } from './tx-form';

/** Each category's workspace, by category id. */
export type CategoryBooks = Readonly<Record<string, string>>;

/**
 * The copy of a category in another workspace: two workspaces hold copies of the same category under different ids.
 * The one with the same key first (a built-in category keeps it in every copy), else the one with the same name under
 * a parent of the same name, else the one with the same name. Null when the other workspace has none.
 */
export function categoryIn(categoryId: string, toBook: string, accounts: readonly AccountRow[], books: CategoryBooks): string | null {
  const from = accounts.find((account) => account.id === categoryId);
  if (!from) return null;
  if (books[categoryId] === toBook) return categoryId;
  const there = accounts.filter((account) => books[account.id] === toBook && account.kind === from.kind && !account.archivedAt);
  if (from.systemKey) {
    const keyed = there.find((account) => account.systemKey === from.systemKey);
    if (keyed) return keyed.id;
  }
  const name = (account: AccountRow | undefined) => account?.name.trim().toLowerCase() ?? '';
  const parentName = (account: AccountRow) => name(accounts.find((each) => each.id === account.parentId));
  const named = there.filter((account) => name(account) === name(from));
  return (named.find((account) => parentName(account) === parentName(from)) ?? named[0])?.id ?? null;
}

/**
 * A saved transaction's draft re-filed in another workspace: its category, or each line of its split, swapped for the
 * copy there. `missing` names the categories with no copy — a lone category goes back to unchosen for the form to
 * ask; a split with one missing cannot move as it is.
 */
export function draftIn(
  draft: FormDraft,
  toBook: string,
  accounts: readonly AccountRow[],
  books: CategoryBooks,
): { draft: FormDraft; missing: string[] } {
  const nameOf = (id: string) => accounts.find((account) => account.id === id)?.name ?? 'a category';
  const missing: string[] = [];
  const swap = (id: string) => {
    if (!id) return '';
    const there = categoryIn(id, toBook, accounts, books);
    if (!there) missing.push(nameOf(id));
    return there ?? '';
  };
  return {
    // A transfer's fee category is spending too, and a card top-up's Top-ups: each is swapped for its copy there (a Top-ups with none there is not missing: the save makes it). A transfer
    // with no fee has neither, and the fee's copy being missing is said, not left to file the fee in the old workspace.
    draft: { ...draft, categoryId: swap(draft.categoryId), ...(draft.mode === 'transfer' && draft.feeCategoryId ? { feeCategoryId: swap(draft.feeCategoryId) } : {}), ...(draft.topUpCategoryId ? { topUpCategoryId: categoryIn(draft.topUpCategoryId, toBook, accounts, books) ?? '' } : {}), splits: draft.splits.map((split) => ({ ...split, categoryId: swap(split.categoryId) })) },
    missing,
  };
}
