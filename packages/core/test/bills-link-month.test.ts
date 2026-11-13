import { describe, expect, it } from 'vitest';
import { type BillMonthsInput, latestLinkMonth, linkChoice, previousOwedMonth } from '../src/index';

const monthFor = (purchasedOn: string, input: BillMonthsInput) => linkChoice(purchasedOn, input).month;

const monthly = (today: string, settled: BillMonthsInput['settled'] = {}): BillMonthsInput => ({ today, startsMonth: '2026-01', outDay: 10, payByDay: null, settled });
const yearly = (today: string, settled: BillMonthsInput['settled'] = {}, startsMonth = '2026-03'): BillMonthsInput => ({
  today, startsMonth, outDay: 15, payByDay: null, settled, yearlyMonth: 3,
});
/** Out on the 25th, paid by the 5th of the next month: the bill out 25 Oct is October's. */
const payLater = (today: string, settled: BillMonthsInput['settled'] = {}): BillMonthsInput => ({ today, startsMonth: '2026-01', outDay: 25, payByDay: 5, settled });
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

describe('linkChoice', () => {
  it('a monthly bill links to the purchase month, as before', () => {
    expect(monthFor('2026-09-03', monthly('2026-10-28'))).toBe('2026-09');
    expect(monthFor('2026-10-28', monthly('2026-10-28'))).toBe('2026-10');
  });

  it('a yearly bill links to the occurrence nearest the purchase date', () => {
    // A month before its first occurrence: that first one, asked — never last year's, before the bill started.
    expect(linkChoice('2026-02-20', yearly('2026-02-20'))).toEqual({ month: '2026-03', ask: true });
    // A few weeks after: paying it late.
    expect(monthFor('2026-04-05', yearly('2026-11-13'))).toBe('2026-03');
    // Late in the year, this year's paid: next year's is nearer.
    expect(linkChoice('2026-11-13', yearly('2026-11-13', { '2026-03': 'paid' }))).toEqual({ month: '2027-03', ask: false });
    // This year's out and never paid: never next year's while it is open — this year's, paid late.
    expect(linkChoice('2026-11-13', yearly('2026-11-13'))).toEqual({ month: '2026-03', ask: false });
    // Soon after this year's, which is paid: this year's, asked, rather than next year's in silence.
    expect(linkChoice('2026-04-05', yearly('2026-11-13', { '2026-03': 'paid' }))).toEqual({ month: '2026-03', ask: true });
  });

  it('the next occurrence when it is nearer only if it can be paid yet, else the one before', () => {
    // Bought in December 2025 with March 2026 open to it, but March 2025 out and never paid: March 2025, paid late.
    expect(monthFor('2025-12-20', yearly('2025-12-20', {}, '2025-03'))).toBe('2025-03');
    // March 2025 paid: March 2026 is nearer, and open.
    expect(linkChoice('2025-12-20', yearly('2025-12-20', { '2025-03': 'paid' }, '2025-03'))).toEqual({ month: '2026-03', ask: false });
    // Read in November 2026, March 2027 is the latest open: a purchase nearer March 2028 falls back to March 2027.
    expect(monthFor('2027-12-01', yearly('2026-11-13', { '2026-03': 'paid' }))).toBe('2027-03');
    expect(monthFor('2028-01-10', yearly('2026-11-13'))).toBe('2027-03');
  });

  it('an every-few-months bill links to the nearest of its months, by the day it comes out', () => {
    // 20 Aug and 20 Nov: the 1st of October is nearer August.
    expect(monthFor('2026-10-01', quarterly('2026-11-25'))).toBe('2026-08');
    // The 10th of October is nearer November, but August is out and unpaid: August, paid late.
    expect(monthFor('2026-10-10', quarterly('2026-11-25'))).toBe('2026-08');
    // August paid: November, nearer.
    expect(linkChoice('2026-10-10', quarterly('2026-11-25', { '2026-08': 'paid' }))).toEqual({ month: '2026-11', ask: false });
    expect(monthFor('2026-11-20', quarterly('2026-11-25'))).toBe('2026-11');
  });
});

describe('a monthly bill paid in the window after it comes out', () => {
  it('links to the bill month whose window holds the purchase date, not the purchase month', () => {
    expect(linkChoice('2026-10-27', payLater('2026-11-13'))).toEqual({ month: '2026-10', ask: false });
    expect(linkChoice('2026-11-03', payLater('2026-11-13'))).toEqual({ month: '2026-10', ask: false });
    expect(linkChoice('2026-11-26', payLater('2026-11-26', { '2026-10': 'paid' }))).toEqual({ month: '2026-11', ask: false });
  });

  it('paid after the window: the newest month already out, if it is still owed; never an older one', () => {
    // Past October's pay-by day, October still owed: October, paid late, no question.
    expect(linkChoice('2026-11-10', payLater('2026-11-13'))).toEqual({ month: '2026-10', ask: false });
  });

  it('the month that holds the date already settled: the purchase month, asked — never an older month in silence', () => {
    // October settled, November not out until the 25th.
    expect(linkChoice('2026-11-03', payLater('2026-11-03', { '2026-10': 'paid' }))).toEqual({ month: '2026-11', ask: true });
    // Bought 27 Oct, inside October's window, October paid: not September, asked.
    expect(linkChoice('2026-10-27', payLater('2026-11-13', { '2026-10': 'paid' }))).toEqual({ month: '2026-10', ask: true });
  });

  it('a window inside one month (out the 1st, pay by the 10th)', () => {
    const early = (settled: BillMonthsInput['settled'] = {}): BillMonthsInput => ({ today: '2026-11-20', startsMonth: '2026-01', outDay: 1, payByDay: 10, settled });
    expect(linkChoice('2026-11-05', early())).toEqual({ month: '2026-11', ask: false });
    // After the 10th, November still owed: November, paid late.
    expect(linkChoice('2026-11-15', early())).toEqual({ month: '2026-11', ask: false });
    // November paid: not October, asked.
    expect(linkChoice('2026-11-15', early({ '2026-11': 'paid' }))).toEqual({ month: '2026-11', ask: true });
  });

  it('never a month before the bill started: started in November, a payment on 3 Nov is November, asked', () => {
    const fresh: BillMonthsInput = { ...payLater('2026-11-03'), startsMonth: '2026-11' };
    expect(linkChoice('2026-11-03', fresh)).toEqual({ month: '2026-11', ask: true });
    expect(linkChoice('2026-11-27', fresh)).toEqual({ month: '2026-11', ask: false });
    expect(linkChoice('2026-12-02', { ...fresh, today: '2026-12-02' })).toEqual({ month: '2026-11', ask: false });
  });

  it('a monthly bill with no pay-by day keeps the purchase month and never asks', () => {
    expect(linkChoice('2026-11-03', { ...monthly('2026-11-13'), outDay: 25 })).toEqual({ month: '2026-11', ask: false });
  });
});

describe('never an occurrence before the bill started', () => {
  it('an every-3-months bill from August, bought on 1 July: August, asked', () => {
    expect(linkChoice('2026-07-01', quarterly('2026-07-01'))).toEqual({ month: '2026-08', ask: true });
  });
  it('a yearly bill starting March 2027, bought in November 2026: March 2027, asked', () => {
    expect(linkChoice('2026-11-13', yearly('2026-11-13', {}, '2027-03'))).toEqual({ month: '2027-03', ask: true });
  });
});

describe('a monthly bill bought for before it started', () => {
  it('no pay-by day: the start month, asked — never a month before it in silence', () => {
    expect(linkChoice('2025-12-10', monthly('2026-10-28'))).toEqual({ month: '2026-01', ask: true });
    expect(linkChoice('2026-01-10', monthly('2026-10-28'))).toEqual({ month: '2026-01', ask: false });
  });
  it('with a pay-by day too', () => {
    expect(linkChoice('2025-12-28', payLater('2026-11-13'))).toEqual({ month: '2026-01', ask: true });
  });
});
