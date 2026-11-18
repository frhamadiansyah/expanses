import { type CategoryNeed, monthName, type TrendBar } from '@expanses/core';
import type { AccountRow, DraftRow } from '@expanses/db';
import { OTHER_COLOUR, ringSlices } from './category-colours';
import { type AmountExtraPart, amountExtraParts, type ListRow, type Sort, sortRows, wholeLeftOut } from './list-model';
import { quickFromDraft, readQuick } from './quick-row';

/**
 * The wide screen's Cashflow (Mac Cashflow D, 2026-11-17) as data: the ring's legend, the month's four figures, what a
 * row counts as, the rows picked (one for the side peek, several at once) and the keys — each worked out here so it
 * is tested without a page.
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
 * The receipt peek's Counts as line: what a spending row's category counts as (Essential, Lifestyle, Debts & savings — its own mark,
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

/**
 * The rows picked in the table, the Mac way (Finder's, Mail's): a click picks one row and its peek opens; ⌘-click adds
 * a row or takes it out again; ⇧-click picks every row from the anchor — the last row clicked or ⌘-clicked — to this
 * one; ⌘A picks every row listed; Esc lets them all go. One row picked shows its peek; two or more, what they add up
 * to and what can be done to them all at once. `ids` are in the order picked.
 */
export interface Selection {
  ids: readonly string[];
  /** Where a ⇧-click reaches from. */
  anchor: string | null;
}

export const NO_SELECTION: Selection = { ids: [], anchor: null };

export type SelectionAction =
  /** A plain click: this row alone, and its peek. */
  | { type: 'open'; id: string }
  /** ⌘-click: this row added, or taken out when it was already picked. */
  | { type: 'toggle'; id: string }
  /** ⇧-click: every row from the anchor to this one, in the table's order, added to what is picked. */
  | { type: 'range'; id: string; ids: readonly string[] }
  /** ⌘A: every row listed. */
  | { type: 'all'; ids: readonly string[] }
  /** Esc, ✕, or a bulk action that went through: nothing picked. */
  | { type: 'close' }
  /** ⌃ ⌄ and the arrow keys, while one row is picked: the row before or after, stopping at either end. */
  | { type: 'step'; by: -1 | 1; ids: readonly string[] }
  /** The table changed under it: a row no longer listed (deleted, filtered out, moved away) is no longer picked. */
  | { type: 'listed'; ids: readonly string[] }
  /** A bulk action left these rows behind (each with its reason): they stay picked, the rest go. */
  | { type: 'keep'; ids: readonly string[] };

export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case 'open':
      return state.ids.length === 1 && state.ids[0] === action.id && state.anchor === action.id ? state : { ids: [action.id], anchor: action.id };
    case 'toggle':
      return state.ids.includes(action.id) ? { ids: state.ids.filter((id) => id !== action.id), anchor: action.id } : { ids: [...state.ids, action.id], anchor: action.id };
    case 'range': {
      const to = action.ids.indexOf(action.id);
      const from = state.anchor === null ? -1 : action.ids.indexOf(state.anchor);
      if (to < 0) return state;
      if (from < 0) return { ids: [action.id], anchor: action.id };
      const span = action.ids.slice(Math.min(from, to), Math.max(from, to) + 1);
      return { ids: [...state.ids, ...span.filter((id) => !state.ids.includes(id))], anchor: state.anchor };
    }
    case 'all':
      return { ids: [...action.ids], anchor: state.anchor ?? action.ids[0] ?? null };
    case 'close':
      return state.ids.length === 0 && state.anchor === null ? state : NO_SELECTION;
    case 'step': {
      if (state.ids.length !== 1) return state;
      const at = action.ids.indexOf(state.ids[0]!);
      if (at < 0) return state;
      const next = action.ids[Math.min(action.ids.length - 1, Math.max(0, at + action.by))];
      return next === undefined || next === state.ids[0] ? state : { ids: [next], anchor: next };
    }
    case 'listed': {
      const ids = state.ids.filter((id) => action.ids.includes(id));
      const anchor = state.anchor !== null && action.ids.includes(state.anchor) ? state.anchor : null;
      return ids.length === state.ids.length && anchor === state.anchor ? state : { ids, anchor };
    }
    case 'keep': {
      const ids = state.ids.filter((id) => action.ids.includes(id));
      return ids.length === state.ids.length ? state : { ids, anchor: ids.at(-1) ?? null };
    }
  }
}

/** What a click on a row does, by the keys held: ⇧ a range, ⌘ (Ctrl off a Mac) a toggle, nothing held the row alone. */
export function clickAction(id: string, keys: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }, ids: readonly string[]): SelectionAction {
  if (keys.shiftKey) return { type: 'range', id, ids };
  if (keys.metaKey || keys.ctrlKey) return { type: 'toggle', id };
  return { type: 'open', id };
}

/**
 * What a key does on the page while rows are picked: Esc lets them go; with one row picked ↑ ↓ step and Return opens
 * the full edit screen. Never while typing in a field (the typing row's own Return records, its Esc clears), and never
 * while a sheet or menu is open over the page — that one's Esc is its own.
 */
export function peekKey(key: string, ctx: { count: number; typing: boolean; covered: boolean }): 'close' | 'up' | 'down' | 'edit' | null {
  if (ctx.count === 0 || ctx.typing || ctx.covered) return null;
  if (key === 'Escape') return 'close';
  if (ctx.count !== 1) return null;
  switch (key) {
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

/** ⌘N, ⌘F and ⌘A on a Mac (Ctrl elsewhere): a new transaction, the search field, and every row listed. */
export function pageShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): 'new' | 'search' | 'all' | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  return key === 'n' ? 'new' : key === 'f' ? 'search' : key === 'a' ? 'all' : null;
}

// ── The waiting rows and the typing row (Mac Cashflow option E, owner 2026-11-18) ───────────────────────────────────

/**
 * The desk's own order: oldest at the top, newest at the bottom, where the typing row adds the next one (the Date header
 * still turns it round). The phone keeps newest first.
 */
export const DESK_SORT: Sort = { key: 'date', dir: 'asc' };

/**
 * The desk's rows in its order. Oldest first is newest first turned round whole — within a day too, so the row typed last
 * is the bottom one, just above the typing row (the phone's oldest first keeps a day newest first, `sortRows`).
 */
export function sortDesk(rows: readonly ListRow[], sort: Sort): ListRow[] {
  return sort.key === 'date' && sort.dir === 'asc' ? sortRows(rows, { key: 'date', dir: 'desc' }).reverse() : sortRows(rows, sort);
}

/** The box header's grey note on the order the table reads in. */
export function orderNote(sort: Sort): string {
  if (sort.key === 'amount') return `${sort.dir === 'asc' ? 'smallest' : 'largest'} at the top · new rows at the bottom`;
  return `${sort.dir === 'asc' ? 'oldest' : 'newest'} at the top · new rows at the bottom`;
}

/**
 * The rows typed or pasted to finish later (drafts with source manual), just above the typing row, in the order they
 * came in — whatever month they are dated in. By when each was made; rows made in the same moment by one paste keep that
 * paste's order (`pasted`, the ids it made, as this page heard them), then their ids.
 */
export function waitingOrder<T extends { id: string; draft?: Pick<DraftRow, 'createdAt'> | null }>(rows: readonly T[], pasted: readonly string[] = []): T[] {
  const at = new Map(pasted.map((id, i) => [id, i]));
  const rank = (row: T) => at.get(row.id) ?? Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => (a.draft?.createdAt ?? '').localeCompare(b.draft?.createdAt ?? '') || rank(a) - rank(b) || a.id.localeCompare(b.id));
}

/**
 * Record N, with several waiting rows picked: the complete ones (by the very reading each row's own Record uses,
 * `readQuick`), in the table's order, and how many are skipped for a blank cell.
 */
export function recordable<T extends { id: string; draft?: DraftRow | null }>(
  picked: readonly string[],
  waiting: readonly T[],
  accounts: readonly AccountRow[],
  today: string,
  baseCurrency: string,
): { ready: T[]; skipped: number } {
  const chosen = waiting.filter((row) => picked.includes(row.id) && row.draft);
  const ready = chosen.filter((row) => readQuick(quickFromDraft(row.draft!, today, accounts), accounts, today, baseCurrency).needs.length === 0);
  return { ready, skipped: chosen.length - ready.length };
}

/** Under Record N: "1 with a blank cell is skipped". */
export const skippedLine = (count: number) => `${count} with a blank cell ${count === 1 ? 'is' : 'are'} skipped`;

/**
 * The toast after waiting rows are recorded: where they went, as months ("Recorded in September 2026"; several, "Recorded
 * in August and September 2026", or "Recorded in December 2025 and January 2026" across a year's end), and the month
 * Show › opens — the latest of them. `months` are YYYY-MM, each a recorded row's own period (`periodMonthOf`).
 */
export function recordedToast(months: readonly string[]): { text: string; show: string } | null {
  const sorted = [...new Set(months)].sort();
  if (sorted.length === 0) return null;
  const years = new Set(sorted.map((month) => month.slice(0, 4)));
  const names = sorted.map((month) => (years.size === 1 ? monthName(month, 'long') : `${monthName(month, 'long')} ${month.slice(0, 4)}`));
  const listed = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;
  return { text: `Recorded in ${listed}${years.size === 1 ? ` ${sorted[0]!.slice(0, 4)}` : ''}`, show: sorted.at(-1)! };
}

/**
 * How a table row's Amount reads (Mac Cashflow D). Wholly left out of the report, Rp 0 in grey (its ⊘ figure says what
 * was left out); money in, green with a plus; a not-monthly bill a month leaves out (`leaveOutNotMonthly`), its whole
 * figure in grey, the ↻ on its category's circle saying why (as the phone's row does).
 */
export function deskAmount(row: ListRow): { minor: number; sign: '+' | ''; tone: 'up' | 'grey' | 'ink'; notMonthlyOut: boolean; extra: AmountExtraPart[] } {
  const out = wholeLeftOut(row, 'report');
  const income = !out && (row.type === 'income' || !!row.refund);
  const notMonthlyOut = !!row.notMonthlyOut;
  return {
    minor: out ? 0 : Math.abs(row.amountMinor),
    sign: income ? '+' : '',
    tone: out || notMonthlyOut ? 'grey' : income ? 'up' : 'ink',
    notMonthlyOut,
    extra: row.tx ? amountExtraParts(row.tx, undefined, row) : [],
  };
}
