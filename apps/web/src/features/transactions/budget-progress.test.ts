import type { BudgetLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { budgetProgress } from './budget-progress';

const line = (over: Partial<BudgetLine> & { id: string }): BudgetLine => ({
  name: over.id,
  ownMinor: 0,
  totalMinor: 0,
  capMinor: null,
  overMinor: 0,
  children: [],
  ...over,
});

describe('budgetProgress', () => {
  it('adds up the caps and what was spent under them', () => {
    const progress = budgetProgress([
      line({ id: 'food', capMinor: 2_500_000, totalMinor: 2_980_500, overMinor: 480_500 }),
      line({ id: 'home', capMinor: 3_000_000, totalMinor: 2_415_000 }),
    ]);
    expect(progress).toEqual({ capsMinor: 5_500_000, spentMinor: 5_395_500, overCount: 1, any: true });
  });

  it('counts only the outermost cap, so a child is never counted twice', () => {
    const progress = budgetProgress([
      line({
        id: 'food',
        capMinor: 2_500_000,
        totalMinor: 2_000_000,
        children: [line({ id: 'coffee', capMinor: 400_000, totalMinor: 500_000, overMinor: 100_000 })],
      }),
    ]);
    expect(progress.capsMinor).toBe(2_500_000);
    expect(progress.spentMinor).toBe(2_000_000);
    // The child is still over its own tighter cap, and says so.
    expect(progress.overCount).toBe(1);
  });

  it('leaves spending with no cap over it out of the measure', () => {
    const progress = budgetProgress([
      line({ id: 'food', capMinor: 2_500_000, totalMinor: 1_000_000 }),
      line({ id: 'health', totalMinor: 1_219_717 }),
    ]);
    expect(progress.spentMinor).toBe(1_000_000);
    expect(progress.capsMinor).toBe(2_500_000);
  });

  it('says there is nothing to measure when no budget is set', () => {
    expect(budgetProgress([line({ id: 'health', totalMinor: 900_000 })])).toEqual({
      capsMinor: 0,
      spentMinor: 0,
      overCount: 0,
      any: false,
    });
  });
});
