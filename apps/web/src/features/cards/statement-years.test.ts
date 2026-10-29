import { describe, expect, it } from 'vitest';
import { hasEarlierYears, yearGroups } from './statement-years';

// Closed on the 20th, October 2026 back to March 2022.
const months: { end: string }[] = [];
for (let y = 2026; y >= 2022; y -= 1) {
  for (let m = y === 2026 ? 10 : 12; m >= (y === 2022 ? 3 : 1); m -= 1) months.push({ end: `${y}-${String(m).padStart(2, '0')}-20` });
}

describe('statement years', () => {
  it('opens on the newest year and the one before it', () => {
    expect(yearGroups(months, 0).map((g) => [g.year, g.months.length])).toEqual([[2026, 10], [2025, 12]]);
    expect(hasEarlierYears(months, 0)).toBe(true);
  });
  it('adds one year for each Show earlier years', () => {
    expect(yearGroups(months, 1).map((g) => g.year)).toEqual([2026, 2025, 2024]);
    expect(yearGroups(months, 2).map((g) => g.year)).toEqual([2026, 2025, 2024, 2023]);
  });
  it('stops offering once the first purchase year is shown', () => {
    expect(hasEarlierYears(months, 2)).toBe(true);
    expect(hasEarlierYears(months, 3)).toBe(false);
    expect(yearGroups(months, 3).map((g) => g.year)).toEqual([2026, 2025, 2024, 2023, 2022]);
  });
  it('has no earlier years when the card began last year, and nothing for no months', () => {
    expect(hasEarlierYears(months.filter((m) => m.end >= '2025-01-01'), 0)).toBe(false);
    expect(yearGroups([], 0)).toEqual([]);
    expect(hasEarlierYears([], 0)).toBe(false);
  });
});
