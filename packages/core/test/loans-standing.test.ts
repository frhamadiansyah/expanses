import { describe, expect, it } from 'vitest';
import { instalmentDates, instalmentStanding, type InstalmentPayment } from '../src/index';

const terms = { firstPaymentOn: '2026-08-01', paymentDay: 1, tenorMonths: 6 };
const pay = (id: string, occurredOn: string, totalMinor = 1_071_155, fromMessage = false): InstalmentPayment => ({ id, occurredOn, totalMinor, fromMessage });

describe('instalmentDates', () => {
  it('lists the instalments in the range, numbered from the loan’s first', () => {
    expect(instalmentDates(terms, '2026-09-01', '2026-11-30')).toEqual([
      { number: 2, dueOn: '2026-09-01' },
      { number: 3, dueOn: '2026-10-01' },
      { number: 4, dueOn: '2026-11-01' },
    ]);
  });
  it('stops at the tenor', () => {
    expect(instalmentDates(terms, '2026-01-01', '2027-12-31').map((d) => d.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('instalmentStanding', () => {
  const dues = instalmentDates(terms, '2026-08-01', '2026-11-30');

  it('an instalment with no payment and its day gone is late, counted in days', () => {
    const states = instalmentStanding(dues, [pay('a', '2026-08-01'), pay('b', '2026-09-02'), pay('c', '2026-10-01')], '2026-11-04');
    expect(states.map((s) => s.status)).toEqual(['paid', 'paid', 'paid', 'late']);
    expect(states[3]).toMatchObject({ number: 4, daysLate: 3, paidOn: null });
    expect(states[1]).toMatchObject({ paidOn: '2026-09-02', daysLate: 1, paymentId: 'b' });
  });

  it('due today is upcoming, not late', () => {
    expect(instalmentStanding(dues, [pay('a', '2026-08-01'), pay('b', '2026-09-01'), pay('c', '2026-10-01')], '2026-11-01')[3]!.status).toBe('upcoming');
  });

  it('a late payment settles the oldest unpaid instalment, not the next one', () => {
    // September was missed; the only later payment is on 15 Oct. It pays September (44 days late); October stays late.
    const states = instalmentStanding(dues, [pay('a', '2026-08-01'), pay('b', '2026-10-15')], '2026-10-20');
    expect(states.map((s) => [s.number, s.status, s.paymentId, s.daysLate])).toEqual([
      [1, 'paid', 'a', 0],
      [2, 'paid', 'b', 44],
      [3, 'late', null, 19],
      [4, 'upcoming', null, 0],
    ]);
  });

  it('a payment on an instalment’s own due day is not taken by the next one', () => {
    const states = instalmentStanding(dues, [pay('a', '2026-08-01'), pay('b', '2026-09-01')], '2026-09-10');
    expect(states.map((s) => s.paymentId)).toEqual(['a', 'b', null, null]);
  });

  it('one payment settles one instalment', () => {
    const states = instalmentStanding(dues, [pay('a', '2026-09-15', 2_142_312)], '2026-09-20');
    expect(states.map((s) => s.status)).toEqual(['paid', 'late', 'upcoming', 'upcoming']);
  });

  it('a payment a few days early counts for the instalment it was early for', () => {
    const states = instalmentStanding(dues, [pay('a', '2026-07-28')], '2026-08-05');
    expect(states[0]).toMatchObject({ status: 'paid', daysLate: 0, paidOn: '2026-07-28' });
  });

  it('carries the payment’s figure and whether it came from a bank message', () => {
    const [first] = instalmentStanding(dues, [pay('a', '2026-08-01', 1_200_000, true)], '2026-08-02');
    expect(first).toMatchObject({ paidMinor: 1_200_000, fromMessage: true });
  });

  it('nothing tracked, nothing late', () => {
    expect(instalmentStanding([], [pay('a', '2026-08-01')], '2026-11-04')).toEqual([]);
  });
});
