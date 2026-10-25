import { describe, expect, it } from 'vitest';
import { addableAccounts, addedFromEarmarks, canSaveGoal, isNoAmount, setAsideWrites } from './goal-form-model';

describe('addableAccounts', () => {
  it('leaves out the accounts already added', () => {
    const eligible = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(addableAccounts(eligible, ['b'])).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(addableAccounts(eligible, ['a', 'b', 'c'])).toEqual([]);
    expect(addableAccounts([], [])).toEqual([]);
  });
});

describe('addedFromEarmarks', () => {
  const earmarks = [
    { goalId: 'g1', accountId: 'a', amountMinor: 5 },
    { goalId: 'g2', accountId: 'b', amountMinor: 5 },
    { goalId: 'g1', accountId: 'c', amountMinor: 0 },
    { goalId: 'g1', accountId: 'd', amountMinor: 9 },
  ];
  it("lists this goal's held accounts only", () => {
    expect(addedFromEarmarks(earmarks, 'g1')).toEqual(['a', 'd']);
  });
  it('is empty for a goal not saved yet', () => {
    expect(addedFromEarmarks(earmarks, undefined)).toEqual([]);
  });
});

describe('isNoAmount', () => {
  it('reads empty and all-noughts as nothing', () => {
    expect(isNoAmount('')).toBe(true);
    expect(isNoAmount(' 0 ')).toBe(true);
    expect(isNoAmount('0,00')).toBe(true);
    expect(isNoAmount('100,03')).toBe(false);
  });
});

describe('setAsideWrites', () => {
  it('saves typed figures and clears every other account', () => {
    const texts: Record<string, string> = { a: '100', b: '', c: '50', d: '70' };
    const writes = setAsideWrites(['a', 'b', 'c', 'd'], ['a', 'b', 'c'], (id) => texts[id] ?? '');
    expect(writes).toEqual([
      { accountId: 'a', action: 'save', text: '100' },
      { accountId: 'b', action: 'remove', text: '' },
      { accountId: 'c', action: 'save', text: '50' },
      // d was removed from the group, so its money is let go even though a figure is still typed.
      { accountId: 'd', action: 'remove', text: '' },
    ]);
  });
});

describe('canSaveGoal', () => {
  const amountStage = { name: 'Flight', amount: '100', months: '', usesMonths: false };
  const monthsStage = { name: 'Fund', amount: '', months: '6', usesMonths: true };
  it('needs a name and complete payments', () => {
    expect(canSaveGoal('Trip', [amountStage])).toBe(true);
    expect(canSaveGoal('Fund', [monthsStage])).toBe(true);
    expect(canSaveGoal(' ', [amountStage])).toBe(false);
    expect(canSaveGoal('Trip', [{ ...amountStage, amount: '' }])).toBe(false);
    expect(canSaveGoal('Trip', [{ ...monthsStage, months: ' ' }])).toBe(false);
    expect(canSaveGoal('Trip', [{ ...amountStage, name: '' }])).toBe(false);
    expect(canSaveGoal('Trip', [])).toBe(false);
  });
});
