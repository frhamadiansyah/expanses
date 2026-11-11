import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { extraEffect, loanSchedule, type LoanTerms, payoffDebtFromSchedule, payoffOrder, type PayoffDebt, simulatePayoff, suggestMethod } from '../src/index';

const debt = (key: string, o: Partial<PayoffDebt> = {}): PayoffDebt => ({ key, name: key, balanceMinor: 0, ratesBps: [0], interest: { kind: 'none' }, minimumsMinor: [], regularMinor: 0, late: false, daysLate: 0, ...o });
const opts = { startMonth: '2026-11', method: 'snowball' as const, extraMinor: 0 };

describe('a single loan with no extra is paid exactly as its own schedule says', () => {
  const cases: [string, LoanTerms, number][] = [
    ['annuity', { originalMinor: 6_000_000, firstPaymentOn: '2026-11-01', tenorMonths: 6, method: 'annuity', paymentDay: 1 }, 2_400],
    ['flat', { originalMinor: 12_000_000, firstPaymentOn: '2026-11-25', tenorMonths: 12, method: 'flat', paymentDay: 25 }, 1_200],
    ['zero', { originalMinor: 2_400_000, firstPaymentOn: '2026-11-10', tenorMonths: 6, method: 'zero', paymentDay: 10 }, 0],
  ];
  for (const [name, terms, rateBps] of cases) {
    it(name, () => {
      const periods = [{ fromOn: terms.firstPaymentOn, rateBps, kind: 'fixed' as const, paymentMinor: 0 }];
      const rows = loanSchedule(terms.originalMinor, terms, periods, '2026-11-01');
      const one = payoffDebtFromSchedule({ key: 'L', name: 'L', balanceMinor: terms.originalMinor, rows, method: terms.method, periods, startMonth: '2026-11', late: false, daysLate: 0 });
      const plan = simulatePayoff([one], opts);
      expect(plan.debtFreeMonth).toBe(rows.at(-1)!.onDate.slice(0, 7));
      expect(plan.interestMinor).toBe(rows.reduce((s, r) => s + r.interestMinor, 0));
      expect(plan.debts[0]!.paidMinor).toBe(rows.reduce((s, r) => s + r.paymentMinor, 0));
    });
  }
  it('an annuity whose rate drops part-way', () => {
    const terms: LoanTerms = { originalMinor: 100_000_000, firstPaymentOn: '2026-11-25', tenorMonths: 24, method: 'annuity', paymentDay: 25 };
    const periods = [
      { fromOn: '2026-11-25', rateBps: 900, kind: 'fixed' as const, paymentMinor: 0 },
      { fromOn: '2027-11-25', rateBps: 600, kind: 'floating' as const, paymentMinor: 0 },
    ];
    const rows = loanSchedule(terms.originalMinor, terms, periods, '2026-11-01');
    const plan = simulatePayoff([payoffDebtFromSchedule({ key: 'L', name: 'L', balanceMinor: 100_000_000, rows, method: 'annuity', periods, startMonth: '2026-11', late: false, daysLate: 0 })], opts);
    expect(plan.debtFreeMonth).toBe('2028-10');
    expect(plan.interestMinor).toBe(rows.reduce((s, r) => s + r.interestMinor, 0));
  });
  it('a loan already paid this month starts next month and is not charged that month’s interest', () => {
    const terms: LoanTerms = { originalMinor: 6_000_000, firstPaymentOn: '2026-10-01', tenorMonths: 6, method: 'annuity', paymentDay: 1 };
    const periods = [{ fromOn: '2026-10-01', rateBps: 2_400, kind: 'fixed' as const, paymentMinor: 0 }];
    const rows = loanSchedule(5_000_000, terms, periods, '2026-12-01'); // November already paid
    const one = payoffDebtFromSchedule({ key: 'L', name: 'L', balanceMinor: 5_000_000, rows, method: 'annuity', periods, startMonth: '2026-11', late: false, daysLate: 0 });
    expect(one.firstMonth).toBe(1);
    expect(one.minimumsMinor[0]).toBe(0);
    const plan = simulatePayoff([one], opts);
    expect(plan.debtFreeMonth).toBe(rows.at(-1)!.onDate.slice(0, 7));
    expect(plan.interestMinor).toBe(rows.reduce((s, r) => s + r.interestMinor, 0));
  });
});

describe('rollover', () => {
  // A: 1.000.000 at 500.000 × 2; B: 3.000.000 at 500.000 × 6. Both 0%.
  const a = debt('A', { balanceMinor: 1_000_000, minimumsMinor: [500_000, 500_000], regularMinor: 500_000 });
  const b = debt('B', { balanceMinor: 3_000_000, minimumsMinor: Array(6).fill(500_000), regularMinor: 500_000 });
  it('a finished debt’s payment goes to the next in line', () => {
    const plan = simulatePayoff([a, b], opts);
    expect(plan.debts.find((d) => d.key === 'A')!.endMonth).toBe('2026-12');
    expect(plan.debts.find((d) => d.key === 'B')!.endMonth).toBe('2027-02'); // m3, not m5
    expect(plan.debtFreeMonth).toBe('2027-02');
    expect(plan.months).toBe(4);
  });
  it('nothing already paid this month rolls over in month 0', () => {
    const paid = debt('P', { balanceMinor: 1_000_000, minimumsMinor: [0, 500_000, 500_000], regularMinor: 500_000, firstMonth: 1 });
    const other = debt('Q', { balanceMinor: 2_000_000, minimumsMinor: Array(4).fill(500_000), regularMinor: 500_000 });
    const plan = simulatePayoff([paid, other], opts);
    expect(plan.debts.find((d) => d.key === 'Q')!.endMonth).toBe('2027-02'); // its own schedule; P never ends early
  });
});

describe('extra a month', () => {
  const one = debt('A', { balanceMinor: 1_200_000, minimumsMinor: Array(12).fill(100_000), regularMinor: 100_000 });
  it('goes to the first in line and brings the month forward', () => {
    const effect = extraEffect([one], { ...opts, extraMinor: 100_000 });
    expect(effect.baseline.debtFreeMonth).toBe('2027-10');
    expect(effect.plan.debtFreeMonth).toBe('2027-04');
    expect(effect.monthsSooner).toBe(6);
    expect(effect.interestSavedMinor).toBe(0);
  });
  it('saves interest on an interest-bearing debt', () => {
    const loan = debt('K', { balanceMinor: 6_000_000, ratesBps: [2_400], interest: { kind: 'balance' }, minimumsMinor: Array(6).fill(1_071_155), regularMinor: 1_071_155 });
    const effect = extraEffect([loan], { ...opts, extraMinor: 3_000_000 });
    expect(effect.plan.debtFreeMonth).toBe('2026-12');
    expect(effect.plan.interestMinor).toBe(120_000 + 40_977);
    expect(effect.interestSavedMinor).toBeGreaterThan(0);
  });
  it('more extra never ends later and never costs more interest (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.integer({ min: 0, max: 5_000_000 }), (x, y) => {
        const [lo, hi] = x <= y ? [x, y] : [y, x];
        const debts = [
          debt('K', { balanceMinor: 6_000_000, ratesBps: [2_400], interest: { kind: 'balance' }, minimumsMinor: Array(6).fill(1_071_155), regularMinor: 1_071_155 }),
          debt('M', { balanceMinor: 50_000_000, ratesBps: [900], interest: { kind: 'balance' }, minimumsMinor: Array(60).fill(1_037_918), regularMinor: 1_037_918 }),
        ];
        const low = simulatePayoff(debts, { ...opts, method: 'avalanche', extraMinor: lo });
        const high = simulatePayoff(debts, { ...opts, method: 'avalanche', extraMinor: hi });
        return high.months! <= low.months! && high.interestMinor <= low.interestMinor;
      }),
    );
  });
});

describe('order', () => {
  const small = debt('small', { balanceMinor: 500_000 });
  const pricey = debt('pricey', { balanceMinor: 9_000_000, ratesBps: [3_540], interest: { kind: 'balance' } });
  const mortgage = debt('mortgage', { balanceMinor: 28_400_000, ratesBps: [750], interest: { kind: 'balance' } });
  const noTerms = debt('noTerms', { balanceMinor: 3_000_000, ratesBps: null });
  const late = debt('late', { balanceMinor: 3_600_000, ratesBps: [3_540], interest: { kind: 'balance' }, late: true, daysLate: 3 });
  it('snowball: smallest first', () => expect(payoffOrder([mortgage, pricey, small], 'snowball')).toEqual(['small', 'pricey', 'mortgage']));
  it('avalanche: highest rate first, unknown after known rates and before 0%', () =>
    expect(payoffOrder([small, mortgage, noTerms, pricey], 'avalanche')).toEqual(['pricey', 'mortgage', 'noTerms', 'small']));
  it('late debts go on top in every method', () => {
    for (const method of ['snowball', 'avalanche', 'byHand'] as const) expect(payoffOrder([small, late, mortgage], method, ['mortgage', 'small'])[0]).toBe('late');
  });
  it('by hand keeps the saved order, appends new debts smallest first, drops gone keys', () =>
    expect(payoffOrder([small, pricey, mortgage], 'byHand', ['mortgage', 'gone', 'pricey'])).toEqual(['mortgage', 'pricey', 'small']));
  it('extra goes to the first in line', () => {
    const plan = simulatePayoff([pricey, mortgage], { ...opts, method: 'avalanche', extraMinor: 1_000_000 });
    expect(plan.order[0]).toBe('pricey');
    expect(plan.debts.find((d) => d.key === 'pricey')!.paidMinor).toBeGreaterThan(0);
  });
});

describe('unknown', () => {
  it('a debt with no rate makes the plan’s month unknown but the others still end', () => {
    const plan = simulatePayoff([debt('known', { balanceMinor: 600_000, minimumsMinor: [300_000, 300_000], regularMinor: 300_000 }), debt('noTerms', { balanceMinor: 1_000_000, ratesBps: null })], opts);
    expect(plan.debtFreeMonth).toBeNull();
    expect(plan.unknown).toEqual({ reason: 'noRate', keys: ['noTerms'] });
    expect(plan.debts.find((d) => d.key === 'known')!.endMonth).toBe('2026-12');
  });
  it('a debt no money ever reaches is never cleared', () => {
    const plan = simulatePayoff([debt('friend', { balanceMinor: 1_000_000 })], { ...opts, capMonths: 24 });
    expect(plan.unknown).toEqual({ reason: 'neverCleared', keys: ['friend'] });
    expect(plan.months).toBeNull();
  });
  it('a payment below the interest is never cleared', () => {
    const plan = simulatePayoff([debt('grow', { balanceMinor: 10_000_000, ratesBps: [3_600], interest: { kind: 'balance' }, minimumsMinor: Array(600).fill(100_000), regularMinor: 100_000 })], opts);
    expect(plan.unknown?.reason).toBe('neverCleared');
  });
  it('a debt with no schedule is cleared by freed money', () => {
    const plan = simulatePayoff([debt('A', { balanceMinor: 1_000_000, minimumsMinor: [500_000, 500_000], regularMinor: 500_000 }), debt('friend', { balanceMinor: 1_000_000 })], opts);
    // A ends in December; from January its 500.000 a month goes to the friend: 2 months.
    expect(plan.debts.find((d) => d.key === 'friend')!.endMonth).toBe('2027-02');
  });
  it('a lump bigger than the month’s level is paid whole, never a negative leftover', () => {
    const plan = simulatePayoff([debt('card', { balanceMinor: 6_214_300, minimumsMinor: [6_214_300] }), debt('A', { balanceMinor: 1_000_000, minimumsMinor: [500_000, 500_000], regularMinor: 500_000 })], opts);
    expect(plan.debts.find((d) => d.key === 'card')!.endMonth).toBe('2026-11');
    expect(plan.debts.find((d) => d.key === 'A')!.endMonth).toBe('2026-12');
  });
});

describe('suggestMethod', () => {
  const k = (key: string, balanceMinor: number, rate: number | null) => debt(key, { balanceMinor, ratesBps: rate === null ? null : [rate], interest: rate ? { kind: 'balance' } : { kind: 'none' } });
  it('avalanche when every rate is known and they differ by 5 points or more', () =>
    expect(suggestMethod([k('paylater', 3_600_000, 3_540), k('mortgage', 28_400_000, 750), k('card', 6_214_300, 0)])).toEqual({ method: 'avalanche', reason: 'ratesDiffer', highestKey: 'paylater', lowestKey: 'mortgage' }));
  it('snowball when three or more debts are each 10% of the total or less', () =>
    expect(suggestMethod([k('a', 500_000, 900), k('b', 600_000, 1_000), k('c', 700_000, 1_100), k('big', 40_000_000, 1_200)])).toEqual({ method: 'snowball', reason: 'manySmall', smallCount: 3 }));
  it('avalanche wins when both hold', () =>
    expect(suggestMethod([k('a', 500_000, 3_600), k('b', 600_000, 0), k('c', 700_000, 0), k('big', 40_000_000, 900)])?.method).toBe('avalanche'));
  it('snowball when a rate is unknown', () => expect(suggestMethod([k('a', 5_000_000, 900), k('b', 6_000_000, null)])).toEqual({ method: 'snowball', reason: 'ratesUnknown' }));
  it('nothing when rates are close', () => expect(suggestMethod([k('a', 5_000_000, 900), k('b', 6_000_000, 1_100)])).toBeNull());
});
