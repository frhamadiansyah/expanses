import { installmentSchedule } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { countingLine, mayCountTwice, noPurchaseWarning, planProgress } from './plan-view';

// Invented: a laptop of Rp 12.000.000, 12 × Rp 1.000.000 from December 2026, statement day the 18th.
const plan = { totalMinor: 12_000_000, months: 12, monthlyMinor: 1_000_000, firstBilledMonth: '2026-12', rateBps: 0, conversionFeeMinor: 0, earnsPoints: true };
const schedule = installmentSchedule(plan, 18);
const rp = (text: string) => text.replace(/ /g, ' ');

describe('countingLine (the app decides how a plan counts, TF 139)', () => {
  it('a plan tied to a spending purchase counts as that category’s spending, month by month', () => {
    expect(rp(countingLine({ investment: false, monthlyMinor: 1_000_000, transactionId: 't1' }, schedule, 'IDR', 1, { categoryName: 'Electronics' }))).toBe(
      'Counts Rp 1.000.000 a month as Electronics spending, in each month from December to November 2027.',
    );
  });

  it('follows Month starts on', () => {
    // Starting on the 16th or later a month is named by its end: 18 Dec falls in January (16 Dec – 15 Jan).
    expect(rp(countingLine({ investment: false, monthlyMinor: 1_000_000, transactionId: 't1' }, schedule, 'IDR', 16, { categoryName: 'Electronics' }))).toBe(
      'Counts Rp 1.000.000 a month as Electronics spending, in each month from January to December 2027.',
    );
  });

  it('a plan with no purchase counts from the card’s start in the app, Uncategorised unless a category is chosen', () => {
    const phone = { totalMinor: 24_000_000, months: 24, monthlyMinor: 1_000_000, firstBilledMonth: '2024-05', rateBps: 0, conversionFeeMinor: 0, earnsPoints: true };
    expect(rp(countingLine({ investment: false, monthlyMinor: 1_000_000, transactionId: null }, installmentSchedule(phone, 18), 'IDR', 1, { recordsFrom: '2025-10-01' }))).toBe(
      'Counts Rp 1.000.000 a month as Uncategorised spending, in each month from October to April 2026.',
    );
  });

  it('an investment is saving, not spending', () => {
    expect(rp(countingLine({ investment: true, monthlyMinor: 1_000_000, transactionId: 'buy' }, schedule, 'IDR'))).toBe('Investment: Rp 1.000.000 a month counts as saving, not spending.');
  });
});

describe('the no-purchase warning', () => {
  const line = (transactionId: string, occurredOn: string, owedMinor: number, extra: object = {}) => ({ transactionId, occurredOn, owedMinor, spending: true, instalment: null, balancing: false, convertedTo: null, ...extra });
  const unlinked = { id: 'p1', transactionId: null, totalMinor: 12_000_000 };

  it('is said only while the card holds an untied purchase of the plan’s total', () => {
    expect(mayCountTwice(unlinked, [line('laptop', '2026-11-10', 12_000_000)])).toBe(true);
    expect(mayCountTwice(unlinked, [line('laptop', '2026-11-10', 12_000_000, { convertedTo: { planId: 'other' } })])).toBe(false);
    expect(mayCountTwice(unlinked, [])).toBe(false);
    expect(mayCountTwice({ ...unlinked, transactionId: 't1' }, [line('laptop', '2026-11-10', 12_000_000)])).toBe(false);
  });

  it('names what it would double', () => {
    expect(noPurchaseWarning(true, false)).toBe('No purchase chosen: each instalment counts as Uncategorised spending, on top of the purchase.');
    expect(noPurchaseWarning(true, false, 'Electronics')).toBe('No purchase chosen: each instalment counts as Electronics spending, on top of the purchase.');
    expect(noPurchaseWarning(true, true)).toBe('No purchase chosen: the card holds a purchase of this total, and each instalment is billed on top of it.');
    expect(noPurchaseWarning(false, false)).toBeNull();
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

