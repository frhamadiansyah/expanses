import { describe, expect, it } from 'vitest';
import { type CardInstallment, countedFromOf, dueDateAfter, installmentSchedule, instalmentDueOn, owedAfter, paidSoFarOn, tickedPaidSoFar } from '../src/index';

/*
 * A plan with no purchase in the app keeps how many of its instalments are paid (owner, 17 Nov 2026): set when it is
 * added — every instalment whose payment was due before that day — and changed by ticking the plan's list. Invented
 * figures: 24 × Rp 1.000.000 first billed March 2025, statement day the 13th, payment due the 2nd.
 */
const plan: CardInstallment = { totalMinor: 24_000_000, months: 24, monthlyMinor: 1_000_000, firstBilledMonth: '2025-03', rateBps: 0, conversionFeeMinor: 0, earnsPoints: false };

describe('dueDateAfter', () => {
  it('is the first due day after a statement date', () => {
    expect(dueDateAfter('2026-11-13', 2)).toBe('2026-12-02');
    expect(dueDateAfter('2026-11-13', 25)).toBe('2026-11-25');
    expect(dueDateAfter('2026-01-31', 30)).toBe('2026-02-28');
    expect(dueDateAfter('2026-12-20', 10)).toBe('2027-01-10');
  });
});

describe('instalmentDueOn', () => {
  it('is the card’s due day after the statement date, or the statement date with no due day', () => {
    expect(instalmentDueOn('2026-11-13', 2)).toBe('2026-12-02');
    expect(instalmentDueOn('2026-11-13', null)).toBe('2026-11-13');
  });
});

describe('paidSoFarOn', () => {
  it('counts the instalments whose payment was due before the day the plan is added', () => {
    // 13 Oct bill due 2 Nov: paid. 13 Nov bill due 2 Dec: owed until after 2 Dec.
    expect(paidSoFarOn(plan, 13, 2, '2026-11-10')).toBe(20);
    expect(paidSoFarOn(plan, 13, 2, '2026-11-17')).toBe(20);
    expect(paidSoFarOn(plan, 13, 2, '2026-12-02')).toBe(20);
    expect(paidSoFarOn(plan, 13, 2, '2026-12-05')).toBe(21);
  });

  it('with no due day, reads the statement date', () => {
    expect(paidSoFarOn(plan, 13, null, '2026-11-13')).toBe(20);
    expect(paidSoFarOn(plan, 13, null, '2026-11-14')).toBe(21);
  });

  it('is none before the first, and all after the last', () => {
    expect(paidSoFarOn(plan, 13, 2, '2025-01-01')).toBe(0);
    expect(paidSoFarOn(plan, 13, 2, '2030-01-01')).toBe(24);
  });
});

describe('owedAfter', () => {
  it('is the instalments after those paid, the last carrying the rounding', () => {
    expect(owedAfter(plan, 20)).toBe(4_000_000);
    expect(owedAfter(plan, 0)).toBe(24_000_000);
    expect(owedAfter(plan, 24)).toBe(0);
    const odd: CardInstallment = { ...plan, totalMinor: 1_000_000, months: 3, monthlyMinor: 333_333 };
    expect(owedAfter(odd, 2)).toBe(333_334);
    expect(owedAfter(odd, 1)).toBe(666_667);
  });
});

describe('tickedPaidSoFar', () => {
  it('ticks an instalment and every one before it; unticks a paid one and every one after it', () => {
    expect(tickedPaidSoFar(20, 21)).toBe(21);
    expect(tickedPaidSoFar(20, 23)).toBe(23);
    expect(tickedPaidSoFar(20, 20)).toBe(19);
    expect(tickedPaidSoFar(20, 19)).toBe(18);
    expect(tickedPaidSoFar(0, 1)).toBe(1);
    expect(tickedPaidSoFar(1, 1)).toBe(0);
  });
});

describe('countedFromOf', () => {
  it('is the statement date of the first instalment not paid: what counts from then is what is owed', () => {
    const schedule = installmentSchedule(plan, 13);
    expect(countedFromOf(schedule, 20)).toBe('2026-11-13');
    expect(countedFromOf(schedule, 0)).toBeNull();
    // All paid: the day after the last, so none counts.
    expect(countedFromOf(schedule, 24)).toBe('2027-02-14');
  });
});
