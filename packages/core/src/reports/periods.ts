const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** YYYY-MM of a YYYY-MM-DD date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** Inclusive first and last day of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(y, m))}` };
}

/** n months ending at endMonth, oldest first. */
export function lastNMonths(endMonth: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(endMonth, i - (n - 1)));
}
