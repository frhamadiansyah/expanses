/*
 * A card's statements, grouped by the year each closed in, newest first. The page opens on the newest year and the one
 * before it; "Show earlier years" adds one more at a time until the year of the first purchase is reached.
 */

export interface DatedMonth {
  /** The day the statement closed. */
  end: string;
}

const yearOf = (date: string) => Number(date.slice(0, 4));

/** The oldest year shown: the newest statement's year, one back, and `extra` more. */
export function oldestShownYear(months: readonly DatedMonth[], extra: number): number | null {
  const newest = months[0];
  return newest ? yearOf(newest.end) - 1 - Math.max(0, extra) : null;
}

/** The months shown, grouped by the year they closed in, newest year first. */
export function yearGroups<T extends DatedMonth>(months: readonly T[], extra: number): { year: number; months: T[] }[] {
  const oldest = oldestShownYear(months, extra);
  if (oldest === null) return [];
  const groups: { year: number; months: T[] }[] = [];
  for (const month of months) {
    const year = yearOf(month.end);
    if (year < oldest) continue;
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.months.push(month);
    else groups.push({ year, months: [month] });
  }
  return groups;
}

/** Whether older statements are still hidden, so the "Show earlier years" row is drawn. */
export function hasEarlierYears(months: readonly DatedMonth[], extra: number): boolean {
  const oldest = oldestShownYear(months, extra);
  const last = months[months.length - 1];
  return oldest !== null && last !== undefined && yearOf(last.end) < oldest;
}
