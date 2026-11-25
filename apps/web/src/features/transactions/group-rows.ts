import { type Figure, type FigureSum, sumFigures } from './table-figures';

/*
 * Group by on the Mac Cashflow table (owner 2026-11-25, as Notion): one choice in the table's ⋯ menu — None, Category,
 * Payment method or Day. Each group says its name, how many rows and what they come to; a click on its name folds it.
 * None is the table as it always was.
 */

export type GroupBy = 'none' | 'category' | 'paid' | 'day';

export const GROUP_CHOICES: readonly { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'category', label: 'Category' },
  { value: 'paid', label: 'Paid with' },
  { value: 'day', label: 'Day' },
];

export interface RowGroup<T> {
  key: string;
  label: string;
  rows: T[];
  sum: FigureSum;
}

/**
 * The rows in their groups. Inside a group the rows keep the table's order. Days follow the calendar — oldest first,
 * or newest first when the table reads so (`newestFirst`); categories and payment methods go largest total first
 * (by name when two are level, or when the totals are in several currencies).
 */
export function groupRows<T>(
  rows: readonly T[],
  by: Exclude<GroupBy, 'none'>,
  keyOf: (row: T) => { key: string; label: string },
  figureOf: (row: T) => Figure,
  currency: string,
  newestFirst = false,
): RowGroup<T>[] {
  const groups = new Map<string, { key: string; label: string; rows: T[] }>();
  for (const row of rows) {
    const { key, label } = keyOf(row);
    const group = groups.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const summed = [...groups.values()].map((group) => ({ ...group, sum: sumFigures(group.rows.map(figureOf), currency) }));
  const total = (group: RowGroup<T>) => ('mixed' in group.sum ? 0 : group.sum.minor);
  if (by === 'day') {
    // An undated row ('' key) goes last either way.
    return summed.sort((a, b) => (!a.key !== !b.key ? (a.key ? -1 : 1) : a.key.localeCompare(b.key) * (newestFirst ? -1 : 1)));
  }
  return summed.sort((a, b) => total(b) - total(a) || a.label.localeCompare(b.label));
}
