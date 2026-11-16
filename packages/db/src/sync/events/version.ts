/*
 * Shared events need every phone in on them to know the seven entities (shared events §7, "App version"; ruling R10).
 * A joiner below this version is refused before it claims anything; a build that predates events altogether refuses the
 * invite itself, by its preview's currency ('XXX').
 */

/** The lowest app version that understands shared events. */
export const SHARED_EVENTS_MIN_APP_VERSION = '0.4.0';

/**
 * The first app version that reads a shared trip's Split costs and Plan switches (0116). An older build applies the
 * event's other fields and passes these over, keeping their clocks: it shows splits and the plan as before, and once it
 * updates it holds neither value. So each phone sends the two again for a device in the event the first time it sees
 * that device at this version or later (sync/repairs.ts, trip switches).
 */
export const TRIP_SWITCHES_MIN_APP_VERSION = '0.5.3';

/**
 * The first app version whose category_needs table takes Debts & savings (0119). An older build's table refuses it by
 * its CHECK, and on a phone that refusal reaches apply without SQLite's code (the worker passes only the message), so
 * apply cannot tell it from a fault and stops the pull at that entry. So a Debts & savings mark is never put in a shared
 * book's log until every other phone in the book says this version or later (capture.ts, `writeChangeSetsTx`); its
 * clock is kept here as if sent, and it goes at that clock once they do (repairs.ts, R7).
 */
export const NEEDS_THIRD_MARK_MIN_APP_VERSION = '0.5.4';

const segment = (parts: readonly string[], i: number) => {
  const n = Number(parts[i]);
  return Number.isFinite(n) ? n : 0;
};

/** Whether `have` is at least `want`, release segment by release segment; an unknown version never is. */
export function meetsVersion(have: string | null, want: string): boolean {
  if (have === null) return false;
  const a = have.split('.');
  const b = want.split('.');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (segment(a, i) !== segment(b, i)) return segment(a, i) > segment(b, i);
  }
  return true;
}
