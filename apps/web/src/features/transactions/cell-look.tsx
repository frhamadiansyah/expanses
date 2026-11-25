import type { ReactNode } from 'react';
import type { CellColumn } from './cell-range';

/*
 * How the Mac tables draw their blue cells ('useCellRange'): the one place the look is said, so Cashflow's and Review's
 * cells change together. Look D (owner, 2026-11-24): a picked cell edged 2px in the accent blue on a pale blue; several
 * picked down a column one block of a deeper pale blue, edged round the block (not between its cells); a cell copied
 * from (⌘C) dashed inside, until a paste or Esc. A cell at rest, blank or not, is the row's own plain ground, and the
 * cell being typed in wears its field's own ring. The edge is an inset shadow, so the dashed line (an outline) and a
 * corner mark can sit on it too. The fill square (owner, 2026-11-24, as Google Sheets): a small blue square at the
 * blue's bottom-right corner, dragged down to fill the cells below; the cells it reaches are edged in dashes meanwhile.
 */

/** What a row's cells are to show of the blue cells: its picked one and where it sits in the block, its copied one. */
export interface CellPick {
  /** The column of the row's picked cell (a block's first), if one is. */
  column: CellColumn | null;
  /** Every column the row has picked: one, or a block's (owner 2026-11-25), in the table's order. */
  columns: readonly CellColumn[];
  /** The columns of the row's cells copied from, while cells are picked. */
  copied: readonly CellColumn[];
  /** Several cells are picked: this one is part of a block. */
  many: boolean;
  /** The block's first and last cell, which close it at the top and the bottom. */
  top: boolean;
  bottom: boolean;
  /** The blue's last cell, which carries the fill square. */
  corner: boolean;
  /** A cell the fill square is being dragged over: dashed at its sides, and at its foot where the reach ends. */
  reach: 'middle' | 'end' | null;
  /** The column the fill square is dragged down. */
  reachColumn: CellColumn | null;
}

// The class names are written out whole (no pieces put together), so the stylesheet's build finds them. A picked cell
// fills its row's height (its words kept in the middle), so a block of them reads as one.
/** One picked cell: the accent edge all round, the pale blue in it. */
const ONE = 'relative self-stretch content-center rounded-[6px]! bg-[var(--mk-cell-pick)] shadow-[inset_0_0_0_2px_var(--mk-blue)]';
/** A cell of a block: the deeper pale blue, edged at its sides, and at the top or bottom where the block ends there. */
const BLOCK = {
  middle: 'relative self-stretch content-center rounded-none! bg-[var(--mk-cell-range)] shadow-[inset_2px_0_0_var(--mk-blue),inset_-2px_0_0_var(--mk-blue)]',
  top: 'relative self-stretch content-center rounded-none! bg-[var(--mk-cell-range)] shadow-[inset_2px_0_0_var(--mk-blue),inset_-2px_0_0_var(--mk-blue),inset_0_2px_0_var(--mk-blue)]',
  bottom: 'relative self-stretch content-center rounded-none! bg-[var(--mk-cell-range)] shadow-[inset_2px_0_0_var(--mk-blue),inset_-2px_0_0_var(--mk-blue),inset_0_-2px_0_var(--mk-blue)]',
  both: 'relative self-stretch content-center rounded-[6px]! bg-[var(--mk-cell-range)] shadow-[inset_0_0_0_2px_var(--mk-blue)]',
} as const;
/**
 * A cell of a block across columns (owner 2026-11-25): the deeper pale blue, edged only where the block ends — its first
 * and last column, its top and bottom row — so the block reads as one rectangle. Each edge is its own shadow, given by
 * the side it is on.
 */
const ACROSS = 'relative self-stretch content-center rounded-none! bg-[var(--mk-cell-range)] [box-shadow:var(--el,0_0_#0000),var(--er,0_0_#0000),var(--et,0_0_#0000),var(--eb,0_0_#0000)]';
const EDGE = {
  left: '[--el:inset_2px_0_0_var(--mk-blue)]',
  right: '[--er:inset_-2px_0_0_var(--mk-blue)]',
  top: '[--et:inset_0_2px_0_var(--mk-blue)]',
  bottom: '[--eb:inset_0_-2px_0_var(--mk-blue)]',
} as const;
/** The cell copied from: a dashed line just inside its edge. */
const COPIED = 'outline-2 outline-dashed -outline-offset-[5px] outline-[var(--mk-blue)]';

/** A cell the fill square reaches, while it is dragged: dashed at its sides (and at its foot, the last), its own ground. */
const REACH = {
  middle:
    'self-stretch rounded-none! [background-image:linear-gradient(var(--mk-blue)_50%,transparent_50%),linear-gradient(var(--mk-blue)_50%,transparent_50%)] [background-size:2px_8px,2px_8px] [background-position:left_top,right_top] [background-repeat:repeat-y,repeat-y]',
  end: 'self-stretch rounded-none! [background-image:linear-gradient(var(--mk-blue)_50%,transparent_50%),linear-gradient(var(--mk-blue)_50%,transparent_50%),linear-gradient(90deg,var(--mk-blue)_50%,transparent_50%)] [background-size:2px_8px,2px_8px,8px_2px] [background-position:left_top,right_top,left_bottom] [background-repeat:repeat-y,repeat-y,repeat-x]',
} as const;
/** The fill square: 8px of the accent blue, ringed in the ground, at the corner; the pointer a thin cross over it. */
const SQUARE =
  'absolute right-[1px] bottom-[1px] z-[2] h-[8px] w-[8px] cursor-crosshair rounded-[2px] bg-[var(--mk-blue)] ring-[1.5px] ring-[var(--mk-page)]';

/** The classes for one cell of a row. */
export function cellLook(column: CellColumn, pick: CellPick | null | undefined): string | false {
  if (!pick) return false;
  const picked = pick.columns.includes(column);
  const across = pick.columns.length > 1;
  const look = !picked
    ? ''
    : across
      ? [
          ACROSS,
          column === pick.columns[0] && EDGE.left,
          column === pick.columns[pick.columns.length - 1] && EDGE.right,
          pick.top && EDGE.top,
          pick.bottom && EDGE.bottom,
        ]
          .filter(Boolean)
          .join(' ')
      : !pick.many
        ? ONE
        : BLOCK[pick.top && pick.bottom ? 'both' : pick.top ? 'top' : pick.bottom ? 'bottom' : 'middle'];
  const reach = pick.reach && pick.column === null && column === pick.reachColumn ? REACH[pick.reach] : '';
  const copied = pick.copied.includes(column) ? COPIED : '';
  return [look, reach, copied].filter(Boolean).join(' ') || false;
}

/** What a cell holds besides its own: the fill square, on the blue's last cell. Pressed, `useCellRange` takes it. */
export function cellCorner(column: CellColumn, pick: CellPick | null | undefined): ReactNode {
  // One column's blue only: a block has no fill square.
  if (!pick?.corner || pick.columns.length !== 1 || pick.column !== column) return null;
  return <span data-fill-square aria-hidden title="Drag down to fill" className={SQUARE} />;
}

/** The marks a cell carries for a range (and for tests): its column, its row, whether it is picked, copied from, or reached by the fill square. */
export function cellMarks(column: CellColumn, row: string, pick: CellPick | null | undefined) {
  return {
    'data-cell': column,
    'data-cell-row': row,
    'data-picked': pick?.columns.includes(column) || undefined,
    'data-copied': pick?.copied.includes(column) || undefined,
    'data-reach': (!!pick?.reach && pick.reachColumn === column) || undefined,
  };
}
