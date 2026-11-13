import type { MoveRefusal } from '@expanses/db';

/** Under the Event row and on Select's confirmation (shared events §6): tagging into a shared event moves it. */
export function moveHint(eventName: string, sharedWith: number | null): string {
  if (sharedWith === null) return `Moves to ${eventName}, a shared event.`;
  return `Moves to ${eventName}, shared with ${sharedWith} ${sharedWith === 1 ? 'person' : 'people'}.`;
}

/** What stayed behind a move, and every different reason, so one row's reason is never read as all of theirs. */
export function keptText(kept: readonly MoveRefusal[]): string {
  const reasons = [...new Set(kept.map((row) => row.why))];
  return `${kept.length} stayed where ${kept.length === 1 ? 'it was' : 'they were'}: ${reasons.join('; ')}`;
}

/**
 * What stayed behind a move into a shared event: the rows it kept, with their reasons, and any chosen row it said
 * nothing about — never left out, so what the list still shows is always said (trip exchange fix). Empty when every
 * chosen row moved or was listed.
 */
export function stayedBehind(
  chosen: readonly string[],
  result: { moved: readonly { transactionId: string }[]; listed: readonly { transactionId: string }[]; kept: readonly MoveRefusal[] },
): MoveRefusal[] {
  const said = new Set([...result.moved, ...result.listed, ...result.kept].map((row) => row.transactionId));
  const unsaid = [...new Set(chosen)].filter((id) => !said.has(id)).map((transactionId) => ({ transactionId, why: 'It could not be moved' }));
  return [...result.kept, ...unsaid];
}

/**
 * The move after a save (sync gaps fix round 1): the purchase is already saved, so a refused move — or one that throws —
 * is said, never thrown. Thrown, it would leave the form open as an add, and a second Save would record it twice. Null
 * when it moved.
 */
export async function moveAfterSave(move: () => Promise<{ kept: readonly MoveRefusal[] }>, where: { bookName: string; eventName: string }): Promise<string | null> {
  let why: string | null;
  try {
    const { kept } = await move();
    why = kept[0]?.why ?? null;
  } catch (error) {
    why = error instanceof Error ? error.message : 'It could not be moved';
  }
  return why === null ? null : `Saved in ${where.bookName}. Not moved into ${where.eventName}: ${why}`;
}

/**
 * How a new purchase is posted when it goes to an event (event mode fix round 1, H2): into a shared event it is saved
 * with no tag and then moved, as Select → Add to event moves it — `moveIntoSharedEvent` applies the event. A move that
 * is refused or fails then leaves an ordinary purchase in its workspace, seen, never one tagged to a shared event and
 * not in it. A private event is tagged as it posts.
 */
export function postTag(eventId: string | null | undefined, sharedEvent: boolean): { eventId: string | null; moveInto: string | null } {
  if (!eventId) return { eventId: null, moveInto: null };
  return sharedEvent ? { eventId: null, moveInto: eventId } : { eventId, moveInto: null };
}

/** A purchase recorded and moved into a shared event: said with no Undo, since a move is not a tag a toast takes back. */
export const recordedIntoText = (description: string, eventName: string) => `Recorded ${description} · moved into ${eventName}`;
