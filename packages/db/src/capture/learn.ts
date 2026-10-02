/**
 * What a source learns from one correction.
 *
 * The reader guesses where a screen's amount, name and date are. When the owner corrects one of them, the correction
 * says more than the new value: it says which line the value was on, and what stood beside it. That is an anchor —
 * the label to look for next time, and roughly where it was — and it turns the second screenshot of a screen into a
 * lookup rather than a guess.
 *
 * Only an image can teach anything. A notification is read by its words, which the word lists already know; there is
 * no layout to it, and nothing to point at.
 */
import type { Anchor, CaptureLine, Reading, Template } from '@expanses/core';
import { eq } from 'drizzle-orm';
import type { Database } from '../database';
import { readingOf } from '../repos/drafts';
import { captureSources } from '../schema-capture';
import { draftTransactions } from '../schema-drafts';
import { templateOf } from './sources';

/**
 * A reading as a draft keeps it: what was read, and the lines it was read from.
 *
 * The lines travel with the reading because everything a correction needs is on the row: the reader says *which*
 * line a value came from, and only the lines themselves say where that was and what was written beside it.
 */
export interface StoredReading extends Reading {
  lines?: CaptureLine[];
}

/** The reading to write down, carrying the lines of an image so a correction can point at one. */
export function readingWithLines(reading: Reading, lines: readonly CaptureLine[]): StoredReading {
  return lines.length > 0 ? { ...reading, lines: [...lines] } : reading;
}

/** What a stored reading says, lines and all. */
export function storedReadingOf(json: string | null): StoredReading | null {
  return readingOf(json) as StoredReading | null;
}

/**
 * Where the value the owner named starts inside a line, as the line printed it.
 *
 * Nobody types what a screen printed: the figure comes back as `38000` for `Rp38.000`, and the name without the label
 * in front of it. So the exact text is looked for first, and then the figures it was made of.
 */
function spotOf(text: string, value: string): number {
  const wanted = value.trim().toLowerCase();
  if (wanted === '') return -1;
  const exact = text.toLowerCase().indexOf(wanted);
  if (exact >= 0) return exact;
  const digits = wanted.replace(/\D/g, '');
  if (digits.length < 2) return -1;
  for (const match of text.matchAll(/\d[\d.,\u00a0 ]*\d|\d/g)) {
    if (match[0].replace(/\D/g, '') === digits) return match.index;
  }
  return -1;
}

/** The line a corrected value is printed on, or null when no line holds it. */
function lineWith(lines: readonly CaptureLine[], value: string): number | null {
  const at = lines.findIndex((line) => spotOf(line.text, value) >= 0);
  return at < 0 ? null : at;
}

/**
 * What stood beside the value: the words before it on its own line, or the line above it.
 *
 * A label is what the reader will look for next time, so it is the *words* and not the figure: `Total` out of
 * `Total Rp38.000`, with the currency mark the owner did not type taken off the end.
 */
function labelOf(lines: readonly CaptureLine[], at: number, value: string): string | null {
  const text = lines[at]!.text;
  const spot = spotOf(text, value);
  if (spot < 0) return null;
  // Cutting at the value leaves whatever introduced it; cutting at the figures leaves the mark before them too.
  const before = spot === text.toLowerCase().indexOf(value.trim().toLowerCase()) ? text.slice(0, spot) : text.slice(0, spot).replace(/[\s\u00a0]*[A-Za-z]{1,3}[\s\u00a0]*$/, '');
  const label = before.trim();
  if (label !== '') return label;
  return at > 0 ? lines[at - 1]!.text.trim() || null : null;
}

/**
 * Writes down where a field was, from the owner's correction of it.
 *
 * Returns false when there is nothing to learn: no source to teach, a capture with no lines, or a value the capture
 * never printed — which means the owner is not correcting a reading but typing something new, and a template that
 * guessed at that would be worse than none.
 */
export async function learnFromCorrection(
  database: Database,
  draftId: string,
  field: 'amount' | 'name' | 'date',
  value: string,
): Promise<boolean> {
  const [draft] = await database.db.select().from(draftTransactions).where(eq(draftTransactions.id, draftId));
  if (!draft?.sourceId) return false;
  const reading = storedReadingOf(draft.readingJson);
  const lines = reading?.lines ?? [];
  if (lines.length === 0) return false;
  const at = lineWith(lines, value);
  if (at === null) return false;
  const [source] = await database.db.select().from(captureSources).where(eq(captureSources.id, draft.sourceId));
  if (!source) return false;

  const anchor: Anchor = { label: labelOf(lines, at, value), region: lines[at]!.box };
  const template: Template = { ...(templateOf(source.templateJson) ?? {}), [field]: anchor };
  await database.db
    .update(captureSources)
    .set({ templateJson: JSON.stringify(template), updatedAt: new Date().toISOString() })
    .where(eq(captureSources.id, source.id));
  return true;
}
