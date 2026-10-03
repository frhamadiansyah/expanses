import { daysInMonth } from './periods';
import { type Period, parsePeriod, stepPeriod, weekOf } from './view-period';

/**
 * Spending drawn over time: the bars on the Cashflow card's third page, and the line of comparisons under them.
 *
 * The bars follow the period the page is showing, so they answer "when" for whatever "what" the donut is answering:
 * a week or a month by its days, a quarter by its weeks, a year by its months. All time and two chosen dates take
 * whichever of those keeps the bars countable.
 */
export type TrendUnit = 'day' | 'week' | 'month' | 'year';

/** What was spent on one day — the shape the database hands over, already in the workspace's currency. */
export interface DayTotal {
  date: string;
  amountMinor: number;
}

export interface TrendBar {
  /** First and last day the bar covers, inclusive — cut at the period's edges, so a quarter's first week can be short. */
  from: string;
  to: string;
  /** What a reading of the bar says it is: "Sat 12 Sep", "6 – 12 Jul", "September 2026", "2026". */
  label: string;
  /** What is written under it: "Mon", "12", "6 Jul", "Sep", "2026". */
  tick: string;
  /** Null for a bar that has not happened yet, which is not the same as one where nothing was spent. */
  totalMinor: number | null;
  /** The bar today falls in: counted so far, and drawn as unfinished. */
  partial: boolean;
}

export interface TrendComparison {
  key: 'previous' | 'year-ago' | 'usual';
  /** What it is set against, read after "vs": "August", "Sep 2025", "usual month". */
  label: string;
  /** The total it is set against, over the same stretch of days. */
  againstMinor: number;
  /** Whole per cent, up positive: 16 is "16% more". */
  changePercent: number;
  /** The period to move to when it is tapped. The usual month is no one month, so it has none. */
  period: string | null;
}

export interface TrendContext {
  /** Today, as YYYY-MM-DD: what has not happened yet is not drawn, and what is happening is compared fairly. */
  today: string;
  /** The first day anything was recorded, or null when nothing has been. Nothing is compared with a time before it. */
  first: string | null;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const toDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;
const fromDay = (day: number) => {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const addDays = (iso: string, n: number) => fromDay(toDay(iso) + n);
const later = (a: string, b: string) => (a > b ? a : b);
const sooner = (a: string, b: string) => (a < b ? a : b);
const monthIndex = (iso: string) => Number(iso.slice(5, 7)) - 1;
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[monthIndex(iso)]}`;
/** The last day of the month a date is in. */
const monthEnd = (iso: string) => `${iso.slice(0, 7)}-${pad(daysInMonth(Number(iso.slice(0, 4)), monthIndex(iso) + 1))}`;

/** The first and last day a period covers, all time reaching from the first record to today. */
function span(period: Period, ctx: TrendContext): { from: string; to: string } | null {
  if (period.from && period.to) return { from: period.from, to: period.to };
  return ctx.first ? { from: ctx.first, to: later(ctx.first, ctx.today) } : null;
}

/** The bars a period is drawn in. A stretch of dates takes the finest unit that stays countable on a phone. */
function unitFor(period: Period, from: string, to: string): TrendUnit {
  switch (period.kind) {
    case 'week':
    case 'month':
      return 'day';
    case 'quarter':
      return 'week';
    case 'year':
      return 'month';
    default: {
      const days = toDay(to) - toDay(from) + 1;
      if (days <= 31) return 'day';
      if (days <= 124) return 'week';
      if (days <= 731) return 'month';
      return 'year';
    }
  }
}

/** Where the bar holding `day` ends, before it is cut to the period. */
function unitEnd(unit: TrendUnit, day: string): string {
  switch (unit) {
    case 'day':
      return day;
    case 'week':
      return parsePeriod(weekOf(day))!.to!;
    case 'month':
      return monthEnd(day);
    case 'year':
      return `${day.slice(0, 4)}-12-31`;
  }
}

function named(unit: TrendUnit, from: string, to: string, inWeek: boolean): { label: string; tick: string } {
  switch (unit) {
    case 'day': {
      const weekday = WEEKDAYS[new Date(toDay(from) * DAY_MS).getUTCDay()]!;
      return { label: `${weekday} ${dayMonth(from)}`, tick: inWeek ? weekday : String(Number(from.slice(8, 10))) };
    }
    case 'week': {
      const sameMonth = from.slice(0, 7) === to.slice(0, 7);
      const label = from === to ? dayMonth(from) : sameMonth ? `${Number(from.slice(8, 10))} – ${dayMonth(to)}` : `${dayMonth(from)} – ${dayMonth(to)}`;
      return { label, tick: dayMonth(from) };
    }
    case 'month':
      return { label: `${MONTHS_LONG[monthIndex(from)]} ${from.slice(0, 4)}`, tick: MONTHS_SHORT[monthIndex(from)]! };
    case 'year':
      return { label: from.slice(0, 4), tick: from.slice(0, 4) };
  }
}

/** What was spent between two days, both included. */
function sumBetween(days: readonly DayTotal[], from: string, to: string): number {
  let total = 0;
  for (const day of days) if (day.date >= from && day.date <= to) total += day.amountMinor;
  return total;
}

/** The period's bars, oldest first, each holding what was spent across its days. */
export function spendingTrend(period: Period, days: readonly DayTotal[], ctx: TrendContext): { unit: TrendUnit; bars: TrendBar[] } {
  const range = span(period, ctx);
  if (!range) return { unit: 'month', bars: [] };
  const unit = unitFor(period, range.from, range.to);
  const bars: TrendBar[] = [];
  for (let from = range.from; from <= range.to; ) {
    const to = sooner(unitEnd(unit, from), range.to);
    const future = from > ctx.today;
    bars.push({
      from,
      to,
      ...named(unit, from, to, period.kind === 'week'),
      totalMinor: future ? null : sumBetween(days, from, sooner(to, ctx.today)),
      partial: !future && ctx.today < to,
    });
    from = addDays(to, 1);
  }
  return { unit, bars };
}

/** How far back each comparison reaches, in the period's own steps. A year's "a year ago" is the one before last. */
const REACH: Partial<Record<Period['kind'], { yearAgo: number; usual: number }>> = {
  week: { yearAgo: 52, usual: 6 },
  month: { yearAgo: 12, usual: 6 },
  quarter: { yearAgo: 4, usual: 6 },
  year: { yearAgo: 2, usual: 0 },
};

function nameOf(kind: Period['kind'], value: string, key: 'previous' | 'year-ago'): string {
  const p = parsePeriod(value)!;
  switch (kind) {
    case 'week':
      return key === 'previous' ? 'last week' : `same week ${value.slice(0, 4)}`;
    case 'month':
      return key === 'previous' ? MONTHS_LONG[monthIndex(p.from!)]! : `${MONTHS_SHORT[monthIndex(p.from!)]} ${value.slice(0, 4)}`;
    case 'quarter':
      return `${value.slice(5)} ${value.slice(0, 4)}`;
    default:
      return value;
  }
}

/**
 * The line under the bars: this period against the one before it, the same one a year earlier, and the usual one.
 *
 * A period still running is compared over as many days as it has had — three days into October is set against
 * 1–3 September, not all of it. A period from before anything was recorded is left out rather than read as nothing
 * spent, and so is one that came to nothing, which no percentage can be taken of. "Usual" is the average of up to six
 * periods before, and is only said once there are three of them.
 */
export function spendingComparisons(period: Period, days: readonly DayTotal[], ctx: TrendContext): TrendComparison[] {
  const reach = REACH[period.kind];
  if (!reach || !period.from || !period.to) return [];
  const running = period.from <= ctx.today && ctx.today < period.to;
  const length = running ? toDay(ctx.today) - toDay(period.from) + 1 : Number.POSITIVE_INFINITY;
  const current = sumBetween(days, period.from, running ? ctx.today : period.to);

  /** The same stretch of an earlier period, or null when it starts before anything was recorded. */
  const stretch = (value: string) => {
    const earlier = parsePeriod(value)!;
    if (!ctx.first || earlier.from! < ctx.first) return null;
    const to = Number.isFinite(length) ? sooner(addDays(earlier.from!, length - 1), earlier.to!) : earlier.to!;
    return sumBetween(days, earlier.from!, to);
  };
  const change = (against: number) => Math.round(((current - against) / against) * 100);

  const comparisons: TrendComparison[] = [];
  for (const [key, steps] of [
    ['previous', 1],
    ['year-ago', reach.yearAgo],
  ] as const) {
    const value = stepPeriod(period.value, -steps);
    const against = value ? stretch(value) : null;
    if (value && against) comparisons.push({ key, label: nameOf(period.kind, value, key), againstMinor: against, changePercent: change(against), period: value });
  }

  const earlier: number[] = [];
  for (let back = 1; back <= reach.usual; back += 1) {
    const value = stepPeriod(period.value, -back);
    const against = value ? stretch(value) : null;
    if (against !== null) earlier.push(against);
  }
  if (earlier.length >= 3) {
    const usual = Math.round(earlier.reduce((sum, total) => sum + total, 0) / earlier.length);
    if (usual > 0) comparisons.push({ key: 'usual', label: `usual ${period.kind}`, againstMinor: usual, changePercent: change(usual), period: null });
  }
  return comparisons;
}

/** The days the bars and the comparisons need between them: one read covers both. Null when there is nothing to read. */
export function trendWindow(period: Period, ctx: TrendContext): { from: string; to: string } | null {
  const range = span(period, ctx);
  if (!range) return null;
  const reach = REACH[period.kind];
  if (!reach) return range;
  const back = stepPeriod(period.value, -Math.max(reach.yearAgo, reach.usual));
  return { from: back ? parsePeriod(back)!.from! : range.from, to: range.to };
}
