import { useRef } from 'react';

/*
 * A double-click on a wide screen's row whose first click opens the side peek (Mac Cashflow, Points, Bills, Wallet, Net
 * worth, Review). The page makes room for the peek at once, and that can move the row from under the pointer — the
 * boxes above it wrap, the table narrows, the row is scrolled back into view — so the second click lands on whatever
 * has come into its place: another row, a box, the peek itself. The Mac counts a double-click by place, not by what is
 * under it, and so does the page: two clicks at one place, soon enough, are still the first row's double-click.
 */

/** What a row (or a card's face, or a treemap box) wears for the guard: the id its double-click opens. */
export const PEEK_ROW = 'data-peek-row';

/** A plain click on a row, kept for a moment: where it was and when. */
export type RowClick = { id: string; x: number; y: number; at: number };

/** How soon, and how near, a second click must come to make a double-click (as the Mac counts one: by place, not by row). */
export const DOUBLE_CLICK = { ms: 500, px: 4 };

/**
 * A double-click on a row whose second click lands on something else: the first opened the peek, and the page making
 * room for it moved the row from under the pointer. Two clicks at one place, soon enough, are the row's double-click
 * still — the row whose page opens, or null when it is an ordinary click (on the same row, its own double-click does it).
 */
export function movedDoubleClick(first: RowClick | null, second: { rowId: string | null; x: number; y: number; at: number }): string | null {
  if (!first || second.rowId === first.id) return null;
  if (second.at - first.at > DOUBLE_CLICK.ms) return null;
  if (Math.abs(second.x - first.x) > DOUBLE_CLICK.px || Math.abs(second.y - first.y) > DOUBLE_CLICK.px) return null;
  return first.id;
}

/** The parts of a mouse event the guard reads (a React event, or a DOM one). */
export type GuardEvent = {
  target: EventTarget | null;
  clientX: number;
  clientY: number;
  timeStamp: number;
  /** The click's count: 2 for a double-click's second click. */
  detail: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
};

/** The row a click is on: the nearest element wearing `PEEK_ROW`, and its id. */
function rowOf(target: EventTarget | null): { id: string; element: Element } | null {
  const element = (target as Element | null)?.closest?.(`[${PEEK_ROW}]`) ?? null;
  const id = element?.getAttribute(PEEK_ROW);
  return element && id ? { id, element } : null;
}

/**
 * The guard's handlers, all three for the page's own root (the peek inside it, so a second click landing on the peek is
 * caught too). `onClick` keeps a plain click that reached the page from a row — one a control in the row kept to itself
 * (a tick, a picker, a fold) is not the row's, and neither is a click with ⌘, ⌃, ⇧ or ⌥, or a double-click's second.
 * `onClickCapture` turns the next click, landing off that row, into `onDouble(id, row)` — the row's element, where it is
 * now — and keeps it from reaching what is there; `onDoubleClickCapture` stops that same gesture's dblclick, which the
 * browser sends to whatever is under the pointer now.
 */
export function peekDoubleClick(onDouble: (id: string, row: Element) => void) {
  let last: (RowClick & { element: Element }) | null = null;
  let handledAt: number | null = null;
  return {
    onClickCapture(event: GuardEvent) {
      const first = last;
      last = null;
      const doubled = movedDoubleClick(first, { rowId: rowOf(event.target)?.id ?? null, x: event.clientX, y: event.clientY, at: event.timeStamp });
      if (!doubled || !first) return;
      event.preventDefault();
      event.stopPropagation();
      handledAt = event.timeStamp;
      onDouble(doubled, first.element);
    },
    onClick(event: GuardEvent) {
      const row = rowOf(event.target);
      const plain = !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.detail < 2;
      if (row && plain) last = { id: row.id, x: event.clientX, y: event.clientY, at: event.timeStamp, element: row.element };
    },
    onDoubleClickCapture(event: GuardEvent) {
      if (handledAt === null || event.timeStamp - handledAt > DOUBLE_CLICK.ms) return;
      handledAt = null;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/** `peekDoubleClick` for a page: the same handlers every render, calling the page's latest `onDouble`. */
export function usePeekDoubleClick(onDouble: (id: string, row: Element) => void) {
  const latest = useRef(onDouble);
  latest.current = onDouble;
  const handlers = useRef<ReturnType<typeof peekDoubleClick> | null>(null);
  handlers.current ??= peekDoubleClick((id, row) => latest.current(id, row));
  return handlers.current;
}
