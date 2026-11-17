import type { BudgetLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { daysLeft, historyOf, noBudgetRows, planSplit, spendingView, splitSheetView, uncoveredMinor } from './budget-view';

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

  it('counts to the 24th in a workspace whose months start on the 25th', () => {
    // November is 25 Oct – 24 Nov: on 16 Nov, nine days with today.
    expect(daysLeft('2026-11', '2026-11-16', 25)).toBe(9);
    expect(daysLeft('2026-11', '2026-11-25', 25)).toBeNull();
    expect(daysLeft('2026-12', '2026-11-16', 25)).toBe(30);
    expect(daysLeft('2026-11', '2026-10-25', 25)).toBe(31);
    // Starting on the 1st is the calendar month, as before.
    expect(daysLeft('2026-10', '2026-10-01', 1)).toBe(31);
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

describe('noBudgetRows', () => {
  it('lists an uncapped root, then its uncapped sub-categories one step in, each only when it spent', () => {
    const food = line('food', 0, null, [line('groceries', 300, null), line('snacks', 0, null)]);
    const fun = line('fun', 0, null);
    const view = spendingView([food, fun]);

    expect(noBudgetRows(view.noBudget).map((row) => [row.line.id, row.depth, row.spentMinor])).toEqual([
      ['food', 0, 300],
      ['groceries', 1, 300],
    ]);
  });

  it('leaves out a sub-category a capped parent already covers', () => {
    const view = spendingView([line('food', 0, 1_000, [line('groceries', 300, null)])]);
    expect(noBudgetRows(view.noBudget)).toEqual([]);
  });
});

describe('historyOf', () => {
  it('reads last month and the three-month average, rounded up to a whole unit', () => {
    const months = [[line('food', 1_000, null)], [line('food', 2_000, null)], [line('food', 1_001, null)]];
    expect(historyOf(months, 'USD').get('food')).toEqual({ lastMinor: 1_000, averageMinor: 1_400 });
  });

  it('counts a month a category did not appear in as nothing, and a sub-category by its own total', () => {
    const months = [[line('food', 0, null, [line('groceries', 600, null)])], [], []];
    const history = historyOf(months, 'IDR');
    expect(history.get('groceries')).toEqual({ lastMinor: 600, averageMinor: 200 });
    expect(history.get('food')).toEqual({ lastMinor: 600, averageMinor: 200 });
  });
});

describe('the Essential and lifestyle sheet', () => {
  // Invented: groceries Rp 320.000 (essential) and a restaurant Rp 200.000 (lifestyle) on a card, then Rp 75.000 promo
  // cashback onto it. The budget sheet counts the cashback in what was spent and with Debts & savings.
  const withCashback = { spendingActualMinor: 445_000, essentialActualMinor: 320_000, lifestyleActualMinor: 200_000, debtsSavingsActualMinor: -75_000, cashbackActualMinor: -75_000 };

  it('shows shares of what was bought, the cashback on its own line and Spent after it', () => {
    const view = splitSheetView(withCashback);
    expect(view.boughtMinor).toBe(520_000);
    expect(view.rows.map((row) => [row.key, row.percent, row.amountMinor])).toEqual([
      ['essential', '62%', 320_000],
      ['lifestyle', '38%', 200_000],
      ['debtsSavings', '0%', 0],
    ]);
    expect(view.cashbackMinor).toBe(-75_000);
    expect(view.spentMinor).toBe(445_000);
    expect(view.bar).toEqual({ essential: (320 / 520) * 100, lifestyle: (200 / 520) * 100, debtsSavings: 0 });
  });

  it('never makes Debts & savings negative from cashback, and the shares add up to 100', () => {
    const view = splitSheetView({ ...withCashback, spendingActualMinor: 545_000, debtsSavingsActualMinor: 25_000, cashbackActualMinor: -75_000 });
    // Rp 100.000 of insurance bought; Rp 620.000 in all.
    expect(view.rows.find((row) => row.key === 'debtsSavings')!.amountMinor).toBe(100_000);
    expect(view.rows.map((row) => row.percent)).toEqual(['52%', '32%', '16%']);
    const sum = view.rows.reduce((total, row) => total + Number.parseInt(row.percent, 10), 0);
    expect(sum).toBe(100);
    for (const row of view.rows) expect(row.amountMinor).toBeGreaterThanOrEqual(0);
  });

  it('rounds to 100 even when each share alone would not', () => {
    // A third each: 33 + 33 + 34.
    const view = splitSheetView({ spendingActualMinor: 300, essentialActualMinor: 100, lifestyleActualMinor: 100, debtsSavingsActualMinor: 100, cashbackActualMinor: 0 });
    expect(view.rows.reduce((total, row) => total + Number.parseInt(row.percent, 10), 0)).toBe(100);
  });

  it('with no cashback is the month as before: no cashback line, and Spent is what was bought', () => {
    const view = splitSheetView({ spendingActualMinor: 3_000_000, essentialActualMinor: 2_000_000, lifestyleActualMinor: 1_000_000, debtsSavingsActualMinor: 0, cashbackActualMinor: 0 });
    expect(view.cashbackMinor).toBeNull();
    expect(view.boughtMinor).toBe(3_000_000);
    expect(view.spentMinor).toBe(3_000_000);
    expect(view.rows.map((row) => row.percent)).toEqual(['67%', '33%', '0%']);
  });

  it('has no shares and no bar when nothing was bought', () => {
    const view = splitSheetView({ spendingActualMinor: 0, essentialActualMinor: 0, lifestyleActualMinor: 0, debtsSavingsActualMinor: 0, cashbackActualMinor: 0 });
    expect(view.rows.map((row) => row.percent)).toEqual(['—', '—', '—']);
    expect(view.bar).toBeNull();
  });

  it('keeps cashback the only thing that month as its own line, with no shares to give', () => {
    const view = splitSheetView({ spendingActualMinor: -75_000, essentialActualMinor: 0, lifestyleActualMinor: 0, debtsSavingsActualMinor: -75_000, cashbackActualMinor: -75_000 });
    expect(view.rows.map((row) => [row.percent, row.amountMinor])).toEqual([['—', 0], ['—', 0], ['—', 0]]);
    expect(view.cashbackMinor).toBe(-75_000);
    expect(view.spentMinor).toBe(-75_000);
  });

  it('gives a refund-heavy part its own sign, and the bar only the parts above nought', () => {
    // Lifestyle refunded more than it bought this month: −Rp 50.000 against Rp 250.000 of essentials.
    const view = splitSheetView({ spendingActualMinor: 200_000, essentialActualMinor: 250_000, lifestyleActualMinor: -50_000, debtsSavingsActualMinor: 0, cashbackActualMinor: 0 });
    expect(view.rows.map((row) => row.percent)).toEqual(['125%', '-25%', '0%']);
    expect(view.bar).toEqual({ essential: 100, lifestyle: 0, debtsSavings: 0 });
  });
});
