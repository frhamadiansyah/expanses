import type { EventRow } from '@expanses/db';

/** "13 – 17 Aug 2026", or one date when the event is a single day. */
export function eventDates(event: Pick<EventRow, 'startsOn' | 'endsOn'>): string {
  const day = (iso: string, withYear: boolean) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  if (event.startsOn === event.endsOn) return day(event.startsOn, true);
  // Inside one month the month is said once: "21 – 28 Oct 2026".
  if (event.startsOn.slice(0, 7) === event.endsOn.slice(0, 7)) {
    return `${new Date(`${event.startsOn}T00:00:00`).getDate()} – ${day(event.endsOn, true)}`;
  }
  return `${day(event.startsOn, false)} – ${day(event.endsOn, true)}`;
}

/** Where an event stands, in the words its card and its screen both use. */
export function eventStatus(event: Pick<EventRow, 'startsOn' | 'endsOn' | 'finishedAt'>, today: string): 'Upcoming' | 'Now' | 'Done' {
  if (event.finishedAt !== null || event.endsOn < today) return 'Done';
  return event.startsOn > today ? 'Upcoming' : 'Now';
}
