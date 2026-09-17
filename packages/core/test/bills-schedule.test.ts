import { describe, expect, it } from 'vitest';
import {
  billPill,
  billSchedule,
  billStanding,
  billWindow,
  currentBillMonth,
  dayMonth,
  monthName,
  payableBillMonths,
} from '../src/index';

describe('billWindow', () => {
  it('opens and falls due in the same month when the pay-by day is later', () => {
    expect(billWindow('2026-09', 1, 10)).toEqual({ month: '2026-09', opensOn: '2026-09-01', payBy: '2026-09-10' });
  });

  it('carries a pay-by day earlier than the out day into the next month', () => {
    expect(billWindow('2026-08', 28, 5)).toEqual({ month: '2026-08', opensOn: '2026-08-28', payBy: '2026-09-05' });
    expect(billWindow('2026-12', 28, 5).payBy).toBe('2027-01-05');
  });

  it('is due on its out day when it has no pay-by day', () => {
    expect(billWindow('2026-09', 20, null)).toEqual({ month: '2026-09', opensOn: '2026-09-20', payBy: '2026-09-20' });
  });

  it('clamps days a month does not have', () => {
    expect(billWindow('2026-02', 31, null).opensOn).toBe('2026-02-28');
    expect(billWindow('2028-02', 30, 31)).toMatchObject({ opensOn: '2028-02-29', payBy: '2028-02-29' });
    expect(billWindow('2026-01', 31, 30).payBy).toBe('2026-02-28');
  });
});

describe('billStanding', () => {
  const internet = billWindow('2026-08', 28, 5);

  it('walks through the window: opens, pay by, due soon, due today, overdue', () => {
    expect(billStanding(internet, '2026-08-27', null)).toEqual({ state: 'upcoming', days: 1 });
    expect(billStanding(internet, '2026-08-28', null)).toEqual({ state: 'open', days: 8 });
    expect(billStanding(internet, '2026-09-01', null)).toEqual({ state: 'open', days: 4 });
    expect(billStanding(internet, '2026-09-02', null)).toEqual({ state: 'dueSoon', days: 3 });
    expect(billStanding(internet, '2026-09-05', null)).toEqual({ state: 'dueSoon', days: 0 });
    expect(billStanding(internet, '2026-09-08', null)).toEqual({ state: 'overdue', days: 3 });
  });

  it('is settled whatever the day once paid or skipped', () => {
    expect(billStanding(internet, '2026-09-30', 'paid')).toEqual({ state: 'paid', days: 0 });
    expect(billStanding(internet, '2026-08-01', 'skipped')).toEqual({ state: 'skipped', days: 0 });
  });

  it('without a pay-by day, is due on the out day and overdue the day after', () => {
    const pln = billWindow('2026-09', 20, null);
    expect(billStanding(pln, '2026-09-19', null)).toEqual({ state: 'upcoming', days: 1 });
    expect(billStanding(pln, '2026-09-20', null)).toEqual({ state: 'dueSoon', days: 0 });
    expect(billStanding(pln, '2026-09-21', null)).toEqual({ state: 'overdue', days: 1 });
  });
});

describe('which month a bill speaks for', () => {
  const internet = { outDay: 28, payByDay: 5, startsMonth: '2026-08' };

  it('raises last month while it is unsettled', () => {
    expect(currentBillMonth({ ...internet, today: '2026-09-08', settled: {} })).toBe('2026-08');
    expect(currentBillMonth({ ...internet, today: '2026-09-08', settled: { '2026-08': 'paid' } })).toBe('2026-09');
    expect(currentBillMonth({ ...internet, today: '2026-09-08', settled: { '2026-08': 'skipped' } })).toBe('2026-09');
  });

  it('never raises a month before the bill was tracked', () => {
    expect(currentBillMonth({ ...internet, startsMonth: '2026-09', today: '2026-09-08', settled: {} })).toBe('2026-09');
  });

  it('offers last, this and next month, oldest unsettled first', () => {
    expect(payableBillMonths({ ...internet, today: '2026-09-08', settled: {} })).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(payableBillMonths({ ...internet, today: '2026-09-08', settled: { '2026-08': 'paid', '2026-09': 'skipped' } })).toEqual(['2026-10']);
    expect(payableBillMonths({ ...internet, startsMonth: '2026-09', today: '2026-09-08', settled: {} })).toEqual(['2026-09', '2026-10']);
  });
});

describe('words', () => {
  const window = billWindow('2026-09', 20, 25);

  it('says each state the way the pill does', () => {
    expect(billPill({ state: 'upcoming', days: 5 }, window, null)).toEqual({ text: 'Opens 20 Sep', tone: 'grey' });
    expect(billPill({ state: 'open', days: 5 }, window, null)).toEqual({ text: 'Pay by 25 Sep', tone: 'blue' });
    expect(billPill({ state: 'dueSoon', days: 2 }, window, null)).toEqual({ text: 'Due in 2 days', tone: 'amber' });
    expect(billPill({ state: 'dueSoon', days: 1 }, window, null).text).toBe('Due in 1 day');
    expect(billPill({ state: 'dueSoon', days: 0 }, window, null).text).toBe('Due today');
    expect(billPill({ state: 'overdue', days: 3 }, window, null)).toEqual({ text: 'Overdue 3 days', tone: 'red' });
    expect(billPill({ state: 'overdue', days: 1 }, window, null).text).toBe('Overdue 1 day');
    expect(billPill({ state: 'paid', days: 0 }, window, '2026-09-01')).toEqual({ text: '✓ Paid 1 Sep', tone: 'green' });
    expect(billPill({ state: 'skipped', days: 0 }, window, null)).toEqual({ text: 'Skipped', tone: 'grey' });
  });

  it('names months, days and the schedule', () => {
    expect(monthName('2026-08', 'long')).toBe('August');
    expect(monthName('2026-08', 'short')).toBe('Aug');
    expect(dayMonth('2026-09-08')).toBe('8 Sep');
    expect(billSchedule(28, 5)).toBe('Every month · out on the 28th · pay by the 5th');
    expect(billSchedule(1, null)).toBe('Every month · out on the 1st');
    expect(billSchedule(22, 23)).toBe('Every month · out on the 22nd · pay by the 23rd');
    expect(billSchedule(11, 12)).toBe('Every month · out on the 11th · pay by the 12th');
  });
});
