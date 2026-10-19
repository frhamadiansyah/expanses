/**
 * When something was acquired, as precisely as the owner remembers it: a year always, a month if they know it, a day
 * only once there is a month. The ledger still needs a whole day to post on, so what was left out is filled with the
 * start of it — 1 January for a year, the 1st for a month — and how much was typed is kept beside it, so the asset's
 * page says "2024" rather than a 1 January nobody chose. The tax report reads only the year, which is always typed.
 */

export type DatePrecision = 'year' | 'month' | 'day';

/** As typed: the year in a box, the month and day as picker values ('' for not chosen, else '1'…'12' / '1'…'31'). */
export interface AcquiredParts {
  year: string;
  month: string;
  day: string;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Days in a month, February counted for the year given (or 29 while the year is still being typed). */
export function daysIn(year: string, month: string): number {
  const m = Number(month);
  if (!m) return 31;
  const y = /^\d{4}$/.test(year) ? Number(year) : 2000;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** A fresh row: nothing picked. The year is still asked for; the wheel opens on this year. */
export const NO_DATE: AcquiredParts = { year: '', month: '', day: '' };

/**
 * The day to post on and how much of it was typed. Throws with a message meant for the screen when the year is
 * missing or not a year, the day does not exist, or the result lands after today.
 */
export function acquiredOn(parts: AcquiredParts, today: string): { on: string; precision: DatePrecision } {
  const yearText = parts.year.trim();
  if (!/^\d{4}$/.test(yearText)) throw new Error('Say the year it was acquired');
  const year = Number(yearText);
  if (year < 1900) throw new Error('The year it was acquired looks too early');
  const month = parts.month === '' ? 0 : Number(parts.month);
  const day = parts.day === '' ? 0 : Number(parts.day);
  if (month < 0 || month > 12 || !Number.isInteger(month)) throw new Error('That month does not exist');
  if (day && !month) throw new Error('Choose the month before the day');
  if (day < 0 || day > daysIn(yearText, String(month)) || !Number.isInteger(day)) throw new Error('That day does not exist in that month');
  const on = `${year}-${pad(month || 1)}-${pad(day || 1)}`;
  if (on > today) throw new Error('It cannot be acquired after today');
  return { on, precision: day ? 'day' : month ? 'month' : 'year' };
}

/** The parts a stored day reads back as, at the precision it was typed: for the Edit screen to start from. */
export function partsOf(on: string, precision: DatePrecision): AcquiredParts {
  return {
    year: on.slice(0, 4),
    month: precision === 'year' ? '' : String(Number(on.slice(5, 7))),
    day: precision === 'day' ? String(Number(on.slice(8, 10))) : '',
  };
}

/** "2024", "Mar 2024" or "14 Mar 2024": only what was typed. */
export function acquiredLabel(on: string, precision: DatePrecision): string {
  const [year, month, day] = on.split('-').map(Number);
  if (!year || !month || !day || month > 12) return on;
  if (precision === 'year') return String(year);
  if (precision === 'month') return `${MONTHS[month - 1]} ${year}`;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}
