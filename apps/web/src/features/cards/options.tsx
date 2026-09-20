import type { AccountRow } from '@expanses/db';
import { useInOpenBook } from '../../lib/queries';
import { categoryGroups, offeredCategories } from '../categories/offered';
import { useCategorySetMembership } from '../categories/set-queries';

/**
 * Category <option>s grouped by top-level parent. Parents are selectable as "(general)".
 *
 * Set categories are left out: every picker built on this one speaks for the monthly tree, and an
 * event's categories are chosen on the event itself.
 *
 * The open book's categories only, unless `ownerWide`: a card's earning rules belong to the owner and match
 * spending in any book, so they alone may name a category from any of them. A form that records something — a
 * loan, a debt, a card-funded purchase, an instalment's extras, a captured draft being confirmed — offers the
 * open book's categories, so it can never hand the posting a category from another one.
 *
 * Which ones, and in what order, is `offered.ts` — shared with `CategoryPicker`, so a child whose parent is
 * archived or set aside still stands here as a choice of its own rather than vanishing with its parent.
 */
export function CategoryOptions({
  accounts,
  kind,
  placeholder = 'Choose…',
  parentSuffix = '(all)',
  ownerWide = false,
}: {
  accounts: AccountRow[];
  kind: 'expense' | 'income';
  placeholder?: string | null;
  parentSuffix?: string;
  ownerWide?: boolean;
}) {
  const membership = useCategorySetMembership().data ?? {};
  const inOpenBook = useInOpenBook();
  const groups = categoryGroups(offeredCategories(accounts, kind, membership, (a) => ownerWide || inOpenBook(a)));
  return (
    <>
      {placeholder !== null && <option value="">{placeholder}</option>}
      {groups.map(({ root, children }) => {
        if (children.length === 0) {
          return (
            <option key={root.id} value={root.id}>
              {root.name}
            </option>
          );
        }
        return (
          <optgroup key={root.id} label={root.name}>
            <option value={root.id}>{`${root.name} ${parentSuffix}`}</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}
