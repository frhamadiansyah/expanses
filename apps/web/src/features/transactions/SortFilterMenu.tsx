import { searchTokens } from '@expanses/core';
import { ArrowUpDown, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../../ui';
import { type ChipOption, chipDot } from './ChipMenu';

export const DEFAULT_SORT = 'date:desc';

/** How many of the menu's controls are off their rest: the sort, the paid-with filter and Transfers. Zero means nothing to reset. */
export function sortFilterCount(p: { sortValue: string; paid: string; transfers?: boolean }): number {
  return (p.sortValue !== DEFAULT_SORT ? 1 : 0) + (p.paid ? 1 : 0) + (p.transfers ? 1 : 0);
}

/** What a phone's tab bar and home indicator take off the foot of the screen. */
const BAR_ROOM = 96;

/** The phone's list look: 15px ink rows, 44 tall, a hairline between each. No hover fill, so a touch leaves nothing lit. */
const ROW = 'flex min-h-11 w-full items-center gap-2 border-t-[0.5px] border-[var(--ph-hair)] px-3.5 py-3 text-left text-[15px] text-[var(--ph-ink)] first:border-t-0 disabled:text-[var(--ph-ink-3)]';
/** A tinted strip over a run of rows, edge to edge; the row under it needs no line of its own. */
const HEAD = 'bg-[var(--ph-fill)] px-3.5 py-2 text-[11px] uppercase tracking-[0.05em] text-[var(--ph-ink-3)]';

/**
 * One icon for the list's sort and its Paid with filter, in the grey capsule the other controls on the row wear. It
 * opens one fixed-width menu: the four sorts, then Paid with (a searchable list here, the phone's sheet there),
 * Transfers (Cashflow's own transfers, listed only while it is ticked) and Reset. Dark with a dot while any is off its rest.
 */
export function SortFilterMenu({
  sorts,
  sortValue,
  onSort,
  paid,
  paidOptions,
  onPaid,
  onOpenPaid,
  transfers,
  onTransfers,
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
  /** The Transfers filter: Cashflow lists the own transfers it leaves to the accounts' pages. Absent, no row is drawn. */
  transfers?: boolean;
  onTransfers?: (on: boolean) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'paid'>('menu');
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);
  const listId = useId();
  const count = sortFilterCount({ sortValue, paid, transfers });
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
          className={cx(
            'absolute right-0 z-20 w-[230px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[14px] bg-[var(--ph-surface)] shadow-[0_8px_30px_rgba(0,0,0,0.27)]',
            above ? 'bottom-full mb-1' : 'mt-1',
          )}
        >
          {view === 'menu' ? (
            <>
              <p className={HEAD}>Sort</p>
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
                  className={cx(ROW, 'justify-between', sort.value === sortValue && 'font-semibold')}
                >
                  <span className="min-w-0 flex-1 truncate">{sort.label}</span>
                  {sort.value === sortValue && <Check size={16} aria-hidden className="shrink-0" />}
                </button>
              ))}
              <p className={HEAD}>Filter</p>
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
                className={cx(ROW, 'justify-between')}
              >
                <span>Paid with</span>
                <span className="flex min-w-0 items-center gap-1 text-[var(--ph-ink-3)]">
                  <span className="max-w-28 truncate">{paidName ?? 'All'}</span>
                  <ChevronRight size={14} aria-hidden />
                </span>
              </button>
              {onTransfers && (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={!!transfers}
                  data-testid="transfers-filter"
                  onClick={() => {
                    onTransfers(!transfers);
                    setOpen(false);
                  }}
                  className={cx(ROW, 'justify-between', transfers && 'font-semibold')}
                >
                  <span>Transfers</span>
                  {transfers && <Check size={16} aria-hidden className="shrink-0" />}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={count === 0}
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
                className={ROW}
              >
                Reset
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setView('menu')} className={cx(ROW, 'font-semibold')}>
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
                className="h-11 w-full border-t-[0.5px] border-[var(--ph-hair)] bg-transparent px-3.5 text-[15px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none"
              />
              <ul id={listId} role="listbox" aria-label="Paid with" className="max-h-64 overflow-y-auto">
                {matching.length === 0 && <li className="border-t-[0.5px] border-[var(--ph-hair)] px-3.5 py-3 text-[15px] text-[var(--ph-ink-3)]">Nothing matches.</li>}
                {matching.map((option) => (
                  <li
                    key={option.value}
                    role="option"
                    aria-selected={option.value === paid}
                    onClick={() => {
                      onPaid(option.value);
                      setOpen(false);
                    }}
                    className={cx('flex min-h-11 cursor-pointer items-center gap-2 border-t-[0.5px] border-[var(--ph-hair)] px-3.5 py-3 text-[15px] text-[var(--ph-ink)]', option.indent && 'pl-7', option.value === paid && 'font-semibold')}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.meta && <span className="tabular whitespace-nowrap text-xs text-[var(--ph-ink-3)]">{option.meta}</span>}
                    {option.value === paid && <Check size={16} aria-hidden className="shrink-0" />}
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
