import { type AccountRow, createAccount } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { Tag } from 'lucide-react';
import { cx, ErrorBox, InputRow, Row, SelectRow } from '../../ui';
import { FormRows } from './FormRow';
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

  const Preview = (icon && ICONS[icon]) || Tag;

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
    <Sheet grouped title="New category" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {/* B7a's preview: the icon this category will draw, before it exists. */}
        <div className="flex justify-center py-2">
          <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--ph-tint-panel)] text-[var(--ph-tint)]">
            <Preview size={30} />
          </span>
        </div>
        <FormRows>
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
        </FormRows>

        {/* Every icon the app can draw. One without a pick keeps inheriting its parent's, exactly as today. */}
        <div role="group" aria-label="Icon" className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto rounded-[11px] bg-[var(--ph-surface)] p-2 sm:grid-cols-8">
          {Object.entries(ICONS).map(([key, Glyph]) => (
            <button
              key={key}
              type="button"
              aria-label={key}
              aria-pressed={icon === key}
              onClick={() => setIcon(icon === key ? '' : key)}
              className={cx(
                'ph-focus-inset flex h-10 w-full items-center justify-center rounded-full',
                icon === key ? 'bg-[var(--ph-tint)] text-[var(--ph-surface)]' : 'text-[var(--ph-ink-2)] hover:bg-[var(--ph-fill)]',
              )}
            >
              <Glyph size={18} aria-hidden />
            </button>
          ))}
        </div>

        <ErrorBox error={error} />
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void save()}
          className="ph-focus min-h-11 w-full rounded-full bg-[var(--ph-tint)] text-[15px] font-semibold text-[var(--ph-surface)] disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}
