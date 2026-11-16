import { describe, expect, it } from 'vitest';
import { blankPlanForm, planFields, planFormOf, purchaseChoices } from './plan-form';

describe('the instalment plan form', () => {
  it('starts blank at twelve months from this month', () => {
    expect(blankPlanForm('2026-10-27')).toEqual({ description: '', total: '', months: '12', firstBilledMonth: '2026-10', earnsPoints: false, transactionId: null, countMode: 'each_month' });
  });

  it('fills from a plan and reads back as the same figures', () => {
    const plan = { description: 'iBox', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-09', earnsPoints: true, transactionId: 't1', countMode: 'at_purchase' as const };
    expect(planFields(planFormOf(plan, 'IDR'), 'IDR')).toEqual(plan);
  });

  it('turns typed fields into numbers, drops dots from the total and names a blank plan', () => {
    expect(planFields({ description: '  ', total: '9.000.000', months: '6', firstBilledMonth: '2026-10', earnsPoints: false, transactionId: null, countMode: 'each_month' }, 'IDR')).toEqual({
      description: 'Instalment plan',
      totalMinor: 9_000_000,
      months: 6,
      firstBilledMonth: '2026-10',
      earnsPoints: false,
      transactionId: null,
      countMode: 'each_month',
    });
  });

  it('shows a stored total grouped, as the amount field does', () => {
    const plan = { description: 'iBox', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-09', earnsPoints: true };
    expect(planFormOf(plan, 'IDR').total).toBe('12.000.000');
  });

  it('reads a total in a currency with cents, comma before the cents', () => {
    const plan = { description: 'Laptop', totalMinor: 123456, months: 6, firstBilledMonth: '2026-09', earnsPoints: false };
    expect(planFormOf(plan, 'USD').total).toBe('1.234,56');
    expect(planFields(planFormOf(plan, 'USD'), 'USD').totalMinor).toBe(123456);
  });

  it('offers the card’s own purchases for the plan, the one charging its total first', () => {
    const line = (transactionId: string, occurredOn: string, owedMinor: number, extra: object = {}) => ({ transactionId, occurredOn, description: transactionId, owedMinor, spending: true, instalment: null, balancing: false, convertedTo: null, ...extra });
    const choices = purchaseChoices(
      [
        line('kopi', '2026-11-12', 50_000),
        line('laptop', '2026-11-10', 12_000_000),
        line('payment', '2026-11-11', -500_000, { spending: false }),
        line('sofa', '2026-10-01', 6_000_000, { convertedTo: { planId: 'other' } }),
        line('laptop#1', '2026-12-18', 1_000_000, { instalment: { planId: 'p1' } }),
        line('tv', '2026-09-01', 8_000_000, { convertedTo: { planId: 'p1' } }),
      ],
      'p1',
      12_000_000,
    );
    expect(choices.map((c) => c.transactionId)).toEqual(['laptop', 'kopi', 'tv']);
  });
});
