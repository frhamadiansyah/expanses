import { installmentSchedule } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { countSpendingFooter } from './plan-view';

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
