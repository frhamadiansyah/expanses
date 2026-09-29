import { type CategoryNeed, needOf, type ResolvedNeed } from '@expanses/core';
import { type AccountRow, createAccount, saveCategoryNeed, setCategoryColour } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useCategoryColours, useInvalidateAll } from '../../lib/queries';
import { Pencil, Tag } from 'lucide-react';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, TextRow } from '../../ui/native';
import { categoryMark, ICONS } from '../categories/CategoryIcon';
import { ColourPicker, IconPicker } from '../categories/CategoryLookSheets';
import { needCaption } from '../categories/category-details';
import { useCategoryNeeds } from '../categories/need-queries';
import { NeedRow } from '../categories/NeedRow';

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
  const [colour, setColour] = useState<string | null>(null);
  const [choosingLook, setChoosingLook] = useState(false);
  const [need, setNeed] = useState<CategoryNeed | null>(null);
  const marks = useCategoryNeeds().data ?? {};
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const chosenColours = useCategoryColours().data;
  // With a parent, it is drawn as its parent draws it until an icon of its own is picked, in a shade of the parent's
  // colour; at the top, in the colour picked for it, or the app's tint until one is.
  const parentMark = parentId ? categoryMark(parentId, parents, chosenColours) : null;
  const Preview = (icon && ICONS[icon]) || parentMark?.Glyph || Tag;

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
      // Only a top-level category has a colour of its own; a subcategory is drawn in a shade of its parent's. Kept
      // apart from the making: a colour that could not be kept leaves the category made, not a second one on retry.
      // An expense category's own Counts as, when one was chosen; otherwise it follows its parent, else essential.
      if (kind === 'expense' && need) await saveCategoryNeed(database, ws, account.id, need).catch(() => undefined);
      if (colour && !parentId) await setCategoryColour(database, ws, account.id, colour).catch(() => undefined);
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
    setColour(null);
    setChoosingLook(false);
    setNeed(null);
    setError(null);
  };

  // The circle: the icon it will draw, in the colour it will wear.
  const own = parentMark ? parentMark.colour : colour;
  const circle = (size: number, glyph: number) => (
    <span
      aria-hidden
      className="relative flex items-center justify-center rounded-full bg-[var(--ph-tint-panel)] text-[var(--ph-tint)]"
      style={{ width: size, height: size, ...(own ? { background: `color-mix(in srgb, ${own} 16%, transparent)`, color: own } : {}) }}
    >
      <Preview size={glyph} />
    </span>
  );

  // What it would count as: its own choice, else its parent's (the parent's own or inherited), else essential.
  const parent = parentId ? parents.find((p) => p.id === parentId) : undefined;
  const inherited = parentId ? needOf(parentId, parents, marks) : null;
  const resolved: ResolvedNeed = need
    ? { need, source: 'yours' }
    : inherited?.source
      ? { need: inherited.need, source: 'parent' }
      : { need: 'essential', source: null };

  const form = (
    <div className="flex flex-col gap-3">
      {/* How it looks sits behind the circle, as a Reminders list's icon does: tap it for the icon and the colour. */}
      <div className="flex justify-center py-2">
        <button type="button" aria-label="Icon and colour" onClick={() => setChoosingLook(true)} className="ph-focus relative rounded-full">
          {circle(64, 30)}
          <span className="absolute -right-0.5 -bottom-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-[0.5px] border-[var(--ph-hair)] bg-[var(--ph-surface)] text-[var(--ph-ink-2)]">
            <Pencil size={11} aria-hidden />
          </span>
        </button>
      </div>
      {/* The kit's rows, as every other form sheet draws them: the label at the left, the answer at the right. Kind
          is not a row: it is the tab the picker is on, and the title says it ("New expense category"). */}
      {/* The form's own 12 px between blocks, not the group's extra margin on top of it. */}
      <InsetGroup className="!mb-0">
        <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name" />
        {/* Top level has a value of its own: an empty one reads as "nothing chosen yet" and draws a blank row. */}
        <SelectRow label="Parent" value={parentId || TOP} onChange={(e) => setParentId(e.target.value === TOP ? '' : e.target.value)}>
          <option value={TOP}>Top level</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          ))}
        </SelectRow>
        {kind === 'expense' && (
          <NeedRow name={name.trim() || 'this category'} need={resolved} caption={needCaption(resolved.source, parent?.name ?? null)} onChoose={setNeed} />
        )}
      </InsetGroup>
      <ErrorBox error={error} />
    </div>
  );

  // One step further in the same sheet: the same circle, then the colours (a top-level category only — one with a
  // parent is drawn in a shade of the parent's), then every icon. No scroll box of its own: the sheet scrolls.
  const look = (
    <div className="flex flex-col gap-3">
      <div className="flex justify-center py-2">{circle(64, 30)}</div>
      {!parentId && (
        <section aria-label="Colour" data-testid="new-category-colours">
          <h3 className="mb-1.5 px-4 text-[12px] leading-[16px] font-medium tracking-[0.04em] text-[var(--ph-ink-3)] uppercase">Colour</h3>
          <ColourPicker value={colour} onPick={setColour} />
        </section>
      )}
      <div data-testid="new-category-icons">
        <IconPicker value={icon || null} onPick={(key) => setIcon(icon === key ? '' : key)} />
      </div>
    </div>
  );

  const view = choosingLook ? look : form;

  return { view, choosingLook, closeLook: () => setChoosingLook(false), canSave: !busy && name.trim() !== '', save: () => void save(), reset };
}
