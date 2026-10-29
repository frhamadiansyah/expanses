import type { EventRow } from '@expanses/db';

/** Days a trip may be away and still be shown at the top of Cashflow. */
export const TRAVEL_LOOKAHEAD_DAYS = 7;

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

export interface TravelEntry {
  event: EventRow;
  /** "Today · day 3 of 6" while it runs, "Starts in 3 days" before. */
  line: string;
  running: boolean;
}

/**
 * The events Cashflow points at: those running today and those starting within a week, the running ones first and then
 * the nearest start, at most `max`. A finished event is never offered, nor one whose end has passed.
 */
export function travelEntries(events: readonly EventRow[], today: string, max = 2): TravelEntry[] {
  const now = dayNumber(today);
  const picked: (TravelEntry & { start: number })[] = [];
  for (const event of events) {
    if (event.finishedAt !== null || event.endsOn < today) continue;
    const start = dayNumber(event.startsOn);
    if (start <= now) {
      const length = dayNumber(event.endsOn) - start + 1;
      picked.push({ event, running: true, start, line: `Today · day ${now - start + 1} of ${length}` });
    } else if (start - now <= TRAVEL_LOOKAHEAD_DAYS) {
      const away = start - now;
      picked.push({ event, running: false, start, line: away === 1 ? 'Starts tomorrow' : `Starts in ${away} days` });
    }
  }
  picked.sort((a, b) => Number(b.running) - Number(a.running) || a.start - b.start);
  return picked.slice(0, max).map(({ event, line, running }) => ({ event, line, running }));
}
