import { searchTokens } from '@expanses/core';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { cx } from '../../ui';

export interface ChipOption {
  value: string;
  label: string;
  /** Quieter text beside the label, such as a card's last four digits. */
  meta?: string;
  icon?: ReactNode;
  /** Words the option can also be found by, beyond its label and meta. */
  keywords?: string;
  indent?: boolean;
}

/**
 * A filter chip that opens a short list. A long list gets a box to type into, so a category or a card
 * is found by typing a few letters rather than scrolling.
 */
export function ChipMenu({
  name,
  value,
  options,
  onPick,
  searchable = false,
  active,
  shown,
}: {
  /** What the chip filters, shown when nothing is picked and read by screen readers either way. */
  name: string;
  value: string;
  options: readonly ChipOption[];
  onPick: (value: string) => void;
  searchable?: boolean;
  /** Draws the chip filled, to say it is narrowing the list. */
  active: boolean;
  /** What the chip reads while something is picked. */
  shown?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const tokens = searchTokens(query);
  const matching = options.filter((option) => {
    const text = `${option.label} ${option.meta ?? ''} ${option.keywords ?? ''}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  });

  function pick(option: ChipOption | undefined) {
    if (!option) return;
    onPick(option.value);
    setOpen(false);
  }

  function onKey(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => Math.min(i + 1, matching.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      pick(matching[index]);
    }
  }

  return (
    <div ref={box} className="relative" onKeyDown={onKey}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
          setQuery('');
          setIndex(Math.max(0, options.findIndex((option) => option.value === value)));
        }}
        className={cx(
          'inline-flex h-9 max-w-64 items-center gap-1.5 rounded-lg px-2.5 text-sm ring-1',
          active ? 'bg-slate-900 text-slate-300 ring-slate-900 hover:bg-slate-700' : 'bg-white text-slate-500 ring-slate-300 hover:bg-slate-100',
        )}
      >
        {/* Named in text rather than aria-label, so a form's own "Category" field keeps its label to itself. */}
        {shown ? (
          <>
            <span className="sr-only">{name}: </span>
            {shown}
          </>
        ) : (
          name
        )}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-72 rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200">
          {searchable && (
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setIndex(0);
              }}
              placeholder="Type to find"
              title={`Find in ${name.toLowerCase()}`}
              aria-controls={listId}
              className="mb-1 h-8 w-full rounded-lg border border-slate-300 px-2 text-sm focus:border-slate-900 focus:outline-none"
            />
          )}
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto">
            {matching.length === 0 && <li className="px-2 py-2 text-xs text-slate-500">Nothing matches.</li>}
            {matching.map((option, i) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
                className={cx('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm', i === index && 'bg-slate-100', option.indent && 'pl-6')}
              >
                <span className="w-3 text-xs">{option.value === value ? '✓' : ''}</span>
                {option.icon}
                <span className="min-w-0 truncate">{option.label}</span>
                {option.meta && <span className="tabular ml-auto whitespace-nowrap text-xs text-slate-500">{option.meta}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
