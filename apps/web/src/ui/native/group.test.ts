import { describe, expect, it } from 'vitest';
import { groupHeader, rowPositions } from './group';

describe('rowPositions', () => {
  it('has no positions in an empty group', () => {
    expect(rowPositions(0)).toEqual([]);
  });

  it('draws no hairline above the first row — the group’s own edge is that line', () => {
    expect(rowPositions(1)).toEqual([{ first: true, last: true, separator: false }]);
  });

  it('separates the rows between, and marks the ends so the corners can be rounded', () => {
    expect(rowPositions(3)).toEqual([
      { first: true, last: false, separator: false },
      { first: false, last: false, separator: true },
      { first: false, last: true, separator: true },
    ]);
  });

  it('draws one fewer separator than it has rows, so nothing hangs below the last', () => {
    const drawn = rowPositions(8).filter((row) => row.separator);
    expect(drawn).toHaveLength(7);
  });
});

describe('groupHeader', () => {
  it('is a bare name when there is no figure to carry', () => {
    expect(groupHeader('Now and next')).toEqual({ label: 'Now and next', trailing: null });
  });

  it('carries a budget as “spent of budget”, with the no-break space formatMinor puts after Rp', () => {
    expect(groupHeader('Travel', { spentMinor: 12_400_000, budgetMinor: 14_000_000, currency: 'IDR' })).toEqual({
      label: 'Travel',
      trailing: 'Rp 12.400.000 of Rp 14.000.000',
    });
  });

  it('keeps the title’s real casing, because the uppercase is a drawing and a screen reader reads the string', () => {
    expect(groupHeader('Paid and skipped').label).toBe('Paid and skipped');
  });

  it('gives IDR no decimal places and a currency with them its own', () => {
    expect(groupHeader('Trip', { spentMinor: 1_250_000, budgetMinor: 2_000_000, currency: 'IDR' }).trailing).toBe(
      'Rp 1.250.000 of Rp 2.000.000',
    );
    expect(groupHeader('Trip', { spentMinor: 129_900, budgetMinor: 200_000, currency: 'USD' }).trailing).toBe(
      'US$1.299,00 of US$2.000,00',
    );
  });
});
