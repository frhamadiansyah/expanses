import type { BudgetLine } from '@expanses/core';
import type { BudgetRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { changesOf, editGroups, fillFromLastMonth, initialState, isDirty, liveCapsTotal, rowStateOf } from './edit-budgets-model';

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
    expect(state.fuel).toEqual({ amount: '1.200.000', frequency: 'yearly', filled: false });
    expect(state.ride).toEqual({ amount: '', frequency: 'monthly', filled: false });
  });
});

describe('liveCapsTotal', () => {
  it('counts a yearly figure as its month, and a child inside a capped parent once', () => {
    const groups = editGroups(lines);
    const state = initialState(groups, [], 'IDR');
    state.fuel = { amount: '1.200.000', frequency: 'yearly', filled: false };
    state.fun = { amount: '300.000', frequency: 'monthly', filled: false };
    expect(liveCapsTotal(lines, state, 'IDR')).toBe(400_000);
    state.t = { amount: '1.000.000', frequency: 'monthly', filled: false };
    expect(liveCapsTotal(lines, state, 'IDR')).toBe(1_300_000);
  });

  it('leaves out a figure that cannot be read', () => {
    const state = initialState(editGroups(lines), [], 'IDR');
    state.fun = { amount: 'abc', frequency: 'monthly', filled: false };
    expect(liveCapsTotal(lines, state, 'IDR')).toBe(0);
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
    expect(next.fuel).toEqual({ amount: '560.000', frequency: 'monthly', filled: true });
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
    state.t = { amount: '1.000.000', frequency: 'monthly', filled: false };

    expect(changesOf(groups, state, initialState(groups, budgets, 'IDR'), budgets, 'IDR')).toEqual({
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
    state.fun = { amount: 'abc', frequency: 'monthly', filled: false };
    expect(changesOf(groups, state, initialState(groups, [], 'IDR'), [], 'IDR').unreadable).toEqual(['fun']);
  });
});

describe('isDirty', () => {
  it('is clean until a figure or a unit changes', () => {
    const groups = editGroups(lines);
    const initial = initialState(groups, [], 'IDR');
    expect(isDirty({ ...initial }, initial)).toBe(false);
    expect(isDirty({ ...initial, fun: { amount: '1', frequency: 'monthly', filled: false } }, initial)).toBe(true);
    expect(isDirty({ ...initial, fun: { amount: '', frequency: 'weekly', filled: false } }, initial)).toBe(true);
  });
});

describe('changesOf, while someone else changes the budgets', () => {
  it('sends only the rows changed on this screen: a budget set or changed elsewhere since it opened is left alone', () => {
    const groups = editGroups(lines);
    const loaded = [budget('fuel', 600_000)];
    const initial = initialState(groups, loaded, 'IDR');
    const state = { ...initial, fun: { amount: '150.000', frequency: 'monthly' as const, filled: false } };
    // A partner, meanwhile: Ride hailing gets a cap, and Fuel goes up.
    const stored = [budget('fuel', 700_000), budget('ride', 250_000)];

    expect(changesOf(groups, state, initial, stored, 'IDR')).toEqual({
      save: [{ categoryAccountId: 'fun', amountMinor: 150_000, frequency: 'monthly' }],
      remove: [],
      unreadable: [],
    });
  });
});

describe('rowStateOf', () => {
  it('reads a row that arrived after the screen opened as empty and monthly', () => {
    expect(rowStateOf({}, 'new-category')).toEqual({ amount: '', frequency: 'monthly', filled: false });
  });
});
