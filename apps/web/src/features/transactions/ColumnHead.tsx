import { ChevronDown, X } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../../ui';
import { amountFilterOn, amountFilterText, type AmountFilter, NO_AMOUNT_FILTER } from './table-figures';

/*
 * The Mac tables' column names (owner 2026-11-24 and 2026-11-25): a name is a small menu of its own — Sort, and for
 * some a filter — so nothing new sits on the page. A name with a filter on is blue and says what it holds, with ✕ to
 * take it off; a name the table is sorted by carries the arrow ("Amount ↓").
 */

/** A column name that opens its menu; blue while a filter is on. */
export const HEAD = 'inline-flex items-center gap-[5px] whitespace-nowrap rounded-[7px] px-[8px] py-[3px] -ml-[8px] hover:bg-[var(--mk-pill)]';
export const HEAD_ON = 'bg-[var(--mk-sel)] text-[var(--mk-blue)] hover:bg-[var(--mk-sel)]';

/** A header's filter as it stands: blue, saying what it holds, with ✕ to take it off. */
export function OnHead({ name, text, icon, onOpen, onClear }: { name: string; text: string; icon?: ReactNode; onOpen?: () => void; onClear: () => void }) {
  return (
    <span className={cx(HEAD, HEAD_ON, 'pr-[4px]')} data-testid={`filter-${name.toLowerCase().replace(/\s+/g, '-')}`} data-on="true">
      <button type="button" onClick={onOpen} className="inline-flex min-w-0 shrink items-center gap-[5px] font-semibold" title={`${name} filter`}>
        {icon}
        <span className="max-w-[170px] truncate">{text}</span>
      </button>
      <button type="button" aria-label={`Clear the ${name} filter`} onClick={onClear} className="shrink-0 rounded-full p-[2px] opacity-70 hover:opacity-100">
        <X size={12} strokeWidth={2.6} aria-hidden />
      </button>
    </span>
  );
}

/** A small panel under a header: closes on Esc and on a press outside it. */
export function HeadPopover({
  anchor,
  label,
  onClose,
  children,
  width = 220,
  tight = false,
}: {
  anchor: HTMLElement | null;
  label: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  /** A menu of lines (8px round it) rather than a panel of fields (12px). */
  tight?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return;
    // Under the name; above it when the window has no room below (a name near the window's foot).
    const tall = box.current?.offsetHeight ?? 0;
    const below = rect.bottom + 6;
    const top = below + tall > window.innerHeight - 8 && rect.top - 6 - tall > 8 ? rect.top - 6 - tall : below;
    setPlace({ top, left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - width - 24)) });
  }, [anchor, width]);
  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node) && !anchor?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={label}
      style={{ minWidth: width, ...(place ?? { visibility: 'hidden' }) }}
      className={cx('fixed z-[60] rounded-[14px] bg-[var(--mk-panel)] text-left text-[13px] font-normal text-[var(--mk-ink)] shadow-[0_12px_40px_rgb(0_0_0/0.18),0_0_0_1px_rgb(0_0_0/0.06)]', tight ? 'p-[8px]' : 'p-[12px]')}
    >
      {children}
    </div>
  );
}

export type SortDir = 'asc' | 'desc';

/** A column's Sort: the order it is in now (null when the table is sorted by another), and its two choices' words. */
export interface ColumnSort {
  dir: SortDir | null;
  /** The two choices, first the one the menu offers first ("↓ High to low"). */
  choices: readonly { dir: SortDir; label: string }[];
  onSort: (dir: SortDir) => void;
}

/** The words each kind of column sorts by. */
export const SORT_WORDS = {
  date: [
    { dir: 'desc', label: '↓ New to old' },
    { dir: 'asc', label: '↑ Old to new' },
  ],
  words: [
    { dir: 'asc', label: '↑ A to Z' },
    { dir: 'desc', label: '↓ Z to A' },
  ],
  amount: [
    { dir: 'desc', label: '↓ High to low' },
    { dir: 'asc', label: '↑ Low to high' },
  ],
} as const satisfies Record<string, readonly { dir: SortDir; label: string }[]>;

/** "↓" or "↑" after a column's name while the table is sorted by it. */
export const sortArrow = (dir: SortDir | null) => (dir === 'desc' ? ' ↓' : dir === 'asc' ? ' ↑' : '');

/** A menu's line: its words, ticked when it is the one on. */
export function MenuItem({ on, onClick, children, testId }: { on?: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={!!on}
      data-testid={testId}
      onClick={onClick}
      className={cx('flex w-full items-center rounded-[8px] px-[8px] py-[5px] text-left whitespace-nowrap hover:bg-[var(--mk-pill)]', on && 'font-semibold text-[var(--mk-blue)]')}
    >
      {children}
    </button>
  );
}

/** A small grey word over a group of a menu's lines: "Sort", "Filter". */
export const MenuLabel = ({ children }: { children: ReactNode }) => <p className="px-[8px] pt-[4px] pb-[2px] text-[11.5px] font-semibold text-[var(--mk-ink-2)]">{children}</p>;

/** The Sort part of a column's menu. */
export function SortPart({ sort, onDone }: { sort: ColumnSort; onDone: () => void }) {
  return (
    <div role="menu" aria-label="Sort">
      <MenuLabel>Sort</MenuLabel>
      {sort.choices.map((choice) => (
        <MenuItem
          key={choice.dir}
          on={sort.dir === choice.dir}
          onClick={() => {
            sort.onSort(choice.dir);
            onDone();
          }}
        >
          {choice.label}
        </MenuItem>
      ))}
    </div>
  );
}

/** Over or Under, typed as an amount cell takes it: Return keeps it, Esc lets it go. */
function BoundField({ label, value, onKeep, onCancel }: { label: string; value: string; onKeep: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  return (
    <label className="flex items-center gap-[8px] px-[8px] py-[4px]">
      <span className="w-[44px] text-[var(--mk-ink-2)]">{label}</span>
      <input
        autoFocus
        value={text}
        aria-label={`Amount ${label.toLowerCase()}`}
        placeholder="Amount"
        inputMode="decimal"
        autoComplete="off"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onKeep(text);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        className="h-[26px] w-[120px] rounded-[6px] bg-[var(--mk-field)] px-[8px] text-right tabular-nums outline-none focus:outline-2 focus:outline-[var(--mk-blue)]"
      />
    </label>
  );
}

/**
 * A column name with its menu: Sort, and — for Amount — Filter: Over … and Under …. Blue, saying the filter, while one
 * is on.
 */
export function ColumnHead({
  name,
  align = 'left',
  chevron = false,
  sort,
  amount,
}: {
  name: string;
  align?: 'left' | 'right';
  /** The small ⌄ after the name (a column that also filters). */
  chevron?: boolean;
  sort: ColumnSort;
  /** The Amount column's filter, in the currency it is said in. */
  amount?: { filter: AmountFilter; currency: string; onChange: (filter: AmountFilter) => void };
}) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState<'over' | 'under' | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const close = () => {
    setOpen(false);
    setTyping(null);
  };
  const on = amount ? amountFilterOn(amount.filter) : false;
  const arrow = sortArrow(sort.dir);
  return (
    <span ref={anchor} className={cx('inline-flex max-w-full', align === 'right' && 'justify-end')}>
      {on && amount ? (
        <OnHead name={name} text={`${arrow.trim() ? `${arrow.trim()} ` : ''}${amountFilterText(amount.filter, amount.currency)}`} onOpen={() => setOpen((was) => !was)} onClear={() => amount.onChange(NO_AMOUNT_FILTER)} />
      ) : (
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-sort={sort.dir === 'desc' ? 'descending' : sort.dir === 'asc' ? 'ascending' : undefined}
          className={cx(HEAD, align === 'right' && '-mr-[8px] ml-0', open && 'bg-[var(--mk-pill)] text-[var(--mk-ink)]')}
        >
          {name}
          {arrow}
          {chevron && <ChevronDown size={13} strokeWidth={2.4} aria-hidden className="opacity-70" />}
        </button>
      )}
      {open && (
        <HeadPopover anchor={anchor.current} label={`${name} menu`} onClose={close} width={200} tight>
          <SortPart sort={sort} onDone={close} />
          {amount && (
            <div role="group" aria-label="Filter" className="mt-[4px] border-t border-[var(--mk-line)] pt-[4px]">
              <MenuLabel>Filter</MenuLabel>
              {(['over', 'under'] as const).map((bound) =>
                typing === bound ? (
                  <BoundField
                    key={bound}
                    label={bound === 'over' ? 'Over' : 'Under'}
                    value={amount.filter[bound]}
                    onKeep={(text) => {
                      amount.onChange({ ...amount.filter, [bound]: text.trim() });
                      close();
                    }}
                    onCancel={() => setTyping(null)}
                  />
                ) : (
                  <MenuItem key={bound} on={amount.filter[bound].trim() !== ''} onClick={() => setTyping(bound)}>
                    {bound === 'over' ? 'Over' : 'Under'} {amount.filter[bound].trim() ? amountFilterText({ ...NO_AMOUNT_FILTER, [bound]: amount.filter[bound] }, amount.currency).replace(/^(Over|Under) /, '') : '…'}
                  </MenuItem>
                ),
              )}
              {on && (
                <MenuItem
                  onClick={() => {
                    amount.onChange(NO_AMOUNT_FILTER);
                    close();
                  }}
                >
                  <span className="text-[var(--mk-ink-2)]">Clear the filter</span>
                </MenuItem>
              )}
            </div>
          )}
        </HeadPopover>
      )}
    </span>
  );
}
