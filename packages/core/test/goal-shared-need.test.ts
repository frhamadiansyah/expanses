import { describe, expect, it } from 'vitest';
import { goalPlan, ownShareOfNeedMinor } from '../src';

describe('a shared goal', () => {
  it('leaves this phone the need less what the others have set up, never below nought', () => {
    expect(ownShareOfNeedMinor(3_000_000, 1_000_000)).toBe(2_000_000);
    expect(ownShareOfNeedMinor(1_000_000, 3_000_000)).toBe(0);
    expect(ownShareOfNeedMinor(0, 0)).toBe(0);
  });
  it('a partner line counts in what is held like any link', () => {
    const goal = { id: 'g', name: 'Trip', kind: 'other' as const, rank: 0, growthBps: 0, returnBps: 0, standingMonthlyMinor: 0, standingNote: null, stages: [{ id: 's', name: 'All', targetMinor: 180_000_000, targetMonths: null, dueOn: '2030-06-01', paidOn: null }] };
    const own = { accountId: 'a', name: 'Main Savings', kind: 'earmark' as const, unitsMicro: null, valueMinor: 28_000_000, currency: 'IDR', baseMinor: 28_000_000, risk: null };
    const theirs = { ...own, accountId: 'line-1', name: 'Partner Savings', valueMinor: 14_000_000, baseMinor: 14_000_000 };
    const plan = goalPlan(goal, [own, theirs], 0, 0, '2026-11-10');
    expect(plan.currentMinor).toBe(42_000_000);
    expect(plan.allTargetMinor).toBe(180_000_000);
  });
});
