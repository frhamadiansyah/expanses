import type { BudgetLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { shareBaseOf, toAmount, toPercent } from './share-form';

const line = (id: string, name: string, capMinor: number | null, children: BudgetLine[] = []): BudgetLine => ({ id, name, ownMinor: 0, totalMinor: 0, capMinor, overMinor: 0, children });

describe('shareBaseOf', () => {
  it('is the parent’s budget when the parent has one, and take-home otherwise', () => {
    const lines = [line('food', 'Food', 2_000_000, [line('groceries', 'Groceries', null)]), line('fun', 'Fun', null, [line('games', 'Games', null)])];
    expect(shareBaseOf(lines, 'groceries', 10_000_000)).toEqual({ basis: 'parent', label: 'Food', minor: 2_000_000 });
    expect(shareBaseOf(lines, 'games', 10_000_000)).toEqual({ basis: 'take-home', label: 'take-home', minor: 10_000_000 });
    expect(shareBaseOf(lines, 'food', 10_000_000)).toEqual({ basis: 'take-home', label: 'take-home', minor: 10_000_000 });
  });
});

describe('toPercent and toAmount', () => {
  const base = { basis: 'take-home' as const, label: 'take-home', minor: 12_000_000 };

  it('turn a figure into its share and back within a whole unit', () => {
    expect(toPercent('1.860.000', base, 'IDR')).toBe('15,5');
    expect(toAmount('15,5', base, 'IDR')).toBe('1.860.000');
    expect(toAmount(toPercent('1.234.567', base, 'IDR'), base, 'IDR')).toBe('1.234.800');
  });

  it('keep an empty or unreadable figure as it is, and give no share without a basis', () => {
    expect(toPercent('', base, 'IDR')).toBe('');
    expect(toAmount('abc', base, 'IDR')).toBe('');
    expect(toPercent('500.000', { ...base, minor: 0 }, 'IDR')).toBe('');
  });
});
