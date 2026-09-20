import { type AccountRow, createAccount } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { Button, cx, ErrorBox, InputRow, Row, RowGroup, SelectRow } from '../../ui';
import { ICONS } from '../categories/CategoryIcon';

/**
 * B7a — a category made without leaving the form, and chosen the moment it exists.
 *
 * **It files into the same workspace the picker filters on.** `createAccount` puts a new category in the book of
 * the context it is handed, and `CategoryPicker` shows the categories `useInOpenBook` keeps: both read the one
 * `ws` the app holds, so the category that has just been made is a category the picker can show. Handed any
 * other context it would land in a book the picker's own filter then hides — the category chosen a second ago
 * vanishing from the list it was chosen in.
 *
 * Kind is not asked for. It is the tab the picker is showing, and a category made under Income from the Expense
 * tab would be a category the form could not then file this spending in.
 */
export function NewCategorySheet({
  kind,
  parents,
  onCreated,
  onClose,
}: {
  kind: 'expense' | 'income';
  /** What it may be filed inside: the roots this picker offers, which are of this kind and this workspace. */
  parents: readonly AccountRow[];
  onCreated: (categoryId: string) => void;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [icon, setIcon] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const account = await createAccount(database, ws, {
        name,
        kind,
        subtype: 'category',
        // Categories carry no currency: `createAccount` refuses one, and what is spent is read in the
        // paying account's own currency.
        currency: null,
        parentId: parentId || null,
        icon: icon || null,
      });
      await invalidate();
      onCreated(account.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="New category" onClose={onClose}>
      <div className="space-y-3">
        <RowGroup>
          <InputRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Boba" />
          <SelectRow label="Inside" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Top level</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.name}
              </option>
            ))}
          </SelectRow>
          {/* Shown, not asked: it is the tab the picker is on, and this is where it says so. */}
          <Row label="Kind" value={kind === 'expense' ? 'Expense' : 'Income'} />
        </RowGroup>

        {/* Every icon the app can draw. One without a pick keeps inheriting its parent's, exactly as today. */}
        <div role="group" aria-label="Icon" className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto rounded-xl bg-white p-2 ring-1 ring-slate-200 sm:grid-cols-8">
          {Object.entries(ICONS).map(([key, Glyph]) => (
            <button
              key={key}
              type="button"
              aria-label={key}
              aria-pressed={icon === key}
              onClick={() => setIcon(icon === key ? '' : key)}
              className={cx(
                'flex h-10 w-full items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900',
                icon === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              <Glyph size={18} aria-hidden />
            </button>
          ))}
        </div>

        <ErrorBox error={error} />
        <Button type="button" className="w-full justify-center" disabled={busy || !name.trim()} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Sheet>
  );
}
