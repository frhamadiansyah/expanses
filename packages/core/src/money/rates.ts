export interface DatedRate {
  /** YYYY-MM-DD. */
  onDate: string;
  rate: number;
}

/**
 * The rate that speaks for a date: the day's own, else the latest earlier one, else nothing.
 *
 * The same rule `findRate` uses in the database, as a pure function, so a whole month of amounts can be converted
 * from one snapshot of the table instead of one query per amount.
 */
export function pickRate(rows: readonly DatedRate[], onDate: string): DatedRate | null {
  let best: DatedRate | null = null;
  for (const row of rows) {
    if (row.onDate > onDate) continue;
    if (!best || row.onDate > best.onDate) best = row;
  }
  return best;
}
