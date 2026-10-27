import { describe, expect, it } from 'vitest';
import { blankPlanForm, planFields, planFormOf } from './plan-form';

describe('the instalment plan form', () => {
  it('starts blank at twelve months from this month', () => {
    expect(blankPlanForm('2026-10-27')).toEqual({ description: '', total: '', months: '12', firstBilledMonth: '2026-10', earnsPoints: false });
  });

  it('fills from a plan and reads back as the same figures', () => {
    const plan = { description: 'iBox', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-09', earnsPoints: true };
    expect(planFields(planFormOf(plan))).toEqual(plan);
  });

  it('turns typed fields into numbers, drops dots from the total and names a blank plan', () => {
    expect(planFields({ description: '  ', total: '9.000.000', months: '6', firstBilledMonth: '2026-10', earnsPoints: false })).toEqual({
      description: 'Instalment plan',
      totalMinor: 9_000_000,
      months: 6,
      firstBilledMonth: '2026-10',
      earnsPoints: false,
    });
  });
});
