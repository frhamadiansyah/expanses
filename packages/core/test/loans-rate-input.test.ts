import { describe, expect, it } from 'vitest';
import { debtItem, loanRatePer, loanSchedule, rateBpsFromTyped, typedFromRateBps } from '../src';

describe('loan rate typed a month or a year', () => {
  it('a year is read as typed, comma or dot', () => {
    expect(rateBpsFromTyped('9,25')).toBe(925);
    expect(rateBpsFromTyped('9.25', 'year')).toBe(925);
    expect(rateBpsFromTyped('')).toBe(0);
  });

  it('a month is stored as yearly bps times twelve', () => {
    expect(rateBpsFromTyped('2', 'month')).toBe(2400);
    expect(rateBpsFromTyped('2,95', 'month')).toBe(3540);
    expect(rateBpsFromTyped('', 'month')).toBe(0);
  });

  it('refuses a negative or non-numeric rate', () => {
    expect(() => rateBpsFromTyped('-1', 'month')).toThrow('The rate must be a number');
    expect(() => rateBpsFromTyped('abc')).toThrow('The rate must be a number');
  });

  it('round-trips typical monthly and yearly figures', () => {
    for (const typed of ['0,5', '1', '2', '2,95', '3,25', '1,125']) expect(typedFromRateBps(rateBpsFromTyped(typed, 'month'), 'month')).toBe(typed);
    for (const typed of ['9', '9,25', '12,5']) expect(typedFromRateBps(rateBpsFromTyped(typed), 'year')).toBe(typed);
    expect(typedFromRateBps(0, 'month')).toBe('');
  });

  it('the engine charges the typed monthly rate each month', () => {
    const bps = rateBpsFromTyped('2', 'month');
    const rows = loanSchedule(
      1_000_000,
      { originalMinor: 1_000_000, firstPaymentOn: '2026-12-10', tenorMonths: 3, method: 'annuity', paymentDay: 10 },
      [{ fromOn: '2026-11-10', rateBps: bps, kind: 'fixed', paymentMinor: 0 }],
      '2026-11-11',
    );
    expect(rows[0]!.interestMinor).toBe(20_000);
  });

  it('only an online loan is asked per month', () => {
    expect(loanRatePer('online_loan')).toBe('month');
    expect(loanRatePer('personal_loan')).toBe('year');
    expect(loanRatePer('')).toBe('year');
    expect(loanRatePer(null)).toBe('year');
    expect(debtItem('online_loan').behaviour).toMatchObject({ asksRate: true, ratePer: 'month' });
  });
});
