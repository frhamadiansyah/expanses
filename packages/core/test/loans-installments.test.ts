import { describe, expect, it } from 'vitest';
import { type CardInstallment, installmentSplit } from '../src/index';

/** A Rp 12.000.000 phone over 12 months, first billed in September 2026. */
const phone: CardInstallment = {
  totalMinor: 12_000_000,
  months: 12,
  monthlyMinor: 1_000_000,
  firstBilledMonth: '2026-09',
  rateBps: 0,
  conversionFeeMinor: 0,
  earnsPoints: false,
};

describe('installmentSplit', () => {
  it('has billed nothing before the first month', () => {
    const split = installmentSplit(phone, '2026-08-31');

    expect(split).toMatchObject({ billedMinor: 0, unbilledMinor: 12_000_000, monthsLeft: 12 });
  });

  it('counts the first month as billed once it arrives', () => {
    const split = installmentSplit(phone, '2026-09-15');

    expect(split.billedMinor).toBe(1_000_000);
    expect(split.unbilledMinor).toBe(11_000_000);
    expect(split.monthsLeft).toBe(11);
  });

  it('counts three instalments three months in', () => {
    const split = installmentSplit(phone, '2026-11-20');

    expect(split.billedMinor).toBe(3_000_000);
    expect(split.unbilledMinor).toBe(9_000_000);
  });

  it('leaves nothing unbilled once the last instalment is billed', () => {
    const split = installmentSplit(phone, '2027-08-31');

    expect(split).toMatchObject({ billedMinor: 12_000_000, unbilledMinor: 0, monthsLeft: 0 });
  });

  it('names the month it ends', () => {
    expect(installmentSplit(phone, '2026-09-15').lastMonth).toBe('2027-08');
  });

  it('keeps the parts adding back to the total', () => {
    for (const onDate of ['2026-08-01', '2026-09-15', '2027-02-01', '2027-08-31', '2028-01-01']) {
      const split = installmentSplit(phone, onDate);
      expect(split.billedMinor + split.unbilledMinor).toBe(12_000_000);
    }
  });

  it('never counts a negative number of months left', () => {
    expect(installmentSplit(phone, '2030-01-01').monthsLeft).toBe(0);
  });
});

describe('what falls due beyond twelve months', () => {
  const twoYears: CardInstallment = { ...phone, totalMinor: 24_000_000, months: 24, monthlyMinor: 1_000_000 };

  it('puts everything past month twelve in its own figure', () => {
    const split = installmentSplit(twoYears, '2026-09-15');

    // Billed one, so 23 are left: the next twelve fall within a year and 11 beyond it.
    expect(split.unbilledMinor).toBe(23_000_000);
    expect(split.unbilledBeyond12Minor).toBe(11_000_000);
  });

  it('has nothing beyond twelve months on a short plan', () => {
    const sixMonths: CardInstallment = { ...phone, totalMinor: 6_000_000, months: 6, monthlyMinor: 1_000_000 };

    expect(installmentSplit(sixMonths, '2026-09-15').unbilledBeyond12Minor).toBe(0);
  });

  it('has nothing beyond twelve months once the plan is nearly done', () => {
    expect(installmentSplit(twoYears, '2028-01-15').unbilledBeyond12Minor).toBe(0);
  });
});

describe('a plan with a fee and a rate', () => {
  it('leaves the conversion fee out of the instalments themselves', () => {
    const withFee: CardInstallment = { ...phone, conversionFeeMinor: 250_000, rateBps: 600 };
    const split = installmentSplit(withFee, '2026-09-15');

    // The fee is a charge of its own on the statement, not part of what is still owed.
    expect(split.billedMinor + split.unbilledMinor).toBe(12_000_000);
  });
});
