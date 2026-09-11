import { daysInMonth } from '../reports/periods';

/** Inclusive date range. */
export interface Cycle {
  start: string;
  end: string;
}

export type CycleAnchor = 'statement' | 'calendar';

const pad = (n: number) => String(n).padStart(2, '0');

function shiftMonth(year: number, month1: number, delta: number): [number, number] {
  const index = year * 12 + (month1 - 1) + delta;
  return [Math.floor(index / 12), (index % 12) + 1];
}

function statementDate(year: number, month1: number, statementDay: number): string {
  return `${year}-${pad(month1)}-${pad(Math.min(statementDay, daysInMonth(year, month1)))}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Cycle ending on the statement day (clamped to month length) and starting the day after the previous statement. */
export function statementCycleFor(date: string, statementDay: number): Cycle {
  if (!Number.isInteger(statementDay) || statementDay < 1 || statementDay > 31) {
    throw new Error(`statementDay must be 1-31, got ${statementDay}`);
  }
  const [y, m] = date.split('-').map(Number) as [number, number];
  const [endY, endM] = date > statementDate(y, m, statementDay) ? shiftMonth(y, m, 1) : [y, m];
  const [prevY, prevM] = shiftMonth(endY, endM, -1);
  return { start: addDays(statementDate(prevY, prevM, statementDay), 1), end: statementDate(endY, endM, statementDay) };
}

export function calendarCycleFor(date: string): Cycle {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}` };
}

export function cycleFor(date: string, anchor: CycleAnchor, statementDay: number): Cycle {
  return anchor === 'calendar' ? calendarCycleFor(date) : statementCycleFor(date, statementDay);
}

export function previousCycle(cycle: Cycle, anchor: CycleAnchor, statementDay: number): Cycle {
  return cycleFor(addDays(cycle.start, -1), anchor, statementDay);
}
