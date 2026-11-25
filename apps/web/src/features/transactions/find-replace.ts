import type { CellAssignment } from './cell-range';

/*
 * Find and replace on the Mac tables (owner 2026-11-25, as Sheets' ⇧⌘H): words found in one column — Note, Category or
 * Payment method — across the rows the table shows, any case; and replaced in one go, on every row found or only on
 * those picked. A note has the words found replaced inside it; a category or a payment method is a name, so the cell
 * takes the new one whole (read as a paste reads it). One change, so one Undo.
 */

export type FindField = 'description' | 'category' | 'paid';

export const FIND_FIELDS: readonly { value: FindField; label: string }[] = [
  { value: 'description', label: 'Note' },
  { value: 'category', label: 'Category' },
  { value: 'paid', label: 'Paid with' },
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where the words are found in a text, any case: each [start, end). None for no words. */
export function findSpans(text: string, query: string): [number, number][] {
  const words = query.trim();
  if (!words) return [];
  const spans: [number, number][] = [];
  const pattern = new RegExp(escape(words), 'gi');
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) spans.push([match.index, match.index + match[0].length]);
  return spans;
}

/** The text with every place the words are found replaced, any case. */
export function replaceAll(text: string, query: string, replacement: string): string {
  const words = query.trim();
  return words ? text.replace(new RegExp(escape(words), 'gi'), () => replacement) : text;
}

/** The rows whose cell holds the words, in the table's order. */
export function findRows(rows: readonly { id: string; text: string }[], query: string): string[] {
  return rows.filter((row) => findSpans(row.text, query).length > 0).map((row) => row.id);
}

/** What a replace puts into each row found: a note with the words replaced in it; a name taken whole. */
export function replaceAssignments(rows: readonly { id: string; text: string }[], field: FindField, query: string, replacement: string): CellAssignment[] {
  return rows
    .filter((row) => findSpans(row.text, query).length > 0)
    .map((row) => ({ id: row.id, column: field, text: field === 'description' ? replaceAll(row.text, query, replacement) : replacement }));
}

/** "6 found · 3 on picked rows", "No match". */
export function foundLine(found: number, onPicked: number): string {
  if (found === 0) return 'No match';
  return onPicked > 0 ? `${found} found · ${onPicked} on picked ${onPicked === 1 ? 'row' : 'rows'}` : `${found} found`;
}
