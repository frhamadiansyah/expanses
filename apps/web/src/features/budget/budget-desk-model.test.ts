import type { BudgetLine } from '@expanses/core';
import type { BudgetRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { cellText, deskTable, needsALook, planCell, shownRows, toneOf, typedRow } from './budget-desk-model';

/** A line of the month's sheet: what it spent itself, its cap, and the lines under it. Invented figures. */
function line(id: string, ownMinor: number, capMinor: number | null, children: BudgetLine[] = []): BudgetLine {
  const totalMinor = children.reduce((total, child) => total + child.totalMinor, ownMinor);
  return { id, name: id, ownMinor, totalMinor, capMinor, overMinor: capMinor !== null && totalMinor > capMinor ? totalMinor - capMinor : 0, children };
}

const stored = (categoryAccountId: string, amountMinor: number, extra: Partial<BudgetRow> = {}): BudgetRow => ({
  id: `b-${categoryAccountId}`,
  categoryAccountId,
  planMinor: amountMinor,
  amountMinor,
  overridden: false,
  frequency: 'monthly',
  amountAsSetMinor: amountMinor,
  share: null,
  ...extra,
});

// Household: its own 300.000 and two budgeted children. Food: no budget of its own, Restaurants over, Takeaways a 20%.
const household = line('Household', 120_000, 300_000, [line('Groceries', 3_412_000, 4_000_000), line('Supplies', 229_000, 500_000)]);
const food = line('Food', 0, null, [line('Restaurants', 1_960_000, 1_500_000), line('Takeaways', 520_000, 500_000), line('Coffee', 380_000, null), line('Tea', 0, null)]);
const health = line('Health', 94_500, 500_000);
const gifts = line('Gifts', 150_000, null);
const electronics = line('Electronics', 0, null, [line('Phones', 600_000, null), line('Cables', 0, null)]);
const pets = line('Pets', 0, null);
const lines = [household, food, health, gifts, electronics, pets];
const budgets = [
  stored('Household', 300_000),
  stored('Groceries', 4_000_000),
  stored('Supplies', 500_000),
  stored('Restaurants', 1_500_000),
  stored('Takeaways', 500_000, { share: { basis: 'parent', bp: 2000 } }),
  stored('Health', 500_000),
];

describe('toneOf', () => {
  it('is green under 85%, orange from 85% (the whole of it included), red only once over, and none with no budget', () => {
    expect(toneOf(1_000_000, 840_000)).toBe('ok');
    expect(toneOf(1_000_000, 850_000)).toBe('near');
    expect(toneOf(1_000_000, 1_000_000)).toBe('near');
    expect(toneOf(1_000_000, 1_000_001)).toBe('over');
    expect(toneOf(null, 500_000)).toBeNull();
  });
});

describe('the Categories table', () => {
  const table = deskTable(lines, budgets);
  const row = (key: string) => table.rows.find((each) => each.key === key)!;

  it('lists the budgeted roots by name, a parent as a group with its own budget or money first as "All <parent>", then No budget yet', () => {
    expect(table.rows.map((each) => [each.key, each.label, each.depth, each.section])).toEqual([
      ['group:Food', 'Food', 0, 'budgeted'],
      // Food has no budget of its own and nothing was booked to Food itself: no "All Food".
      ['line:Coffee', 'Coffee', 1, 'budgeted'],
      // Tea has no budget and spent nothing: Edit budgets has it.
      ['line:Restaurants', 'Restaurants', 1, 'budgeted'],
      ['line:Takeaways', 'Takeaways', 1, 'budgeted'],
      ['line:Health', 'Health', 0, 'budgeted'],
      ['group:Household', 'Household', 0, 'budgeted'],
      ['line:Household', 'All Household', 1, 'budgeted'],
      ['line:Groceries', 'Groceries', 1, 'budgeted'],
      ['line:Supplies', 'Supplies', 1, 'budgeted'],
      // Nothing budgeted in either and both spent: by what they spent, a spending sub-category one step in. Pets spent nothing.
      ['line:Electronics', 'Electronics', 0, 'none'],
      ['line:Phones', 'Phones', 1, 'none'],
      ['line:Gifts', 'Gifts', 0, 'none'],
    ]);
    expect(table.noBudgetCount).toBe(2);
  });

  it('gives a group the whole category’s Spent, and the Budget and Left of its outermost budgets (the phone’s drawer)', () => {
    // Household's own budget covers everything under it: 300.000 against all 3.761.000 it spent.
    expect(row('group:Household')).toMatchObject({ budgetMinor: 300_000, spentMinor: 3_761_000, leftMinor: -3_461_000, tone: 'over', edit: null });
    // Food has none of its own: Restaurants and Takeaways are its budget and its Left; Coffee, unbudgeted, is in its
    // Spent but under no budget (Not budgeted).
    expect(row('group:Food')).toMatchObject({ budgetMinor: 2_000_000, spentMinor: 2_860_000, leftMinor: -480_000, tone: 'over' });
  });

  it('gives "All <parent>" only what was booked to the parent itself, against the parent’s own budget', () => {
    // 120.000 booked to Household itself; its 300.000 covers all 3.761.000 under it, as the phone's "All" row reads.
    expect(row('line:Household')).toMatchObject({ label: 'All Household', budgetMinor: 300_000, spentMinor: 120_000, leftMinor: -3_461_000, tone: 'over' });
  });

  it('adds a group’s sub-category rows and its "All" row up to the group’s Spent', () => {
    // Invented: money on the parent itself and no budget of its own; one sub-category budgeted, one not, one refunded.
    const home = line('Home', 75_000, null, [line('Repairs', 410_000, 600_000), line('Garden', 96_500, null), line('Decor', -30_000, null), line('Spare', 0, null)]);
    const pets2 = line('Pets', 0, null, [line('Petfood', 250_000, 300_000), line('Vet', 180_000, null)]);
    const capped = line('Car', 50_000, 1_000_000, [line('Fuel', 640_000, null), line('Parking', 82_000, 100_000)]);
    const sums = deskTable([home, pets2, capped], [stored('Repairs', 600_000), stored('Petfood', 300_000), stored('Car', 1_000_000), stored('Parking', 100_000)]);
    for (const group of sums.rows.filter((each) => each.kind === 'group')) {
      const under = sums.rows.filter((each) => each.groupId === group.categoryId && each.depth === 1);
      expect(under.reduce((sum, each) => sum + each.spentMinor, 0)).toBe(group.spentMinor);
    }
    const at = (key: string) => sums.rows.find((each) => each.key === key);
    expect(at('group:Home')).toMatchObject({ budgetMinor: 600_000, spentMinor: 551_500, leftMinor: 190_000 });
    expect(at('line:Home')).toMatchObject({ label: 'All Home', budgetMinor: null, spentMinor: 75_000, leftMinor: null });
    // No budget of its own and nothing on Pets itself: no "All Pets", and its two rows make its Spent.
    expect(at('line:Pets')).toBeUndefined();
    expect(at('group:Pets')).toMatchObject({ budgetMinor: 300_000, spentMinor: 430_000, leftMinor: 50_000 });
    expect(at('group:Car')).toMatchObject({ budgetMinor: 1_000_000, spentMinor: 772_000, leftMinor: 228_000 });
    expect(at('line:Car')).toMatchObject({ budgetMinor: 1_000_000, spentMinor: 50_000, leftMinor: 228_000 });
  });

  it('gives each line its budget, spent and left, its % as typed, and an unbudgeted line no left', () => {
    expect(row('line:Groceries')).toMatchObject({ budgetMinor: 4_000_000, spentMinor: 3_412_000, leftMinor: 588_000, tone: 'near', percent: null, edit: 'cell' });
    expect(row('line:Takeaways')).toMatchObject({ budgetMinor: 500_000, leftMinor: -20_000, tone: 'over', percent: '20%' });
    expect(row('line:Coffee')).toMatchObject({ budgetMinor: null, spentMinor: 380_000, leftMinor: null, tone: null, edit: 'cell' });
    expect(row('line:Health')).toMatchObject({ tone: 'ok', share: 94_500 / 500_000 });
  });

  it('adds the total from the outermost budgets only, as the gauge does', () => {
    expect(table.total).toEqual({ budgetMinor: 300_000 + 2_000_000 + 500_000, spentMinor: 3_761_000 + 2_480_000 + 94_500, leftMinor: 2_800_000 - 6_335_500 });
  });

  it('sends a weekly budget to the full editor and a month with its own figure to the cap sheet', () => {
    const odd = deskTable([health, gifts], [stored('Health', 2_166_667, { frequency: 'weekly', amountAsSetMinor: 500_000 }), stored('Gifts', 900_000, { overridden: true, planMinor: 200_000 })]);
    expect(odd.rows.find((each) => each.categoryId === 'Health')).toMatchObject({ edit: 'editor', frequency: 'weekly' });
    // An override makes Gifts budgeted this month, whatever its plan.
    expect(odd.rows.find((each) => each.categoryId === 'Gifts')).toMatchObject({ edit: 'sheet', overridden: true });
  });

  it('folds a group to its own row', () => {
    expect(shownRows(table.rows, new Set(['Household'])).map((each) => each.key)).not.toContain('line:Groceries');
    expect(shownRows(table.rows, new Set(['Household'])).map((each) => each.key)).toContain('group:Household');
    expect(shownRows(table.rows, new Set()).length).toBe(table.rows.length);
  });
});

describe('Needs a look', () => {
  it('names the over ones first, then those at 85% or more, and always ends on the count without a budget', () => {
    expect(needsALook(lines, 2)).toEqual([
      { kind: 'over', categoryId: 'Household', name: 'Household', overMinor: 3_461_000 },
      { kind: 'over', categoryId: 'Restaurants', name: 'Restaurants', overMinor: 460_000 },
      { kind: 'unbudgeted', count: 2 },
    ]);
  });

  it('floors a share near the whole, so a category not over never reads 100%', () => {
    const near = needsALook([line('Bills', 999_000, 1_000_000), line('Fuel', 860_000, 1_000_000), line('Gym', 100_000, 1_000_000)], 0);
    expect(near).toEqual([
      { kind: 'near', categoryId: 'Bills', name: 'Bills', percent: 99 },
      { kind: 'near', categoryId: 'Fuel', name: 'Fuel', percent: 86 },
    ]);
    expect(needsALook([line('Gym', 100_000, 1_000_000)], 0)).toEqual([]);
  });
});

describe('typing in a Budget cell', () => {
  const take = 10_000_000;

  it('opens on the plan as typed: an amount, a % with its sign, or nothing', () => {
    expect(cellText(budgets[1], 'IDR')).toBe('4.000.000');
    expect(cellText(budgets[4], 'IDR')).toBe('20%');
    expect(cellText(undefined, 'IDR')).toBe('');
    expect(typedRow('12,5 %')).toMatchObject({ mode: 'share', amount: '12,5' });
    expect(typedRow(' 450000 ')).toMatchObject({ mode: 'amount', amount: '450000' });
  });

  it('saves an amount as Edit budgets would, and only that row', () => {
    expect(planCell(lines, budgets, 'Coffee', '450000', take, 'IDR')).toEqual({ kind: 'save', changes: { save: [{ categoryAccountId: 'Coffee', amountMinor: 450_000, frequency: 'monthly' }], remove: [] } });
    expect(planCell(lines, budgets, 'Groceries', '4.250.000', take, 'IDR')).toEqual({ kind: 'save', changes: { save: [{ categoryAccountId: 'Groceries', amountMinor: 4_250_000, frequency: 'monthly' }], remove: [] } });
  });

  it('reads a % of a sub-category as a share of its parent’s budget, and of a root as a share of take-home', () => {
    // Household's own budget is 300.000: 50% of it.
    expect(planCell(lines, budgets, 'Supplies', '50%', take, 'IDR')).toEqual({
      kind: 'save',
      changes: { save: [{ categoryAccountId: 'Supplies', amountMinor: 150_000, frequency: 'monthly', share: { basis: 'parent', bp: 5000 } }], remove: [] },
    });
    expect(planCell(lines, budgets, 'Gifts', '2%', take, 'IDR')).toEqual({
      kind: 'save',
      changes: { save: [{ categoryAccountId: 'Gifts', amountMinor: 200_000, frequency: 'monthly', share: { basis: 'take-home', bp: 200 } }], remove: [] },
    });
  });

  it('refuses a % of nothing, and a figure it cannot read, before anything is written', () => {
    expect(planCell(lines, budgets, 'Gifts', '2%', 0, 'IDR')).toEqual({ kind: 'error', message: 'Set a take-home first to budget by %' });
    expect(planCell(lines, budgets, 'Gifts', 'lots', take, 'IDR')).toEqual({ kind: 'error', message: 'That figure cannot be read' });
    expect(planCell(lines, budgets, 'Gifts', '250%', take, 'IDR')).toMatchObject({ kind: 'error' });
  });

  it('clears a budget when the cell is emptied, and changes nothing for the same figure or an empty unbudgeted cell', () => {
    expect(planCell(lines, budgets, 'Health', '', take, 'IDR')).toEqual({ kind: 'save', changes: { save: [], remove: ['Health'] } });
    expect(planCell(lines, budgets, 'Health', '500000', take, 'IDR')).toEqual({ kind: 'none' });
    expect(planCell(lines, budgets, 'Health', '500.000', take, 'IDR')).toEqual({ kind: 'none' });
    expect(planCell(lines, budgets, 'Gifts', '', take, 'IDR')).toEqual({ kind: 'none' });
    expect(planCell(lines, budgets, 'Takeaways', '20%', take, 'IDR')).toEqual({ kind: 'none' });
  });

  it('opens the full editor rather than clear a parent whose %-children would keep their figure (its confirm)', () => {
    const tree = [line('Food', 0, 2_000_000, [line('Takeaways', 0, 400_000)])];
    const rows = [stored('Food', 2_000_000), stored('Takeaways', 400_000, { share: { basis: 'parent', bp: 2000 } })];
    expect(planCell(tree, rows, 'Food', '', take, 'IDR')).toEqual({ kind: 'editor' });
    // Changing the parent's figure is no such case: the child follows it.
    expect(planCell(tree, rows, 'Food', '2500000', take, 'IDR')).toMatchObject({ kind: 'save' });
  });
});
