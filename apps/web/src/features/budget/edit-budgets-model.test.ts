import type { BudgetLine } from '@expanses/core';
import type { BudgetRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { basisOfRow, changesOf, editGroups, fillFromLastMonth, initialState, isDirty, liveCapsTotal, rowStateOf, switchRow, typedCaps } from './edit-budgets-model';

function line(id: string, name: string, children: BudgetLine[] = []): BudgetLine {
  return { id, name, ownMinor: 0, totalMinor: 0, capMinor: null, overMinor: 0, children };
}
const budget = (categoryAccountId: string, amountAsSetMinor: number, frequency: BudgetRow['frequency'] = 'monthly'): BudgetRow => ({
  id: `b-${categoryAccountId}`,
  categoryAccountId,
  planMinor: amountAsSetMinor,
  amountMinor: amountAsSetMinor,
  overridden: false,
  frequency,
  amountAsSetMinor,
  share: null,
});

const lines = [line('t', 'Transport', [line('fuel', 'Fuel'), line('ride', 'Ride hailing')]), line('fun', 'Entertainment')];
// Nothing stored, and nothing on screen to compare with: every share is new.
const nothing = { initial: {}, budgets: [] };

describe('editGroups', () => {
  it('gives a root with children an All row first, its children one step in, and a lone root a single row; by name', () => {
    expect(editGroups(lines).map((group) => group.rows.map((row) => [row.label, row.depth]))).toEqual([
      [['Entertainment', 0]],
      [
        ['All Transport', 0],
        ['Fuel', 1],
        ['Ride hailing', 1],
      ],
    ]);
  });
});

describe('initialState', () => {
  it('shows a cap as it was typed, in its unit, and an uncapped row empty', () => {
    const state = initialState(editGroups(lines), [budget('fuel', 1_200_000, 'yearly')], 'IDR');
    expect(state.fuel).toEqual({ amount: '1.200.000', frequency: 'yearly', filled: false, mode: 'amount' });
    expect(state.ride).toEqual({ amount: '', frequency: 'monthly', filled: false, mode: 'amount' });
  });
});

describe('liveCapsTotal', () => {
  it('counts a yearly figure as its month, and a child inside a capped parent once', () => {
    const groups = editGroups(lines);
    const state = initialState(groups, [], 'IDR');
    state.fuel = { amount: '1.200.000', frequency: 'yearly', filled: false, mode: 'amount' };
    state.fun = { amount: '300.000', frequency: 'monthly', filled: false, mode: 'amount' };
    expect(liveCapsTotal(lines, state, 0, 'IDR', nothing)).toBe(400_000);
    state.t = { amount: '1.000.000', frequency: 'monthly', filled: false, mode: 'amount' };
    expect(liveCapsTotal(lines, state, 0, 'IDR', nothing)).toBe(1_300_000);
  });

  it('leaves out a figure that cannot be read', () => {
    const state = initialState(editGroups(lines), [], 'IDR');
    state.fun = { amount: 'abc', frequency: 'monthly', filled: false, mode: 'amount' };
    expect(liveCapsTotal(lines, state, 0, 'IDR', nothing)).toBe(0);
  });
});

describe('fillFromLastMonth', () => {
  const history = new Map([
    ['fuel', { lastMinor: 560_000 }],
    ['ride', { lastMinor: 0 }],
    ['t', { lastMinor: 560_000 }],
    ['fun', { lastMinor: 125_000 }],
  ]);

  it('fills empty rows without children that spent, and nothing else', () => {
    const groups = editGroups(lines);
    const state = initialState(groups, [budget('fun', 200_000)], 'IDR');
    const next = fillFromLastMonth(groups, state, history, 'IDR');
    expect(next.fuel).toEqual({ amount: '560.000', frequency: 'monthly', filled: true, mode: 'amount' });
    expect(next.ride!.amount).toBe('');
    expect(next.t!.amount).toBe('');
    expect(next.fun).toEqual(state.fun);
  });

  it('skips a row under a parent that already has a figure', () => {
    const groups = editGroups(lines);
    const state = initialState(groups, [budget('t', 900_000)], 'IDR');
    expect(fillFromLastMonth(groups, state, history, 'IDR').fuel!.amount).toBe('');
  });
});

describe('changesOf', () => {
  it('saves new and changed rows, removes cleared ones, and leaves the untouched alone', () => {
    const groups = editGroups(lines);
    const budgets = [budget('fuel', 600_000), budget('fun', 200_000), budget('ride', 1_200_000, 'yearly')];
    const state = initialState(groups, budgets, 'IDR');
    state.fuel = { ...state.fuel!, amount: '650.000' };
    state.fun = { ...state.fun!, amount: '' };
    state.t = { amount: '1.000.000', frequency: 'monthly', filled: false, mode: 'amount' };

    expect(changesOf(groups, state, initialState(groups, budgets, 'IDR'), budgets, 0, 'IDR')).toEqual({
      save: [
        { categoryAccountId: 't', amountMinor: 1_000_000, frequency: 'monthly' },
        { categoryAccountId: 'fuel', amountMinor: 650_000, frequency: 'monthly' },
      ],
      remove: ['fun'],
      unreadable: [],
    });
  });

  it('names a figure that cannot be read instead of saving it', () => {
    const groups = editGroups(lines);
    const state = initialState(groups, [], 'IDR');
    state.fun = { amount: 'abc', frequency: 'monthly', filled: false, mode: 'amount' };
    expect(changesOf(groups, state, initialState(groups, [], 'IDR'), [], 0, 'IDR').unreadable).toEqual(['fun']);
  });
});

describe('isDirty', () => {
  it('is clean until a figure or a unit changes', () => {
    const groups = editGroups(lines);
    const initial = initialState(groups, [], 'IDR');
    expect(isDirty({ ...initial }, initial)).toBe(false);
    expect(isDirty({ ...initial, fun: { amount: '1', frequency: 'monthly', filled: false, mode: 'amount' } }, initial)).toBe(true);
    expect(isDirty({ ...initial, fun: { amount: '', frequency: 'weekly', filled: false, mode: 'amount' } }, initial)).toBe(true);
  });
});

describe('changesOf, while someone else changes the budgets', () => {
  it('sends only the rows changed on this screen: a budget set or changed elsewhere since it opened is left alone', () => {
    const groups = editGroups(lines);
    const loaded = [budget('fuel', 600_000)];
    const initial = initialState(groups, loaded, 'IDR');
    const state = { ...initial, fun: { amount: '150.000', frequency: 'monthly' as const, filled: false, mode: 'amount' as const } };
    // A partner, meanwhile: Ride hailing gets a cap, and Fuel goes up.
    const stored = [budget('fuel', 700_000), budget('ride', 250_000)];

    expect(changesOf(groups, state, initial, stored, 0, 'IDR')).toEqual({
      save: [{ categoryAccountId: 'fun', amountMinor: 150_000, frequency: 'monthly' }],
      remove: [],
      unreadable: [],
    });
  });
});

describe('rowStateOf', () => {
  it('reads a row that arrived after the screen opened as empty and monthly', () => {
    expect(rowStateOf({}, 'new-category')).toEqual({ amount: '', frequency: 'monthly', filled: false, mode: 'amount' });
  });
});

describe('shares on Edit budgets', () => {
  const take = 10_000_000;

  it('opens a % budget as its share, in share mode', () => {
    const stored = { ...budget('t', 3_000_000), share: { basis: 'take-home' as const, bp: 3000 } };
    expect(initialState(editGroups(lines), [stored], 'IDR').t).toEqual({ amount: '30', frequency: 'monthly', filled: false, mode: 'share' });
  });

  it('counts a % of take-home and a % of a typed parent in the live total', () => {
    const groups = editGroups(lines);
    const state = initialState(groups, [], 'IDR');
    state.t = { amount: '30', frequency: 'monthly', filled: false, mode: 'share' };
    state.fuel = { amount: '40', frequency: 'monthly', filled: false, mode: 'share' };
    expect(typedCaps(lines, state, take, 'IDR', nothing).get('fuel')).toBe(1_200_000);
    expect(liveCapsTotal(lines, state, take, 'IDR', nothing)).toBe(3_000_000);
  });

  it('sends a share with the basis the row has now and the figure it comes to', () => {
    const groups = editGroups(lines);
    const initial = initialState(groups, [], 'IDR');
    const state = { ...initial, t: { amount: '1.000.000', frequency: 'monthly' as const, filled: false, mode: 'amount' as const }, fuel: { amount: '25', frequency: 'monthly' as const, filled: false, mode: 'share' as const }, fun: { amount: '5', frequency: 'monthly' as const, filled: false, mode: 'share' as const } };
    expect(changesOf(groups, state, initial, [], take, 'IDR').save).toEqual([
      { categoryAccountId: 'fun', amountMinor: 500_000, frequency: 'monthly', share: { basis: 'take-home', bp: 500 } },
      { categoryAccountId: 't', amountMinor: 1_000_000, frequency: 'monthly' },
      { categoryAccountId: 'fuel', amountMinor: 250_000, frequency: 'monthly', share: { basis: 'parent', bp: 2500 } },
    ]);
  });

  it('names a share that cannot be read, and treats a change of mode as a change', () => {
    const groups = editGroups(lines);
    const initial = initialState(groups, [], 'IDR');
    const state = { ...initial, fun: { amount: '150', frequency: 'monthly' as const, filled: false, mode: 'share' as const } };
    expect(changesOf(groups, state, initial, [], take, 'IDR').unreadable).toEqual(['fun']);
    expect(isDirty({ ...initial, fun: { ...initial.fun!, mode: 'share' } }, initial)).toBe(true);
  });
});

describe('a share keeps the basis it was saved with', () => {
  const take = 10_000_000;

  it('resolves, counts and saves a stored % of take-home against take-home, even under a parent with a figure', () => {
    const groups = editGroups(lines);
    const stored = [budget('t', 1_000_000), { ...budget('fuel', 500_000), share: { basis: 'take-home' as const, bp: 500 } }];
    const initial = initialState(groups, stored, 'IDR');
    const state = { ...initial, fuel: { ...initial.fuel!, amount: '6' } };
    expect(typedCaps(lines, state, take, 'IDR', { initial, budgets: stored }).get('fuel')).toBe(600_000);
    expect(basisOfRow(groups[1]!.rows[1]!, typedCaps(lines, state, take, 'IDR', { initial, budgets: stored }), stored)).toBe('take-home');
    expect(changesOf(groups, state, initial, stored, take, 'IDR').save).toEqual([{ categoryAccountId: 'fuel', amountMinor: 600_000, frequency: 'monthly', share: { basis: 'take-home', bp: 600 } }]);
  });

  it('takes the basis from the tree for a new share, and for a stored % of a parent that no longer has a figure', () => {
    const groups = editGroups(lines);
    const stored = [{ ...budget('fuel', 400_000), share: { basis: 'parent' as const, bp: 4000 } }];
    const initial = initialState(groups, stored, 'IDR');
    const state = { ...initial, fuel: { ...initial.fuel!, amount: '5' }, ride: { amount: '2', frequency: 'monthly' as const, filled: false, mode: 'share' as const } };
    expect(changesOf(groups, state, initial, stored, take, 'IDR').save).toEqual([
      { categoryAccountId: 'fuel', amountMinor: 500_000, frequency: 'monthly', share: { basis: 'take-home', bp: 500 } },
      { categoryAccountId: 'ride', amountMinor: 200_000, frequency: 'monthly', share: { basis: 'take-home', bp: 200 } },
    ]);
  });
});

describe('switchRow', () => {
  const base = { basis: 'take-home' as const, label: 'take-home', minor: 12_000_000 };

  it('turns a figure typed in another unit into the share its month is', () => {
    const quarterly = { amount: '3.600.000', frequency: 'quarterly' as const, filled: false, mode: 'amount' as const };
    expect(switchRow(quarterly, 'share', base, 'IDR')).toMatchObject({ amount: '10', frequency: 'monthly', mode: 'share' });
  });

  it('turns a share into its month’s figure, by the month whatever unit was picked', () => {
    const share = { amount: '10', frequency: 'monthly' as const, filled: false, mode: 'share' as const };
    expect(switchRow(share, 'weekly', base, 'IDR')).toMatchObject({ amount: '1.200.000', frequency: 'monthly', mode: 'amount' });
    expect(switchRow(share, 'monthly', base, 'IDR')).toMatchObject({ amount: '1.200.000', frequency: 'monthly', mode: 'amount' });
  });

  it('changes only the unit of a figure typed as an amount', () => {
    const monthly = { amount: '1.200.000', frequency: 'monthly' as const, filled: false, mode: 'amount' as const };
    expect(switchRow(monthly, 'yearly', base, 'IDR')).toMatchObject({ amount: '1.200.000', frequency: 'yearly', mode: 'amount' });
  });
});
