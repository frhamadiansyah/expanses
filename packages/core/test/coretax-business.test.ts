import { describe, expect, it } from 'vitest';
import { type BusinessInput, type BusinessSource, businessIncomeFor, UMKM_RATE_BPS } from '../src/index';

const THRESHOLD = 500_000_000;
const CEILING = 4_800_000_000;

const source = (partial: Partial<BusinessSource> = {}): BusinessSource => ({
  id: 'warung',
  name: 'Warung',
  scheme: 'umkm_final',
  normaRateBps: null,
  thresholdApplies: true,
  ...partial,
});

const input = (partial: Partial<BusinessInput> = {}): BusinessInput => ({
  sources: [source()],
  turnover: {},
  thresholdMinor: THRESHOLD,
  ceilingMinor: CEILING,
  ...partial,
});

/** The same amount every month, which is the easiest year to reason about. */
const everyMonth = (amountMinor: number) => Array.from({ length: 12 }, (_, index) => ({ month: index + 1, amountMinor }));

describe('businessIncomeFor, UMKM', () => {
  it('taxes nothing while the exempt slice still covers the year', () => {
    const report = businessIncomeFor(input({ turnover: { warung: everyMonth(10_000_000) } }));

    expect(report.umkm[0]!.grossMinor).toBe(120_000_000);
    expect(report.umkm[0]!.taxMinor).toBe(0);
    expect(report.umkm[0]!.crossedInMonth).toBeNull();
  });

  it('starts taxing in the month the slice runs out, not the month after', () => {
    // Rp 100 juta a month: the first five months use the slice up exactly, so June is the first taxed.
    const report = businessIncomeFor(input({ turnover: { warung: everyMonth(100_000_000) } }));
    const umkm = report.umkm[0]!;

    expect(umkm.crossedInMonth).toBe(6);
    expect(umkm.months[4]!.taxableMinor).toBe(0);
    expect(umkm.months[5]!.taxableMinor).toBe(100_000_000);
  });

  it('splits the crossing month between the exempt part and the taxed part', () => {
    // Rp 120 juta a month crosses part-way through May: Rp 20 juta of it is still exempt.
    const report = businessIncomeFor(input({ turnover: { warung: everyMonth(120_000_000) } }));
    const may = report.umkm[0]!.months[4]!;

    expect(may.exemptMinor).toBe(20_000_000);
    expect(may.taxableMinor).toBe(100_000_000);
    expect(may.taxMinor).toBe(500_000);
  });

  it('charges 0,5% of what is taxable and nothing on what is exempt', () => {
    const report = businessIncomeFor(input({ turnover: { warung: everyMonth(100_000_000) } }));
    const umkm = report.umkm[0]!;

    expect(umkm.exemptMinor).toBe(THRESHOLD);
    expect(umkm.taxableMinor).toBe(1_200_000_000 - THRESHOLD);
    expect(umkm.taxMinor).toBe(Math.round(((1_200_000_000 - THRESHOLD) * UMKM_RATE_BPS) / 10_000));
  });

  it('taxes from the first rupiah when the slice is switched off', () => {
    const report = businessIncomeFor(
      input({ sources: [source({ thresholdApplies: false })], turnover: { warung: everyMonth(10_000_000) } }),
    );

    expect(report.umkm[0]!.exemptMinor).toBe(0);
    expect(report.umkm[0]!.months[0]!.taxMinor).toBe(50_000);
    expect(report.umkm[0]!.crossedInMonth).toBeNull();
  });

  it('carries a running total, so you can see when the ceiling is near', () => {
    const report = businessIncomeFor(input({ turnover: { warung: everyMonth(100_000_000) } }));

    expect(report.umkm[0]!.months[11]!.cumulativeMinor).toBe(1_200_000_000);
  });

  it('warns once the year has passed the ceiling, because the scheme stops applying', () => {
    const report = businessIncomeFor(input({ turnover: { warung: everyMonth(500_000_000) } }));

    expect(report.problems.some((problem) => problem.level === 'warning' && /ceiling/.test(problem.message))).toBe(true);
  });

  it('gives every month a row even when only one was recorded', () => {
    const report = businessIncomeFor(input({ turnover: { warung: [{ month: 7, amountMinor: 5_000_000 }] } }));

    expect(report.umkm[0]!.months).toHaveLength(12);
    expect(report.umkm[0]!.grossMinor).toBe(5_000_000);
  });

  it('reads months in the order the year runs, not the order they were typed', () => {
    const jumbled = [
      { month: 6, amountMinor: 120_000_000 },
      { month: 1, amountMinor: 120_000_000 },
      { month: 5, amountMinor: 120_000_000 },
      { month: 3, amountMinor: 120_000_000 },
      { month: 2, amountMinor: 120_000_000 },
      { month: 4, amountMinor: 120_000_000 },
    ];
    const report = businessIncomeFor(input({ turnover: { warung: jumbled } }));

    expect(report.umkm[0]!.crossedInMonth).toBe(5);
  });

  it('refuses a month below nought rather than crediting tax back', () => {
    const report = businessIncomeFor(input({ turnover: { warung: [{ month: 2, amountMinor: -1_000 }] } }));

    expect(report.problems.some((problem) => problem.level === 'blocking')).toBe(true);
  });
});

describe('businessIncomeFor, NPPN', () => {
  const affiliate = source({ id: 'shopee', name: 'Shopee affiliate', scheme: 'nppn', normaRateBps: 5_000 });

  it('turns turnover into net income at the percentage given', () => {
    const report = businessIncomeFor(input({ sources: [affiliate], turnover: { shopee: everyMonth(10_000_000) } }));

    expect(report.nppn[0]!.grossMinor).toBe(120_000_000);
    expect(report.nppn[0]!.netMinor).toBe(60_000_000);
  });

  it('works out nothing and says so when the percentage is missing', () => {
    const report = businessIncomeFor(
      input({ sources: [source({ id: 'shopee', name: 'Shopee affiliate', scheme: 'nppn' })], turnover: { shopee: everyMonth(10_000_000) } }),
    );

    expect(report.nppn[0]!.netMinor).toBe(0);
    expect(report.problems.some((problem) => problem.level === 'blocking' && /norma percentage/.test(problem.message))).toBe(true);
  });

  it('never charges a rate itself: norma income carries no tax figure', () => {
    const report = businessIncomeFor(input({ sources: [affiliate], turnover: { shopee: everyMonth(10_000_000) } }));

    expect(report.nppn[0]).not.toHaveProperty('taxMinor');
  });

  it('keeps the two schemes apart when the owner runs both', () => {
    const report = businessIncomeFor(
      input({ sources: [source(), affiliate], turnover: { warung: everyMonth(100_000_000), shopee: everyMonth(10_000_000) } }),
    );

    expect(report.umkm).toHaveLength(1);
    expect(report.nppn).toHaveLength(1);
  });
});
