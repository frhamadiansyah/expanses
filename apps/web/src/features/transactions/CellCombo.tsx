import { searchTokens } from '@expanses/core';
import { type CSSProperties, type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../../ui';

export interface ComboOption {
  value: string;
  label: string;
  /** Shown beside the label in the cell and the list, and searched: a card's last four digits. */
  meta?: string;
  /** Shown only in the list, and searched: a category's parent. */
  detail?: string;
  icon?: ReactNode;
  keywords?: string;
}

/** A choice that does something rather than naming a value: "＋ Add a credit card ending 5512". */
export interface ComboAdd {
  key: string;
  label: string;
  /** Grey, at the right: "2 rows". */
  meta?: string;
  onPick: () => void;
}

/**
 * A cell you type into to choose from a list: a few letters or a card's last four digits narrow it,
 * Enter or Tab takes the highlighted choice, Escape puts the cell back as it was.
 */
export function CellCombo({
  value,
  options,
  onChange,
  label,
  placeholder,
  resolve,
  invalid,
  dense = false,
  disabled,
  guessed,
  pending,
  className,
}: {
  value: string;
  options: readonly ComboOption[];
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  /** Reads typed text into a choice when the list was not used, such as a pasted "Bonvoy 8802". */
  resolve?: (text: string) => string | null;
  invalid?: boolean;
  /** The wide Cashflow table's 13 px cell (Mac Cashflow D), the same height as the rows under it. */
  dense?: boolean;
  /** Not yet usable, such as while its choices are still loading. */
  disabled?: boolean;
  /** Filled in by a guess rather than chosen: said in italic on the phone (the desk draws it plain), with why on hover and to a reader. */
  guessed?: string | null;
  /**
   * Text pasted into the cell that names no choice yet (a card's digits, an account's name): shown in the empty cell with a
   * dashed line, and its `adds` offered first in the list ("Not in cicis yet"), which a click on the cell opens.
   */
  pending?: { text: string | null; adds: readonly ComboAdd[] } | null;
  className?: string;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const listId = useId();
  const field = useRef<HTMLInputElement>(null);
  // The desk's table scrolls sideways, which would cut a list hanging below its last rows: the dense list is placed on
  // the window instead, under the cell (or over it, near the window's foot), and follows a scroll.
  const [place, setPlace] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open || !dense) return;
    const measure = () => {
      const rect = field.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      // Kept inside the window on the right: the list may be wider than its cell.
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 330) - 8));
      setPlace(
        below < 270 && rect.top > below
          ? { position: 'fixed', left, bottom: window.innerHeight - rect.top + 4, width: rect.width }
          : { position: 'fixed', left, top: rect.bottom + 4, width: rect.width },
      );
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, dense]);
  const selected = options.find((option) => option.value === value);

  const tokens = searchTokens(query ?? '');
  const matching = options.filter((option) => {
    const text = `${option.label} ${option.meta ?? ''} ${option.detail ?? ''} ${option.keywords ?? ''}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  });

  // The adds lead the list while nothing is typed; typing narrows the choices already there, as before.
  const adds = pending && !selected && !(query ?? '').trim() ? pending.adds : [];
  const items: ({ add: ComboAdd } | { option: ComboOption })[] = [...adds.map((add) => ({ add })), ...matching.map((option) => ({ option }))];
  const shownPending = pending?.text && !selected && query === null ? pending.text : null;

  function take(item: (typeof items)[number] | undefined) {
    if (item && 'add' in item) {
      setQuery(null);
      setOpen(false);
      item.add.onPick();
    } else choose(item?.option);
  }

  function choose(option: ComboOption | undefined) {
    if (option) onChange(option.value);
    setQuery(null);
    setOpen(false);
  }

  function settle() {
    if (query === null) return;
    if (query.trim() === '') onChange('');
    else {
      const hit = resolve?.(query) ?? (matching.length === 1 ? matching[0]!.value : null);
      if (hit !== null) onChange(hit);
    }
    setQuery(null);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setIndex(Math.max(0, items.findIndex((item) => 'option' in item && item.option.value === value)));
      } else setIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && open) {
      // Taken here, so the row does not save on the same key press that picked the choice.
      event.preventDefault();
      event.stopPropagation();
      take(items[index]);
    } else if (event.key === 'Tab' && open && query) {
      take(items[index]);
    } else if (event.key === 'Escape' && (open || query !== null)) {
      event.stopPropagation();
      setQuery(null);
      setOpen(false);
    }
  }

  return (
    <div className={cx('relative', className)}>
      {selected?.icon && query === null && <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2">{selected.icon}</span>}
      <input
        ref={field}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={query ?? selected?.label ?? ''}
        placeholder={placeholder}
        onFocus={(event) => event.currentTarget.select()}
        // A cell holding pasted text not in cicis yet opens its list on a click: what to add comes first.
        onClick={() => {
          if (!pending?.adds.length || selected || open) return;
          setOpen(true);
          setIndex(0);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setIndex(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={settle}
        title={guessed && query === null ? guessed : shownPending ? 'Not in cicis yet' : undefined}
        aria-description={guessed && query === null ? guessed : shownPending ? `Not in cicis yet: ${shownPending}` : undefined}
        data-guessed={guessed && query === null ? 'true' : undefined}
        className={cx(
          dense
            ? 'h-[30px] w-full rounded-[5px] bg-transparent px-2 text-[13px] placeholder:text-[var(--ph-ink-3)] focus:bg-[var(--ph-surface)] focus:outline-2 focus:outline-[var(--mac-accent)]'
            : 'h-9 w-full rounded-md bg-transparent px-2 text-base md:text-sm focus:bg-white focus:outline-2 focus:outline-slate-900',
          Boolean(selected?.icon) && query === null && 'pl-9',
          // The digits stand at the right edge, lined up with the rows above and below; a long name ends in "…" before them.
          Boolean(selected?.meta) && query === null && 'truncate pr-12',
          // The desk's table draws no missing cell (option E): blank is just blank.
          invalid && !dense && 'bg-amber-50 ring-1 ring-amber-400 ring-inset',
          // The desk draws a guess like any other value (owner, 21 Nov: the row's Record button already says it waits);
          // why it was guessed stays on hover and for a reader.
          guessed && query === null && !dense && 'text-[var(--ph-ink-2)] italic',
        )}
      />
      {shownPending && (
        <span className={cx('pointer-events-none absolute inset-y-0 left-2 flex max-w-[calc(100%-16px)] items-center', dense ? 'text-[13px]' : 'text-base md:text-sm')}>
          <span data-testid="paid-pending" className="truncate border-b border-dashed border-[var(--ph-ink-3)] leading-[15px]">
            {shownPending}
          </span>
        </span>
      )}
      {selected?.meta && query === null && (
        <span className={cx('tabular pointer-events-none absolute top-1/2 right-2 -translate-y-1/2', dense ? 'text-[11px]' : 'text-xs font-semibold text-slate-600')}>{selected.meta}</span>
      )}
      {open && (
        <ul id={listId} role="listbox" style={dense && place ? place : undefined} className={cx(dense && place ? 'z-40' : 'absolute left-0 z-30 mt-1', 'max-h-64 w-full overflow-y-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200', adds.length > 0 ? 'min-w-[320px]' : 'min-w-64')}>
          {adds.length > 0 && (
            <>
              <li role="presentation" className="px-2 pt-1 pb-0.5 text-[11px] font-semibold text-slate-500">
                Not in cicis yet
              </li>
              {adds.map((add, i) => (
                <li
                  key={add.key}
                  role="option"
                  aria-selected={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    take({ add });
                  }}
                  className={cx('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm', i === index && 'bg-slate-100')}
                >
                  <span className="min-w-0 truncate">{add.label}</span>
                  {add.meta && <span className="tabular ml-auto whitespace-nowrap text-xs text-slate-500">{add.meta}</span>}
                </li>
              ))}
              <li role="presentation" className="mx-1 my-1 h-px bg-slate-200" />
              <li role="presentation" className="px-2 pt-0.5 pb-0.5 text-[11px] font-semibold text-slate-500">
                Or pick one already there
              </li>
            </>
          )}
          {matching.length === 0 && <li className="px-2 py-2 text-xs text-slate-500">Nothing matches.</li>}
          {matching.map((option, at) => {
            const i = adds.length + at;
            return (
            <li
              key={option.value}
              role="option"
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(event) => {
                // Chosen before the input loses focus, so the blur does not read the half-typed text instead.
                event.preventDefault();
                choose(option);
              }}
              className={cx('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm', i === index && 'bg-slate-100')}
            >
              {option.icon}
              <span className="min-w-0 truncate">{option.label}</span>
              {(option.meta ?? option.detail) && <span className="tabular ml-auto whitespace-nowrap text-xs text-slate-500">{option.meta ?? option.detail}</span>}
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
