import { type Cycle, daysInMonth, statementCycleFor } from '@expanses/core';

const pad = (n: number) => String(n).padStart(2, '0');

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The statement `back` statements before the one today falls in. */
export function cycleBack(today: string, statementDay: number, back: number): Cycle {
  let cycle = statementCycleFor(today, statementDay);
  for (let i = 0; i < back; i += 1) cycle = statementCycleFor(addDays(cycle.start, -1), statementDay);
  return cycle;
}

/** The first due day after a statement date. */
export function dueDateAfter(statementOn: string, dueDay: number): string {
  let [y, m] = statementOn.split('-').map(Number) as [number, number];
  for (let i = 0; i < 2; i += 1) {
    const candidate = `${y}-${pad(m)}-${pad(Math.min(dueDay, daysInMonth(y, m)))}`;
    if (candidate > statementOn) return candidate;
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return `${y}-${pad(m)}-${pad(Math.min(dueDay, daysInMonth(y, m)))}`;
}
