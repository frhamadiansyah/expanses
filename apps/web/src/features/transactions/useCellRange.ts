import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import type { CellPick } from './cell-look';
import { type CellColumn, type CellRange, columnPick, extendRange, fillReach, isCellColumn, jumpPick, movePick, pasteAssignments, pastedLines, rangeIds, rangeKey, rowAtHeight, startRange, stretchPick, stretchTo, togglePick } from './cell-range';

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
  commandPicksRows = true,
  onRecord,
  onLook,
  onMenu,
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
  /**
   * Whether ⌘-click picks rows while no cells are picked (Cashflow's Record many). Where it does not (Review), ⌘-click
   * picks the cell. Once cells are picked, ⌘-click in their column adds a cell or takes it out, in either table.
   */
  commandPicksRows?: boolean;
  /** ⌘Return with cells picked: records the rows they are in, as the table records a row. */
  onRecord?: (ids: readonly string[]) => void;
  /** Space with cells picked (Finder's quick look, owner 2026-11-25): the row of the cell last reached. */
  onLook?: (id: string) => void;
  /**
   * A right-click (or a two-finger click) on the table (owner 2026-11-25): the table's own menu at the pointer, never
   * the system's. On a cell not picked, that cell is picked first; `column` is null on a row but off its cells.
   */
  onMenu?: (at: { id: string; column: CellColumn | null; x: number; y: number }) => void;
}) {
  const [range, setRangeState] = useState<CellRange | null>(null);
  /** Whether the range is picked (blue), not just the cell last clicked. */
  const [held, setHeld] = useState(false);
  /** The cells ⌘C copied from, dashed until a paste or Esc. */
  const [copied, setCopied] = useState<{ column: CellColumn; ids: string[] } | null>(null);
  /**
   * A letter typed with several cells picked: one value for them all, in a small field over the cells (`CellBulkField`),
   * begun with that letter. Return puts it into every one by the paste's path; Esc lets it go.
   */
  const [bulk, setBulk] = useState<{ column: CellColumn; ids: string[]; typed: string } | null>(null);
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
    setBulk(null);
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
  const now = useRef({ range, picked, active, ids, copyText, onPaste, onFill, onClear, onPick, onStart, onRecord, onLook });
  now.current = { range, picked, active, ids, copyText, onPaste, onFill, onClear, onPick, onStart, onRecord, onLook };

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
      // A sheet, a cell's list, the table's own menu, or a bar that works on the picked cells (Find and replace).
      if ((target as HTMLElement | null)?.closest?.('[role="dialog"], [role="listbox"], [role="menu"], [data-keeps-cells]')) return;
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
    /**
     * Esc or Return in a cell being typed in (Notion's table, owner 2026-11-24): the typing stops, what was typed is kept
     * (as leaving the row keeps it), and the cell is picked. Nothing is recorded: ⌘Return records.
     */
    const finishToPick = (event: KeyboardEvent): boolean => {
      if ((event.key !== 'Escape' && event.key !== 'Enter') || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return false;
      const field = event.target as HTMLElement | null;
      if (!field || field.tagName !== 'INPUT' || !container.current?.contains(field) || covered()) return false;
      const cell = cellOf(field);
      if (!cell) return false;
      const pick = () => {
        setCopied(null);
        hold(startRange(cell.column, cell.id));
        begin();
      };
      if (field.getAttribute('aria-expanded') === 'true') {
        // A cell's list, open: Esc closes it first (its own Esc), the next Esc picks the cell. Return takes the choice
        // highlighted (the list's own Return), and then the cell is picked.
        if (event.key === 'Enter') window.setTimeout(() => document.activeElement === field && pick(), 0);
        return false;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      pick();
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
        finishToPick(event);
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
      const columnsOf = (id: string) =>
        [...(container.current?.querySelectorAll<HTMLElement>('[data-cell]') ?? [])]
          .filter((el) => el.dataset.cellRow === id)
          .map((el) => el.dataset.cell)
          .filter(isCellColumn);
      switch (asked) {
        case 'close':
          letGo();
          return;
        case 'look':
          now.current.onLook?.(r.focus);
          return;
        case 'first':
        case 'last':
        case 'home':
        case 'end':
          show(jumpPick(r, rows, columnsOf(r.focus), asked));
          return;
        case 'more first':
        case 'more last':
          show(stretchTo(r, rows, asked === 'more first' ? 'first' : 'last'));
          return;
        case 'column':
          show(columnPick(r, rows));
          return;
        case 'record': {
          // One row: recorded as ⌘Return in its own cells records it, with what its cells hold now (an edit just ended
          // may still be on its way to being saved). Several: the table records them together.
          const field = cells.length === 1 ? cellEl(r.column, cells[0]!)?.closest('[data-quick-row]')?.querySelector<HTMLInputElement>('input:not([disabled])') : null;
          if (field) field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
          else now.current.onRecord?.(cells);
          return;
        }
        case 'fill':
          if (cells.length >= 2) now.current.onFill(r.column, cells);
          return;
        case 'clear':
          now.current.onClear(r.column, cells);
          return;
        case 'up':
        case 'down':
        case 'left':
        case 'right':
          show(movePick(r, rows, columnsOf(r.focus), asked));
          return;
        case 'more up':
        case 'more down':
          show(stretchPick(r, rows, asked === 'more up' ? -1 : 1));
          return;
        case 'type':
          // Several cells: one value for them all, begun with the letter. One: the letter types in the cell, in place of
          // what it held (a sheet's way), when it has a field.
          if (cells.length >= 2) setBulk({ column: r.column, ids: [...cells], typed: event.key });
          else typeIn(r.column, r.focus, event.key);
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
    // A cell's field taking the keyboard while cells are picked (Tab into it, or a field focused by the page): typing
    // there now, so the blue lets go, and Esc or Return in it pick it again.
    const into = (event: FocusEvent) => {
      if (!now.current.active) return;
      const field = event.target as HTMLElement | null;
      if (!field || field.tagName !== 'INPUT' || !container.current?.contains(field)) return;
      const cell = cellOf(field);
      if (cell) clicked(startRange(cell.column, cell.id));
    };
    document.addEventListener('focusin', into);
    document.addEventListener('mouseup', up);
    document.addEventListener('mousemove', move);
    window.addEventListener('blur', leave);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', keys, true);
    document.addEventListener('copy', copy);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('focusin', into);
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
      if (!cell) {
        // A press on the table but on no cell (a row's circle, between the cells) lets the blue go, as one outside it.
        if (active && !(event.target as HTMLElement | null)?.closest?.('[role="listbox"]')) letGo();
        return;
      }
      const { column, id } = cell;
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      if (event.shiftKey && plain && range && range.column === column && (active || shiftExtends(range, picked))) {
        event.preventDefault();
        swallowClick.current = true;
        hold(extendRange(range, column, id));
        begin();
        return;
      }
      // ⌘-click: a cell added to the picked ones or taken out, in their column, next to them or not. Elsewhere it is the
      // row's own ⌘-click where ⌘-click picks rows (Cashflow); where it picks none (Review), it picks the cell — in
      // another column, a new pick there. Never the row's ⌘-click then, nor its peek.
      const command = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
      if (command && ((active && range?.column === column) || !commandPicksRows)) {
        event.preventDefault();
        event.stopPropagation();
        swallowClick.current = true;
        const next = active ? togglePick(range, ids, column, id) : startRange(column, id);
        if (!next) {
          letGo();
          return;
        }
        hold(next);
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
    onContextMenu: (event: ReactMouseEvent) => {
      if (!enabled) return;
      const cell = cellOf(event.target);
      const row = cell?.id ?? (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-peek-row], [data-row-id]');
      const id = typeof row === 'string' ? row : (row?.dataset.peekRow ?? row?.dataset.rowId);
      if (!id) return;
      // The table's own menu, never the system's (the web view's Reload, Inspect).
      event.preventDefault();
      event.stopPropagation();
      if (cell && !(active && range && picked.includes(cell.id) && range.column === cell.column)) {
        hold(startRange(cell.column, cell.id));
        begin();
      }
      onMenu?.({ id, column: cell?.column ?? null, x: event.clientX, y: event.clientY });
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
      // A block's ends are where the row above (below) is not picked: cells ⌘-clicked apart are each closed off.
      top: at >= 0 && !picked.includes(ids[ids.indexOf(id) - 1] ?? ''),
      bottom: at >= 0 && !picked.includes(ids[ids.indexOf(id) + 1] ?? ''),
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
    bulk,
    /** The one value typed for several cells: into every one by the paste's path; nothing when left blank. */
    submitBulk: (text: string) => {
      const asked = bulk;
      setBulk(null);
      rest();
      if (!asked || !text.trim()) return;
      setCopied(null);
      onPaste(asked.column, pasteAssignments(asked.ids, [text.trim()]));
    },
    cancelBulk: () => {
      setBulk(null);
      rest();
    },
    clear: letGo,
    /** The picked cells' words, as ⌘C copies them (the menu's Copy). */
    copied: () => (active && range ? copyText(range.column, picked) : ''),
    /** The menu's Copy done: the cells copied from are dashed, as after ⌘C. */
    markCopied: () => {
      if (active && range) setCopied({ column: range.column, ids: [...picked] });
    },
    /** Words pasted into the picked cells, as ⌘V pastes them (the menu's Paste). */
    pasteText: (text: string) => {
      if (!active || !range) return;
      const lines = pastedLines(text);
      if (lines.length === 0) return;
      setCopied(null);
      onPaste(range.column, pasteAssignments(picked, lines));
    },
  };
}
