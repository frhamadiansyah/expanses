import type { AccountRow } from '@expanses/db';
import { useCategorySetMembership } from '../categories/set-queries';

/**
 * Category <option>s grouped by top-level parent. Parents are selectable as "(general)".
 *
 * Set categories are left out: every picker built on this one speaks for the monthly tree, and an
 * event's categories are chosen on the event itself.
 */
export function CategoryOptions({
  accounts,
  kind,
  placeholder = 'Choose…',
  parentSuffix = '(all)',
}: {
  accounts: AccountRow[];
  kind: 'expense' | 'income';
  placeholder?: string | null;
  parentSuffix?: string;
}) {
  const membership = useCategorySetMembership().data ?? {};
  const categories = accounts.filter((a) => a.kind === kind && a.archivedAt === null && membership[a.id] === undefined);
  const roots = categories.filter((c) => c.parentId === null);
  return (
    <>
      {placeholder !== null && <option value="">{placeholder}</option>}
      {roots.map((root) => {
        const children = categories.filter((c) => c.parentId === root.id);
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
