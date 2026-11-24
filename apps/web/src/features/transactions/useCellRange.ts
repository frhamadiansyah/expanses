import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import type { CellPick } from './cell-look';
import { type CellColumn, type CellRange, extendRange, fillReach, isCellColumn, movePick, pasteAssignments, pastedLines, rangeIds, rangeKey, rowAtHeight, startRange, stretchPick } from './cell-range';

/**
 * The blue cells of a Mac table (`cell-range`): which cells are picked, and the mouse and keys that pick and use them.
 *
 * A table marks each of its cells `data-cell="<column>"` and `data-cell-row="<row id>"`, and spreads `containerProps` on
 * what holds its rows. A click on a cell types in it (a cell with a field) or opens its row; it picks nothing. Cells are
 * picked (blue) by Esc in a cell being typed in, by a drag down a column, or by ⇧-click when `shiftExtends` says so (a
 * table whose ⇧-click already picks rows keeps that until cells are blue). While cells are picked — one or several —
 * the arrows move the blue, ⇧↑ ⇧↓ stretch it down its column, ⌘C copies, ⌘V pastes, ⌘D fills down, Delete clears,
 * Return types in the cell (or, for several Category or Paid with cells, asks for one choice; so does a double-click on
 * them), a letter starts typing in the cell in its place, and Esc lets go. The fill square at the blue's corner,
 * dragged down its column, fills the cells it reaches with the top blue cell's value as ⌘D does (Esc mid-drag lets
 * it go, filling nothing), and leaves the whole filled run blue. Nothing here writes: the table's callbacks do, by its
 * own single edit's path.
 *
 * While cells are picked the keyboard rests on a hidden text box holding what they say, selected (`sink`). The Mac
 * app's web view hands ⌘C and ⌘V to the page as keys only when nothing is focused — no copy, no paste — and copies or
 * pastes only with a field focused (seen in a Mac build, 24 Nov 2026), so this is what lets them work there; in a
 * browser it changes nothing. Esc, the arrows, Return and letters reach the page there as anywhere.
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
  /** Whether ⇧-click on a cell stretches this range (rather than leaving the click to the row) while nothing is picked. */
  shiftExtends: (range: CellRange, picked: readonly string[]) => boolean;
  /** Called as cells are picked: the row selection and its peek step aside. */
  onStart?: () => void;
  copyText: (column: CellColumn, ids: readonly string[]) => string;
  onPaste: (column: CellColumn, assignments: { id: string; text: string }[]) => void;
  onFill: (column: CellColumn, ids: readonly string[]) => void;
  onClear: (column: CellColumn, ids: readonly string[]) => void;
  /** Return or a double-click on Category or Paid with cells (Return on one with no field to type in): the usual picker, its choice for them all. */
  onPick: (column: CellColumn, ids: readonly string[]) => void;
  enabled?: boolean;
}) {
  const [range, setRangeState] = useState<CellRange | null>(null);
  /** Whether the range is picked (blue), not just the cell last clicked. */
  const [held, setHeld] = useState(false);
  /** The cells ⌘C copied from, dashed until a paste or Esc. */
  const [copied, setCopied] = useState<{ column: CellColumn; ids: string[] } | null>(null);
  const picked = rangeIds(range, ids);
  const active = enabled && range !== null && picked.length > 0 && held;
  const container = useRef<HTMLElement | null>(null);
  const sink = useRef<HTMLTextAreaElement | null>(null);
  const drag = useRef<{ column: CellColumn; anchor: string; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const pressedInRange = useRef<{ column: CellColumn; id: string } | null>(null);
  const settle = useRef<number | null>(null);
  /** The fill square being dragged: down which column, from which blue cells; `reach` the cells below it covers. */
  const fill = useRef<{ column: CellColumn; block: string[] } | null>(null);
  const [reach, setReachState] = useState<string[]>([]);
  const reachNow = useRef<string[]>([]);
  const setReach = (next: string[]) => {
    reachNow.current = next;
    setReachState(next);
  };

  /** The cell last clicked (typed in, not blue): the start a ⇧-click or a drag reaches from. */
  const clicked = (next: CellRange | null) => {
    setRangeState(next);
    setHeld(false);
    setCopied(null);
  };
  /** Cells picked: blue. */
  const hold = (next: CellRange) => {
    setRangeState(next);
    setHeld(true);
  };
  const letGo = () => clicked(null);

  /** The fill square let go of: its reach cleared, the pointer back. */
  const endFill = () => {
    fill.current = null;
    setReach([]);
    document.documentElement.style.removeProperty('cursor');
  };

  // What the document's listeners read: the newest of everything, without listening again on every render.
  const now = useRef({ range, picked, active, ids, copyText, onPaste, onFill, onClear, onPick, onStart });
  now.current = { range, picked, active, ids, copyText, onPaste, onFill, onClear, onPick, onStart };

  const cellOf = (target: EventTarget | null): { column: CellColumn; id: string; el: HTMLElement } | null => {
    // A cell's own list of choices hangs inside the cell but is no part of it: a press on a choice starts no drag, or the
    // list, gone on that press, would leave the pointer over the rows it covered and stretch a range to them (owner's
    // video, 24 Nov: four Category cells picked after choosing one).
    if ((target as HTMLElement | null)?.closest?.('[role="listbox"]')) return null;
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-cell]');
    const column = el?.dataset.cell;
    const id = el?.dataset.cellRow;
    return el && isCellColumn(column) && id ? { column, id, el } : null;
  };
  const cellEl = (column: CellColumn, id: string) =>
    [...(container.current?.querySelectorAll<HTMLElement>('[data-cell]') ?? [])].find((el) => el.dataset.cell === column && el.dataset.cellRow === id) ?? null;
  /** The keyboard rests on the hidden box once cells are blue, its words selected for ⌘C. */
  const rest = () => {
    const box = sink.current;
    if (!box) return;
    if (document.activeElement !== box) box.focus({ preventScroll: true });
    box.select();
  };
  const begin = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.getSelection()?.removeAllRanges();
    now.current.onStart?.();
    rest();
  };
  const clearSettle = () => {
    if (settle.current !== null) window.clearTimeout(settle.current);
    settle.current = null;
  };

  // The hidden box: in the page while the table is, out of sight and out of the way of the pointer.
  useEffect(() => {
    if (!enabled) return;
    const box = document.createElement('textarea');
    box.dataset.cellSink = 'true';
    box.setAttribute('aria-label', 'Picked cells');
    box.tabIndex = -1;
    box.spellcheck = false;
    box.setAttribute('autocomplete', 'off');
    box.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;resize:none;border:0;padding:0;';
    // Nothing is ever typed into it: what lands there (a paste no cell took) is put back.
    box.addEventListener('input', () => {
      const { active: on, range: r, picked: cells } = now.current;
      box.value = on && r ? now.current.copyText(r.column, cells) : '';
      box.select();
    });
    document.body.appendChild(box);
    sink.current = box;
    return () => {
      box.remove();
      sink.current = null;
    };
  }, [enabled]);

  // The box holds what the blue cells say, selected, so the web view's own Copy copies them too.
  const text = active && range ? copyText(range.column, picked) : '';
  useEffect(() => {
    const box = sink.current;
    if (!box) return;
    box.value = text;
    if (active) {
      const focused = document.activeElement;
      if (focused === box || focused === document.body || focused === null) rest();
    } else if (document.activeElement === box) box.blur();
  }, [active, text]);

  useEffect(() => {
    if (!enabled) return;
    const typingIn = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el || el === sink.current) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
    };
    const covered = () => document.querySelector('[role="dialog"]') !== null;
    const up = () => {
      if (drag.current?.moved) swallowClick.current = true;
      drag.current = null;
      const filling = fill.current;
      if (!filling) return;
      const cells = reachNow.current;
      endFill();
      if (cells.length === 0) return;
      // As ⌘D: the top blue cell's value into every cell below it, by the table's own fill; the whole run stays blue.
      now.current.onFill(filling.column, [...filling.block, ...cells]);
      hold({ column: filling.column, anchor: filling.block[0]!, focus: cells[cells.length - 1]! });
    };
    /** The fill square dragged: the row under the pointer, read down its column, sets how far it reaches. */
    const move = (event: MouseEvent) => {
      const filling = fill.current;
      if (!filling) return;
      // The button let go where no mouseup reached the page (another window, a sheet): the drag ends, filling nothing.
      if ((event.buttons & 1) === 0) {
        endFill();
        return;
      }
      const rows = now.current.ids;
      const tops = rows.flatMap((id) => {
        const el = cellEl(filling.column, id);
        return el ? [{ id, top: el.getBoundingClientRect().top }] : [];
      });
      const next = fillReach(rows, filling.block, rowAtHeight(tops, event.clientY));
      if (next.join(',') !== reachNow.current.join(',')) setReach(next);
    };
    const leave = () => {
      if (fill.current) endFill();
    };
    // A press anywhere outside the table (and not in a sheet over it) lets the range go.
    const away = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (container.current?.contains(target) || covered()) return;
      if ((target as HTMLElement | null)?.closest?.('[role="dialog"], [role="listbox"]')) return;
      letGo();
    };
    /** Typing in a picked cell: its field takes the keyboard, holding `typed` in place of what it held when given. */
    const typeIn = (column: CellColumn, id: string, typed: string | null): boolean => {
      const field = cellEl(column, id)?.querySelector<HTMLInputElement>('input:not([disabled])');
      if (!field) return false;
      clicked(startRange(column, id));
      field.focus();
      if (typed !== null) {
        // Set as the browser sets a typed value, so the cell's own change (React's) reads it.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, typed);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const end = field.value.length;
      field.setSelectionRange(end, end);
      return true;
    };
    /** Esc in a cell being typed in: the typing stops, what was typed is kept (as leaving the row keeps it), and the cell is picked. */
    const escToPick = (event: KeyboardEvent): boolean => {
      if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return false;
      const field = event.target as HTMLElement | null;
      if (!field || field.tagName !== 'INPUT' || !container.current?.contains(field) || covered()) return false;
      // A cell's list, open, closes first (its own Esc); the next Esc picks the cell.
      if (field.getAttribute('aria-expanded') === 'true') return false;
      const cell = cellOf(field);
      if (!cell) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      setCopied(null);
      hold(startRange(cell.column, cell.id));
      begin();
      return true;
    };
    const keys = (event: KeyboardEvent) => {
      const { active: on, range: r, picked: cells, ids: rows } = now.current;
      // Mid-drag, the fill square answers Esc alone: let go, nothing filled.
      if (fill.current) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          endFill();
        }
        return;
      }
      if (!on) {
        escToPick(event);
        return;
      }
      if (!r || covered() || event.isComposing) return;
      const asked = rangeKey(event, typingIn(event.target));
      if (!asked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const show = (next: CellRange) => {
        hold(next);
        cellEl(next.column, next.focus)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        rest();
      };
      switch (asked) {
        case 'close':
          letGo();
          return;
        case 'fill':
          if (cells.length >= 2) now.current.onFill(r.column, cells);
          return;
        case 'clear':
          now.current.onClear(r.column, cells);
          return;
        case 'up':
        case 'down':
        case 'left':
        case 'right': {
          const columns = [...(container.current?.querySelectorAll<HTMLElement>('[data-cell]') ?? [])]
            .filter((el) => el.dataset.cellRow === r.focus)
            .map((el) => el.dataset.cell)
            .filter(isCellColumn);
          show(movePick(r, rows, columns, asked));
          return;
        }
        case 'more up':
        case 'more down':
          show(stretchPick(r, rows, asked === 'more up' ? -1 : 1));
          return;
        case 'type':
          // A letter types in the far cell of the blue, in place of what it held (a sheet's way), when it has a field.
          typeIn(r.column, r.focus, event.key);
          return;
        case 'pick':
          if (cells.length === 1) {
            if (typeIn(r.column, r.focus, null)) return;
          }
          if (r.column === 'category' || r.column === 'paid') now.current.onPick(r.column, cells);
          return;
      }
    };
    const copy = (event: ClipboardEvent) => {
      const { active: on, range: r, picked: cells } = now.current;
      if (!on || !r || typingIn(event.target) || covered()) return;
      event.clipboardData?.setData('text/plain', now.current.copyText(r.column, cells));
      // From the hidden box, its own copy stands: it holds these words, selected, and the Mac app's web view puts on
      // the clipboard what was selected but not what a page sets (seen in a Mac build, 24 Nov 2026). From anywhere
      // else (nothing focused, in a browser), the words set here are the copy.
      if (event.target !== sink.current) event.preventDefault();
      setCopied({ column: r.column, ids: [...cells] });
    };
    const paste = (event: ClipboardEvent) => {
      const { active: on, range: r, picked: cells } = now.current;
      // Into the picked cells only: a row merely clicked (its peek open) is never pasted over.
      if (!on || !r || typingIn(event.target) || covered()) return;
      event.preventDefault();
      const lines = pastedLines(event.clipboardData?.getData('text/plain') ?? '');
      if (lines.length === 0) return;
      setCopied(null);
      now.current.onPaste(r.column, pasteAssignments(cells, lines));
    };
    document.addEventListener('mouseup', up);
    document.addEventListener('mousemove', move);
    window.addEventListener('blur', leave);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', keys, true);
    document.addEventListener('copy', copy);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('mouseup', up);
      document.removeEventListener('mousemove', move);
      window.removeEventListener('blur', leave);
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
      // The fill square: its own drag, never a run of cells, a row picked or the peek opened.
      if ((event.target as HTMLElement | null)?.closest?.('[data-fill-square]')) {
        event.preventDefault();
        event.stopPropagation();
        swallowClick.current = true;
        if (active && range) {
          fill.current = { column: range.column, block: [...picked] };
          setReach([]);
          document.documentElement.style.setProperty('cursor', 'crosshair');
          rest();
        }
        return;
      }
      const cell = cellOf(event.target);
      if (!cell) return;
      const { column, id } = cell;
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      if (event.shiftKey && plain && range && range.column === column && (active || shiftExtends(range, picked))) {
        event.preventDefault();
        swallowClick.current = true;
        hold(extendRange(range, column, id));
        begin();
        return;
      }
      if (!plain || event.shiftKey) {
        letGo();
        return;
      }
      // A press inside several blue cells keeps them, for a double-click to ask for one choice; a single click lets them go.
      if (active && picked.length >= 2 && range?.column === column && picked.includes(id)) {
        event.preventDefault();
        swallowClick.current = true;
        pressedInRange.current = { column, id };
        return;
      }
      clicked(startRange(column, id));
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
      hold({ column: held.column, anchor: held.anchor, focus: cell.id });
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
          clicked(startRange(pressed.column, pressed.id));
          // A draft's cell is typed in, as a single click on it always was.
          target?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus();
        }, 280);
      }
    },
    onDoubleClickCapture: (event: ReactMouseEvent) => {
      const cell = cellOf(event.target);
      if (!active || picked.length < 2 || !range || !cell || cell.column !== range.column || !picked.includes(cell.id)) return;
      event.stopPropagation();
      event.preventDefault();
      clearSettle();
      if (range.column === 'category' || range.column === 'paid') onPick(range.column, picked);
    },
  };

  /**
   * What a row's cells show of the blue cells (`cell-look`), while cells are picked: its picked cell, where it sits in
   * the block, and the cell ⌘C copied from (until a paste); null for a row with neither.
   */
  const cellPick = (id: string): CellPick | null => {
    if (!active || !range) return null;
    const at = picked.indexOf(id);
    const copiedHere = copied && copied.ids.includes(id) ? copied.column : null;
    const reached = reach.indexOf(id);
    if (at < 0 && !copiedHere && reached < 0) return null;
    return {
      column: at < 0 ? null : range.column,
      copied: copiedHere,
      many: picked.length >= 2,
      top: at === 0,
      bottom: at === picked.length - 1,
      corner: at >= 0 && at === picked.length - 1,
      reach: reached < 0 ? null : reached === reach.length - 1 ? 'end' : 'middle',
      reachColumn: reached < 0 ? null : range.column,
    };
  };

  return {
    range,
    picked,
    active,
    setRange: (next: CellRange | null) => (next ? hold(next) : letGo()),
    containerProps,
    cellPick,
    clear: letGo,
  };
}
