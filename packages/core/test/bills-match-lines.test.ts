import { describe, expect, it } from 'vitest';
import { matchBillsToLines } from '../src/index';

describe('matchBillsToLines', () => {
  it('gives each bill the part in its category, and two bills of one category the part of their own amount', () => {
    const lines = [
      { categoryId: 'internet', amountMinor: 385_000 },
      { categoryId: 'phone', amountMinor: 150_000 },
      { categoryId: 'phone', amountMinor: 100_000 },
    ];
    // Mobile phone 2 (100.000) is asked first, yet takes its own part, not the first Phone one.
    expect(
      matchBillsToLines(
        [
          { categoryId: 'phone', amountMinor: 100_000 },
          { categoryId: 'internet', amountMinor: 385_000 },
          { categoryId: 'phone', amountMinor: 150_000 },
        ],
        lines,
      ),
    ).toEqual([2, 0, 1]);
  });

  it('falls back to the category, then to any part left, and to none when the parts run out', () => {
    const lines = [
      { categoryId: 'phone', amountMinor: 120_000 },
      { categoryId: 'food', amountMinor: 40_000 },
    ];
    expect(
      matchBillsToLines(
        [
          { categoryId: 'phone', amountMinor: 100_000 },
          { categoryId: 'internet', amountMinor: null },
          { categoryId: 'water', amountMinor: 50_000 },
        ],
        lines,
      ),
    ).toEqual([0, 1, null]);
  });
});
