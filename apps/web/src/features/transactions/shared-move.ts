import type { MoveRefusal } from '@expanses/db';

/** Under the Event row and on Select's confirmation (shared events §6): tagging into a shared event moves it. */
export function moveHint(eventName: string, sharedWith: number): string {
  return `Moves to ${eventName}, shared with ${sharedWith} ${sharedWith === 1 ? 'person' : 'people'}.`;
}

/** What stayed behind a move, and the first reason. */
export function keptText(kept: readonly MoveRefusal[]): string {
  return `${kept.length} stayed where ${kept.length === 1 ? 'it was' : 'they were'}: ${kept[0]!.why}`;
}
