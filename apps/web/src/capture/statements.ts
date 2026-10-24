/**
 * Statements that came in as pictures and were read in the app: what "Choose from Photos" picked, and a single
 * screenshot shared from Photos that turned out to be a statement page (`readsAsStatement`).
 *
 * They wait here, by id, for the card picker (`/statement/shared?batch=<id>`) to take them, the way the share sheet's
 * several screenshots wait in the App Group under theirs. Memory only: only the text lines are held, never a picture,
 * and nothing of a statement outlives the app.
 */
import type { CaptureLine } from '@expanses/core';

const offered = new Map<string, CaptureLine[][]>();
/** Offered by a drain, and not yet opened: Review hands the owner on to the card picker for each. */
const waiting: string[] = [];
const listeners = new Set<() => void>();
let counter = 0;

/** The id prefix the card picker knows an app-held statement by; the share sheet's batches are bare UUIDs. */
export const APP_STATEMENT_PREFIX = 'read-';

/**
 * Holds one statement's lines, one list per screenshot, and returns the id the card picker takes as `batch`.
 * `waits` marks it as one a drain found, for Review to open; a picker opens its own at once.
 */
export function offerStatement(images: CaptureLine[][], opts: { waits?: boolean } = {}): string {
  counter += 1;
  const id = `${APP_STATEMENT_PREFIX}${Date.now().toString(36)}-${counter}`;
  offered.set(id, images);
  if (opts.waits) {
    waiting.push(id);
    for (const listener of listeners) listener();
  }
  return id;
}

/** The lines held under an id, handed over once: the card picker keeps its own copy for the app's life. */
export function takeOfferedStatement(id: string): CaptureLine[][] | null {
  const images = offered.get(id) ?? null;
  offered.delete(id);
  const at = waiting.indexOf(id);
  if (at >= 0) waiting.splice(at, 1);
  return images;
}

/** The first statement a drain found that nobody has opened yet, or null. */
export function nextWaitingStatement(): string | null {
  return waiting[0] ?? null;
}

/** Told whenever a drain offers a statement. Returns the way to stop listening. */
export function onWaitingStatement(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
