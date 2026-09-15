import { searchTokens } from '@expanses/core';
import { type ReactNode, useId, useState } from 'react';
import { cx } from '../../ui';

export interface ComboOption {
  value: string;
  label: string;
  /** Shown beside the label, and searched: a card's digits, a category's parent. */
  meta?: string;
  icon?: ReactNode;
  keywords?: string;
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
  className?: string;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  const tokens = searchTokens(query ?? '');
  const matching = options.filter((option) => {
    const text = `${option.label} ${option.meta ?? ''} ${option.keywords ?? ''}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  });

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
        setIndex(Math.max(0, matching.findIndex((option) => option.value === value)));
      } else setIndex((i) => Math.min(i + 1, matching.length - 1));
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && open) {
      // Taken here, so the row does not save on the same key press that picked the choice.
      event.preventDefault();
      event.stopPropagation();
      choose(matching[index]);
    } else if (event.key === 'Tab' && open && query) {
      choose(matching[index]);
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
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query ?? selected?.label ?? ''}
        placeholder={placeholder}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setIndex(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={settle}
        className={cx(
          'h-9 w-full rounded-md bg-transparent px-2 text-sm focus:bg-white focus:outline-2 focus:outline-slate-900',
          Boolean(selected?.icon) && query === null && 'pl-9',
          Boolean(selected?.meta) && query === null && 'pr-12',
          invalid && 'bg-amber-50 ring-1 ring-amber-400 ring-inset',
        )}
      />
      {selected?.meta && query === null && (
        <span className="tabular pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs font-semibold text-slate-600">{selected.meta}</span>
      )}
      {open && (
        <ul id={listId} role="listbox" className="absolute left-0 z-30 mt-1 max-h-64 w-full min-w-64 overflow-y-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200">
          {matching.length === 0 && <li className="px-2 py-2 text-xs text-slate-500">Nothing matches.</li>}
          {matching.map((option, i) => (
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
              {option.meta && <span className="tabular ml-auto whitespace-nowrap text-xs text-slate-500">{option.meta}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
