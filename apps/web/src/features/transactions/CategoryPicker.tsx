import { categoryPath } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { Menu, Plus } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInOpenBook } from '../../lib/queries';
import { cx, Input } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { categoryGroups, offeredCategories } from '../categories/offered';
import { useCategorySetMembership } from '../categories/set-queries';
import { NewCategorySheet } from './NewCategorySheet';

/** One top-level category and what hangs off it — the card the picker draws per root. */
export interface PickerGroup {
  root: AccountRow;
  children: AccountRow[];
}

/**
 * The categories a picker may offer, as a tree: each root, then what hangs off it.
 *
 * The filter and the grouping are `offered.ts`'s, shared with `CategoryOptions` — of this kind, still open, not
 * part of a category set, and filed in the **open book**, because a picker that skips `inOpenBook` offers two
 * buttons nothing on screen tells apart and files this spending in the workspace it does not belong to.
 *
 * `search` narrows on the whole path, so typing "food" keeps everything under Food and beverage and typing
 * "boba" keeps Boba alone. The narrowing happens **before** the grouping on purpose: `categoryGroups` lets a
 * child whose parent is not itself offered stand as its own root, so a search that matches only a child still
 * shows that child rather than hiding it under a parent that was filtered away.
 */
export function pickerGroups(
  accounts: AccountRow[],
  kind: 'expense' | 'income',
  membership: Record<string, unknown>,
  inOpenBook: (a: AccountRow) => boolean,
  search = '',
): PickerGroup[] {
  const offered = offeredCategories(accounts, kind, membership, inOpenBook);
  const wanted = search.trim().toLowerCase();
  const matching = wanted ? offered.filter((a) => categoryPath(accounts, a.id).toLowerCase().includes(wanted)) : offered;
  return categoryGroups(matching);
}

/** One row of the tree: the icon, the name, and the whole path as its `title`. */
function CategoryButton({
  category,
  accounts,
  chosen,
  child,
  onPick,
}: {
  category: AccountRow;
  accounts: AccountRow[];
  chosen: boolean;
  /** Indented, with the elbow line the mockup draws, when it hangs off the root above it. */
  child: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={chosen ? 'true' : undefined}
      onClick={onPick}
      title={categoryPath(accounts, category.id)}
      className={cx(
        'relative flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm hover:bg-slate-50',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900',
        child
          ? 'pl-9 before:absolute before:top-0 before:left-5 before:h-1/2 before:w-3 before:border-b before:border-l before:border-slate-200'
          : 'font-medium',
      )}
    >
      <CategoryIcon categoryId={category.id} accounts={accounts} size="xs" />
      <span className="min-w-0 flex-1 truncate">{category.name}</span>
    </button>
  );
}

/**
 * Choosing a category, for every screen that files one: the form's Category row, the edit sheet's, and the
 * list's category gesture.
 *
 * B7's tree — one card per top-level category, its children indented under it, a search pill at the foot and
 * **+ New category** at the head. Tapping a parent picks the parent: "Food and beverage" is a real answer, not
 * a heading, and a tree that only let leaves be chosen would take that answer away.
 *
 * One component, three ways in. The card, the row and the edit sheet each open this and none of them was
 * touched to give them the tree — which is the point: a second picker is a second place for the workspace
 * filter to be forgotten, and forgetting it files one workspace's spending in another.
 *
 * A button's accessible name is the category's own name and the whole path is its `title`: a name reading
 * "Restaurants Food and beverage › Restaurants" is a name nobody can ask for, by voice or in a test.
 */
export function CategoryPicker({
  kind,
  lockKind = false,
  title = 'Select category',
  value,
  onPick,
  onClose,
}: {
  /** The tab the form is on, which is the kind the sheet opens showing. */
  kind: 'expense' | 'income';
  /**
   * Hide the Expense / Income control and offer `kind` alone. The list's category gesture re-files a purchase
   * through `expenseLines`, so an income category there would post a purchase against an income account: a
   * choice the sheet must not offer rather than a save that has to refuse it afterwards.
   */
  lockKind?: boolean;
  /** What the sheet is called. The list's gesture names the purchase being re-filed; a form just picks one. */
  title?: string;
  value?: string;
  onPick: (categoryId: string) => void;
  onClose: () => void;
}) {
  const accounts = useAccounts().data ?? [];
  const membership = useCategorySetMembership().data ?? {};
  const inOpenBook = useInOpenBook();
  const [showing, setShowing] = useState<'expense' | 'income'>(kind);
  const [search, setSearch] = useState('');
  const [making, setMaking] = useState(false);
  const groups = pickerGroups(accounts, showing, membership, inOpenBook, search);
  // What a new category may be filed under: the roots this picker itself offers, of the kind it is showing.
  const parents = pickerGroups(accounts, showing, membership, inOpenBook).map((group) => group.root);

  const choose = (categoryId: string) => {
    onPick(categoryId);
    onClose();
  };

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          {!lockKind ? (
            <div role="group" aria-label="Kind" className="inline-flex gap-0.5 rounded-lg bg-slate-200 p-0.5">
              {(['expense', 'income'] as const).map((which) => (
                <button
                  key={which}
                  type="button"
                  aria-pressed={showing === which}
                  onClick={() => setShowing(which)}
                  className={cx('rounded-md px-3 py-1 text-sm font-medium', showing === which ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}
                >
                  {which === 'expense' ? 'Expense' : 'Income'}
                </button>
              ))}
            </div>
          ) : (
            <span />
          )}
          {/* The way to the whole tree, for what this sheet is deliberately too small for: renaming, archiving,
              a category's card MCC, the sets. It closes the sheet on its way, since it leaves the screen. */}
          <Link
            to="/categories"
            onClick={onClose}
            aria-label="Manage categories"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
          >
            <Menu size={18} aria-hidden />
          </Link>
        </div>

        {/* First, and green: making the category you meant is the answer when none of the rows below is. */}
        <button
          type="button"
          onClick={() => setMaking(true)}
          className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
        >
          <Plus size={18} aria-hidden className="shrink-0" />
          New category
        </button>

        {groups.map((group) => (
          <div key={group.root.id} className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
            <CategoryButton category={group.root} accounts={accounts} chosen={group.root.id === value} child={false} onPick={() => choose(group.root.id)} />
            {group.children.map((child) => (
              <CategoryButton key={child.id} category={child} accounts={accounts} chosen={child.id === value} child onPick={() => choose(child.id)} />
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="px-1 py-3 text-sm text-slate-500">
            {search.trim() ? 'Nothing here by that name.' : 'No categories in this workspace yet.'}
          </p>
        )}

        {/* The pill rides the foot of the sheet, so a long tree can be narrowed without scrolling back up. */}
        <div className="sticky bottom-0 -mx-4 bg-white/90 px-4 pt-2 pb-1 backdrop-blur">
          <Input aria-label="Search categories" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="rounded-full" />
        </div>
      </div>

      {making && (
        <NewCategorySheet
          kind={showing}
          parents={parents}
          onCreated={(categoryId) => choose(categoryId)}
          onClose={() => setMaking(false)}
        />
      )}
    </Sheet>
  );
}
