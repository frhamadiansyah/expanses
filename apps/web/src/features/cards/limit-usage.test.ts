import { describe, expect, it } from 'vitest';
import { availableLine as lineOf, cardBackFigure, dueNowMinor, laterByCard, laterInstalmentsMinor, limitUsage } from './limit-usage';

describe('limitUsage', () => {
  it('shows instalments as part of what is used, not as a second deduction', () => {
    expect(limitUsage(30_000_000, 80_000_000, 17_500_000)).toEqual({ usedMinor: 30_000_000, heldMinor: 17_500_000, availableMinor: 50_000_000, barUsedPct: 16, barHeldPct: 22, usedPct: 38 });
  });

  it('never lets instalments hold more than is owed', () => {
    expect(limitUsage(4_000_000, 80_000_000, 17_500_000)).toMatchObject({ heldMinor: 4_000_000, availableMinor: 76_000_000, barUsedPct: 0, barHeldPct: 5 });
  });

  it('says how far over the limit a card is, and draws no bar without a limit', () => {
    expect(limitUsage(42_000_000, 40_000_000, 0)).toMatchObject({ availableMinor: -2_000_000, usedPct: 100, barUsedPct: 100 });
    expect(limitUsage(5_000_000, null, 1_000_000)).toEqual({ usedMinor: 5_000_000, heldMinor: 1_000_000, availableMinor: null, barUsedPct: 0, barHeldPct: 0, usedPct: null });
  });

  it('counts a credit on top of the limit: Rp 50.000.000 credit on a Rp 100.000.000 limit leaves Rp 150.000.000 to spend', () => {
    expect(limitUsage(-50_000_000, 100_000_000, 0)).toMatchObject({ usedMinor: 0, availableMinor: 150_000_000, usedPct: 0, barUsedPct: 0 });
  });
});

describe('cardBackFigure', () => {
  it('names what is owed Outstanding', () => {
    expect(cardBackFigure(30_000_000, 0)).toEqual({ label: 'Outstanding', minor: 30_000_000 });
    expect(cardBackFigure(0, 0)).toEqual({ label: 'Outstanding', minor: 0 });
  });

  it('names a card in credit by its credit, in the same place', () => {
    expect(cardBackFigure(0, 50_000_000)).toEqual({ label: 'Credit', minor: 50_000_000 });
  });
});

/*
 * The brief's example (2026-11-17): BCA Visa, limit 30.000.000, a 12.000.000 laptop on 6 x 2.000.000 first billed this
 * month and 500.000 of groceries. Owed in full 12.500.000; instalments not billed yet 10.000.000; due now 2.500.000.
 */
const plan = (extra: Partial<Parameters<typeof laterInstalmentsMinor>[0]> = {}): Parameters<typeof laterInstalmentsMinor>[0] => ({
  cardAccountId: 'visa',
  transactionId: 'laptop',
  paidSoFar: 0,
  totalMinor: 12_000_000,
  months: 6,
  monthlyMinor: 2_000_000,
  firstBilledMonth: '2026-11',
  rateBps: 0,
  conversionFeeMinor: 0,
  earnsPoints: false,
  ...extra,
});

describe('the instalments not billed yet', () => {
  it('a plan tied to a purchase: every instalment after the ones billed by this month', () => {
    expect(laterInstalmentsMinor(plan(), '2026-11-17')).toBe(10_000_000);
    expect(laterInstalmentsMinor(plan(), '2026-10-31')).toBe(12_000_000);
    expect(laterInstalmentsMinor(plan(), '2027-04-01')).toBe(0);
  });

  it('a plan with no purchase: the same, but never more than its owed line (the instalments after those paid)', () => {
    // 24 x 500.000 from Jan 2026; by Nov 11 are billed, 13 later. Paid 11: owed line 6.500.000, all of it later.
    const loose = plan({ transactionId: null, totalMinor: 12_000_000, months: 24, monthlyMinor: 500_000, firstBilledMonth: '2026-01', paidSoFar: 11 });
    expect(laterInstalmentsMinor(loose, '2026-11-17')).toBe(6_500_000);
    // Paid only 8: owed line 8.000.000, of which the 3 billed (1.500.000) are due now and 6.500.000 later.
    expect(laterInstalmentsMinor({ ...loose, paidSoFar: 8 }, '2026-11-17')).toBe(6_500_000);
    // Ticked ahead to 15: owed line 4.500.000, all of it later — never more than is owed on it.
    expect(laterInstalmentsMinor({ ...loose, paidSoFar: 15 }, '2026-11-17')).toBe(4_500_000);
    expect(laterInstalmentsMinor({ ...loose, paidSoFar: 24 }, '2026-11-17')).toBe(0);
  });

  it('adds up by card', () => {
    const plans = [plan(), plan({ transactionId: 'phone', totalMinor: 3_000_000, monthlyMinor: 1_000_000, months: 3 }), plan({ cardAccountId: 'mandiri', transactionId: 'tv', firstBilledMonth: '2026-12' })];
    expect(laterByCard(plans, '2026-11-17')).toEqual({ visa: 12_000_000, mandiri: 12_000_000 });
  });
});

describe('what is due now on a card', () => {
  it('is what is owed less the instalments not billed yet', () => {
    expect(dueNowMinor(12_500_000, 10_000_000)).toBe(2_500_000);
  });

  it('is everything owed with no plans', () => {
    expect(dueNowMinor(12_500_000, 0)).toBe(12_500_000);
  });

  it('is never below nothing: a card paid off early has nothing left for its plans to hold', () => {
    expect(dueNowMinor(4_000_000, 10_000_000)).toBe(0);
  });

  it('is nothing for a card in credit, whose credit is told on its own', () => {
    expect(dueNowMinor(0, 10_000_000)).toBe(0);
    expect(cardBackFigure(dueNowMinor(0, 10_000_000), 250_000)).toEqual({ label: 'Credit', minor: 250_000 });
  });
});

describe('the line under the limit bar', () => {
  // The figures carry a no-break space after Rp: read as a plain one.
  const availableLine = (...args: Parameters<typeof lineOf>) => lineOf(...args).replace(/\u00a0/g, ' ');

  it('names the instalments in place of the limit when there are any', () => {
    expect(availableLine(limitUsage(12_500_000, 30_000_000, 10_000_000), 30_000_000, 'IDR')).toBe('Rp 17.500.000 available · Rp 10.000.000 in instalments');
  });

  it('keeps the limit when there are none', () => {
    expect(availableLine(limitUsage(2_500_000, 30_000_000, 0), 30_000_000, 'IDR')).toBe('Rp 27.500.000 available of Rp 30.000.000');
  });

  it('says how far over the limit a card is', () => {
    expect(availableLine(limitUsage(32_000_000, 30_000_000, 10_000_000), 30_000_000, 'IDR')).toBe('Over the limit by Rp 2.000.000');
  });
});
