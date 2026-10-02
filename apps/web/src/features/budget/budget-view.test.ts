import type { BudgetLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { daysLeft, planSplit, spendingView, uncoveredMinor } from './budget-view';

function line(id: string, ownMinor: number, capMinor: number | null, children: BudgetLine[] = []): BudgetLine {
  const totalMinor = children.reduce((total, child) => total + child.totalMinor, ownMinor);
  return { id, name: id, ownMinor, totalMinor, capMinor, overMinor: capMinor !== null && totalMinor > capMinor ? totalMinor - capMinor : 0, children };
}

describe('days left', () => {
  it('counts today in the current month', () => {
    expect(daysLeft('2026-10', '2026-10-01')).toBe(31);
    expect(daysLeft('2026-09', '2026-09-30')).toBe(1);
  });

  it('has none for a month past, and every day of one still to come', () => {
    expect(daysLeft('2026-09', '2026-10-01')).toBeNull();
    expect(daysLeft('2027-02', '2026-10-01')).toBe(28);
  });
});

describe('the Spending tab', () => {
  const food = line('Food', 0, 3_000_000, [line('Groceries', 1_000_000, 800_000), line('Restaurants', 500_000, null)]);
  const transport = line('Transport', 200_000, 1_000_000);
  const care = line('Care', 0, null, [line('Hair', 100_000, null), line('Gym', 300_000, 250_000)]);
  const gifts = line('Gifts', 50_000, null);
  const view = spendingView([food, transport, care, gifts]);

  it('adds up only the outermost caps and what they saw', () => {
    expect(view.budgetedMinor).toBe(3_000_000 + 1_000_000 + 250_000);
    expect(view.spentMinor).toBe(1_500_000 + 200_000 + 300_000);
  });

  it('lists a line over its cap once, in the Over group', () => {
    expect(view.over.map((row) => row.id)).toEqual(['Groceries', 'Gym']);
    // Food's capped child is over, so Food is a plain line rather than a drawer of one.
    expect(view.budgeted.find((entry) => entry.kind === 'line' && entry.line.id === 'Food')).toBeDefined();
    // Care's only cap is over, so Care has nothing left to fold.
    expect(view.budgeted.some((entry) => entry.kind === 'drawer' && entry.parent.id === 'Care')).toBe(false);
  });

  it('sorts the most used first', () => {
    // Food has used half, Transport a fifth.
    expect(view.budgeted.map((entry) => (entry.kind === 'line' ? entry.line.id : entry.parent.id))).toEqual(['Food', 'Transport']);
  });

  it('puts what no cap covers under No budget, a capped child left out', () => {
    expect(view.noBudget.map((entry) => entry.line.id)).toEqual(['Care', 'Gifts']);
    const careEntry = view.noBudget.find((entry) => entry.line.id === 'Care')!;
    expect(careEntry.spentMinor).toBe(100_000);
    expect(careEntry.children.map((child) => child.line.id)).toEqual(['Hair']);
    expect(view.noBudgetMinor).toBe(150_000);
  });

  it('folds a parent over its capped children, its own cap first', () => {
    const tree = line('Food', 0, 3_000_000, [line('Groceries', 100_000, 800_000), line('Snacks', 300_000, 400_000)]);
    const [entry] = spendingView([tree]).budgeted;
    expect(entry?.kind === 'drawer' && entry.lines.map((row) => row.id)).toEqual(['Food', 'Snacks', 'Groceries']);
    expect(entry?.kind === 'drawer' && entry.leftMinor).toBe(2_600_000);
  });

  it('reads Care as spending only what is uncapped', () => {
    const own = line('Care', 40_000, null, [line('Hair', 100_000, null), line('Gym', 300_000, 250_000)]);
    expect(uncoveredMinor(own)).toBe(140_000);
  });
});

describe('the take-home split', () => {
  it('divides into debt, goals, caps and what is unplanned', () => {
    const split = planSplit({ incomeMinor: 25_000_000, debtMinor: 5_000_000, goalsMinor: 4_000_000, budgetedMinor: 11_200_000 });
    expect(split.parts.map((part) => [part.key, part.minor, part.percent])).toEqual([
      ['debt', 5_000_000, 20],
      ['goals', 4_000_000, 16],
      ['budgeted', 11_200_000, 45],
      ['unplanned', 4_800_000, 19],
    ]);
    expect(split.scaleMinor).toBe(25_000_000);
  });

  it('draws against the plan when the plan is more than the take-home', () => {
    const split = planSplit({ incomeMinor: 0, debtMinor: 1_000, goalsMinor: 0, budgetedMinor: 2_000 });
    expect(split.scaleMinor).toBe(3_000);
    expect(split.parts.every((part) => part.percent === null)).toBe(true);
  });
});
