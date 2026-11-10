import type { WordList } from './types';

/**
 * A capture laid out as a table: labels in one place, their values in another.
 *
 * A card issuer's transaction email is a table — a row of labels ("Nomor Kartu", "Merchant"), then a row of values
 * under them, twice, then a status — and what reaches the app is that table flattened to text by whatever handed it
 * over. Nobody promises how: one cell to a line, one row to a line with the cells apart by tabs or runs of spaces, or
 * each label with its value under it. All three are one rule here: a label is a cell that is nothing but a label word,
 * and a value is paired with its label by its place in its group.
 *
 * The labels are words of the language lists, never a bank's layout, so any issuer that prints its purchase this way
 * is read the same. Every step is a split or a scan over the text once: an email can run to several kilobytes of
 * footer, and nothing here backtracks over it.
 */

/** What a label says its value is. `other` is a label the reader knows only to step past ("Jenis Kartu"). */
export type TableField = 'amount' | 'currency' | 'date' | 'name' | 'account' | 'status' | 'other';

/** One label with its value, and the line of the text the value was on. */
export interface TablePair {
  field: TableField;
  value: string;
  line: number;
}

/** The pairs a table held, in the order they were printed, and the last line any of them was on (-1 for none). */
export interface LabelledTable {
  pairs: TablePair[];
  end: number;
}

/** A line cut into its cells: apart at a tab or at two spaces and more. */
function cellsOf(line: string): string[] {
  return line
    .replace(/ /g, ' ')
    .split(/\t+| {2,}/)
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '');
}

/** A cell folded to the form a label word is written in: lower case, single spaces, no colon after it. */
function asLabel(cell: string): string {
  let text = cell.toLowerCase().replace(/\s+/g, ' ').trim();
  if (text.endsWith(':')) text = text.slice(0, -1).trim();
  return text;
}

/** Every label word, with what its value is. The first list to name a word keeps it. */
function labelsOf(words: WordList): Map<string, TableField> {
  const labels = new Map<string, TableField>();
  const lists: readonly (readonly [readonly string[], TableField])[] = [
    [words.amountLabels, 'amount'],
    [words.currencyLabels, 'currency'],
    [words.dateLabels, 'date'],
    [words.nameLabels, 'name'],
    [words.accountLabels, 'account'],
    [words.statusLabels, 'status'],
    [words.tableLabels, 'other'],
  ];
  for (const [list, field] of lists) {
    for (const word of list) if (!labels.has(word)) labels.set(word, field);
  }
  return labels;
}

/** The labels a word list is read with, made once per list. */
const LABELS = new WeakMap<WordList, Map<string, TableField>>();

/**
 * The labelled pairs a text holds, however its table was flattened.
 *
 * - A line of labels only, followed by a line of as many cells with no label among them: the values, cell by cell.
 * - A line whose first cell is a label and whose other cells are not: the label and its value on one line.
 * - A run of lines that are each one label, followed by as many lines that are each one value: paired in order. A
 *   label followed by its value is the run of one.
 *
 * Anything else — a greeting, a footer, a sentence — holds no pair and is passed over.
 */
export function labelledTableOf(text: string, words: WordList): LabelledTable {
  let labels = LABELS.get(words);
  if (!labels) {
    labels = labelsOf(words);
    LABELS.set(words, labels);
  }
  const known = labels;
  const fieldOf = (cell: string): TableField | null => known.get(asLabel(cell)) ?? null;

  const rows = text
    .split('\n')
    .map((line, index) => {
      const cells = cellsOf(line);
      return { cells, fields: cells.map(fieldOf), line: index };
    })
    .filter((row) => row.cells.length > 0);

  const pairs: TablePair[] = [];
  let end = -1;
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    const first = row.fields[0] ?? null;
    if (first === null) {
      // A status written after its label on one line, "Status: Approved", is still the table's status.
      const colon = row.cells.length === 1 ? row.cells[0]!.indexOf(':') : -1;
      if (colon > 0 && fieldOf(row.cells[0]!.slice(0, colon)) === 'status') {
        pairs.push({ field: 'status', value: row.cells[0]!.slice(colon + 1).trim(), line: row.line });
      }
      i += 1;
      continue;
    }
    if (row.cells.length > 1) {
      if (row.fields.every((field) => field !== null)) {
        const next = rows[i + 1];
        if (next && next.cells.length === row.cells.length && next.fields.every((field) => field === null)) {
          row.fields.forEach((field, k) => pairs.push({ field: field!, value: next.cells[k]!, line: next.line }));
          end = next.line;
          i += 2;
          continue;
        }
      } else if (row.fields.slice(1).every((field) => field === null)) {
        pairs.push({ field: first, value: row.cells.slice(1).join(' '), line: row.line });
        end = row.line;
      }
      i += 1;
      continue;
    }
    let k = i;
    while (k < rows.length && rows[k]!.cells.length === 1 && rows[k]!.fields[0] !== null) k += 1;
    let v = k;
    while (v < rows.length && v - k < k - i && rows[v]!.cells.length === 1 && rows[v]!.fields[0] === null) v += 1;
    if (v - k === k - i) {
      for (let n = 0; n < k - i; n += 1) {
        pairs.push({ field: rows[i + n]!.fields[0]!, value: rows[k + n]!.cells[0]!, line: rows[k + n]!.line });
      }
      end = rows[v - 1]!.line;
      i = v;
      continue;
    }
    i = k;
  }
  return { pairs, end };
}

/** The first value printed under a label of this kind, or null. */
export function tableValue(table: LabelledTable, field: TableField): TablePair | null {
  return table.pairs.find((pair) => pair.field === field) ?? null;
}
