import { installmentSchedule } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { countSpendingFooter, noPurchaseWarning, planProgress, purchaseStateOf } from './plan-view';

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

describe('a plan with no purchase (owner, 16 Nov 2026)', () => {
  const line = (transactionId: string, occurredOn: string, owedMinor: number) => ({ transactionId, occurredOn, owedMinor, spending: true, instalment: null, balancing: false, convertedTo: null });
  const unlinked = { id: 'p1', transactionId: null, totalMinor: 12_000_000, firstBilledMonth: '2026-12' };

  it('reads linked, before the records, or unlinked', () => {
    expect(purchaseStateOf({ ...unlinked, transactionId: 't1' }, [], null)).toBe('linked');
    expect(purchaseStateOf(unlinked, [], '2027-03-01')).toBe('before-records');
    expect(purchaseStateOf(unlinked, [], '2026-01-01')).toBe('unlinked');
    expect(purchaseStateOf(unlinked, [line('t1', '2026-11-10', 12_000_000)], '2026-01-01')).toBe('unlinked');
  });

  it('warns under Each month when the purchase may be recorded, never for one bought before the records', () => {
    expect(noPurchaseWarning('unlinked', 'each_month')).toBe('No purchase chosen: each instalment counts as Uncategorised spending, on top of the purchase.');
    expect(noPurchaseWarning('unlinked', 'each_month', 'Electronics')).toBe('No purchase chosen: each instalment counts as Electronics spending, on top of the purchase.');
    expect(noPurchaseWarning('before-records', 'each_month')).toBeNull();
    expect(noPurchaseWarning('linked', 'each_month')).toBeNull();
    expect(noPurchaseWarning('unlinked', 'at_purchase')).toBeNull();
    expect(noPurchaseWarning('unlinked', 'at_purchase', null, true)).toBe('No purchase chosen: choose the purchase it came from to count it each month.');
  });

  it('counts from the card’s records start, in its own category', () => {
    // 24 × Rp 1.000.000 from May 2024; records from 1 Oct 2025: instalments 18–24 count, Oct 2025 – Apr 2026.
    const phone = { totalMinor: 24_000_000, months: 24, monthlyMinor: 1_000_000, firstBilledMonth: '2024-05', rateBps: 0, conversionFeeMinor: 0, earnsPoints: true };
    expect(rp(countSpendingFooter({ ...phone, countMode: 'each_month', transactionId: null }, installmentSchedule(phone, 18), 'IDR', 1, { recordsFrom: '2025-10-01', categoryName: 'Gadgets' }))).toBe(
      'Each month: Rp 1.000.000 counts in each month from October to April 2026. Under Gadgets, as no purchase is chosen.',
    );
  });
});

describe('plans that are never spending (TF 139)', () => {
  const phone = { totalMinor: 6_000_000, months: 6, monthlyMinor: 1_000_000, firstBilledMonth: '2026-12', rateBps: 0, conversionFeeMinor: 0, earnsPoints: false };
  it('an investment says its instalments are repayments', () => {
    expect(countSpendingFooter({ ...phone, countMode: 'at_purchase', transactionId: 'buy' }, installmentSchedule(phone, 18), 'IDR', 1, { investment: true })).toBe(
      'An investment: instalments are card repayments, not spending.',
    );
  });

  it('a plan from before the records, At purchase, has nothing to choose', () => {
    expect(countSpendingFooter({ ...phone, countMode: 'at_purchase', transactionId: null }, installmentSchedule(phone, 18), 'IDR', 1, { beforeRecords: true })).toBe(
      'Counted as card repayments only, not spending.',
    );
    expect(noPurchaseWarning('before-records', 'at_purchase', null, true)).toBeNull();
  });
});
