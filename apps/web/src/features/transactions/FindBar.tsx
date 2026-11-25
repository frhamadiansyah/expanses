import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cx } from '../../ui';
import { PILL, PILL_BLUE } from '../../ui/desk';
import { FIND_FIELDS, type FindField, findSpans, foundLine } from './find-replace';

/*
 * The Find and replace bar over a Mac table (owner 2026-11-25, Sheets' ⇧⌘H): Find, the column it looks in, Replace,
 * how many rows hold the words (and how many of them are picked), Replace on picked and Replace all. Pressing in it
 * keeps the picked cells (`data-keeps-cells`), so Replace on picked can reach them. Esc closes it.
 */

export interface FindState {
  query: string;
  field: FindField;
  replacement: string;
}

export const NO_FIND: FindState = { query: '', field: 'description', replacement: '' };

/** The words found, drawn marked inside a note (the cells themselves are tinted by `foundCellsStyle`). */
export function Marked({ text, query }: { text: string; query: string }) {
  const spans = findSpans(text, query);
  if (spans.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  spans.forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={i} data-found className="rounded-[3px] bg-[var(--mk-find)] text-inherit">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** A tint on each cell found that cannot mark its words itself (a cell being typed in, a category, a payment method). */
export function foundCellsStyle(cells: readonly { id: string; column: string }[]): string {
  if (cells.length === 0) return '';
  const selectors = cells.map(({ id, column }) => `[data-cell-row="${CSS.escape(id)}"][data-cell="${column}"]`).join(',\n');
  return `${selectors} { background-color: var(--mk-find) !important; border-radius: 6px; }`;
}

export function FindBar({
  state,
  onChange,
  found,
  onPicked,
  readOnly,
  onReplace,
  onClose,
}: {
  state: FindState;
  onChange: (state: FindState) => void;
  /** How many rows hold the words, and how many of those are picked. */
  found: number;
  onPicked: number;
  readOnly: boolean;
  onReplace: (only: 'picked' | 'all') => void;
  onClose: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const esc = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  const input = 'h-[28px] w-[220px] rounded-[8px] bg-[var(--mk-field)] px-[10px] text-[13px] text-[var(--mk-ink)] ring-1 ring-[var(--mk-field-line)] outline-none focus:ring-2 focus:ring-[var(--mk-blue)]';
  const words = state.query.trim() !== '';
  // The keyboard back in Find once replaced: the button pressed may now be greyed, and Esc still closes the bar.
  const replace = (only: 'picked' | 'all') => {
    onReplace(only);
    field.current?.focus();
  };
  return (
    <div
      data-keeps-cells
      data-testid="find-bar"
      role="search"
      aria-label="Find and replace"
      onKeyDown={esc}
      className="mx-[14px] mb-[10px] flex flex-wrap items-center gap-x-[18px] gap-y-[8px] rounded-[14px] bg-[var(--mk-panel)] px-[14px] py-[10px] text-[13px] text-[var(--mk-ink)] shadow-[0_0_0_1px_var(--mk-line)]"
    >
      <div className="grid grid-cols-[auto_auto_auto] items-center gap-x-[12px] gap-y-[8px]">
        <label htmlFor="find-words" className="text-[var(--mk-ink-2)]">
          Find
        </label>
        <input id="find-words" ref={field} value={state.query} onChange={(event) => onChange({ ...state, query: event.target.value })} autoComplete="off" spellCheck={false} className={input} />
        <select
          aria-label="Find in"
          value={state.field}
          onChange={(event) => onChange({ ...state, field: event.target.value as FindField })}
          className="h-[28px] rounded-[8px] bg-transparent px-[6px] text-[13px] font-semibold text-[var(--mk-ink-2)] hover:bg-[var(--mk-pill)]"
        >
          {FIND_FIELDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {!readOnly && (
          <>
            <label htmlFor="find-replace" className="text-[var(--mk-ink-2)]">
              Replace
            </label>
            <input id="find-replace" value={state.replacement} onChange={(event) => onChange({ ...state, replacement: event.target.value })} autoComplete="off" spellCheck={false} className={input} />
            <span />
          </>
        )}
      </div>
      <div className="ml-auto flex flex-col items-end gap-[8px]">
        <span data-testid="find-count" className="text-[12.5px] text-[var(--mk-ink-2)] tabular-nums">
          {words ? foundLine(found, onPicked) : 'Type the words to find'}
        </span>
        {!readOnly && (
          <div className="flex items-center gap-[8px]">
            <button type="button" disabled={!words || onPicked === 0} onClick={() => replace('picked')} className={cx(PILL, 'h-[28px] px-[12px] text-[12.5px]')}>
              Replace on picked
            </button>
            <button type="button" disabled={!words || found === 0} onClick={() => replace('all')} className={cx(PILL_BLUE, 'h-[28px] px-[12px] text-[12.5px]')}>
              Replace all{found > 0 && words ? ` ${found}` : ''}
            </button>
          </div>
        )}
      </div>
      <button type="button" aria-label="Close Find and replace" title="Close (Esc)" onClick={onClose} className="self-start rounded-full p-[4px] text-[var(--mk-ink-2)] hover:bg-[var(--mk-pill)]">
        <X size={14} strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  );
}
