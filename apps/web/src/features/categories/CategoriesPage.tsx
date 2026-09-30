import { categoryPath } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useAccounts, useInOpenBook } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { type CornerAction, InsetGroup, InsetRow, LargeTitle, SCREEN, SearchPill, SegmentedControl } from '../../ui/native';
import { pickerGroups } from '../transactions/CategoryPicker';
import { CategoryIcon } from './CategoryIcon';
import { useCategorySetMembership, useCategorySets } from './set-queries';
import { useCategoryActions } from './use-category-actions';

/**
 * One line of the tree, drawn as the picker draws it — icon, name, and a chevron, because the line is the way to
 * the category's own page. Nothing else rides on it: renaming, marking and archiving live on that page.
 */
function CategoryLine({ category, accounts, child }: { category: AccountRow; accounts: AccountRow[]; child: boolean }) {
  return (
    <Link
      to="/categories/$categoryId"
      params={{ categoryId: category.id }}
      title={categoryPath(accounts, category.id)}
      className={cx(
        'ph-focus-inset relative flex w-full items-center gap-3 text-left active:bg-[var(--ph-fill)]',
        child
          ? 'pl-[34px] before:absolute before:top-0 before:bottom-1/2 before:left-5 before:w-[10px] before:rounded-bl-lg before:border-b-[1.5px] before:border-l-[1.5px] before:border-[var(--ph-hair)]'
          : 'pl-[14px]',
      )}
    >
      <CategoryIcon categoryId={category.id} accounts={accounts} size={child ? 'sm' : 'md'} />
      <span className="ph-row-body flex min-h-[46px] min-w-0 flex-1 items-center gap-2 pr-[14px]">
        <span className={cx('min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]', !child && 'font-semibold')}>{category.name}</span>
        <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
          {'›'}
        </span>
      </span>
    </Link>
  );
}

/**
 * The Categories list: the same tree the category picker draws, one card per top-level category, every line a link
 * to that category's page. 🔍 in the corner swaps a search field into the title's row, as Cashflow's does, and it
 * narrows the tree the way the picker's does — by `pickerGroups`, so the two can never disagree about what a category list holds.
 */
export function CategoriesPage() {
  const { kind = 'expense' } = useSearch({ from: '/categories' });
  const navigate = useNavigate();
  const accounts = useAccounts().data ?? [];
  const membership = useCategorySetMembership().data ?? {};
  const inOpenBook = useInOpenBook();
  const sets = useCategorySets().data ?? [];
  const actions = useCategoryActions();
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  // The monthly tree only, and only the open book's: a set's categories are managed on the sets page.
  const groups = pickerGroups(accounts, kind, membership, inOpenBook, search);

  /* The primary action is a corner glyph at every width, not a dark rectangle beside the title. */
  const corner: CornerAction[] = [
    { key: 'add', label: 'Add category', glyph: <Plus size={22} aria-hidden />, run: () => actions.add(kind, null) },
    { key: 'search', label: 'Search', glyph: <Search size={20} aria-hidden />, pressed: searching, run: () => setSearching((was) => !was) },
  ];
  // Cashflow's search: the kit's pill drawn in the title's own row, so nothing below it moves when it opens.
  const searchField = (
    <SearchPill
      value={search}
      onChange={setSearch}
      onClose={() => {
        setSearch('');
        setSearching(false);
      }}
      placeholder="Search categories…"
      label="Search categories"
    />
  );

  return (
    <div className={SCREEN}>
      <LargeTitle title="Categories" actions={corner} field={searching ? searchField : undefined} />
      <SegmentedControl
        className="mb-[18px] md:max-w-xs"
        label="Which categories"
        segments={[
          { key: 'expense', label: 'Expense' },
          { key: 'income', label: 'Income' },
        ]}
        value={kind}
        onChange={(key) => void navigate({ to: '/categories', search: key === 'income' ? { kind: 'income' } : {}, replace: true })}
      />
      <ErrorBox error={actions.error} />

      <div className="flex w-full flex-col gap-[10px] md:max-w-2xl" data-testid="category-tree">
        {groups.map((group) => (
          <div
            key={group.root.id}
            className="overflow-hidden rounded-[18px] bg-[var(--ph-surface)] py-1 [&>*+*>.ph-row-body]:border-t-[0.5px] [&>*+*>.ph-row-body]:border-[var(--ph-hair)]"
          >
            <CategoryLine category={group.root} accounts={accounts} child={false} />
            {group.children.map((child) => (
              <CategoryLine key={child.id} category={child} accounts={accounts} child />
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="px-1 py-3 text-[15px] text-[var(--ph-ink-3)]">
            {search.trim() ? 'Nothing here by that name.' : `No ${kind} categories in this workspace yet.`}
          </p>
        )}
      </div>

      {kind === 'expense' && (
        <InsetGroup className="mt-[18px]" footer="Categories an event draws on, kept out of the list above.">
          <InsetRow title="Sets" value={sets.length} to="/categories/sets" />
        </InsetGroup>
      )}

    </div>
  );
}
