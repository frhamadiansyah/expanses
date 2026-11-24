import type { CellColumn } from './cell-range';

/*
 * How the Mac tables draw their blue cells ('useCellRange'): the one place the look is said, so Cashflow's and Review's
 * cells change together. Look D (owner, 2026-11-24): a picked cell edged 2px in the accent blue on a pale blue; several
 * picked down a column one block of a deeper pale blue, edged round the block (not between its cells); a cell copied
 * from (⌘C) dashed inside, until a paste or Esc. A cell at rest, blank or not, is the row's own plain ground, and the
 * cell being typed in wears its field's own ring. The edge is an inset shadow, so the dashed line (an outline) and a
 * corner mark can sit on it too.
 */

/** What a row's cells are to show of the blue cells: its picked one and where it sits in the block, its copied one. */
export interface CellPick {
  /** The column of the row's picked cell, if one is. */
  column: CellColumn | null;
  /** The column of the row's cell copied from, while cells are picked. */
  copied: CellColumn | null;
  /** Several cells are picked: this one is part of a block. */
  many: boolean;
  /** The block's first and last cell, which close it at the top and the bottom. */
  top: boolean;
  bottom: boolean;
}

// The class names are written out whole (no pieces put together), so the stylesheet's build finds them. A picked cell
// fills its row's height (its words kept in the middle), so a block of them reads as one.
/** One picked cell: the accent edge all round, the pale blue in it. */
const ONE = 'self-stretch content-center rounded-[6px]! bg-[var(--mk-cell-pick)] shadow-[inset_0_0_0_2px_var(--mk-blue)]';
/** A cell of a block: the deeper pale blue, edged at its sides, and at the top or bottom where the block ends there. */
const BLOCK = {
  middle: 'self-stretch content-center rounded-none! bg-[var(--mk-cell-range)] shadow-[inset_2px_0_0_var(--mk-blue),inset_-2px_0_0_var(--mk-blue)]',
  top: 'self-stretch content-center rounded-none! bg-[var(--mk-cell-range)] shadow-[inset_2px_0_0_var(--mk-blue),inset_-2px_0_0_var(--mk-blue),inset_0_2px_0_var(--mk-blue)]',
  bottom: 'self-stretch content-center rounded-none! bg-[var(--mk-cell-range)] shadow-[inset_2px_0_0_var(--mk-blue),inset_-2px_0_0_var(--mk-blue),inset_0_-2px_0_var(--mk-blue)]',
  both: 'self-stretch content-center rounded-[6px]! bg-[var(--mk-cell-range)] shadow-[inset_0_0_0_2px_var(--mk-blue)]',
} as const;
/** The cell copied from: a dashed line just inside its edge. */
const COPIED = 'outline-2 outline-dashed -outline-offset-[5px] outline-[var(--mk-blue)]';

/** The classes for one cell of a row. */
export function cellLook(column: CellColumn, pick: CellPick | null | undefined): string | false {
  if (!pick) return false;
  const picked = pick.column === column;
  const look = !picked ? '' : !pick.many ? ONE : BLOCK[pick.top && pick.bottom ? 'both' : pick.top ? 'top' : pick.bottom ? 'bottom' : 'middle'];
  const copied = pick.copied === column ? COPIED : '';
  return [look, copied].filter(Boolean).join(' ') || false;
}

/** The marks a cell carries for a range (and for tests): its column, its row, and whether it is picked or copied from. */
export function cellMarks(column: CellColumn, row: string, pick: CellPick | null | undefined) {
  return { 'data-cell': column, 'data-cell-row': row, 'data-picked': pick?.column === column || undefined, 'data-copied': pick?.copied === column || undefined };
}
