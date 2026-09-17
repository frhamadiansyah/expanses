import { addMonths, daysInMonth, monthRange } from './periods';

/**
 * The stretch of time a screen is showing: a week, a month, a quarter, a year, all of it, or two chosen dates.
 *
 * Each is written as one string, so it can sit in an address and be shared: `2026-09`, `2026-W38` (ISO week,
 * Monday to Sunday), `2026-Q3`, `2026`, `all`, and `2026-07-01..2026-09-17`.
 */
export type PeriodKind = 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom';

export interface Period {
  kind: PeriodKind;
  value: string;
  /** First day, inclusive. Null for all time. */
  from: string | null;
  /** Last day, inclusive. Null for all time. */
  to: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A calendar date as a count of days, so weeks can be walked without time zones getting a say. */
const toDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
const fromDay = (day: number) => {
  const d = new Date(day * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const isRealDate = (iso: string) => DATE.test(iso) && fromDay(toDay(iso)) === iso;

/** Monday of ISO week 1: the week holding the year's first Thursday. */
function weekOneMonday(year: number): number {
  const jan4 = toDay(`${year}-01-04`);
  const weekday = (new Date(jan4 * 86_400_000).getUTCDay() + 6) % 7;
  return jan4 - weekday;
}

const weeksInYear = (year: number) => (weekOneMonday(year + 1) - weekOneMonday(year)) / 7;

/** The ISO week a day falls in, as YYYY-Www. Early January can belong to last year's week, late December to next year's. */
export function weekOf(date: string): string {
  const day = toDay(date);
  let year = Number(date.slice(0, 4)) + 1;
  while (day < weekOneMonday(year)) year -= 1;
  return `${year}-W${pad(Math.floor((day - weekOneMonday(year)) / 7) + 1)}`;
}

export function parsePeriod(value: string): Period | null {
  if (value === 'all') return { kind: 'all', value, from: null, to: null };

  let match = /^(\d{4})$/.exec(value);
  if (match) return { kind: 'year', value, from: `${value}-01-01`, to: `${value}-12-31` };

  match = /^(\d{4})-(\d{2})$/.exec(value);
  if (match) {
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return { kind: 'month', value, ...monthRange(value) };
  }

  match = /^(\d{4})-Q([1-4])$/.exec(value);
  if (match) {
    const year = Number(match[1]);
    const first = (Number(match[2]) - 1) * 3 + 1;
    return { kind: 'quarter', value, from: `${year}-${pad(first)}-01`, to: `${year}-${pad(first + 2)}-${pad(daysInMonth(year, first + 2))}` };
  }

  match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (match) {
    const year = Number(match[1]);
    const week = Number(match[2]);
    if (week < 1 || week > weeksInYear(year)) return null;
    const monday = weekOneMonday(year) + (week - 1) * 7;
    return { kind: 'week', value, from: fromDay(monday), to: fromDay(monday + 6) };
  }

  match = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (match && isRealDate(match[1]!) && isRealDate(match[2]!) && match[1]! <= match[2]!) {
    return { kind: 'custom', value, from: match[1]!, to: match[2]! };
  }
  return null;
}

/** The period next to this one, by its own unit. Nothing is next to all time, or to two chosen dates. */
export function stepPeriod(value: string, n: number): string | null {
  const period = parsePeriod(value);
  if (!period) return null;
  switch (period.kind) {
    case 'month':
      return addMonths(value, n);
    case 'year':
      return String(Number(value) + n);
    case 'quarter': {
      const index = Number(value.slice(0, 4)) * 4 + Number(value.slice(6)) - 1 + n;
      return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
    }
    case 'week':
      return weekOf(fromDay(toDay(period.from!) + n * 7));
    default:
      return null;
  }
}

const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;

/** "September 2026", "14 – 20 Sep 2026", "Q3 2026", "2026", "All time", "1 Jul – 17 Sep 2026". */
export function periodLabel(value: string): string {
  const period = parsePeriod(value);
  if (!period) return value;
  switch (period.kind) {
    case 'all':
      return 'All time';
    case 'year':
      return value;
    case 'quarter':
      return `${value.slice(5)} ${value.slice(0, 4)}`;
    case 'month':
      return `${MONTHS_LONG[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`;
    default: {
      const from = period.from!;
      const to = period.to!;
      const sameYear = from.slice(0, 4) === to.slice(0, 4);
      const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7);
      if (from === to) return `${dayMonth(from)} ${from.slice(0, 4)}`;
      if (sameMonth) return `${Number(from.slice(8, 10))} – ${dayMonth(to)} ${to.slice(0, 4)}`;
      if (sameYear) return `${dayMonth(from)} – ${dayMonth(to)} ${to.slice(0, 4)}`;
      return `${dayMonth(from)} ${from.slice(0, 4)} – ${dayMonth(to)} ${to.slice(0, 4)}`;
    }
  }
}

/** Every ISO week that touches a month, in order: what a week picker shows for that month. */
export function weeksOfMonth(month: string): Period[] {
  const { from, to } = monthRange(month);
  const weeks: Period[] = [];
  for (let day = toDay(parsePeriod(weekOf(from))!.from!); day <= toDay(to); day += 7) {
    weeks.push(parsePeriod(weekOf(fromDay(day)))!);
  }
  return weeks;
}
