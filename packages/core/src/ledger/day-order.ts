/**
 * The order of transactions within one day, when it has been set by hand.
 *
 * A row carries `dayOrder`, a position among its day's rows, or none. Rows with none come first, newest first — so a
 * transaction just recorded lands on top of its day, as it always has — and placed rows follow by position. A drag
 * writes the moved row alone, halfway between its two neighbours, so one move is one write (and one synced change);
 * only when a neighbour has never been placed, or the gap has run out, is the whole day numbered once.
 */

export interface DayOrdered {
  dayOrder?: number | null;
  createdAt?: string;
}

/** Within one day: unplaced rows first, newest first; then placed rows by position, newest first on a tie. */
export function compareWithinDay(a: DayOrdered, b: DayOrdered): number {
  const aPlaced = a.dayOrder !== null && a.dayOrder !== undefined;
  const bPlaced = b.dayOrder !== null && b.dayOrder !== undefined;
  if (aPlaced !== bPlaced) return aPlaced ? 1 : -1;
  const byPosition = aPlaced ? a.dayOrder! - b.dayOrder! : 0;
  return byPosition || (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
}

export interface DayOrderWrite {
  id: string;
  dayOrder: number;
}

const placed = (value: number | null | undefined): value is number => value !== null && value !== undefined;

/**
 * The positions to write so `rows` — one day's rows, in the order they should now be shown, the moved row among them —
 * reads in that order. Only the moved row when its neighbours are both placed (or it is at an end next to a placed
 * row); otherwise the whole day, numbered 1, 2, 3…, leaving out any row whose number does not change.
 */
export function planDayOrder(rows: readonly { id: string; dayOrder: number | null | undefined }[], movedId: string): DayOrderWrite[] {
  const index = rows.findIndex((row) => row.id === movedId);
  if (index < 0) throw new Error(`${movedId} is not among the day's rows`);
  if (rows.length < 2) return [];
  const moved = rows[index]!;
  const prev = rows[index - 1];
  const next = rows[index + 1];
  const prevOk = !prev || placed(prev.dayOrder);
  const nextOk = !next || placed(next.dayOrder);
  if (prevOk && nextOk) {
    const low = prev?.dayOrder ?? undefined;
    const high = next?.dayOrder ?? undefined;
    const fits = (value: number) => (low === undefined || value > low) && (high === undefined || value < high);
    if (placed(moved.dayOrder) && fits(moved.dayOrder)) return [];
    const target = low === undefined ? high! - 1 : high === undefined ? low + 1 : low + (high - low) / 2;
    if (fits(target)) return [{ id: movedId, dayOrder: target }];
  }
  return rows.flatMap((row, i) => (row.dayOrder === i + 1 ? [] : [{ id: row.id, dayOrder: i + 1 }]));
}
