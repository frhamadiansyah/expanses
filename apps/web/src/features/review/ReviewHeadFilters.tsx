import { ChevronDown, Search, X } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../../ui';
import { monthBounds, NONE, whenFilterText } from './review-desk-model';

/*
 * Mac Review's header filters (owner, 2026-11-24: docs/mockups/2026-11-24-mac-review-header-filter.html): the table's
 * own column names are the filters, so nothing new sits on the page. A header with a filter on is blue and says what
 * it holds, with ✕ to take it off.
 */

/** A column name that opens its filter; blue while one is on. */
const HEAD = 'inline-flex items-center gap-[5px] whitespace-nowrap rounded-[7px] px-[8px] py-[3px] -ml-[8px] hover:bg-[var(--mk-pill)]';
const HEAD_ON = 'bg-[var(--mk-sel)] text-[var(--mk-blue)] hover:bg-[var(--mk-sel)]';

/** A header's filter as it stands: blue, saying what it holds, with ✕ to take it off. */
function OnHead({ name, text, icon, onOpen, onClear }: { name: string; text: string; icon?: ReactNode; onOpen?: () => void; onClear: () => void }) {
  return (
    <span className={cx(HEAD, HEAD_ON, 'pr-[4px]')} data-testid={`filter-${name.toLowerCase().replace(/\s+/g, '-')}`} data-on="true">
      <button type="button" onClick={onOpen} className="inline-flex shrink-0 items-center gap-[5px] font-semibold" title={`${name} filter`}>
        {icon}
        <span className="max-w-[170px] truncate">{text}</span>
      </button>
      <button type="button" aria-label={`Clear the ${name} filter`} onClick={onClear} className="rounded-full p-[2px] opacity-70 hover:opacity-100">
        <X size={12} strokeWidth={2.6} aria-hidden />
      </button>
    </span>
  );
}

/** A small panel under a header: closes on Esc and on a press outside it. */
function HeadPopover({ anchor, label, onClose, children }: { anchor: HTMLElement | null; label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const rect = anchor?.getBoundingClientRect();
    if (rect) setPlace({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - 300)) });
  }, [anchor]);
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
      style={place ?? { visibility: 'hidden' }}
      className="fixed z-[60] min-w-[220px] rounded-[14px] bg-[var(--mk-panel)] p-[12px] text-[13px] font-normal text-[var(--mk-ink)] shadow-[0_12px_40px_rgb(0_0_0/0.18),0_0_0_1px_rgb(0_0_0/0.06)]"
    >
      {children}
    </div>
  );
}

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

/** When: From and To, both days kept, with This month, Last month and Any time. */
export function WhenHead({ from, to, today, onChange }: { from: string | null; to: string | null; today: string; onChange: (from: string | null, to: string | null) => void }) {
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
        <OnHead name="When" text={`When: ${whenFilterText(from, to)}`} onOpen={() => setOpen((was) => !was)} onClear={() => onChange(null, null)} />
      ) : (
        <button type="button" onClick={() => setOpen((was) => !was)} className={HEAD} aria-expanded={open}>
          When <ChevronDown size={13} strokeWidth={2.4} aria-hidden className="opacity-70" />
        </button>
      )}
      {open && (
        <HeadPopover anchor={anchor.current} label="When filter" onClose={() => setOpen(false)}>
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
  onChange,
}: {
  name: string;
  noneLabel: string;
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
        <OnHead name={name} text={label} onOpen={() => setOpen((was) => !was)} onClear={() => onChange(null)} />
      ) : (
        <button type="button" onClick={() => setOpen((was) => !was)} className={HEAD} aria-expanded={open}>
          {name} <ChevronDown size={13} strokeWidth={2.4} aria-hidden className="opacity-70" />
        </button>
      )}
      {open && (
        <HeadPopover anchor={anchor.current} label={`${name} filter`} onClose={() => setOpen(false)}>
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
