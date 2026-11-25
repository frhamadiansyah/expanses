import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  BILL_DAY_KEY,
  isNotMonthlyRepeat,
  WEEKS_EVERY_MAX,
  WEEKS_EVERY_MIN,
  weeklyDueDatesBetween,
  weeklyMonthlyMinor,
  weeklyNextDue,
  weeklyRepeat,
  weeklyStartOn,
} from '../src/index';

// Invented: a prepaid top-up of 1.000.000 every 3 weeks, first one on Tue 3 Nov 2026.
const start = '2026-11-03';

describe('a bill that repeats every few weeks', () => {
  it('adds days across months and years', () => {
    expect(addDaysIso('2026-11-03', 21)).toBe('2026-11-24');
    expect(addDaysIso('2026-11-24', 21)).toBe('2026-12-15');
    expect(addDaysIso('2026-12-15', 21)).toBe('2027-01-05');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('is due on its start date before anything is paid', () => {
    expect(weeklyNextDue(start, 3, [])).toBe('2026-11-03');
  });

  it('is next due N weeks after the latest payment', () => {
    expect(weeklyNextDue(start, 3, ['2026-11-03'])).toBe('2026-11-24');
    expect(weeklyNextDue(start, 3, ['2026-11-24', '2026-11-03'])).toBe('2026-12-15');
  });

  it('moves the rest with a payment made early or late', () => {
    // Bought on 20 Nov instead of 24 Nov: the next one is 11 Dec, not 15 Dec.
    expect(weeklyNextDue(start, 3, ['2026-11-03', '2026-11-20'])).toBe('2026-12-11');
    // Bought late on 28 Nov.
    expect(weeklyNextDue(start, 3, ['2026-11-03', '2026-11-28'])).toBe('2026-12-19');
  });

  it('is never due before its start date', () => {
    // A start moved later than the last payment's turn: the start wins.
    expect(weeklyNextDue('2026-12-20', 3, ['2026-11-03'])).toBe('2026-12-20');
  });

  it('lists the due dates of a month: the payments in it and the ones still to come', () => {
    const paid = ['2026-11-03', '2026-11-24'];
    expect(weeklyDueDatesBetween({ startOn: start, everyWeeks: 3, paidOn: paid }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-03', '2026-11-24']);
    expect(weeklyDueDatesBetween({ startOn: start, everyWeeks: 3, paidOn: paid }, '2026-12-01', '2026-12-31')).toEqual(['2026-12-15']);
    expect(weeklyDueDatesBetween({ startOn: start, everyWeeks: 3, paidOn: paid }, '2027-01-01', '2027-01-31')).toEqual(['2027-01-05', '2027-01-26']);
  });

  it('counts an unpaid due date that has passed in its month, and the ones after it', () => {
    // Nothing paid since 3 Nov: 24 Nov is still owed, and 15 Dec follows it.
    expect(weeklyDueDatesBetween({ startOn: start, everyWeeks: 3, paidOn: ['2026-11-03'] }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-03', '2026-11-24']);
    expect(weeklyDueDatesBetween({ startOn: start, everyWeeks: 3, paidOn: ['2026-11-03'] }, '2026-12-01', '2026-12-31')).toEqual(['2026-12-15']);
  });

  it('lists nothing before the start', () => {
    expect(weeklyDueDatesBetween({ startOn: start, everyWeeks: 3, paidOn: [] }, '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('works out what it comes to a month on average, roughly', () => {
    // 1.000.000 × 365 ÷ 7 ÷ 3 ÷ 12 = 1.448.413, shown to four figures as 1.448.000 (in hundredths: 144.800.000).
    expect(weeklyMonthlyMinor(100_000_000, 3)).toBe(144_800_000);
    expect(weeklyMonthlyMinor(1_000_000, 3)).toBe(1_448_000);
    expect(weeklyMonthlyMinor(5_000, 1)).toBe(21_730);
    expect(weeklyMonthlyMinor(0, 3)).toBe(0);
  });

  it('keeps its start as its first month and day', () => {
    expect(weeklyStartOn('2026-11', 3)).toBe('2026-11-03');
    expect(weeklyStartOn('2027-02', 31)).toBe('2027-02-28');
  });

  it('names its repeat', () => {
    expect(weeklyRepeat(1)).toBe('Every week');
    expect(weeklyRepeat(3)).toBe('Every 3 weeks');
  });

  it('accepts a day key and refuses a month key', () => {
    expect(BILL_DAY_KEY.test('2026-11-24')).toBe(true);
    expect(BILL_DAY_KEY.test('2026-11')).toBe(false);
    expect(BILL_DAY_KEY.test('2026-13-01')).toBe(false);
  });

  it('is a monthly-counted bill: Cashflow keeps its payments in the month they were made', () => {
    expect(isNotMonthlyRepeat('weeks', 3)).toBe(false);
    expect(WEEKS_EVERY_MIN).toBe(1);
    expect(WEEKS_EVERY_MAX).toBe(8);
  });
});
