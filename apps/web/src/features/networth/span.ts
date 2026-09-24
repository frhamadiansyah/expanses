import type { Segment } from '../../ui/native';

/**
 * How far back the figure and its line are read.
 *
 * A range is a count of month-end snapshots — the series is monthly, so six months is six of them — except for the two
 * that are not counts at all: year to date starts at January, and all starts where there is something to draw.
 */
export type Span = '6m' | 'ytd' | '1y' | '3y' | '5y' | 'all';

/**
 * How many months of snapshots a range is read from: what it draws, and not more.
 *
 * YTD is twelve, because January is at most a year back. All is five years — the longest window this page asks for,
 * and one request a month, so the figure the page opens on is read from the six months it shows rather than the year
 * it used to.
 */
export const SPAN_MONTHS: Record<Span, number> = { '6m': 6, ytd: 12, '1y': 12, '3y': 36, '5y': 60, all: 60 };

/*
 * Named the way Health names a range: two or three characters over a track, not three sentences. The control's own
 * label is what a screen reader hears first, so "6M" beside "Range" reads as a range and not as a code.
 */
export const RANGES = [
  { key: '6m', label: '6M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' },
  { key: '3y', label: '3Y' },
  { key: '5y', label: '5Y' },
  { key: 'all', label: 'ALL' },
] as const satisfies readonly Segment[];

/** A month-end snapshot, as far as a range cares: when it was, and what the sheet held then. */
export interface SpanPoint {
  month: string;
  netWorthMinor: number | null;
  assetsMinor: number | null;
  liabilitiesMinor: number | null;
}

/**
 * The points a range draws, oldest first.
 *
 * The last `n` months for the ranges that are a count. Year to date is the months of the last point's own year, so it
 * follows the calendar rather than counting twelve back. All is every month with something on the sheet: a month
 * before the first account held nothing because there was nothing there, and four years of nothing drawn before the
 * first figure is a drawing that says the money did not exist.
 */
export function spanSlice<T extends SpanPoint>(points: readonly T[], span: Span): T[] {
  if (span === 'all') {
    const first = points.findIndex((point) => (point.assetsMinor ?? 0) !== 0 || (point.liabilitiesMinor ?? 0) !== 0);
    return first > 0 ? points.slice(first) : [...points];
  }
  if (span === 'ytd') {
    const year = points[points.length - 1]?.month.slice(0, 4);
    return year === undefined ? [] : points.filter((point) => point.month.startsWith(year));
  }
  return points.slice(-SPAN_MONTHS[span]);
}

/**
 * The two figures a range's change is read between: where it started and where it ended.
 *
 * Null when either end has no figure — a rate missing that month — because a change worked out from a month that
 * could not be added up is a change about nothing.
 */
export function rangeChange(points: readonly { netWorthMinor: number | null }[]): { fromMinor: number; toMinor: number } | null {
  const from = points[0]?.netWorthMinor;
  const to = points[points.length - 1]?.netWorthMinor;
  if (from === null || from === undefined || to === null || to === undefined) return null;
  return { fromMinor: from, toMinor: to };
}
