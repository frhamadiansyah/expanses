import { categoryPath } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInOpenBook } from '../../lib/queries';
import { cx } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useCategorySetMembership } from '../categories/set-queries';

/**
 * The categories a picker may offer, in the order a tree reads: each root, then what hangs off it.
 *
 * The filter is `CategoryOptions`' own — of this kind, still open, not part of a category set, and filed in the
 * **open book** — because a picker that skips `inOpenBook` offers two buttons nothing on screen tells apart and
 * files this spending in the workspace it does not belong to. Exported so the test can walk the same order the
 * sheet draws.
 */
export function pickerCategories(
  accounts: readonly AccountRow[],
  kind: 'expense' | 'income',
  membership: Record<string, unknown>,
  inOpenBook: (a: AccountRow) => boolean,
): AccountRow[] {
  const offered = accounts.filter((a) => a.kind === kind && a.archivedAt === null && membership[a.id] === undefined && inOpenBook(a));
  return offered.filter((a) => a.parentId === null).flatMap((root) => [root, ...offered.filter((a) => a.parentId === root.id)]);
}

/**
 * Choosing a category, for every screen that files one.
 *
 * The plain version: the kind on a segmented control, and a button per category. **Task 16 grows this same
 * file** into B7's tree of cards, the search pill and + New category — one component in two sizes, so the
 * list's category gesture, the Add card and the edit sheet never drift into three different pickers.
 *
 * A button's accessible name is the category's own name and the whole path is its `title`, exactly as the
 * list's category sheet already does it: a name reading "Restaurants Food and beverage › Restaurants" is a
 * name nobody can ask for, by voice or in a test.
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
  const categories = pickerCategories(accounts, showing, membership, inOpenBook);

  return (
    <Sheet title={title} onClose={onClose}>
      {!lockKind && (
        <div role="group" aria-label="Kind" className="mb-3 inline-flex gap-0.5 rounded-lg bg-slate-200 p-0.5">
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
      )}
      <ul className="-mx-1 divide-y divide-slate-100">
        {categories.map((category) => (
          <li key={category.id}>
            <button
              type="button"
              aria-current={category.id === value ? 'true' : undefined}
              onClick={() => {
                onPick(category.id);
                onClose();
              }}
              title={categoryPath(accounts, category.id)}
              className="flex min-h-11 w-full items-center gap-3 px-1 text-left text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
            >
              <CategoryIcon categoryId={category.id} accounts={accounts} size="xs" />
              <span className="min-w-0 flex-1 truncate">{category.name}</span>
              <span aria-hidden className="truncate text-xs text-slate-400">
                {categoryPath(accounts, category.id)}
              </span>
            </button>
          </li>
        ))}
        {categories.length === 0 && <li className="px-1 py-3 text-sm text-slate-500">No categories in this workspace yet.</li>}
      </ul>
    </Sheet>
  );
}
