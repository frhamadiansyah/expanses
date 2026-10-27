import { searchTokens } from '@expanses/core';
import { ArrowUpDown, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../../ui';
import { type ChipOption, chipDot } from './ChipMenu';

export const DEFAULT_SORT = 'date:desc';

/** How many of the menu's two controls are off their rest: the sort and the paid-with filter. Zero means nothing to reset. */
export function sortFilterCount(p: { sortValue: string; paid: string }): number {
  return (p.sortValue !== DEFAULT_SORT ? 1 : 0) + (p.paid ? 1 : 0);
}

/** What a phone's tab bar and home indicator take off the foot of the screen. */
const BAR_ROOM = 96;

const ROW = 'flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-slate-100';

/**
 * One icon for the list's sort and its Paid with filter, in the grey capsule the other controls on the row wear. It
 * opens one fixed-width menu: the four sorts, then Paid with (a searchable list here, the phone's sheet there) and
 * Reset. Dark with a dot while either is off its rest.
 */
export function SortFilterMenu({
  sorts,
  sortValue,
  onSort,
  paid,
  paidOptions,
  onPaid,
  onOpenPaid,
  onReset,
}: {
  sorts: readonly { value: string; label: string }[];
  sortValue: string;
  onSort: (value: string) => void;
  paid: string;
  paidOptions: readonly ChipOption[];
  onPaid: (value: string) => void;
  /** A phone picks the account in its own sheet: the menu closes and this opens it. */
  onOpenPaid?: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'paid'>('menu');
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);
  const listId = useId();
  const count = sortFilterCount({ sortValue, paid });
  const dot = chipDot({ active: count > 0, iconOnly: true, count });
  const paidName = paidOptions.find((option) => option.value === paid && option.value)?.label;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // Low on the screen the tab bar sits over the foot of a menu hung below the button, so it opens upward instead.
  useLayoutEffect(() => {
    if (!open || !box.current || !menu.current) return;
    const room = window.innerHeight - BAR_ROOM - box.current.getBoundingClientRect().bottom;
    setAbove(menu.current.offsetHeight + 4 > room);
  }, [open, view]);

  const tokens = searchTokens(query);
  const matching = paidOptions.filter((option) => {
    const text = `${option.label} ${option.meta ?? ''} ${option.keywords ?? ''}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  });

  return (
    <div ref={box} className="relative" onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}>
      <div className="inline-flex items-center rounded-lg bg-slate-200 p-0.5">
        <button
          type="button"
          aria-label="Sort and filter"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setOpen((was) => !was);
            setView('menu');
            setQuery('');
          }}
          className={cx(
            'flex h-7 w-8 items-center justify-center rounded-md',
            dot ? 'relative bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900',
          )}
        >
          <ArrowUpDown size={15} aria-hidden />
          {dot && <span aria-hidden data-testid="filter-on" className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-[var(--ph-tint)] ring-2 ring-slate-200" />}
        </button>
      </div>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Sort and filter"
          data-testid="sort-filter-menu"
          className={cx('absolute right-0 z-20 w-[260px] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200', above ? 'bottom-full mb-1' : 'mt-1')}
        >
          {view === 'menu' ? (
            <>
              <p className="px-2 pt-1.5 pb-0.5 text-xs font-semibold text-slate-500">Sort</p>
              {sorts.map((sort) => (
                <button
                  key={sort.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={sort.value === sortValue}
                  onClick={() => {
                    onSort(sort.value);
                    setOpen(false);
                  }}
                  className={ROW}
                >
                  <span className="w-3 text-xs">{sort.value === sortValue ? '✓' : ''}</span>
                  <span className="min-w-0 flex-1 truncate">{sort.label}</span>
                </button>
              ))}
              <p className="mt-1 border-t border-slate-100 px-2 pt-2 pb-0.5 text-xs font-semibold text-slate-500">Filter</p>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  if (onOpenPaid) {
                    setOpen(false);
                    onOpenPaid();
                  } else {
                    setView('paid');
                    setQuery('');
                  }
                }}
                className={ROW}
              >
                <span className="w-3" />
                <span className="flex-1">Paid with</span>
                <span className="max-w-28 truncate text-xs text-slate-500">{paidName ?? 'All'}</span>
                <ChevronRight size={14} aria-hidden className="text-slate-400" />
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={count === 0}
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
                className={cx(ROW, 'disabled:text-slate-400 disabled:hover:bg-transparent')}
              >
                <RotateCcw size={13} aria-hidden className="w-3" />
                <span className="flex-1">Reset</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setView('menu')} className={cx(ROW, 'font-medium')}>
                <ChevronLeft size={14} aria-hidden />
                Paid with
              </button>
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Type to find"
                aria-label="Find in paid with"
                aria-controls={listId}
                className="mb-1 h-8 w-full rounded-lg border border-slate-300 px-2 text-sm focus:border-slate-900 focus:outline-none"
              />
              <ul id={listId} role="listbox" aria-label="Paid with" className="max-h-64 overflow-y-auto">
                {matching.length === 0 && <li className="px-2 py-2 text-xs text-slate-500">Nothing matches.</li>}
                {matching.map((option) => (
                  <li
                    key={option.value}
                    role="option"
                    aria-selected={option.value === paid}
                    onClick={() => {
                      onPaid(option.value);
                      setOpen(false);
                    }}
                    className={cx('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-100', option.indent && 'pl-6')}
                  >
                    <span className="w-3 text-xs">{option.value === paid ? '✓' : ''}</span>
                    <span className="min-w-0 truncate">{option.label}</span>
                    {option.meta && <span className="tabular ml-auto whitespace-nowrap text-xs text-slate-500">{option.meta}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
