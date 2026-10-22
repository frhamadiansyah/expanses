import { categoryPath } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { Check, ChevronRight, Shapes, Split } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetAddButton, SheetSearchButton } from '../../app/Sheet';
import { useAccounts, useInOpenBook } from '../../lib/queries';
import { cx } from '../../ui';
import { SearchPill, SegmentedControl } from '../../ui/native';
import { CategoryIcon, ICONS } from '../categories/CategoryIcon';
import { categoryGroups, offeredCategories, setCategoriesElsewhere } from '../categories/offered';
import { useCategorySetMembership } from '../categories/set-queries';
import { useCategoryWorkspaces } from '../workspaces/queries';
import { RowGlyph } from './FormRow';
import { useNewCategoryForm } from './NewCategorySheet';
import { useShareCategoryIds } from './queries';

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
  /** An event's set, offered in place of the monthly tree (`offeredCategories`). */
  setId: string | null = null,
): PickerGroup[] {
  const offered = offeredCategories(accounts, kind, membership, inOpenBook, setId);
  const wanted = search.trim().toLowerCase();
  const matching = wanted ? offered.filter((a) => categoryPath(accounts, a.id).toLowerCase().includes(wanted)) : offered;
  return categoryGroups(matching);
}

/** A shared event's own category (shared events §6): the event's list, not a workspace's tree. */
export interface EventCategoryChoice {
  categoryId: string;
  name: string;
  icon: string | null;
  archived: boolean;
}

/** The drawing an event category was given, from the same bundled set the tree's categories draw from. */
export function EventCategoryGlyph({ icon }: { icon: string | null }) {
  const Icon = (icon ? ICONS[icon] : undefined) ?? Shapes;
  return (
    <RowGlyph>
      <Icon size={15} />
    </RowGlyph>
  );
}

/**
 * The picker in a shared event: one card of the event's categories, "No category" first — an expense may have none,
 * and is then filed under the event's own "Shared spending". No tabs (no event holds income), no New category and no
 * Manage categories: an event's categories are its people's, kept on the event, never a workspace's tree.
 */
function EventCategoryList({ categories, value, onPick }: { categories: readonly EventCategoryChoice[]; value: string; onPick: (categoryId: string) => void }) {
  // One already on the expense stays offered after it is archived, so the row never reads blank; nothing else archived.
  const offered = categories.filter((c) => !c.archived || c.categoryId === value);
  const row = (categoryId: string, name: string, icon: string | null) => (
    <button
      key={categoryId || 'none'}
      type="button"
      aria-current={categoryId === value ? 'true' : undefined}
      onClick={() => onPick(categoryId)}
      className="ph-focus-inset relative flex w-full items-center gap-3 pl-[14px] text-left active:bg-[var(--ph-fill)]"
    >
      <EventCategoryGlyph icon={icon} />
      <span className="ph-row-body flex min-h-[46px] min-w-0 flex-1 items-center gap-2 pr-[14px]">
        <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">{name}</span>
        {categoryId === value && <Check size={18} aria-hidden className="shrink-0 text-[var(--ph-tint)]" />}
      </span>
    </button>
  );
  return (
    <div className="overflow-hidden rounded-[18px] bg-[var(--ph-surface)] py-1 [&>*+*>.ph-row-body]:border-t-[0.5px] [&>*+*>.ph-row-body]:border-[var(--ph-hair)]">
      {row('', 'No category', null)}
      {offered.map((c) => row(c.categoryId, c.name, c.icon))}
    </div>
  );
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
 * Choosing a category, for every screen that files one: the form's Category row and the list's category gesture.
 *
 * B7's tree — one card per top-level category, its children indented under it, ⌕ in the header for a search and
 * **＋** in the header makes a new category. Tapping a parent picks the parent: "Food and beverage" is a real answer, not
 * a heading, and a tree that only let leaves be chosen would take that answer away.
 *
 * One component, every way in. The card and the row each open this and neither was
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
  setId = null,
  eventCategories,
  onPick,
  onClose,
  onSplit,
  splitRefusal = null,
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
  /**
   * The set of the event the spending is being recorded into, when it draws on one: its categories are offered in
   * place of the monthly tree, for spending only — no set holds income.
   */
  setId?: string | null;
  /** A shared event's categories, offered in place of every workspace category (shared events §6, R14). */
  eventCategories?: readonly EventCategoryChoice[];
  onPick: (categoryId: string) => void;
  onClose: () => void;
  /**
   * Splitting the amount between several categories, offered as the list's first row while spending is shown: the
   * one place a purchase's category is chosen is also where it is chosen several times. Left out where the form
   * cannot carry a split (income, a captured draft, an edit of a shared purchase).
   */
  onSplit?: () => void;
  /** Why a split cannot be taken now — With already names people — shown under the row, which is then greyed. */
  splitRefusal?: string | null;
}) {
  const accounts = useAccounts().data ?? [];
  const membership = useCategorySetMembership().data ?? {};
  const inBook = useInOpenBook();
  /*
   * A shared event's own copies of its categories (`event_category_accounts`) are expense accounts filed in no book.
   * The open book's list already leaves them out once it is read; this keeps them out before it is, and with no book
   * open, so a trip's "Dinners" is never offered as one of this workspace's categories.
   */
  const shareIds = useShareCategoryIds();
  const inOpenBook = (a: AccountRow) => inBook(a) && !shareIds.has(a.id);
  const [showing, setShowing] = useState<'expense' | 'income'>(kind);
  const [search, setSearch] = useState('');
  // ⌕ in the header opens the search in the tabs' row, the same as Paid with: no field on the list until asked for.
  const [finding, setFinding] = useState(false);
  const [making, setMaking] = useState(false);
  const set = showing === 'expense' ? setId : null;
  const groups = pickerGroups(accounts, showing, membership, inOpenBook, search, set);
  // An event's set is filed in one workspace's book; opened from another, the list is empty, and says where they are.
  const workspaceOf = useCategoryWorkspaces();
  const setElsewhere = groups.length === 0 && !search.trim() ? setCategoriesElsewhere(accounts, membership, set, inOpenBook, workspaceOf) : null;
  // What a new category may be filed under: the monthly tree's roots of the kind it is showing. A category made here
  // is a monthly one whichever list is open — a set is added to on its own page — so its parents are the tree's.
  const parents = pickerGroups(accounts, showing, membership, inOpenBook).map((group) => group.root);

  const choose = (categoryId: string) => {
    onPick(categoryId);
    onClose();
  };
  // New category is a step this sheet moves to, not a sheet stacked on it.
  const newCategory = useNewCategoryForm({ kind: showing, parents, onCreated: (categoryId) => choose(categoryId) });

  const searchField = (
    <SearchPill
      value={search}
      onChange={setSearch}
      onClose={() => {
        setSearch('');
        setFinding(false);
      }}
      compact
      placeholder="Search"
      label="Search categories"
    />
  );

  if (eventCategories) {
    return (
      <Sheet grouped tall title={title} onClose={onClose}>
        <EventCategoryList categories={eventCategories} value={value ?? ''} onPick={choose} />
      </Sheet>
    );
  }

  // One sheet for the list and for New category, so moving between them keeps whatever detent it was left at.
  const stepBack = () => setMaking(false);
  return (
    <Sheet
      grouped
      tall
      title={making ? (newCategory.choosingLook ? 'Icon and colour' : `New ${showing} category`) : title}
      onClose={making ? (newCategory.choosingLook ? newCategory.closeLook : stepBack) : onClose}
      {...(making
        ? newCategory.choosingLook
          ? // The look is chosen as it is tapped; ✓ and ‹ both return to the form with it.
            { back: { label: `New ${showing} category`, run: newCategory.closeLook }, confirm: { label: 'Done', run: newCategory.closeLook } }
          : { back: { label: title, run: stepBack }, confirm: { label: 'Save', disabled: !newCategory.canSave, run: newCategory.save } }
        : {
            closeHidden: finding,
            heading: lockKind && finding ? searchField : undefined,
            action: (
              <>
                {/* Making the category you meant, when none of the rows is it: in the corner, out of the list's way. */}
                {!finding && (
                  <SheetAddButton
                    label="New category"
                    onClick={() => {
                      newCategory.reset();
                      setMaking(true);
                    }}
                  />
                )}
                <SheetSearchButton
                  open={finding}
                  onClick={() => {
                    if (finding) setSearch('');
                    setFinding((was) => !was);
                  }}
                />
              </>
            ),
          })}
    >
      {making ? newCategory.view : (
      <div className="flex flex-col gap-[10px]">
        {/* The tabs and the search that replaces them share one fixed 32 px row, so nothing below moves. With no
            tabs (a sheet locked to one kind), the search takes the title's place in the header instead. */}
        {!lockKind && (
          <div className="flex h-8 items-center">
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


        {onSplit && showing === 'expense' && !search.trim() && (
          <div className="overflow-hidden rounded-[18px] bg-[var(--ph-surface)] py-1">
            <button
              type="button"
              disabled={!!splitRefusal}
              onClick={onSplit}
              className="ph-focus flex min-h-11 w-full items-center gap-[10px] px-[10px] text-left disabled:opacity-50"
            >
              <RowGlyph>
                <Split size={15} />
              </RowGlyph>
              <span className="min-w-0 flex-1 py-[6px]">
                <span className="block text-[17px] leading-[22px] font-medium text-[var(--ph-tint)] md:text-[15px] md:leading-5">Split between categories</span>
                {splitRefusal && <span className="block text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{splitRefusal}</span>}
              </span>
              <ChevronRight size={17} aria-hidden className="shrink-0 text-[var(--ph-chevron)]" />
            </button>
          </div>
        )}

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
            {search.trim()
              ? 'Nothing here by that name.'
              : setElsewhere
                ? `This event's categories are in ${setElsewhere}. Open it to record here.`
                : 'No categories in this workspace yet.'}
          </p>
        )}

        {/* The way to the whole tree — renaming, archiving, a category's code, the sets — at the list's foot, drawn as
            Add more details is: words in the secondary ink, no box. It closes the sheet on its way. */}
        <Link
          to="/categories"
          onClick={onClose}
          className="ph-focus flex min-h-11 w-full items-center justify-center rounded-full text-[15px] font-medium text-[var(--ph-ink-2)]"
        >
          Manage categories
        </Link>

      </div>
      )}
    </Sheet>
  );
}
