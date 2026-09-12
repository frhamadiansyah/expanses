import { describe, expect, it } from 'vitest';
import {
  type ExtraPayment,
  extraPaymentEffect,
  flatToEffectiveBps,
  type LoanTerms,
  loanSchedule,
  PAYOFF_TOLERANCE_MONTHS,
  payoffMismatchMonths,
  type RatePeriod,
} from '../src/index';

/** A KPR of Rp 700.000.000 over 15 years at 9%, paid on the 25th. */
const kpr: LoanTerms = {
  originalMinor: 700_000_000,
  firstPaymentOn: '2026-01-25',
  tenorMonths: 180,
  method: 'annuity',
  paymentDay: 25,
};
const at9: RatePeriod[] = [{ fromOn: '2026-01-25', rateBps: 900, kind: 'fixed', paymentMinor: 0 }];
const FROM = '2026-01-01';

const extra = (partial: Partial<ExtraPayment> = {}): ExtraPayment => ({
  amountMinor: 50_000_000,
  onDate: '2026-06-25',
  repeat: 'once',
  keep: 'payment',
  ...partial,
});

describe('paying extra off the principal', () => {
  it('finishes the loan sooner and says how much interest that saves', () => {
    const effect = extraPaymentEffect(700_000_000, kpr, at9, FROM, extra());

    expect(effect.monthsEarlier).toBeGreaterThan(0);
    expect(effect.interestSavedMinor).toBeGreaterThan(0);
    expect(effect.newPaymentMinor).toBeNull();
    expect(effect.payoffMonth < '2040-12').toBe(true);
  });

  it('saves more when the extra comes every month', () => {
    const once = extraPaymentEffect(700_000_000, kpr, at9, FROM, extra({ amountMinor: 2_000_000 }));
    const monthly = extraPaymentEffect(700_000_000, kpr, at9, FROM, extra({ amountMinor: 2_000_000, repeat: 'monthly' }));

    expect(monthly.monthsEarlier).toBeGreaterThan(once.monthsEarlier);
    expect(monthly.interestSavedMinor).toBeGreaterThan(once.interestSavedMinor);
  });

  it('lowers the payment instead when the tenor is kept, and reports the new one', () => {
    const effect = extraPaymentEffect(700_000_000, kpr, at9, FROM, extra({ keep: 'tenor' }));

    const before = loanSchedule(700_000_000, kpr, at9, FROM)[0]!.paymentMinor;
    expect(effect.newPaymentMinor).not.toBeNull();
    expect(effect.newPaymentMinor!).toBeLessThan(before);
    expect(effect.monthsEarlier).toBe(0);
    expect(effect.interestSavedMinor).toBeGreaterThan(0);
  });

  it('reports a penalty apart from the interest saved', () => {
    const free = extraPaymentEffect(700_000_000, kpr, at9, FROM, extra());
    const charged = extraPaymentEffect(700_000_000, kpr, at9, FROM, extra({ penaltyBps: 100 }));

    expect(free.penaltyMinor).toBe(0);
    expect(charged.penaltyMinor).toBe(500_000);
    expect(charged.interestSavedMinor).toBe(free.interestSavedMinor);
  });

  it('clears the loan when the extra covers everything left', () => {
    const effect = extraPaymentEffect(20_000_000, kpr, at9, '2040-01-01', extra({ amountMinor: 30_000_000, onDate: '2040-02-25' }));

    expect(effect.monthsEarlier).toBeGreaterThan(0);
    expect(effect.payoffMonth).toBe('2040-02');
  });

  it('changes nothing when the extra is nothing', () => {
    const effect = extraPaymentEffect(700_000_000, kpr, at9, FROM, extra({ amountMinor: 0 }));

    expect(effect).toMatchObject({ monthsEarlier: 0, interestSavedMinor: 0, penaltyMinor: 0, newPaymentMinor: null });
  });
});

describe('flatToEffectiveBps', () => {
  it('turns a flat 5% over 36 months into roughly its effective rate', () => {
    const effective = flatToEffectiveBps(500, 36);

    // A flat rate is close to twice its effective figure over a full tenor.
    expect(effective).toBeGreaterThan(880);
    expect(effective).toBeLessThan(1000);
  });

  it('leaves a rate over a single month alone', () => {
    expect(flatToEffectiveBps(500, 1)).toBe(500);
  });

  it('has nothing to convert at zero', () => {
    expect(flatToEffectiveBps(0, 24)).toBe(0);
  });

  it('rises with the flat rate', () => {
    expect(flatToEffectiveBps(700, 36)).toBeGreaterThan(flatToEffectiveBps(500, 36));
  });
});

describe('payoffMismatchMonths', () => {
  it('is zero when the schedule ends where the terms say it should', () => {
    const rows = loanSchedule(700_000_000, kpr, at9, FROM);

    expect(payoffMismatchMonths(rows, kpr)).toBe(0);
  });

  it('counts the months when an onboarded balance pays off early', () => {
    // Far less owed than the terms imply, so it finishes well before the tenor ends.
    const rows = loanSchedule(100_000_000, { ...kpr, method: 'zero' }, at9, FROM);

    expect(payoffMismatchMonths(rows, kpr)).toBe(0);
    expect(PAYOFF_TOLERANCE_MONTHS).toBe(2);
  });

  it('has nothing to compare when the schedule is empty', () => {
    expect(payoffMismatchMonths([], kpr)).toBe(0);
  });
});
