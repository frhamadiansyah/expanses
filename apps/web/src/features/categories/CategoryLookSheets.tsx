import { CATEGORY_PALETTE } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Check, type LucideIcon, Search } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { cx } from '../../ui';
import { ICONS } from './CategoryIcon';
import { searchIcons } from './icon-sections';

const SHELF_HEADING = 'mb-1.5 px-4 text-[12px] leading-[16px] font-medium tracking-[0.04em] text-[var(--ph-ink-3)] uppercase';
const SHELF = 'rounded-[11px] bg-[var(--ph-surface)] p-2';
const CELL = 'ph-focus-inset mx-auto flex h-11 w-11 items-center justify-center rounded-full';
const cellTone = (on: boolean) => (on ? 'bg-[var(--ph-ink)] text-[var(--ph-surface)]' : 'text-[var(--ph-ink-2)] hover:bg-[var(--ph-fill)]');

/**
 * Every icon the app draws, on shelves by what it is for, with a search over their names and the words people type
 * for them (Option A). Used inside the icon sheet and, embedded, by the new-category sheet. Each cell is named by its
 * icon's key, and the chosen one is filled with ink.
 */
export function IconPicker({ value, onPick }: { value: string | null; onPick: (key: string) => void }) {
  const [query, setQuery] = useState('');
  const shelves = searchIcons(query);
  return (
    <div className="flex flex-col gap-4">
      <label className="flex h-11 items-center gap-2 rounded-full bg-[var(--ph-surface)] px-4">
        <Search size={16} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
        <input
          aria-label="Search icons"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons"
          className="min-w-0 flex-1 bg-transparent text-base text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none md:text-[15px]"
        />
      </label>
      {shelves.length === 0 && <p className="px-4 py-2 text-[15px] text-[var(--ph-ink-3)]">No icon by that name.</p>}
      {shelves.map((shelf) => (
        <section key={shelf.title} aria-label={shelf.title}>
          <h3 className={SHELF_HEADING}>{shelf.title}</h3>
          <div className={cx(SHELF, 'grid grid-cols-6 gap-1')}>
            {shelf.keys.map((key) => {
              const Glyph = ICONS[key]!;
              return (
                <button key={key} type="button" aria-label={key} aria-pressed={value === key} onClick={() => onPick(key)} className={cx(CELL, cellTone(value === key))}>
                  <Glyph size={20} aria-hidden />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The icon sheet on a category's page: ✕ leaves it as it was, ✓ saves the pick. "Automatic" takes the category's own
 * icon away, so it draws its parent's (or its default) again — `automatic` is that glyph.
 */
export function IconSheet({
  current,
  automatic,
  onSave,
  onClose,
}: {
  current: string | null;
  automatic: LucideIcon;
  onSave: (icon: string | null) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(current);
  const Auto = automatic;
  return (
    <Sheet grouped title="Icon" onClose={onClose} confirm={{ label: 'Save icon', run: () => onSave(picked) }}>
      <div className="flex flex-col gap-4">
        <button
          type="button"
          aria-pressed={picked === null}
          onClick={() => setPicked(null)}
          className="ph-focus flex min-h-11 items-center gap-3 rounded-[11px] bg-[var(--ph-surface)] px-4 py-2 text-left"
        >
          <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', cellTone(picked === null))}>
            <Auto size={18} aria-hidden />
          </span>
          <span className="flex-1 text-[15px] font-medium text-[var(--ph-ink)]">Automatic</span>
          <span className="text-[12.5px] text-[var(--ph-ink-3)]">its parent's or the default</span>
        </button>
        <IconPicker value={picked} onPick={setPicked} />
      </div>
    </Sheet>
  );
}

/** The colour sheet on a top-level category's page: ten swatches, and Automatic for the colour the app works out. */
export function ColourSheet({
  current,
  automatic,
  onSave,
  onClose,
}: {
  current: string | null;
  /** Today's worked-out colour, shown beside the word so Automatic is not a mystery. */
  automatic: string;
  onSave: (colour: string | null) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(current);
  return (
    <Sheet grouped title="Colour" onClose={onClose} confirm={{ label: 'Save colour', run: () => onSave(picked) }}>
      <div className={cx(SHELF, 'grid grid-cols-6 gap-2 py-3')}>
        <Swatch
          label="Automatic"
          on={picked === null}
          onClick={() => setPicked(null)}
          style={{ background: `conic-gradient(#dc2626, #d97706, #16a34a, #0284c7, #7c3aed, #db2777, #dc2626)` }}
        />
        {CATEGORY_PALETTE.map((entry) => (
          <Swatch key={entry.colour} label={entry.name} on={picked === entry.colour} onClick={() => setPicked(entry.colour)} style={{ background: entry.colour }} />
        ))}
      </div>
      <p className="mt-2 flex items-center gap-2 px-4 text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
        <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: automatic }} />
        Automatic is this colour. Subcategories are drawn in shades of the one you pick.
      </p>
    </Sheet>
  );
}

function Swatch({ label, on, onClick, style }: { label: string; on: boolean; onClick: () => void; style: React.CSSProperties }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={cx(CELL, 'text-white', on && 'ring-2 ring-[var(--ph-ink)] ring-offset-2 ring-offset-[var(--ph-surface)]')}
      style={style}
    >
      {on && <Check size={18} strokeWidth={3} aria-hidden />}
    </button>
  );
}

/**
 * Where a category sits: at the top, or under one of the top-level categories of its kind in the open workspace. A
 * category with subcategories of its own stays at the top — the tree is two levels deep — and the sheet says why.
 */
export function ParentSheet({
  current,
  parents,
  blocked,
  onSave,
  onClose,
}: {
  current: string | null;
  parents: readonly AccountRow[];
  /** Set when the category has live subcategories: it may not move under another. */
  blocked: boolean;
  onSave: (parentId: string | null) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(current);
  const options: { id: string | null; name: string }[] = [{ id: null, name: 'None (top level)' }, ...parents.map((p) => ({ id: p.id, name: p.name }))];
  return (
    <Sheet grouped title="Parent" onClose={onClose} confirm={{ label: 'Save parent', run: () => onSave(picked) }}>
      {blocked && (
        <p data-testid="parent-blocked" className="mb-3 px-4 text-[13px] leading-[17px] text-[var(--ph-ink-3)]">
          This category has subcategories of its own. Move or archive its subcategories first.
        </p>
      )}
      <div className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
        {options.map((option) => {
          const off = blocked && option.id !== null;
          return (
            <button
              key={option.id ?? 'none'}
              type="button"
              aria-pressed={picked === option.id}
              disabled={off}
              onClick={() => setPicked(option.id)}
              className="ph-focus-inset flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left disabled:opacity-40"
            >
              <span className="flex-1 text-[15px] text-[var(--ph-ink)]">{option.name}</span>
              {picked === option.id && <Check size={18} aria-hidden className="text-[var(--ph-tint)]" />}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
