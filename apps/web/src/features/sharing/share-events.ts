import type { EventRow, SharedEventSummary } from '@expanses/db';
import { sharedWithText } from '../events/shared-view';

/** One event on the Share page: its name and where it stands, shared or not. */
export interface ShareEventRow {
  eventId: string;
  name: string;
  shared: boolean;
  /** "Not shared", or "Shared with 2 people" as the events list words it. */
  value: string;
}

/**
 * The Share page's Events section: the owner's events that are not archived (`listEvents` leaves those out), in the
 * order the events list keeps, each told apart by whether this phone holds an event book for it.
 */
export function shareEventRows(events: readonly EventRow[], summaries: Readonly<Record<string, SharedEventSummary>>): ShareEventRow[] {
  return events.map((event) => {
    const summary = summaries[event.id];
    return { eventId: event.id, name: event.name, shared: summary !== undefined, value: summary ? sharedWithText(summary.sharedWith) : 'Not shared' };
  });
}
