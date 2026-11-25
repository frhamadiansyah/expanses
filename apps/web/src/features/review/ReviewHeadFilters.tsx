import { ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../../ui';
import { type ColumnSort, HEAD, HEAD_ON, HeadPopover, OnHead, SortPart, sortArrow } from '../transactions/ColumnHead';
import { monthBounds, NONE, whenFilterText } from './review-desk-model';

/*
 * Mac Review's header filters (owner, 2026-11-24: docs/mockups/2026-11-24-mac-review-header-filter.html): the table's
 * own column names are the filters, so nothing new sits on the page. A header with a filter on is blue and says what
 * it holds, with ✕ to take it off.
 */

/** Note: a click turns the name into a search field that narrows as typed; ⌘F opens it too. */
export function NoteHead({ value, open, onOpen, onClose, onChange }: { value: string; open: boolean; onOpen: () => void; onClose: () => void; onChange: (value: string) => void }) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      field.current?.focus();
      field.current?.select();
    }
  }, [open]);
  if (open)
    return (
      <span className={cx(HEAD, HEAD_ON, 'w-full max-w-[260px] py-[2px]')}>
        <Search size={12} strokeWidth={2.4} aria-hidden className="shrink-0" />
        <input
          ref={field}
          aria-label="Filter by note"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
          onBlur={onClose}
          className="min-w-0 flex-1 rounded-[5px] bg-[var(--mk-field)] px-[6px] py-[1px] font-normal text-[var(--mk-ink)] outline-none"
        />
        {value && (
          <button type="button" aria-label="Clear the Note filter" onMouseDown={(event) => event.preventDefault()} onClick={() => onChange('')} className="rounded-full p-[2px] opacity-70 hover:opacity-100">
            <X size={12} strokeWidth={2.6} aria-hidden />
          </button>
        )}
      </span>
    );
  if (value.trim()) return <OnHead name="Note" text={value.trim()} icon={<Search size={12} strokeWidth={2.4} aria-hidden />} onOpen={onOpen} onClear={() => onChange('')} />;
  return (
    <button type="button" onClick={onOpen} className={HEAD} title="Filter by note (⌘F)">
      Note
    </button>
  );
}

/** Date (Cashflow's column name, owner 2026-11-24): From and To, both days kept, with This month, Last month and Any time. */
export function WhenHead({
  from,
  to,
  today,
  sort,
  onChange,
}: {
  from: string | null;
  to: string | null;
  today: string;
  /** Sort by date, at the top of the menu (owner 2026-11-25). */
  sort?: ColumnSort;
  onChange: (from: string | null, to: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const on = from !== null || to !== null;
  const chip = (label: string, bounds: { from: string; to: string } | null) => {
    const chosen = bounds ? bounds.from === from && bounds.to === to : !on;
    return (
      <button
        type="button"
        onClick={() => onChange(bounds?.from ?? null, bounds?.to ?? null)}
        className={cx('rounded-full px-[10px] py-[4px] text-[12px]', chosen ? 'bg-[var(--mk-blue)] text-white' : 'bg-[var(--mk-pill)] hover:bg-[var(--mk-pill-hover)]')}
      >
        {label}
      </button>
    );
  };
  const day = (label: string, value: string | null, set: (value: string | null) => void) => (
    <label className="my-[6px] flex items-center gap-[10px]">
      <span className="w-[42px] text-[var(--mk-ink-2)]">{label}</span>
      <input
        type="date"
        aria-label={`${label} date`}
        value={value ?? ''}
        onChange={(event) => set(event.target.value || null)}
        className="min-w-[150px] rounded-[8px] border border-[var(--mk-field-line)] bg-[var(--mk-field)] px-[10px] py-[4px] text-[var(--mk-ink)]"
      />
    </label>
  );
  return (
    <span ref={anchor} className="inline-flex">
      {on ? (
        <OnHead name="Date" text={`Date${sortArrow(sort?.dir ?? null)}: ${whenFilterText(from, to)}`} onOpen={() => setOpen((was) => !was)} onClear={() => onChange(null, null)} />
      ) : (
        <button type="button" onClick={() => setOpen((was) => !was)} className={HEAD} aria-expanded={open}>
          Date{sortArrow(sort?.dir ?? null)} <ChevronDown size={13} strokeWidth={2.4} aria-hidden className="opacity-70" />
        </button>
      )}
      {open && (
        <HeadPopover anchor={anchor.current} label="Date filter" onClose={() => setOpen(false)}>
          {sort && <SortHead sort={sort} onDone={() => setOpen(false)} />}
          {day('From', from, (value) => onChange(value, to))}
          {day('To', to, (value) => onChange(from, value))}
          <div className="mt-[10px] flex gap-[6px]">
            {chip('This month', monthBounds(today, 0))}
            {chip('Last month', monthBounds(today, 1))}
            {chip('Any time', null)}
          </div>
        </HeadPopover>
      )}
    </span>
  );
}

/** Category or Paid with: one value from a short list, or none ("No category"). */
export function ChoiceHead({
  name,
  noneLabel,
  value,
  options,
  sort,
  onChange,
}: {
  name: string;
  noneLabel: string;
  /** Sort by this column's names, at the top of the menu (owner 2026-11-25). */
  sort?: ColumnSort;
  /** The value held: an id, `NONE`, or null for any. */
  value: string | null;
  options: readonly { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const label = value === null ? '' : value === NONE ? noneLabel : (options.find((option) => option.value === value)?.label ?? noneLabel);
  const item = (key: string | null, text: string) => (
    <button
      key={key ?? 'any'}
      type="button"
      role="menuitemradio"
      aria-checked={value === key}
      onClick={() => {
        onChange(key);
        setOpen(false);
      }}
      className={cx('flex w-full items-center rounded-[8px] px-[8px] py-[5px] text-left hover:bg-[var(--mk-pill)]', value === key && 'font-semibold text-[var(--mk-blue)]')}
    >
      <span className="truncate">{text}</span>
    </button>
  );
  return (
    <span ref={anchor} className="inline-flex">
      {value !== null ? (
        <OnHead name={name} text={`${sortArrow(sort?.dir ?? null).trim() ? `${sortArrow(sort?.dir ?? null).trim()} ` : ''}${label}`} onOpen={() => setOpen((was) => !was)} onClear={() => onChange(null)} />
      ) : (
        <button type="button" onClick={() => setOpen((was) => !was)} className={HEAD} aria-expanded={open}>
          {name}
          {sortArrow(sort?.dir ?? null)} <ChevronDown size={13} strokeWidth={2.4} aria-hidden className="opacity-70" />
        </button>
      )}
      {open && (
        <HeadPopover anchor={anchor.current} label={`${name} filter`} onClose={() => setOpen(false)}>
          {sort && <SortHead sort={sort} onDone={() => setOpen(false)} />}
          <div role="menu" aria-label={`${name} filter`} className="max-h-[300px] overflow-y-auto">
            {item(null, 'Any')}
            {item(NONE, noneLabel)}
            {options.map((option) => item(option.value, option.label))}
          </div>
        </HeadPopover>
      )}
    </span>
  );
}

/** A header's Sort, above its filter: the two orders, and a line under them. */
function SortHead({ sort, onDone }: { sort: ColumnSort; onDone: () => void }) {
  return (
    <div className="-mx-[4px] -mt-[4px] mb-[8px] border-b border-[var(--mk-line)] pb-[6px]">
      <SortPart sort={sort} onDone={onDone} />
    </div>
  );
}
