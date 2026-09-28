import { type AccountRow, createAccount } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Tag } from 'lucide-react';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, TextRow } from '../../ui/native';
import { ICONS } from '../categories/CategoryIcon';
import { IconPicker } from '../categories/CategoryLookSheets';

/**
 * B7a — a category made without leaving the form, and chosen the moment it exists. Drawn by Select category in its
 * own sheet, as a step it moves to (‹ back, ✓ save), so no second sheet stacks on the first.
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
const TOP = 'top-level';

export function useNewCategoryForm({
  kind,
  parents,
  onCreated,
}: {
  kind: 'expense' | 'income';
  /** What it may be filed inside: the roots this picker offers, which are of this kind and this workspace. */
  parents: readonly AccountRow[];
  onCreated: (categoryId: string) => void;
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
    if (busy || !name.trim()) return;
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

  const reset = () => {
    setName('');
    setParentId('');
    setIcon('');
    setError(null);
  };

  const view = (
    <div className="flex flex-col gap-3">
      {/* B7a's preview: the icon this category will draw, before it exists. */}
      <div className="flex justify-center py-2">
        <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--ph-tint-panel)] text-[var(--ph-tint)]">
          <Preview size={30} />
        </span>
      </div>
      {/* The kit's rows, as every other form sheet draws them: the label at the left, the answer at the right. Kind
          is not a row: it is the tab the picker is on, and the title says it ("New expense category"). */}
      {/* The form's own 12 px between blocks, not the group's extra margin on top of it. */}
      <InsetGroup className="!mb-0">
        <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Boba" />
        {/* Top level has a value of its own: an empty one reads as "nothing chosen yet" and draws a blank row. */}
        <SelectRow label="Inside" value={parentId || TOP} onChange={(e) => setParentId(e.target.value === TOP ? '' : e.target.value)}>
          <option value={TOP}>Top level</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          ))}
        </SelectRow>
      </InsetGroup>

      {/* Every icon the app can draw, on the picker's shelves (Option A). None picked keeps inheriting its parent's.
          No scroll box of its own: the sheet scrolls, so at any detent the icons run to its foot rather than stopping
          in a box with grey under it. */}
      <div data-testid="new-category-icons">
        <IconPicker value={icon || null} onPick={(key) => setIcon(icon === key ? '' : key)} />
      </div>

      <ErrorBox error={error} />
    </div>
  );

  return { view, canSave: !busy && name.trim() !== '', save: () => void save(), reset };
}
