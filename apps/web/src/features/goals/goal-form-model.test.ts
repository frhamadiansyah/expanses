import { describe, expect, it } from 'vitest';
import { formatMinor } from '@expanses/core';
import { addableAccounts, addedFromEarmarks, assumptionsSummary, canSaveGoal, editBaseOf, isNoAmount, onlyPaymentName, setAsideSummary, setAsideWrites } from './goal-form-model';

describe('onlyPaymentName', () => {
  it('a new goal saves its only payment under the goal name', () => {
    expect(onlyPaymentName(' Hajj or umrah ', 'Hajj', undefined)).toBe('Hajj or umrah');
  });
  it('a saved goal keeps a payment name of its own, and follows the goal name otherwise', () => {
    expect(onlyPaymentName('Hajj trip', 'Down payment', 'Hajj')).toBe('Down payment');
    expect(onlyPaymentName('Hajj trip', 'Hajj', 'Hajj')).toBe('Hajj trip');
    expect(onlyPaymentName('Hajj', '', 'Hajj')).toBe('Hajj');
  });
});

describe('setAsideSummary', () => {
  it('says None, a total in one currency, or a count across several', () => {
    expect(setAsideSummary([])).toBe('None');
    expect(setAsideSummary([{ currency: 'IDR', minor: 0 }])).toBe('None');
    expect(setAsideSummary([{ currency: 'IDR', minor: 1000000 }, { currency: 'IDR', minor: 500000 }])).toBe(formatMinor(1500000, 'IDR'));
    expect(setAsideSummary([{ currency: 'IDR', minor: 1 }, { currency: 'USD', minor: 1 }])).toBe('2 accounts');
  });
});

describe('assumptionsSummary', () => {
  it('reads growth then return', () => {
    expect(assumptionsSummary('5', '4')).toBe('Growth 5% · Return 4%');
    expect(assumptionsSummary('', '4,5')).toBe('Growth 0% · Return 4,5%');
  });
});

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

describe('editBaseOf (final review I1)', () => {
  it('keeps the fields a save compares against, and none of what does not travel', () => {
    const goal = {
      id: 'g1', workspaceId: 'w', name: 'Trip Fund', kind: 'holiday', rank: 0, growthBps: 300, returnBps: 450, standingMonthlyMinor: 500_000, standingNote: null,
      currency: 'IDR', status: 'active', createdAt: '2026-01-01T00:00:00Z',
      stages: [{ id: 's1', name: 'Deposit', targetMinor: 4_350_000, targetMonths: null, dueOn: '2031-03-01', paidOn: '2026-11-10', returnBps: null }],
    } as const;
    expect(editBaseOf(goal as unknown as Parameters<typeof editBaseOf>[0])).toEqual({
      name: 'Trip Fund',
      kind: 'holiday',
      growthBps: 300,
      returnBps: 450,
      currency: 'IDR',
      stages: [{ id: 's1', name: 'Deposit', targetMinor: 4_350_000, targetMonths: null, dueOn: '2031-03-01', paidOn: '2026-11-10' }],
    });
  });
});
