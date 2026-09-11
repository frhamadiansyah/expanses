import type { AccountRow } from '@expanses/db';

/** Category <option>s grouped by top-level parent. Parents are selectable as "(general)". */
export function CategoryOptions({ accounts, kind, placeholder = 'Choose…' }: { accounts: AccountRow[]; kind: 'expense' | 'income'; placeholder?: string | null }) {
  const categories = accounts.filter((a) => a.kind === kind && a.archivedAt === null);
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
            <option value={root.id}>{`${root.name} (all)`}</option>
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
