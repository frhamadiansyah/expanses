import { describe, expect, it } from 'vitest';
import { formatMinor } from '@expanses/core';
import { assumptionsSummary, canSaveGoal, editBaseOf, isNoAmount, keepsCalculatorWorking, onlyPaymentName, setAsideSummary, setAsideWrites } from './goal-form-model';

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

describe('keepsCalculatorWorking (final re-review, out-of-scope 1)', () => {
  const opened = {
    name: 'Aisha School', kind: 'education' as const, growthBps: 1000, returnBps: 800, currency: 'IDR',
    stages: [
      { id: 's1', name: 'Pre 2027', targetMinor: 22_000_000, targetMonths: null, dueOn: '2027-07-01', paidOn: null },
      { id: 's2', name: 'Primary 2040', targetMinor: 76_000_000, targetMonths: null, dueOn: '2040-07-01', paidOn: null },
    ],
  };
  const untouched = { growthBps: 1000, returnBps: 800, currency: 'IDR', stages: opened.stages };

  it("compares with the goal as the form opened on it, so Rina's re-working meanwhile is no hand edit here", () => {
    // Rina re-worked the fee and marked the first year paid while the form was open: the goal now differs from the form.
    const now = { ...opened, stages: [{ ...opened.stages[0]!, targetMinor: 27_500_000, paidOn: '2026-11-10' }, { ...opened.stages[1]!, targetMinor: 95_000_000 }] };
    expect(keepsCalculatorWorking(now, untouched, false)).toBe(false);
    expect(keepsCalculatorWorking(opened, untouched, false)).toBe(true);
  });

  it('only paid marks changed here keeps it', () => {
    expect(keepsCalculatorWorking(opened, { ...untouched, stages: [{ ...opened.stages[0]!, paidOn: '2026-11-10' }, opened.stages[1]!] }, false)).toBe(true);
  });

  it('a figure changed here by hand unlinks it, as before', () => {
    const [first, second] = opened.stages as [(typeof opened.stages)[0], (typeof opened.stages)[0]];
    expect(keepsCalculatorWorking(opened, { ...untouched, stages: [{ ...first, targetMinor: 30_000_000 }, second] }, false)).toBe(false);
    expect(keepsCalculatorWorking(opened, { ...untouched, stages: [{ ...first, targetMinor: null, targetMonths: 6 }, second] }, false)).toBe(false);
    expect(keepsCalculatorWorking(opened, { ...untouched, stages: [{ ...first, name: 'Playgroup' }, second] }, false)).toBe(false);
    expect(keepsCalculatorWorking(opened, { ...untouched, stages: [{ ...first, dueOn: '2027-08-01' }, second] }, false)).toBe(false);
    expect(keepsCalculatorWorking(opened, { ...untouched, stages: [first] }, false)).toBe(false);
    expect(keepsCalculatorWorking(opened, { ...untouched, stages: [first, second, { name: 'Uniform', targetMinor: 1_500_000, targetMonths: null, dueOn: '2027-06-01' }] }, false)).toBe(false);
    expect(keepsCalculatorWorking(opened, { ...untouched, growthBps: 900 }, false)).toBe(false);
    expect(keepsCalculatorWorking(opened, { ...untouched, returnBps: 700 }, false)).toBe(false);
    expect(keepsCalculatorWorking(opened, { ...untouched, currency: 'USD' }, false)).toBe(false);
  });

  it('an own target carried into the working is no reason to unlink, but a rename still is', () => {
    const [first, second] = opened.stages as [(typeof opened.stages)[0], (typeof opened.stages)[0]];
    expect(keepsCalculatorWorking(opened, { ...untouched, stages: [{ ...first, targetMinor: 30_000_000 }, second] }, true)).toBe(true);
    expect(keepsCalculatorWorking(opened, { ...untouched, stages: [{ ...first, name: 'Playgroup' }, second] }, true)).toBe(false);
  });
});
