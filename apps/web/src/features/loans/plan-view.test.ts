import { installmentSchedule } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { countingLine, firstBilledDate, mayCountTwice, noPurchaseWarning, owedFooter, paidListRows, planProgress } from './plan-view';

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

  it('a plan with no purchase counts only what is owed, Uncategorised unless a category is chosen', () => {
    const phone = { totalMinor: 24_000_000, months: 24, monthlyMinor: 1_000_000, firstBilledMonth: '2024-05', rateBps: 0, conversionFeeMinor: 0, earnsPoints: true };
    expect(rp(countingLine({ investment: false, monthlyMinor: 1_000_000, transactionId: null }, installmentSchedule(phone, 18), 'IDR', 1, { paidSoFar: 17 }))).toBe(
      'Counts Rp 1.000.000 a month as Uncategorised spending, in each month from October to April 2026.',
    );
    expect(countingLine({ investment: false, monthlyMinor: 1_000_000, transactionId: null }, installmentSchedule(phone, 18), 'IDR', 1, { paidSoFar: 24 })).toBe(
      'Every instalment is paid: nothing more counts as spending.',
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


/*
 * The Paid list (owner, 17 Nov 2026, mockup 1b). The owner's case, invented: 24 × Rp 1.000.000 first billed March 2025,
 * statement day the 13th, due the 2nd; added 17 Nov 2026, so 1–20 ticked.
 */
describe('the Paid list', () => {
  const ori = { totalMinor: 24_000_000, months: 24, monthlyMinor: 1_000_000, firstBilledMonth: '2025-03', rateBps: 0, conversionFeeMinor: 0, earnsPoints: false };
  const bills = installmentSchedule(ori, 13);
  const view = (rows: ReturnType<typeof paidListRows>) => rows.map((row) => [row.title, row.subtitle, row.ticked, row.tapTo]);

  it('on the new plan’s sheet: every one owed, the latest two ticked, the older folded', () => {
    expect(view(paidListRows({ schedule: bills, paidSoFar: 20, dueDay: 2, open: 2, expanded: false }))).toEqual([
      ['24 of 24', '13 Feb 2027', false, 24],
      ['23 of 24', '13 Jan 2027', false, 23],
      ['22 of 24', '13 Dec 2026', false, 22],
      ['21 of 24', '13 Nov 2026 · due 2 Dec', false, 21],
      ['20 of 24', '13 Oct 2026', true, 19],
      ['19 of 24', '13 Sep 2026', true, 18],
      ['1–18 of 24', 'March 2025 – August 2026', true, null],
    ]);
    expect(paidListRows({ schedule: bills, paidSoFar: 20, dueDay: 2, open: 2, expanded: true })).toHaveLength(24);
  });

  it('on the plan’s page: billed and the next to come, the paid folded, a covered one not the list’s to untick', () => {
    expect(view(paidListRows({ schedule: bills, paidSoFar: 20, dueDay: 2, today: '2026-11-17', open: 0, expanded: false }))).toEqual([
      ['22 of 24', '13 Dec 2026 · upcoming', false, 22],
      ['21 of 24', '13 Nov 2026 · due 2 Dec', false, 21],
      ['1–20 of 24', 'Paid', true, null],
    ]);
    expect(view(paidListRows({ schedule: bills, paidSoFar: 20, dueDay: 2, today: '2026-12-03', covered: new Set([21]), open: 0, expanded: false })).slice(0, 2)).toEqual([
      ['22 of 24', '13 Dec 2026 · due 2 Jan', false, 22],
      ['21 of 24', '13 Nov 2026 · paid', true, null],
    ]);
  });

  it('says what is owed, and where', () => {
    expect(rp(owedFooter(ori, 20, 'IDR', 'Visa Kencana', false))).toBe('Owed: 21–24, Rp 4.000.000 — added to Visa Kencana’s balance.');
    expect(rp(owedFooter(ori, 21, 'IDR', 'Visa Kencana', true))).toBe('Owed: 22–24, Rp 3.000.000 — held in Visa Kencana’s opening balance.');
    expect(rp(owedFooter(ori, 23, 'IDR', 'Visa Kencana', false))).toBe('Owed: 24, Rp 1.000.000 — added to Visa Kencana’s balance.');
    expect(owedFooter(ori, 24, 'IDR', 'Visa Kencana', false)).toBe('Owed: nothing. Every instalment is paid.');
  });

  it('shows First billed as the full date, on the card’s statement day', () => {
    expect(firstBilledDate(bills)).toBe('13 March 2025');
  });
});
