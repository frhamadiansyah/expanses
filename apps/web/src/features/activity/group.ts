import type { ActivityLine, ActivityState } from '@expanses/db';

/*
 * The Activity page's decisions, away from the screen: how lines fall under day headers, what a line's time reads as,
 * and what stands at the right of a line.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day of a timestamp, YYYY-MM-DD. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local clock time of a timestamp, 24-hour. */
export function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Today", "Yesterday", else the date in words. */
export function dayHeader(day: string, now: Date): string {
  const today = localDay(now.toISOString());
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString());
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export interface DayGroup {
  day: string;
  header: string;
  lines: ActivityLine[];
}

/** Lines (newest first) under their day, in the order given. */
export function groupByDay(lines: readonly ActivityLine[], now: Date = new Date()): DayGroup[] {
  const out: DayGroup[] = [];
  for (const line of lines) {
    const day = localDay(line.at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.lines.push(line);
    else out.push({ day, header: dayHeader(day, now), lines: [line] });
  }
  return out;
}

/** "Today, 12:30" for the detail page. */
export function whenText(iso: string, now: Date = new Date()): string {
  return `${dayHeader(localDay(iso), now)}, ${timeOf(iso)}`;
}

/** The words at the right of a line that is not reversible now; null when it is (the Undo capsule stands there) or has none. */
export function stateWords(state: ActivityState): string | null {
  switch (state) {
    case 'undone':
      return 'Undone';
    case 'changed':
      return 'Changed again';
    case 'cannot':
      return 'Cannot undo';
    case 'safety':
      return 'Safety copy';
    default:
      return null;
  }
}
