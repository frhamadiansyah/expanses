import type { MoveRefusal } from '@expanses/db';

/** Under the Event row and on Select's confirmation (shared events §6): tagging into a shared event moves it. */
export function moveHint(eventName: string, sharedWith: number | null): string {
  if (sharedWith === null) return `Moves to ${eventName}, a shared event.`;
  return `Moves to ${eventName}, shared with ${sharedWith} ${sharedWith === 1 ? 'person' : 'people'}.`;
}

/** What stayed behind a move, and the first reason. */
export function keptText(kept: readonly MoveRefusal[]): string {
  return `${kept.length} stayed where ${kept.length === 1 ? 'it was' : 'they were'}: ${kept[0]!.why}`;
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
