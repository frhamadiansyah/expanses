/*
 * Bills that repeat every few weeks (2026-11-25): a prepaid electricity token bought roughly every 3 weeks. One plain
 * rule, the same one the bill's page says under its form: the next one is N weeks after the latest payment — before any
 * payment, the bill's start date, and never before it. Buying early or late moves the rest with it. Nothing else is
 * kept: the payments' own dates are the dates that were due, and the ones after are counted from the latest.
 *
 * A week-repeating bill's payment is keyed by its own day (`bill_payments.bill_month` holds 'YYYY-MM-DD' for it, where
 * every other bill holds its month 'YYYY-MM'), so a month can hold two of them and neither reads as paid twice.
 */

/** The fewest and the most weeks between a week-repeating bill's payments. */
export const WEEKS_EVERY_MIN = 1;
export const WEEKS_EVERY_MAX = 8;

/** A week-repeating bill's payment key: the day it was paid, YYYY-MM-DD. Every other bill's key is its month. */
export const BILL_DAY_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Whether `every` is a usable gap in weeks. */
export const isWeeksEvery = (every: number | null | undefined): every is number =>
  every != null && Number.isInteger(every) && every >= WEEKS_EVERY_MIN && every <= WEEKS_EVERY_MAX;

const utc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

/** A YYYY-MM-DD date `n` days later (earlier when negative). */
export function addDaysIso(date: string, n: number): string {
  return new Date(utc(date) + n * 86_400_000).toISOString().slice(0, 10);
}

const latest = (dates: readonly string[]): string | null => dates.reduce<string | null>((max, d) => (max === null || d > max ? d : max), null);

/**
 * The day a week-repeating bill is next due: `everyWeeks` weeks after the latest of `paidOn`, else `startOn`, and never
 * before `startOn` (a start moved later re-anchors it).
 */
export function weeklyNextDue(startOn: string, everyWeeks: number, paidOn: readonly string[]): string {
  const last = latest(paidOn);
  if (last === null) return startOn;
  const next = addDaysIso(last, everyWeeks * 7);
  return next < startOn ? startOn : next;
}

/**
 * The due dates of a week-repeating bill from `from` to `to` (both included), oldest first: the days it was paid, and
 * from its next due date on, one every `everyWeeks` weeks. A due date that has passed unpaid is still counted, and so
 * are the ones after it.
 */
export function weeklyDueDatesBetween(input: { startOn: string; everyWeeks: number; paidOn: readonly string[] }, from: string, to: string): string[] {
  const dates = new Set(input.paidOn.filter((d) => d >= from && d <= to));
  const step = input.everyWeeks * 7;
  let next = weeklyNextDue(input.startOn, input.everyWeeks, input.paidOn);
  // Straight to the first step on or after `from`, so a month far ahead is not walked to one step at a time.
  if (next < from) next = addDaysIso(next, Math.floor((utc(from) - utc(next)) / 86_400_000 / step) * step);
  for (; next <= to; next = addDaysIso(next, step)) if (next >= from) dates.add(next);
  return [...dates].sort();
}

/**
 * What a week-repeating bill comes to a month on average: `amountMinor` × 365 ÷ 7 ÷ `everyWeeks` ÷ 12, to four figures —
 * it is shown with "≈", a guide, not a figure anything is counted by. 1.000.000 every 3 weeks: 1.448.000.
 */
export function weeklyMonthlyMinor(amountMinor: number, everyWeeks: number): number {
  const exact = (amountMinor * 365) / 7 / everyWeeks / 12;
  if (!(exact > 0)) return 0;
  const unit = 10 ** Math.max(0, Math.floor(Math.log10(exact)) - 3);
  return Math.round(exact / unit) * unit;
}

/**
 * A week-repeating bill's start date, as it is kept: the first month of its window on its day of the month (the
 * month's last day when it is shorter) — the same two fields every bill has, so no column is new.
 */
export function weeklyStartOn(startsMonth: string, dayOfMonth: number): string {
  const [y, m] = startsMonth.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${startsMonth}-${String(Math.min(dayOfMonth, last)).padStart(2, '0')}`;
}

/** "Every 3 weeks", or "Every week". */
export function weeklyRepeat(everyWeeks: number): string {
  return everyWeeks === 1 ? 'Every week' : `Every ${everyWeeks} weeks`;
}
