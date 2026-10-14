/** One ticked row, and the event it is in now (null for none). */
export interface Ticked {
  id: string;
  eventId: string | null;
}

/**
 * Which ticked rows an Add to event or a Remove from event actually changes.
 *
 * Adding moves every row not already in that event — including one in another event, as tagging a single payment
 * always has. Removing touches only rows that were in an event; the rest are already where they belong, and
 * counting them in "3 removed" would claim a change that never happened.
 */
export function rowsToMove(ticked: readonly Ticked[], eventId: string | null): Ticked[] {
  return ticked.filter((row) => (eventId === null ? row.eventId !== null : row.eventId !== eventId));
}

/**
 * What the toast says once the rows have moved. A removal names the event when every row came out of the same
 * one, and says "their events" when they came from several — never a single name that is true of only some.
 */
export function movedText(moved: readonly Ticked[], eventId: string | null, nameOf: (eventId: string) => string | undefined): string {
  const count = `${moved.length} ${moved.length === 1 ? 'transaction' : 'transactions'}`;
  if (eventId !== null) return `${count} added to ${nameOf(eventId) ?? 'the event'}`;
  const from = [...new Set(moved.map((row) => row.eventId))];
  return `${count} removed from ${from.length === 1 && from[0] ? (nameOf(from[0]) ?? 'the event') : 'their events'}`;
}

/**
 * The way back: each moved row returned to the event it came from, grouped so each event is one write. A row that
 * was in no event goes back to none — so Undo after a move out of another event sends it home, not nowhere.
 */
export function homesOf(moved: readonly Ticked[]): Map<string | null, string[]> {
  const homes = new Map<string | null, string[]>();
  for (const row of moved) homes.set(row.eventId, [...(homes.get(row.eventId) ?? []), row.id]);
  return homes;
}
