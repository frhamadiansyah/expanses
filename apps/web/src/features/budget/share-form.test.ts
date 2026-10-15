import type { BudgetLine } from '@expanses/core';
import type { BudgetRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { dependantsOf, keptWarning, shareBaseOf, toAmount, toPercent } from './share-form';

const line = (id: string, name: string, capMinor: number | null, children: BudgetLine[] = []): BudgetLine => ({ id, name, ownMinor: 0, totalMinor: 0, capMinor, overMinor: 0, children });
const stored = (categoryAccountId: string, planMinor: number, amountMinor: number, share: BudgetRow['share']): BudgetRow => ({
  id: `b-${categoryAccountId}`,
  categoryAccountId,
  planMinor,
  amountMinor,
  overridden: amountMinor !== planMinor,
  frequency: 'monthly',
  amountAsSetMinor: planMinor,
  share,
});

describe('shareBaseOf', () => {
  it('is the parent’s budget when the parent has one, and take-home otherwise', () => {
    const lines = [line('food', 'Food', 2_000_000, [line('groceries', 'Groceries', null)]), line('fun', 'Fun', null, [line('games', 'Games', null)])];
    expect(shareBaseOf(lines, 'groceries', 10_000_000, null)).toEqual({ basis: 'parent', label: 'Food', minor: 2_000_000 });
    expect(shareBaseOf(lines, 'games', 10_000_000, null)).toEqual({ basis: 'take-home', label: 'take-home', minor: 10_000_000 });
    expect(shareBaseOf(lines, 'food', 10_000_000, null)).toEqual({ basis: 'take-home', label: 'take-home', minor: 10_000_000 });
  });

  it('keeps the basis a share was saved with while it is there, and falls back to the tree once it is not', () => {
    const lines = [line('food', 'Food', 2_000_000, [line('groceries', 'Groceries', null)]), line('fun', 'Fun', null, [line('games', 'Games', null)])];
    expect(shareBaseOf(lines, 'groceries', 10_000_000, { basis: 'take-home', bp: 500 })).toEqual({ basis: 'take-home', label: 'take-home', minor: 10_000_000 });
    expect(shareBaseOf(lines, 'groceries', 10_000_000, { basis: 'parent', bp: 4000 })).toEqual({ basis: 'parent', label: 'Food', minor: 2_000_000 });
    expect(shareBaseOf(lines, 'games', 10_000_000, { basis: 'parent', bp: 4000 })).toEqual({ basis: 'take-home', label: 'take-home', minor: 10_000_000 });
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

describe('dependantsOf', () => {
  it('names each %-child of the budget with its plan figure for the month, not that month’s own figure', () => {
    const lines = [line('food', 'Food', 2_000_000, [line('groceries', 'Groceries', 950_000), line('coffee', 'Coffee', 300_000)])];
    const budgets = [stored('food', 2_000_000, 2_000_000, null), stored('groceries', 800_000, 950_000, { basis: 'parent', bp: 4000 }), stored('coffee', 300_000, 300_000, null)];
    expect(dependantsOf(lines, budgets, 'food')).toEqual([{ name: 'Groceries', minor: 800_000 }]);
    expect(keptWarning(dependantsOf(lines, budgets, 'food'), 'IDR')).toMatch(/^Groceries keeps Rp\s800\.000 a month\. Remove this budget\?$/);
  });
});
