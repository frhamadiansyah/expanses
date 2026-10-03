/**
 * Screenshots already read, waiting for the check screen: the share sheet's way in (spec S2).
 *
 * A screen that has the Vision lines of several images already (the share extension's batch, read on the phone)
 * holds them here and opens `/cards/$cardId/check?batch=<id>`: the check starts at the reading step's end, with
 * nothing to pick. Memory only, so nothing of the statement outlives the app; the check drops it when it is done.
 */
import type { CaptureLine } from '@expanses/core';

const held = new Map<string, CaptureLine[][]>();
let counter = 0;

/** Holds one statement's lines, one list per screenshot, and returns the id the check route takes as `batch`. */
export function holdStatementBatch(images: CaptureLine[][]): string {
  counter += 1;
  const id = `batch-${Date.now().toString(36)}-${counter}`;
  held.set(id, images);
  return id;
}

/** The lines held under an id, or null once dropped (or never held). */
export function statementBatch(id: string | undefined): CaptureLine[][] | null {
  return id ? (held.get(id) ?? null) : null;
}

export function dropStatementBatch(id: string | undefined): void {
  if (id) held.delete(id);
}

/** What the card page says once it is back from a check: "May statement checked — ✓ Reconciled". Read once. */
let finished: string | null = null;
export function setCheckedNote(text: string): void {
  finished = text;
}
export function takeCheckedNote(): string | null {
  const text = finished;
  finished = null;
  return text;
}
