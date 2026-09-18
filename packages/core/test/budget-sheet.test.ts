import { describe, expect, it } from 'vitest';
import { budgetSheet, type BudgetSheetInput, type CategoryAmount, type CategoryNode } from '../src/index';

const categories: CategoryNode[] = [
  { id: 'food', parentId: null, name: 'Food' },
  { id: 'groceries', parentId: 'food', name: 'Groceries' },
  { id: 'coffee', parentId: 'food', name: 'Coffee' },
  { id: 'transport', parentId: null, name: 'Transport' },
  { id: 'school', parentId: null, name: 'School' },
];

const amounts: CategoryAmount[] = [
  { accountId: 'groceries', amountBaseMinor: 3_000_000 },
  { accountId: 'coffee', amountBaseMinor: 800_000 },
  { accountId: 'transport', amountBaseMinor: 1_200_000 },
];

const input = (overrides: Partial<BudgetSheetInput> = {}): BudgetSheetInput => ({
  month: '2026-09',
  categories,
  amounts,
  caps: [],
  incomePlanMinor: 0,
  incomeActualMinor: 0,
  debtPaymentsPlanMinor: 0,
  debtPaymentsActualMinor: 0,
  savings: [],
  eventSpendingMinor: 0,
  eventsInCaps: false,
  ...overrides,
});

const line = (sheet: ReturnType<typeof budgetSheet>, id: string) => {
  const walk = (rows: ReturnType<typeof budgetSheet>['lines']): ReturnType<typeof budgetSheet>['lines'][number] | undefined => {
    for (const row of rows) {
      if (row.id === id) return row;
      const found = walk(row.children);
      if (found) return found;
    }
    return undefined;
  };
  return walk(sheet.lines)!;
};

describe('the category lines', () => {
  it('rolls a child into its parent, so a cap on Food covers Coffee', () => {
    const sheet = budgetSheet(input({ caps: [{ categoryId: 'food', amountMinor: 5_000_000 }] }));

    expect(line(sheet, 'food').totalMinor).toBe(3_800_000);
    expect(line(sheet, 'food').capMinor).toBe(5_000_000);
    expect(line(sheet, 'food').overMinor).toBe(0);
  });

  it('keeps a category with no spending and no cap, which the spending page would drop', () => {
    const sheet = budgetSheet(input());

    expect(line(sheet, 'school').totalMinor).toBe(0);
    expect(line(sheet, 'school').capMinor).toBeNull();
  });

  it('says how far over a cap a line is, and counts the lines that are over', () => {
    const sheet = budgetSheet(
      input({ caps: [{ categoryId: 'coffee', amountMinor: 500_000 }, { categoryId: 'transport', amountMinor: 2_000_000 }] }),
    );

    expect(line(sheet, 'coffee').overMinor).toBe(300_000);
    expect(line(sheet, 'transport').overMinor).toBe(0);
    expect(sheet.overCount).toBe(1);
  });
});

describe('the totals', () => {
  it('counts a nested budget once, under its outermost budgeted parent', () => {
    const sheet = budgetSheet(
      input({ caps: [{ categoryId: 'food', amountMinor: 5_000_000 }, { categoryId: 'coffee', amountMinor: 500_000 }] }),
    );

    // Coffee sits inside Food, so only Food's cap is in the total.
    expect(sheet.capsTotalMinor).toBe(5_000_000);
  });

  it('adds caps that share no branch', () => {
    const sheet = budgetSheet(
      input({ caps: [{ categoryId: 'groceries', amountMinor: 3_500_000 }, { categoryId: 'transport', amountMinor: 2_000_000 }] }),
    );

    expect(sheet.capsTotalMinor).toBe(5_500_000);
  });

  it('totals everything actually spent, capped or not', () => {
    expect(budgetSheet(input()).spendingActualMinor).toBe(5_000_000);
  });
});

describe('the two bottom lines', () => {
  it('plans against the caps, and reports against what happened', () => {
    const sheet = budgetSheet(
      input({
        caps: [{ categoryId: 'food', amountMinor: 5_000_000 }],
        incomePlanMinor: 20_000_000,
        incomeActualMinor: 19_000_000,
        debtPaymentsPlanMinor: 4_000_000,
        debtPaymentsActualMinor: 4_000_000,
        savings: [{ goalId: 'dana', name: 'Emergency fund', planMinor: 2_000_000, actualMinor: 1_000_000 }],
      }),
    );

    expect(sheet.leftOverPlanMinor).toBe(20_000_000 - 5_000_000 - 4_000_000 - 2_000_000);
    expect(sheet.leftOverActualMinor).toBe(19_000_000 - 5_000_000 - 4_000_000 - 1_000_000);
  });

  it('carries the goal rows through, so the sheet can list them', () => {
    const sheet = budgetSheet({
      ...input(),
      savings: [{ goalId: 'hajj', name: 'Hajj', planMinor: 1_500_000, actualMinor: 500_000 }],
    });

    expect(sheet.savings).toEqual([{ goalId: 'hajj', name: 'Hajj', planMinor: 1_500_000, actualMinor: 500_000 }]);
  });

  it('sums what the goals ask for and what reached them', () => {
    const sheet = budgetSheet(
      input({
        savings: [
          { goalId: 'dana', name: 'Emergency fund', planMinor: 2_000_000, actualMinor: 1_000_000 },
          { goalId: 'hajj', name: 'Hajj', planMinor: 1_500_000, actualMinor: 1_500_000 },
        ],
      }),
    );

    expect(sheet.savingsPlanMinor).toBe(3_500_000);
    expect(sheet.savingsActualMinor).toBe(2_500_000);
  });
});

describe('an occasion', () => {
  it('is held out of the caps, so an ordinary month still reads honestly', () => {
    const caps = [{ categoryId: 'food', amountMinor: 5_000_000 }];
    const without = budgetSheet(input({ caps }));
    const with_ = budgetSheet(input({ caps, eventSpendingMinor: 9_000_000 }));

    // A wedding would otherwise read as every category blown at once.
    expect(with_.spendingActualMinor).toBe(without.spendingActualMinor);
    expect(with_.overCount).toBe(without.overCount);
    expect(with_.capsTotalMinor).toBe(without.capsTotalMinor);
  });

  it('is still taken off what is left, because the money went', () => {
    const sheet = budgetSheet(input({ incomeActualMinor: 10_000_000, eventSpendingMinor: 2_000_000 }));

    // Rp 10.000.000 in, Rp 5.000.000 of ordinary spending, Rp 2.000.000 on the occasion.
    expect(sheet.leftOverActualMinor).toBe(3_000_000);
  });

  it('is carried through, so the sheet can name it rather than hide it', () => {
    expect(budgetSheet(input({ eventSpendingMinor: 2_000_000 })).eventSpendingMinor).toBe(2_000_000);
  });

  it('changes nothing when there was no occasion', () => {
    const sheet = budgetSheet(input({ incomeActualMinor: 10_000_000 }));

    expect(sheet.eventSpendingMinor).toBe(0);
    expect(sheet.leftOverActualMinor).toBe(5_000_000);
  });
});

describe('a workspace that counts its events', () => {
  const base = {
    month: '2026-08',
    categories: [{ id: 'c1', parentId: null, name: 'Restaurants' }],
    amounts: [{ accountId: 'c1', amountBaseMinor: 1_000_000 }],
    caps: [{ categoryId: 'c1', amountMinor: 2_000_000 }],
    incomePlanMinor: 10_000_000,
    incomeActualMinor: 10_000_000,
    debtPaymentsPlanMinor: 0,
    debtPaymentsActualMinor: 0,
    savings: [],
    eventSpendingMinor: 400_000,
  };

  it('subtracts event spending once when the caps do not see it', () => {
    const sheet = budgetSheet({ ...base, eventsInCaps: false });

    expect(sheet.leftOverActualMinor).toBe(10_000_000 - 1_000_000 - 400_000);
  });

  it('does not subtract it twice when the caps already contain it', () => {
    // The caller passed totals that include the event, so spendingActual is the whole 1.400.000.
    const sheet = budgetSheet({ ...base, amounts: [{ accountId: 'c1', amountBaseMinor: 1_400_000 }], eventsInCaps: true });

    expect(sheet.spendingActualMinor).toBe(1_400_000);
    expect(sheet.eventSpendingMinor).toBe(400_000);
    expect(sheet.leftOverActualMinor).toBe(10_000_000 - 1_400_000);
  });
});
