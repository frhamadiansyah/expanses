import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { type CellColumn, type CellRange, extendRange, isCellColumn, pasteAssignments, pastedLines, rangeIds, rangeKey, startRange } from './cell-range';

/**
 * The blue cells of a Mac table (`cell-range`): which cells are picked, and the mouse and keys that pick and use them.
 *
 * A table marks each of its cells `data-cell="<column>"` and `data-cell-row="<row id>"`, and spreads `containerProps` on
 * what holds its rows. A click starts a range at a cell; a drag down the same column, or ⇧-click when `shiftExtends`
 * says so (a table whose ⇧-click already picks rows keeps that), stretches it. With two cells or more picked: ⌘C copies
 * them, ⌘V pastes into them, ⌘D fills down, Delete clears, Return (or a double-click on the range) asks for one choice,
 * Esc lets go. Nothing here writes: the table's callbacks do, by its own single edit's path.
 */
export function useCellRange({
  ids,
  shiftExtends,
  onStart,
  copyText,
  onPaste,
  onFill,
  onClear,
  onPick,
  enabled = true,
}: {
  /** The rows in the table's order. */
  ids: readonly string[];
  /** Whether ⇧-click on a cell stretches this range (rather than leaving the click to the row). */
  shiftExtends: (range: CellRange, picked: readonly string[]) => boolean;
  /** Called as a range of two cells or more begins: the row selection and its peek step aside. */
  onStart?: () => void;
  copyText: (column: CellColumn, ids: readonly string[]) => string;
  onPaste: (column: CellColumn, assignments: { id: string; text: string }[]) => void;
  onFill: (column: CellColumn, ids: readonly string[]) => void;
  onClear: (column: CellColumn, ids: readonly string[]) => void;
  /** Return or a double-click on a range of Category or Paid with cells: the usual picker, its choice for them all. */
  onPick: (column: CellColumn, ids: readonly string[]) => void;
  enabled?: boolean;
}) {
  const [range, setRange] = useState<CellRange | null>(null);
  const picked = rangeIds(range, ids);
  const active = enabled && range !== null && picked.length >= 2;
  const container = useRef<HTMLElement | null>(null);
  const drag = useRef<{ column: CellColumn; anchor: string; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const pressedInRange = useRef<{ column: CellColumn; id: string } | null>(null);
  const settle = useRef<number | null>(null);

  // What the document's listeners read: the newest of everything, without listening again on every render.
  const now = useRef({ range, picked, active, copyText, onPaste, onFill, onClear, onPick });
  now.current = { range, picked, active, copyText, onPaste, onFill, onClear, onPick };

  const cellOf = (target: EventTarget | null): { column: CellColumn; id: string; el: HTMLElement } | null => {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-cell]');
    const column = el?.dataset.cell;
    const id = el?.dataset.cellRow;
    return el && isCellColumn(column) && id ? { column, id, el } : null;
  };
  const begin = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.getSelection()?.removeAllRanges();
    onStart?.();
  };
  const clearSettle = () => {
    if (settle.current !== null) window.clearTimeout(settle.current);
    settle.current = null;
  };

  useEffect(() => {
    if (!enabled) return;
    const typingIn = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const covered = () => document.querySelector('[role="dialog"]') !== null;
    const up = () => {
      if (drag.current?.moved) swallowClick.current = true;
      drag.current = null;
    };
    // A press anywhere outside the table (and not in a sheet over it) lets the range go.
    const away = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (container.current?.contains(target) || covered()) return;
      if ((target as HTMLElement | null)?.closest?.('[role="dialog"], [role="listbox"]')) return;
      setRange(null);
    };
    const keys = (event: KeyboardEvent) => {
      const { active: on, range: r, picked: cells } = now.current;
      if (!on || !r || covered()) return;
      const asked = rangeKey(event, typingIn(event.target));
      if (!asked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (asked === 'close') setRange(null);
      else if (asked === 'fill') now.current.onFill(r.column, cells);
      else if (asked === 'clear') now.current.onClear(r.column, cells);
      else if (r.column === 'category' || r.column === 'paid') now.current.onPick(r.column, cells);
    };
    const copy = (event: ClipboardEvent) => {
      const { active: on, range: r, picked: cells } = now.current;
      if (!on || !r || typingIn(event.target) || covered()) return;
      event.clipboardData?.setData('text/plain', now.current.copyText(r.column, cells));
      event.preventDefault();
    };
    const paste = (event: ClipboardEvent) => {
      const { active: on, range: r, picked: cells } = now.current;
      // Into the picked cells only: a row merely clicked (its peek open) is never pasted over.
      if (!on || !r || typingIn(event.target) || covered()) return;
      const lines = pastedLines(event.clipboardData?.getData('text/plain') ?? '');
      if (lines.length === 0) return;
      event.preventDefault();
      now.current.onPaste(r.column, pasteAssignments(cells, lines));
    };
    document.addEventListener('mouseup', up);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', keys, true);
    document.addEventListener('copy', copy);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('mouseup', up);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', keys, true);
      document.removeEventListener('copy', copy);
      document.removeEventListener('paste', paste);
      clearSettle();
    };
  }, [enabled]);

  const containerProps = {
    ref: (node: HTMLElement | null) => {
      container.current = node;
    },
    onMouseDownCapture: (event: ReactMouseEvent) => {
      if (!enabled || event.button !== 0) return;
      swallowClick.current = false;
      pressedInRange.current = null;
      clearSettle();
      const cell = cellOf(event.target);
      if (!cell) return;
      const { column, id } = cell;
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      if (event.shiftKey && plain && range && range.column === column && shiftExtends(range, picked)) {
        event.preventDefault();
        swallowClick.current = true;
        setRange(extendRange(range, column, id));
        begin();
        return;
      }
      if (!plain || event.shiftKey) {
        setRange(null);
        return;
      }
      // A press inside the range keeps it, for a double-click to ask for one choice; a single click lets it go.
      if (active && range?.column === column && picked.includes(id)) {
        event.preventDefault();
        swallowClick.current = true;
        pressedInRange.current = { column, id };
        return;
      }
      setRange(startRange(column, id));
      drag.current = { column, anchor: id, moved: false };
    },
    onMouseOver: (event: ReactMouseEvent) => {
      const held = drag.current;
      if (!held || (event.buttons & 1) === 0) return;
      const cell = cellOf(event.target);
      if (!cell || cell.column !== held.column || (cell.id === held.anchor && !held.moved)) return;
      event.preventDefault();
      if (!held.moved) {
        held.moved = true;
        begin();
      }
      setRange({ column: held.column, anchor: held.anchor, focus: cell.id });
    },
    onClickCapture: (event: ReactMouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.stopPropagation();
      event.preventDefault();
      const pressed = pressedInRange.current;
      pressedInRange.current = null;
      if (pressed && event.detail === 1) {
        const target = cellOf(event.target)?.el;
        settle.current = window.setTimeout(() => {
          settle.current = null;
          setRange(startRange(pressed.column, pressed.id));
          // A draft's cell is typed in, as a single click on it always was.
          target?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus();
        }, 280);
      }
    },
    onDoubleClickCapture: (event: ReactMouseEvent) => {
      const cell = cellOf(event.target);
      if (!active || !range || !cell || cell.column !== range.column || !picked.includes(cell.id)) return;
      event.stopPropagation();
      event.preventDefault();
      clearSettle();
      if (range.column === 'category' || range.column === 'paid') onPick(range.column, picked);
    },
  };

  /** The column a row's picked cell is in, while two cells or more are picked; null otherwise. */
  const pickedColumn = (id: string): CellColumn | null => (active && range && picked.includes(id) ? range.column : null);

  return { range, picked, active, setRange, containerProps, pickedColumn, clear: () => setRange(null) };
}
