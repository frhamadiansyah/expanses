import { categoryPath } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetSearchButton } from '../../app/Sheet';
import { useAccounts, useInOpenBook } from '../../lib/queries';
import { cx } from '../../ui';
import { SearchPill, SegmentedControl } from '../../ui/native';
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
        'ph-focus-inset relative flex w-full items-center gap-3 text-left active:bg-[var(--ph-fill)]',
        // B7's elbow: a child hangs off the root above it by a line that turns into the row.
        child
          ? 'pl-[34px] before:absolute before:top-0 before:bottom-1/2 before:left-5 before:w-[10px] before:rounded-bl-lg before:border-b-[1.5px] before:border-l-[1.5px] before:border-[var(--ph-hair)]'
          : 'pl-[14px]',
      )}
    >
      <CategoryIcon categoryId={category.id} accounts={accounts} size={child ? 'sm' : 'md'} />
      <span className="ph-row-body flex min-h-[46px] min-w-0 flex-1 items-center gap-2 pr-[14px]">
        <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">{category.name}</span>
        {chosen && <Check size={18} aria-hidden className="shrink-0 text-[var(--ph-tint)]" />}
      </span>
    </button>
  );
}

/**
 * Choosing a category, for every screen that files one: the form's Category row, the edit sheet's, and the
 * list's category gesture.
 *
 * B7's tree — one card per top-level category, its children indented under it, ⌕ in the header for a search and
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
  // ⌕ in the header opens the search in the tabs' row, the same as Paid with: no field on the list until asked for.
  const [finding, setFinding] = useState(false);
  const [making, setMaking] = useState(false);
  const groups = pickerGroups(accounts, showing, membership, inOpenBook, search);
  // What a new category may be filed under: the roots this picker itself offers, of the kind it is showing.
  const parents = pickerGroups(accounts, showing, membership, inOpenBook).map((group) => group.root);

  const choose = (categoryId: string) => {
    onPick(categoryId);
    onClose();
  };

  const searchField = (
    <SearchPill
      value={search}
      onChange={setSearch}
      onClose={() => {
        setSearch('');
        setFinding(false);
      }}
      placeholder="Search"
      label="Search categories"
    />
  );

  return (
    <Sheet
      grouped
      title={title}
      onClose={onClose}
      closeHidden={finding}
      heading={lockKind && finding ? searchField : undefined}
      action={
        <SheetSearchButton
          open={finding}
          onClick={() => {
            if (finding) setSearch('');
            setFinding((was) => !was);
          }}
        />
      }
    >
      <div className="flex flex-col gap-[10px]">
        {/* The tabs and the search that replaces them share one fixed 44 px row, so nothing below moves. With no
            tabs (a sheet locked to one kind), the search takes the title's place in the header instead. */}
        {!lockKind && (
          <div className="flex h-11 items-center">
            {finding ? (
              <div className="w-full">{searchField}</div>
            ) : (
              <SegmentedControl
                className="w-full"
                label="Kind"
                segments={[
                  { key: 'expense', label: 'Expense' },
                  { key: 'income', label: 'Income' },
                ]}
                value={showing}
                onChange={(key) => setShowing(key as 'expense' | 'income')}
              />
            )}
          </div>
        )}

        {/* First, and green: making the category you meant is the answer when none of the rows below is. */}
        <button
          type="button"
          onClick={() => setMaking(true)}
          className="ph-focus flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[var(--ph-surface)] text-[15px] font-semibold text-[var(--ph-tint)] active:bg-[var(--ph-fill)]"
        >
          <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ph-tint)] text-[var(--ph-surface)]">
            <Plus size={14} strokeWidth={3} />
          </span>
          New category
        </button>

        {groups.map((group) => (
          <div
            key={group.root.id}
            className="overflow-hidden rounded-[18px] bg-[var(--ph-surface)] py-1 [&>*+*>.ph-row-body]:border-t-[0.5px] [&>*+*>.ph-row-body]:border-[var(--ph-hair)]"
          >
            <CategoryButton category={group.root} accounts={accounts} chosen={group.root.id === value} child={false} onPick={() => choose(group.root.id)} />
            {group.children.map((child) => (
              <CategoryButton key={child.id} category={child} accounts={accounts} chosen={child.id === value} child onPick={() => choose(child.id)} />
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="px-1 py-3 text-[15px] text-[var(--ph-ink-3)]">
            {search.trim() ? 'Nothing here by that name.' : 'No categories in this workspace yet.'}
          </p>
        )}

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
