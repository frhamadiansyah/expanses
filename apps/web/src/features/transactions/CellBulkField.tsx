import { useLayoutEffect, useRef, useState } from 'react';
import type { CellColumn } from './cell-range';

/** A column, as the one-value field names it. */
const COLUMN_WORD: Record<CellColumn, string> = { date: 'Date', description: 'Note', category: 'Category', paid: 'Payment method', amount: 'Amount' };

/**
 * One value for several picked cells (owner, 2026-11-24, Review's header filters, frame 2): a letter typed with two
 * cells or more picked opens this small field over the top one, begun with that letter. Return puts what it holds into
 * every picked cell (`useCellRange`'s paste path: the same skips, refusals and Undo); Esc, or leaving it, lets it go.
 */
export function CellBulkField({
  bulk,
  onDone,
  onCancel,
}: {
  bulk: { column: CellColumn; ids: readonly string[]; typed: string };
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(bulk.typed);
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const label = `${COLUMN_WORD[bulk.column]} for ${bulk.ids.length} rows`;

  // Over the top picked cell (under it when there is no room above), as wide as the cell, and never narrower than a word.
  useLayoutEffect(() => {
    const top = [...document.querySelectorAll<HTMLElement>('[data-cell]')].find((el) => el.dataset.cell === bulk.column && el.dataset.cellRow === bulk.ids[0]);
    const rect = top?.getBoundingClientRect();
    setPlace(rect ? { top: rect.top - 46 >= 8 ? rect.top - 46 : rect.bottom + 6, left: rect.left, width: Math.max(rect.width, 280) } : { top: 80, left: 80, width: 280 });
  }, [bulk]);
  // The keyboard goes to the field once it is placed (a hidden field takes no focus), the caret after the letter.
  useLayoutEffect(() => {
    const input = field.current;
    if (!place || !input || document.activeElement === input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [place]);

  const finish = (run: () => void) => {
    if (settled.current) return;
    settled.current = true;
    run();
  };

  return (
    <div
      role="dialog"
      aria-label={label}
      data-testid="cell-bulk"
      style={place ? { top: place.top, left: place.left, width: place.width } : { visibility: 'hidden' }}
      className="fixed z-[60] flex items-center gap-[8px] rounded-[10px] bg-[var(--mk-field)] px-[10px] py-[7px] text-[13px] text-[var(--mk-ink)] shadow-[0_8px_26px_rgb(0_0_0/0.16)] ring-[1.5px] ring-[var(--mk-blue)]"
    >
      <span className="shrink-0 whitespace-nowrap text-[var(--mk-ink-2)]">{label}</span>
      <input
        ref={field}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            finish(() => onDone(text));
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(onCancel);
          }
        }}
        onBlur={() => finish(onCancel)}
        className="min-w-0 flex-1 bg-transparent font-medium outline-none"
      />
      <span className="shrink-0 text-[11px] text-[var(--mk-ink-3)]">Return</span>
    </div>
  );
}
