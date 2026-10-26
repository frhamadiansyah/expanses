import { describe, expect, it } from 'vitest';
import {
  billStanding,
  billWindow,
  currentBillMonth,
  firstYearlyMonth,
  isOwedMonth,
  nextOwedMonth,
  payableBillMonths,
  pausedMonths,
  pauseStart,
  yearlyListed,
  yearlyRepeat,
} from '../src/index';

const base = { startsMonth: '2026-03', settled: {} as Record<string, 'paid' | 'skipped' | 'paused'> };

describe('a yearly bill is owed only in its own month', () => {
  it('owes the month of the year and no other', () => {
    expect(isOwedMonth('2026-03', 3)).toBe(true);
    expect(isOwedMonth('2026-04', 3)).toBe(false);
    expect(isOwedMonth('2026-04', null)).toBe(true);
    expect(nextOwedMonth('2026-03', 3)).toBe('2026-03');
    expect(nextOwedMonth('2026-04', 3)).toBe('2027-03');
    expect(nextOwedMonth('2026-12', 1)).toBe('2027-01');
  });

  it('its row speaks for the next occurrence, and for the last one only while that is unsettled in the month after', () => {
    const input = { ...base, outDay: 12, payByDay: null, yearlyMonth: 3 };
    expect(currentBillMonth({ ...input, today: '2026-03-05' })).toBe('2026-03');
    expect(currentBillMonth({ ...input, today: '2026-08-01' })).toBe('2027-03');
    // March unsettled and it is April: still March's bill, late. Settled: on to next year.
    expect(currentBillMonth({ ...input, today: '2027-04-10', startsMonth: '2027-03' })).toBe('2027-03');
    expect(currentBillMonth({ ...input, today: '2027-04-10', startsMonth: '2027-03', settled: { '2027-03': 'paid' } })).toBe('2028-03');
    // Two months on, an unpaid occurrence is let go, as a monthly bill's is.
    expect(currentBillMonth({ ...input, today: '2027-05-10', startsMonth: '2027-03' })).toBe('2028-03');
  });

  it('never speaks for a month before it began', () => {
    expect(currentBillMonth({ ...base, startsMonth: '2027-03', outDay: 12, payByDay: null, yearlyMonth: 3, today: '2026-10-26' })).toBe('2027-03');
  });

  it('a monthly bill is unchanged', () => {
    expect(currentBillMonth({ ...base, outDay: 12, payByDay: null, today: '2026-08-01', settled: { '2026-07': 'paid' } })).toBe('2026-08');
    expect(currentBillMonth({ ...base, outDay: 12, payByDay: null, yearlyMonth: null, today: '2026-08-01', settled: { '2026-07': 'paid' } })).toBe('2026-08');
  });

  it('starts at the first occurrence on or after today', () => {
    expect(firstYearlyMonth('2026-10-26', 12, 1)).toBe('2026-12');
    expect(firstYearlyMonth('2026-10-26', 3, 12)).toBe('2027-03');
    expect(firstYearlyMonth('2026-10-26', 10, 26)).toBe('2026-10');
    expect(firstYearlyMonth('2026-10-26', 10, 25)).toBe('2027-10');
    expect(firstYearlyMonth('2026-10-26', 10, 31)).toBe('2026-10');
  });

  it('is overdue only after its due-by day', () => {
    const w = billWindow('2026-03', 12, 20);
    expect(billStanding(w, '2026-03-11', null).state).toBe('upcoming');
    expect(billStanding(w, '2026-03-20', null)).toEqual({ state: 'dueSoon', days: 0 });
    expect(billStanding(w, '2026-03-21', null)).toEqual({ state: 'overdue', days: 1 });
  });

  it('a due-by day before the bill day is in the following month: out 28 Dec, pay by 5 Jan', () => {
    const w = billWindow('2026-12', 28, 5);
    expect(w).toEqual({ month: '2026-12', opensOn: '2026-12-28', payBy: '2027-01-05' });
    const input = { ...base, startsMonth: '2026-12', outDay: 28, payByDay: 5, yearlyMonth: 12 };
    expect(currentBillMonth({ ...input, today: '2027-01-03' })).toBe('2026-12');
    expect(billStanding(w, '2027-01-03', null)).toEqual({ state: 'dueSoon', days: 2 });
    expect(billStanding(w, '2027-01-06', null).state).toBe('overdue');
    // Settled in January, it speaks for the next December.
    expect(currentBillMonth({ ...input, today: '2027-01-03', settled: { '2026-12': 'paid' } })).toBe('2027-12');
  });

  it('is listed only within 30 days of its date, or while out and unpaid', () => {
    const w = billWindow('2026-11', 25, null);
    expect(yearlyListed(billStanding(w, '2026-10-26', null), w, '2026-10-26')).toBe(true); // 30 days
    expect(yearlyListed(billStanding(w, '2026-10-25', null), w, '2026-10-25')).toBe(false); // 31 days
    expect(yearlyListed(billStanding(w, '2026-11-24', null), w, '2026-11-24')).toBe(true);
    expect(yearlyListed(billStanding(w, '2026-11-30', null), w, '2026-11-30')).toBe(true); // overdue
    expect(yearlyListed(billStanding(w, '2026-11-30', 'paid'), w, '2026-11-30')).toBe(false);
    expect(yearlyListed(billStanding(w, '2026-10-30', 'skipped'), w, '2026-10-30')).toBe(false);
    expect(yearlyListed(billStanding(w, '2026-11-01', 'paused'), w, '2026-11-01')).toBe(false);
  });

  it('settles with a pay or a skip: the next occurrence is next year', () => {
    const input = { ...base, startsMonth: '2026-11', outDay: 25, payByDay: null, yearlyMonth: 11, today: '2026-11-20' };
    expect(payableBillMonths(input)).toEqual(['2026-11']);
    expect(payableBillMonths({ ...input, settled: { '2026-11': 'paid' } })).toEqual([]);
    expect(payableBillMonths({ ...input, settled: { '2026-11': 'skipped' } })).toEqual([]);
    // Far from its month, the one ahead can still be paid on purpose.
    expect(payableBillMonths({ ...input, today: '2027-02-01', settled: { '2026-11': 'paid' } })).toEqual(['2027-11']);
  });

  it('a pause over its month skips that occurrence', () => {
    const months = pausedMonths(pauseStart('2026-10-26', {}), '2027-01');
    expect(months).toEqual(['2026-10', '2026-11', '2026-12']);
    const settled = Object.fromEntries(months.map((m) => [m, 'paused' as const]));
    const w = billWindow('2026-11', 25, null);
    expect(billStanding(w, '2026-11-20', settled['2026-11'] ?? null).state).toBe('paused');
    const input = { ...base, startsMonth: '2026-11', outDay: 25, payByDay: null, yearlyMonth: 11, today: '2026-11-20', settled };
    expect(payableBillMonths(input)).toEqual(['2026-11']); // a paused month can still be paid on purpose
  });

  it('handles a leap-day bill: 29 Feb falls on the 28th in a common year', () => {
    expect(billWindow('2027-02', 29, null).opensOn).toBe('2027-02-28');
    expect(billWindow('2028-02', 29, null).opensOn).toBe('2028-02-29');
    expect(firstYearlyMonth('2027-02-28', 2, 29)).toBe('2027-02');
    expect(firstYearlyMonth('2027-03-01', 2, 29)).toBe('2028-02');
    expect(firstYearlyMonth('2028-02-28', 2, 29)).toBe('2028-02');
  });

  it('is read as Every year · March 12', () => {
    expect(yearlyRepeat(3, 12)).toBe('Every year · March 12');
  });
});
