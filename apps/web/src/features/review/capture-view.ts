/**
 * What a capture's row says, in one place — the row and the sheet read the same answer, so they cannot disagree
 * about whether something still needs asking.
 *
 * A capture is more than a figure: it came from somewhere (an app's notification, a screen, a paper receipt), it
 * may be more than one sighting of the same payment, and it may still be missing the one thing only the owner
 * knows — which account it is. The screen draws those three facts and nothing else; what the reader made of the
 * text is the sheet's subject.
 */
import { exponentOf, findAmounts, type CaptureLine, type Reading, WORDS } from '@expanses/core';
import type { CaptureSource, DraftRow } from '@expanses/db';

/** One thing a capture still has to be told before it can be recorded. */
export type CaptureNeed = 'account' | 'to-account' | 'amount';

export interface CaptureRowView {
  /** Where it came from; null for anything that is not a capture with a kind of its own. */
  icon: '🔔' | '📱' | '🧾' | null;
  /** Under the name: where it came from, and whether more than one sighting is folded into it. */
  subtitle: string;
  /** What still has to be answered before it can be recorded, in the order the sheet asks. */
  needs: CaptureNeed[];
  /** The earlier sightings folded in, when there are any: "Seen in N captures". */
  merged: string | null;
}

const ICONS: Partial<Record<DraftRow['source'], '🔔' | '📱' | '🧾'>> = {
  notification: '🔔',
  screen: '📱',
  photo: '🧾',
};

/** How sure the reader must be of the figure for the row to stop asking the owner to check it. */
export const SURE = 70;

export function captureRowView(draft: DraftRow, source: CaptureSource | null): CaptureRowView {
  const needs: CaptureNeed[] = [];
  if (draft.accountId === null) needs.push('account');
  if (draft.kind === 'transfer' && draft.toAccountId === null) needs.push('to-account');
  if (draft.amountMinor === 0 || (draft.confidence !== null && draft.confidence < SURE)) needs.push('amount');

  const merged = draft.captureIds.length > 1 ? `Seen in ${draft.captureIds.length} captures` : null;
  const where = source?.label ?? 'Captured on this phone';
  return {
    icon: ICONS[draft.source] ?? null,
    subtitle: merged ? `${where} · ${merged}` : where,
    needs,
    merged,
  };
}

/** The reading as a draft keeps it: the values, and the lines they were read from. */
export type ReadingWithLines = Reading & { lines?: CaptureLine[] };

export interface FieldBox {
  field: 'amount' | 'name' | 'date';
  /** x, y, width and height in 0–1, y from the top — the box of the line the value came from. */
  box: [number, number, number, number];
  /** What the box is called where it is drawn. */
  label: string;
}

const FIELD_LABELS: Record<FieldBox['field'], string> = { amount: 'Amount', name: 'Merchant', date: 'Date' };

// The marks the reader knows, so a typed amount can be read with the same rules as a printed one.
const READER_MARKS: Record<string, string> = { IDR: 'Rp', USD: '$', SGD: 'S$', MYR: 'RM', EUR: '€', JPY: '¥' };

/** The editable form of an amount: '38000' for Rp38.000, '12.5' for $12.50. */
export function majorText(minor: number, currency: string): string {
  const exponent = exponentOf(currency);
  return String(Number((Math.abs(minor) / 10 ** exponent).toFixed(exponent)));
}

/**
 * What the owner typed as an amount, in minor units — read with the reader's own rules, so 'Rp38.000', '38.000'
 * and '38000' all agree, and a figure the reader cannot make sense of is not a change at all.
 */
export function minorFromTyped(text: string, currency: string): number | null {
  const typed = text.trim();
  if (typed === '') return null;
  const [found] = findAmounts(`${READER_MARKS[currency] ?? currency} ${typed}`, WORDS);
  return found?.minor ?? null;
}

/**
 * Where the picture says what was read: one box per field, on the line it was read from.
 *
 * Only an image has lines to point at — a notification's reading came out of its words, and there is nothing to
 * draw a box on. A field the reader did not place (or placed on a line that is no longer there) is left out
 * rather than drawn somewhere wrong.
 */
export function fieldBoxes(reading: ReadingWithLines | null): FieldBox[] {
  if (!reading) return [];
  const lines = reading.lines ?? [];
  const wanted: { field: FieldBox['field']; line: number | null }[] = [
    { field: 'amount', line: reading.amount?.line ?? null },
    { field: 'name', line: reading.name?.line ?? null },
    { field: 'date', line: reading.occurredAt?.line ?? null },
  ];
  const boxes: FieldBox[] = [];
  for (const { field, line } of wanted) {
    const from = line === null ? undefined : lines[line];
    if (!from) continue;
    boxes.push({ field, box: from.box, label: FIELD_LABELS[field] });
  }
  return boxes;
}
