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

/** How near a due date is, in words, and whether it needs attention: soon within three days, late once passed. */
export function dueIn(today: string, dueOn: string): { text: string; tone: 'calm' | 'soon' | 'late' } {
  const days = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return { text: days === -1 ? '1 day late' : `${-days} days late`, tone: 'late' };
  if (days === 0) return { text: 'today', tone: 'soon' };
  if (days === 1) return { text: 'tomorrow', tone: 'soon' };
  return { text: `in ${days} days`, tone: days <= 3 ? 'soon' : 'calm' };
}
