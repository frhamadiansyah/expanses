import { lifeCoverMinor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { LIFE_COVER_DEFAULTS, lifeCoverInputsOf, lifeCoverPrefill, lifeCoverWorking } from './life-cover-form';

const totals = { liquidMinor: 200_000_000, investMinor: 0, assetsMinor: 900_000_000, liabilitiesMinor: 300_000_000, netWorthMinor: 600_000_000 };
const plan = (kind: string, stages: { state: string; todayMinor: number }[]) => ({ goal: { kind }, stages }) as never;

describe('life cover prefills', () => {
  it('takes debts and liquid assets from the sheet, and education still to fund in today’s money', () => {
    const prefill = lifeCoverPrefill(totals, [
      plan('education', [
        { state: 'paid', todayMinor: 50_000_000 },
        { state: 'saving', todayMinor: 100_000_000 },
        { state: 'later', todayMinor: 50_000_000 },
      ]),
      plan('holiday', [{ state: 'saving', todayMinor: 30_000_000 }]),
    ]);
    expect(prefill).toEqual({ debtsMinor: 300_000_000, liquidAssetsMinor: 200_000_000, educationMinor: 150_000_000, missingRates: [] });
  });

  it('flags a currency with no rate rather than read its accounts as nothing', () => {
    const prefill = lifeCoverPrefill(totals, [], ['USD']);
    expect(prefill).toMatchObject({ debtsMinor: null, liquidAssetsMinor: null, missingRates: ['USD'] });
    const working = lifeCoverWorking({ ...LIFE_COVER_DEFAULTS, annualNeed: '120000000' }, prefill, 'IDR');
    expect(working.result).toBeNull();
    expect(working.problems.debts).toMatch(/USD/);
    expect(working.problems.liquidAssets).toMatch(/USD/);
    // Typed over, the figure is the user's and the answer comes back.
    expect(lifeCoverWorking({ ...LIFE_COVER_DEFAULTS, annualNeed: '120000000', debts: '0', liquidAssets: '0' }, prefill, 'IDR').result).not.toBeNull();
  });

  it('uses what was typed over a prefill, and the prefill where nothing was', () => {
    const inputs = lifeCoverInputsOf(
      { annualNeed: '120.000.000', years: '10', inflation: '3,5', returnPercent: '5', debts: undefined, education: '0', finalExpenses: '25.000.000', liquidAssets: undefined, inForce: '500.000.000' },
      { debtsMinor: 300_000_000, liquidAssetsMinor: 200_000_000, educationMinor: 150_000_000, missingRates: [] },
      'IDR',
    );
    expect(inputs).toEqual({
      annualNeedTodayMinor: 120_000_000,
      yearsOfSupport: 10,
      inflationBps: 350,
      returnBps: 500,
      debtsMinor: 300_000_000,
      educationMinor: 0,
      finalExpensesMinor: 25_000_000,
      liquidAssetsMinor: 200_000_000,
      inForceCoverMinor: 500_000_000,
    });
  });

  it('reads a dollar workspace in cents', () => {
    // parseMajor in USD: "1.200,50" is 120.050 cents; an IDR-style read would make it 120.050 dollars.
    const inputs = lifeCoverInputsOf(
      { annualNeed: '30.000,00', years: '5', inflation: '3,5', returnPercent: '5', debts: '1.200,50', education: undefined, finalExpenses: '', liquidAssets: undefined, inForce: '' },
      { debtsMinor: 0, liquidAssetsMinor: 0, educationMinor: 0, missingRates: [] },
      'USD',
    );
    expect(inputs).toMatchObject({ annualNeedTodayMinor: 3_000_000, debtsMinor: 120_050 });
    expect(lifeCoverMinor(inputs).coverMinor).toBe(14_369_257 + 120_050);
  });

  it('opens on 3.5% inflation, 5% on the payout and ten years', () => {
    expect(LIFE_COVER_DEFAULTS).toMatchObject({ years: '10', inflation: '3.5', returnPercent: '5', debts: undefined, education: undefined, liquidAssets: undefined });
  });

  it('answers the worked example both ways: cover to hold, then a surplus', () => {
    const prefill = { debtsMinor: 0, liquidAssetsMinor: 0, educationMinor: 0, missingRates: [] };
    const draft = { ...LIFE_COVER_DEFAULTS, annualNeed: '120000000', debts: '300000000', education: '150000000', finalExpenses: '25000000', liquidAssets: '200000000', inForce: '500000000' };
    expect(lifeCoverWorking(draft, prefill, 'IDR').result).toMatchObject({ coverMinor: 884_641_927, surplusMinor: 0 });
    expect(lifeCoverWorking({ ...draft, liquidAssets: '2000000000' }, prefill, 'IDR').result).toMatchObject({ coverMinor: 0, surplusMinor: 915_358_073 });
  });

  it('puts each refusal on its own row and never throws, whatever is typed', () => {
    const prefill = { debtsMinor: 0, liquidAssetsMinor: 0, educationMinor: 0, missingRates: [] };
    const bad = lifeCoverWorking({ ...LIFE_COVER_DEFAULTS, annualNeed: '120000000', inflation: '-', returnPercent: '-100', years: '2,5', inForce: '-1' }, prefill, 'IDR');
    expect(bad.result).toBeNull();
    expect(Object.keys(bad.problems).sort()).toEqual(['inForce', 'inflation', 'returnPercent', 'years']);
    const junk = ['', '-', ',', '.', '-100', '1e400', '999999999999999999999', 'x', '0', '2,5', '  '];
    for (const value of junk) {
      for (const field of Object.keys(LIFE_COVER_DEFAULTS) as (keyof typeof LIFE_COVER_DEFAULTS)[]) {
        expect(() => lifeCoverWorking({ ...LIFE_COVER_DEFAULTS, annualNeed: '120000000', [field]: value }, prefill, 'IDR'), `${field}=${value}`).not.toThrow();
      }
    }
  });
});
