import { describe, expect, it } from 'vitest';
import { type BillMonthsInput, defaultLinkMonth, latestLinkMonth, previousOwedMonth } from '../src/index';

const monthly = (today: string, settled: BillMonthsInput['settled'] = {}): BillMonthsInput => ({ today, startsMonth: '2026-01', outDay: 10, payByDay: null, settled });
const yearly = (today: string, settled: BillMonthsInput['settled'] = {}, startsMonth = '2026-03'): BillMonthsInput => ({
  today, startsMonth, outDay: 15, payByDay: null, settled, yearlyMonth: 3,
});
/** Every 3 months from August: Aug, Nov, Feb, May. */
const quarterly = (today: string, settled: BillMonthsInput['settled'] = {}): BillMonthsInput => ({
  today, startsMonth: '2026-08', outDay: 20, payByDay: null, settled, yearlyMonth: 8, repeatEvery: 3,
});

describe('previousOwedMonth', () => {
  it('is the last month on or before the one given that the bill comes out in', () => {
    expect(previousOwedMonth('2026-03', 3)).toBe('2026-03');
    expect(previousOwedMonth('2026-02', 3)).toBe('2025-03');
    expect(previousOwedMonth('2026-11', 3)).toBe('2026-03');
    expect(previousOwedMonth('2026-10', 8, 3, '2026-08')).toBe('2026-08');
    expect(previousOwedMonth('2026-11', 8, 3, '2026-08')).toBe('2026-11');
    expect(previousOwedMonth('2027-01', 8, 3, '2026-08')).toBe('2026-11');
  });
});

describe('latestLinkMonth', () => {
  it('a monthly bill: next month at most, as before', () => {
    expect(latestLinkMonth(monthly('2026-10-28'))).toBe('2026-11');
    expect(latestLinkMonth(monthly('2026-10-28', { '2026-10': 'paid', '2026-11': 'paid' }))).toBe('2026-10');
  });

  it('a yearly bill paid for this year can be paid early for next year, in the very month it came out', () => {
    expect(latestLinkMonth(yearly('2026-03-20', { '2026-03': 'paid' }))).toBe('2027-03');
    expect(latestLinkMonth(yearly('2026-03-02'))).toBe('2027-03');
    // Out of its month the next occurrence was already open to it; one occurrence ahead, never two.
    expect(latestLinkMonth(yearly('2026-11-13', { '2026-03': 'paid' }))).toBe('2027-03');
    expect(latestLinkMonth(yearly('2026-11-13', { '2026-03': 'paid', '2027-03': 'paid' }))).toBe('2027-03');
  });

  it('an every-few-months bill settled for this occurrence can take the next one early', () => {
    expect(latestLinkMonth(quarterly('2026-11-25', { '2026-08': 'paid', '2026-11': 'paid' }))).toBe('2027-02');
    expect(latestLinkMonth(quarterly('2026-09-05', { '2026-08': 'paid' }))).toBe('2026-11');
  });

  it('a bill that starts later is open up to its first month', () => {
    expect(latestLinkMonth(yearly('2026-11-13', {}, '2027-03'))).toBe('2027-03');
  });
});

describe('defaultLinkMonth', () => {
  it('a monthly bill links to the purchase month, as before', () => {
    expect(defaultLinkMonth('2026-09-03', monthly('2026-10-28'))).toBe('2026-09');
    expect(defaultLinkMonth('2026-10-28', monthly('2026-10-28'))).toBe('2026-10');
  });

  it('a yearly bill links to the occurrence nearest the purchase date', () => {
    // A month before it comes out: paying it early.
    expect(defaultLinkMonth('2026-02-20', yearly('2026-02-20'))).toBe('2026-03');
    // A few weeks after: paying it late.
    expect(defaultLinkMonth('2026-04-05', yearly('2026-11-13'))).toBe('2026-03');
    // Late in the year, next year's is nearer.
    expect(defaultLinkMonth('2026-11-13', yearly('2026-11-13', { '2026-03': 'paid' }))).toBe('2027-03');
  });

  it('the next occurrence when it is nearer only if it can be paid yet, else the one before', () => {
    // Bought in December 2025 for March 2026, read in December 2025: March is open to it.
    expect(defaultLinkMonth('2025-12-20', yearly('2025-12-20', {}, '2025-03'))).toBe('2026-03');
    // Read in November 2026, March 2027 is the latest open: a purchase nearer March 2028 falls back to March 2027.
    expect(defaultLinkMonth('2027-12-01', yearly('2026-11-13', { '2026-03': 'paid' }))).toBe('2027-03');
    expect(defaultLinkMonth('2028-01-10', yearly('2026-11-13'))).toBe('2027-03');
  });

  it('an every-few-months bill links to the nearest of its months, by the day it comes out', () => {
    // 20 Aug and 20 Nov: the 1st of October is nearer August.
    expect(defaultLinkMonth('2026-10-01', quarterly('2026-11-25'))).toBe('2026-08');
    // The 10th of October is nearer November.
    expect(defaultLinkMonth('2026-10-10', quarterly('2026-11-25'))).toBe('2026-11');
    expect(defaultLinkMonth('2026-11-20', quarterly('2026-11-25'))).toBe('2026-11');
  });
});
