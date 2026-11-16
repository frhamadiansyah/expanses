import { installmentSchedule } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { countSpendingFooter, planProgress } from './plan-view';

// Invented: a laptop of Rp 12.000.000, 12 × Rp 1.000.000 from December 2026, statement day the 18th.
const plan = { totalMinor: 12_000_000, months: 12, monthlyMinor: 1_000_000, firstBilledMonth: '2026-12', rateBps: 0, conversionFeeMinor: 0, earnsPoints: true };
const schedule = installmentSchedule(plan, 18);
const rp = (text: string) => text.replace(/ /g, ' ');

describe('countSpendingFooter', () => {
  it('names the amount and the months under Each month', () => {
    expect(rp(countSpendingFooter({ ...plan, countMode: 'each_month', transactionId: 't1' }, schedule, 'IDR'))).toBe('Each month: Rp 1.000.000 counts in each month from December to November 2027.');
  });

  it('follows Month starts on', () => {
    // Starting on the 16th or later a month is named by its end: 18 Dec falls in January (16 Dec – 15 Jan).
    expect(rp(countSpendingFooter({ ...plan, countMode: 'each_month', transactionId: 't1' }, schedule, 'IDR', 16))).toBe('Each month: Rp 1.000.000 counts in each month from January to December 2027.');
  });

  it('says where a plan with no purchase counts', () => {
    expect(rp(countSpendingFooter({ ...plan, countMode: 'each_month', transactionId: null }, schedule, 'IDR'))).toMatch(/Under Uncategorised, as no purchase is chosen\.$/);
  });

  it('says the purchase counts whole At purchase', () => {
    expect(rp(countSpendingFooter({ ...plan, countMode: 'at_purchase', transactionId: 't1' }, schedule, 'IDR'))).toBe(
      'At purchase: the whole Rp 12.000.000 counts on the day of the purchase; each instalment repays the card.',
    );
  });
});

describe('planProgress', () => {
  const statuses = schedule.map((bill) => ({ ...bill, of: 12, status: (bill.number <= 2 ? 'paid' : bill.number === 3 ? 'billed' : 'upcoming') as 'paid' | 'billed' | 'upcoming' }));

  it('counts what is paid and what is left, and lists the next one first, then newest first', () => {
    const progress = planProgress(12_000_000, statuses);
    expect(progress).toMatchObject({ paid: 2, billed: 3, of: 12, leftMinor: 10_000_000, endsMonth: '2027-11' });
    expect(progress.rows.map((row) => [row.number, row.status])).toEqual([
      [4, 'upcoming'],
      [3, 'billed'],
      [2, 'paid'],
      [1, 'paid'],
    ]);
  });

  it('lists only the next one before anything is billed', () => {
    const progress = planProgress(12_000_000, statuses.map((row) => ({ ...row, status: 'upcoming' as const })));
    expect(progress.rows.map((row) => row.number)).toEqual([1]);
    expect(progress.leftMinor).toBe(12_000_000);
  });
});
