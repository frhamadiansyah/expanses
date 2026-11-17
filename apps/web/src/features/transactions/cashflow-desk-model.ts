import type { CategoryNeed, TrendBar } from '@expanses/core';
import { OTHER_COLOUR, ringSlices } from './category-colours';
import type { ListRow } from './list-model';

/**
 * The wide screen's Cashflow (Mac Cashflow D, 2026-11-17) as data: the ring's legend, the month's four figures, what a
 * row counts as, and the side peek's stepping and keys — each worked out here so it is tested without a page.
 */

/** A category under the ring: its mark is drawn by the page (`CategoryIcon`), its slice in `colour`. */
export interface LegendItem {
  key: string;
  /** Null for the gathered "Others", which filters nothing. */
  categoryId: string | null;
  name: string;
  colour: string;
  minor: number;
  /** Whole per cent of the ring. */
  percent: number;
}

/** How many categories the box names before the rest are gathered into Others: the ring's height, no more. */
export const LEGEND_LIMIT = 5;

/**
 * The ring's slices and the list beside it: the largest categories as themselves (the phone's own rule, `ringSlices`,
 * which also gathers anything under a fortieth), the rest — and any category set — as one Others. Shares are of the
 * slices drawn, as on the phone, so a category's percentage and its slice always agree.
 */
export function ringLegend(
  nodes: readonly { id: string; name: string; totalMinor: number }[],
  colourOf: (id: string) => string,
  extraMinor = 0,
  limit = LEGEND_LIMIT,
): { items: LegendItem[]; wholeMinor: number } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const { shown, rest } = ringSlices(
    nodes.map((node) => ({ id: node.id, totalMinor: node.totalMinor })),
    limit,
    colourOf,
  );
  const restMinor = rest.reduce((sum, item) => sum + item.totalMinor, 0) + Math.max(0, extraMinor);
  const drawn = [
    ...shown.map((slice) => ({ key: slice.item.id, categoryId: slice.item.id, name: byId.get(slice.item.id)?.name ?? '', colour: slice.colour, minor: slice.totalMinor })),
    ...(restMinor > 0 ? [{ key: 'others', categoryId: null, name: 'Others', colour: OTHER_COLOUR, minor: restMinor }] : []),
  ];
  const wholeMinor = drawn.reduce((sum, item) => sum + item.minor, 0);
  return { items: drawn.map((item) => ({ ...item, percent: wholeMinor > 0 ? Math.round((item.minor / wholeMinor) * 100) : 0 })), wholeMinor };
}

/** The ring's arcs as stroke dashes on a circle of `circumference`, each a hair short so neighbours stay apart. */
export function ringArcs(items: readonly Pick<LegendItem, 'key' | 'minor' | 'colour'>[], circumference: number, gap = 2): { key: string; colour: string; dash: number; offset: number }[] {
  const whole = items.reduce((sum, item) => sum + item.minor, 0);
  if (whole <= 0) return [];
  let at = 0;
  return items.map((item) => {
    const length = (item.minor / whole) * circumference;
    const arc = { key: item.key, colour: item.colour, dash: Math.max(0.5, length - (items.length > 1 ? gap : 0)), offset: -at };
    at += length;
    return arc;
  });
}

/** This month's box: what was spent, what came in, what is left of it, and how many captures wait to be reviewed. */
export interface MonthFigures {
  spentMinor: number | null;
  receivedMinor: number | null;
  /** Received less spent; null until both are read. Below nought when more went out than came in. */
  leftMinor: number | null;
  toReview: number;
}

export function monthFigures(spentMinor: number | null, receivedMinor: number | null, toReview: number): MonthFigures {
  return { spentMinor, receivedMinor, leftMinor: spentMinor === null || receivedMinor === null ? null : receivedMinor - spentMinor, toReview };
}

const NEED_WORDS: Record<CategoryNeed, string> = { essential: 'Essential', lifestyle: 'Lifestyle', debts_savings: 'Debts & savings' };

/**
 * The Counts as column: what a spending row's category counts as (Essential, Lifestyle, Debts & savings — its own mark,
 * an ancestor's, the built-in one, else essential). Income and every other row count as none of them: a dash.
 * Blank while the marks are still being read.
 */
export function countsAs(row: Pick<ListRow, 'type' | 'categoryId'>, needs: Readonly<Record<string, CategoryNeed>> | undefined): string {
  if (row.type !== 'expense' || !row.categoryId) return '—';
  if (!needs) return '';
  return NEED_WORDS[needs[row.categoryId] ?? 'essential'];
}

/** The day bars' furniture: the tallest bar, and where Today's marker stands (−1 when today is not in the period). */
export function dayBarsShape(bars: readonly Pick<TrendBar, 'from' | 'to' | 'totalMinor'>[], today: string): { peakMinor: number; todayIndex: number } {
  return {
    peakMinor: Math.max(0, ...bars.map((bar) => bar.totalMinor ?? 0)),
    todayIndex: bars.findIndex((bar) => bar.from <= today && today <= bar.to),
  };
}

/** Which row the side peek shows: none, or one row by its id. */
export interface PeekState {
  id: string | null;
}

export type PeekAction =
  | { type: 'open'; id: string }
  | { type: 'close' }
  /** ⌃ ⌄ and the arrow keys: the row before or after, in the table's own order, stopping at either end. */
  | { type: 'step'; by: -1 | 1; ids: readonly string[] }
  /** The table changed under it: a row no longer listed (deleted, filtered out) closes the peek. */
  | { type: 'listed'; ids: readonly string[] };

export function peekReducer(state: PeekState, action: PeekAction): PeekState {
  switch (action.type) {
    case 'open':
      return { id: action.id };
    case 'close':
      return state.id === null ? state : { id: null };
    case 'step': {
      if (state.id === null) return state;
      const at = action.ids.indexOf(state.id);
      if (at < 0) return state;
      const next = action.ids[Math.min(action.ids.length - 1, Math.max(0, at + action.by))];
      return next === undefined || next === state.id ? state : { id: next };
    }
    case 'listed':
      return state.id !== null && !action.ids.includes(state.id) ? { id: null } : state;
  }
}

/**
 * What a key does on the page while a row is selected: Esc closes the peek, ↑ ↓ step, Return opens the full edit
 * screen. Never while typing in a field (the typing row's own Return records, its Esc clears), and never while a sheet
 * or menu is open over the page — that one's Esc is its own.
 */
export function peekKey(key: string, ctx: { open: boolean; typing: boolean; covered: boolean }): 'close' | 'up' | 'down' | 'edit' | null {
  if (!ctx.open || ctx.typing || ctx.covered) return null;
  switch (key) {
    case 'Escape':
      return 'close';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'Enter':
      return 'edit';
    default:
      return null;
  }
}

/** ⌘N and ⌘F on a Mac (Ctrl elsewhere): a new transaction, and the search field. */
export function pageShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): 'new' | 'search' | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  return key === 'n' ? 'new' : key === 'f' ? 'search' : null;
}
