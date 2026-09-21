import { describe, expect, it } from 'vitest';
import {
  CalculatorError,
  emergencyTargetMinor,
  futureValueMinor,
  lifeCoverMinor,
  presentValueOfYearsMinor,
  retirementTargetMinor,
  retirementTodayMinor,
  savingPlanFor,
} from '../src/index';

const TODAY = '2026-09-13';

describe('the emergency fund', () => {
  it('is months of what actually goes out', () => {
    expect(emergencyTargetMinor(6, 15_000_000)).toBe(90_000_000);
  });

  it('refuses a number of months that is not one', () => {
    expect(() => emergencyTargetMinor(0, 15_000_000)).toThrow(CalculatorError);
    expect(() => emergencyTargetMinor(-1, 15_000_000)).toThrow(CalculatorError);
  });
});

describe('retirement', () => {
  const inputs = {
    annualSpendTodayMinor: 120_000_000,
    yearsToRetirement: 0,
    yearsInRetirement: 20,
    inflationBps: 500,
    returnInRetirementBps: 500,
  };

  it('is what you spend times the years, when the money only keeps pace with prices', () => {
    // A real return of nothing: every year of retirement must be saved in full.
    expect(retirementTargetMinor(inputs)).toBe(2_400_000_000);
  });

  it('asks for less when the money outgrows prices, because the pot keeps earning', () => {
    const earning = retirementTargetMinor({ ...inputs, returnInRetirementBps: 800 });

    expect(earning).toBeLessThan(2_400_000_000);
    expect(earning).toBeGreaterThan(0);
  });

  it('asks for more when retirement is further off, because prices rise until then', () => {
    const later = retirementTargetMinor({ ...inputs, yearsToRetirement: 20 });

    expect(later).toBe(Math.round(2_400_000_000 * 1.05 ** 20));
  });

  it('does not use the 4% rule, which would ask for 25 years of spending flat', () => {
    // 25x annual spending is 3 milyar here; the drawdown says something else.
    expect(retirementTargetMinor(inputs)).not.toBe(120_000_000 * 25);
  });

  it('refuses a retirement of no years, or spending of nothing', () => {
    expect(() => retirementTargetMinor({ ...inputs, yearsInRetirement: 0 })).toThrow(CalculatorError);
    expect(() => retirementTargetMinor({ ...inputs, annualSpendTodayMinor: 0 })).toThrow(CalculatorError);
  });
});

describe('what it takes a month', () => {
  it('is the gap spread over the months, when the money earns nothing', () => {
    expect(savingPlanFor({ targetMinor: 120_000_000, alreadySavedMinor: 0, returnBps: 0, months: 12 })).toEqual({
      gapMinor: 120_000_000,
      monthlyMinor: 10_000_000,
    });
  });

  it('counts what is already put aside, grown to the day it is needed', () => {
    const plan = savingPlanFor({ targetMinor: 120_000_000, alreadySavedMinor: 50_000_000, returnBps: 1200, months: 12 });

    // 50 juta earning 12% for a year is worth 56 juta by then, so only the rest has to be saved.
    expect(plan.gapMinor).toBe(120_000_000 - 56_000_000);
    expect(plan.monthlyMinor).toBeGreaterThan(0);
  });

  it('asks for nothing when what you hold already covers it', () => {
    expect(savingPlanFor({ targetMinor: 100_000_000, alreadySavedMinor: 200_000_000, returnBps: 500, months: 24 })).toEqual({
      gapMinor: 0,
      monthlyMinor: 0,
    });
  });

  it('refuses a target that is not ahead of you', () => {
    expect(() => savingPlanFor({ targetMinor: 100_000_000, alreadySavedMinor: 0, returnBps: 500, months: 0 })).toThrow(CalculatorError);
  });
});

describe('the one real-rate annuity', () => {
  it('discounts at the real rate: 120 jt a year for 10 years at 3.5% inflation and 5% return', () => {
    expect(presentValueOfYearsMinor(120_000_000, 10, 350, 500)).toBe(1_109_641_927);
  });

  it('is plain years times the amount when the return only keeps pace', () => {
    expect(presentValueOfYearsMinor(120_000_000, 10, 500, 500)).toBe(1_200_000_000);
  });

  it('is nothing for no years', () => {
    expect(presentValueOfYearsMinor(120_000_000, 0, 350, 500)).toBe(0);
  });

  it('refuses part of a year: the exact method is for whole years', () => {
    expect(() => presentValueOfYearsMinor(120_000_000, 10.5, 350, 500)).toThrow(CalculatorError);
  });

  it('discounts at the real rate, not the nominal one or the plain difference', () => {
    // Discounting at the nominal 5% gives 926.608.192; at the plain 1,5% difference, 1.106.662.146 — both wrong.
    expect(presentValueOfYearsMinor(120_000_000, 10, 350, 500)).toBe(1_109_641_927);
    expect(presentValueOfYearsMinor(3_000_000, 5, 350, 500)).toBe(14_369_257);
  });

  it('asks for more than the years times the amount when the return trails prices', () => {
    // A negative real rate: both halves of the fraction are negative, and still rounded once.
    expect(presentValueOfYearsMinor(120_000_000, 10, 500, 350)).toBe(1_299_933_990);
  });

  it('is exact at scale, not a naive float division of the same BigInt halves', () => {
    // Verified independently with fractions.Fraction: the exact value is …157,51, so half away from
    // zero rounds up to …158. A naive float formula, or float division of the exact numerator and
    // denominator, agrees with every other case in this file but not this one.
    expect(presentValueOfYearsMinor(1_000_000_000_000, 24, 350, 500)).toBe(20_148_904_416_158);
  });

  it('refuses an amount that is not a whole number of minor units', () => {
    expect(() => presentValueOfYearsMinor(1.5, 10, 350, 500)).toThrow(CalculatorError);
  });

  it('refuses years below nothing, not just a part of one', () => {
    expect(() => presentValueOfYearsMinor(120_000_000, -1, 350, 500)).toThrow(CalculatorError);
  });

  it('refuses a rate that is not a whole basis point', () => {
    expect(() => presentValueOfYearsMinor(120_000_000, 10, 350.5, 500)).toThrow(CalculatorError);
  });

  it('refuses a rate that takes away everything or more, inflation or return', () => {
    expect(() => presentValueOfYearsMinor(120_000_000, 10, -10_000, 500)).toThrow(CalculatorError);
    expect(() => presentValueOfYearsMinor(120_000_000, 10, 350, -10_000)).toThrow(CalculatorError);
  });

  it('refuses a result too large to hold exactly', () => {
    // Nominal equals real, so the pot is amount × years — 9 triliun for 2.000 years overruns
    // Number.MAX_SAFE_INTEGER, and a silently imprecise figure is worse than a refusal.
    expect(() => presentValueOfYearsMinor(9_000_000_000_000, 2_000, 500, 500)).toThrow(CalculatorError);
  });
});

describe('retirement in today’s money', () => {
  const inputs = { annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 350, returnInRetirementBps: 500 };

  it('is the drawdown annuity of today’s spending', () => {
    expect(retirementTodayMinor(inputs)).toBe(2_070_575_495);
  });

  it('inflated by the goal engine to the day you stop, is the pot the old figure named', () => {
    expect(retirementTargetMinor(inputs)).toBe(4_120_008_061);
    expect(futureValueMinor(retirementTodayMinor(inputs), 350, 240)).toBe(4_120_008_061);
  });

  it('is the figure the goal engine will show, to the minor unit', () => {
    // The old one-step float said 4.800.099.137. The pot is now rounded once in today's money and inflated by
    // futureValueMinor — exactly what goalPlan does to the stored stage — so page and goal agree: 4.800.099.136.
    const other = { ...inputs, inflationBps: 500, returnInRetirementBps: 800 };
    expect(retirementTargetMinor(other)).toBe(4_800_099_136);
    expect(retirementTargetMinor(other)).toBe(futureValueMinor(retirementTodayMinor(other), 500, 240));
  });

  it('ignores returnBeforeBps — the pot is drawn down at the retirement return, not what it earned while saving', () => {
    const withSavingReturn = { ...inputs, returnBeforeBps: 1000 };
    expect(retirementTodayMinor(withSavingReturn)).toBe(2_070_575_495);
    expect(retirementTargetMinor(withSavingReturn)).toBe(4_120_008_061);
  });

  it('rounds a part-year yearsToRetirement to the nearest month, not the floor and not years rounded first', () => {
    // 20,3 years is 243,6 months: rounding first gives 244; flooring gives 243; rounding the years to 20
    // and then multiplying by 12 gives 240. All three disagree, so this discriminates every wrong neighbour.
    const partYear = retirementTargetMinor({ ...inputs, yearsToRetirement: 20.3 });
    expect(partYear).toBe(futureValueMinor(retirementTodayMinor(inputs), inputs.inflationBps, 244));
    expect(partYear).not.toBe(futureValueMinor(retirementTodayMinor(inputs), inputs.inflationBps, 243));
    expect(partYear).not.toBe(futureValueMinor(retirementTodayMinor(inputs), inputs.inflationBps, 240));
  });

  it('refuses retirement set in the past, even before the drawdown pot is worked out', () => {
    expect(() => retirementTodayMinor({ ...inputs, yearsToRetirement: -1 })).toThrow(CalculatorError);
    expect(() => retirementTargetMinor({ ...inputs, yearsToRetirement: -1 })).toThrow(CalculatorError);
  });
});

describe('life cover — capital needs', () => {
  const base = {
    annualNeedTodayMinor: 120_000_000, yearsOfSupport: 10, inflationBps: 350, returnBps: 500,
    debtsMinor: 300_000_000, educationMinor: 150_000_000, finalExpensesMinor: 25_000_000,
    liquidAssetsMinor: 200_000_000, inForceCoverMinor: 500_000_000,
  };

  it('adds every need once and takes every resource off once', () => {
    const cover = lifeCoverMinor(base);
    expect(cover.incomeNeedMinor).toBe(1_109_641_927);
    expect(cover.needsMinor).toBe(1_584_641_927);
    expect(cover.resourcesMinor).toBe(700_000_000);
    // Adding the debts again after the fact, as the workbook did, would say 1_184_641_927.
    expect(cover.coverMinor).toBe(884_641_927);
    expect(cover.surplusMinor).toBe(0);
  });

  it('says no further cover is needed, and by how much, when resources exceed needs', () => {
    const cover = lifeCoverMinor({ ...base, liquidAssetsMinor: 2_000_000_000 });
    expect(cover.coverMinor).toBe(0);
    expect(cover.surplusMinor).toBe(915_358_073);
  });

  it('works in cents', () => {
    expect(lifeCoverMinor({ ...base, annualNeedTodayMinor: 3_000_000, yearsOfSupport: 5, debtsMinor: 0, educationMinor: 0, finalExpensesMinor: 0, liquidAssetsMinor: 0, inForceCoverMinor: 0 }).coverMinor).toBe(14_369_257);
  });

  it('refuses an amount below nothing', () => {
    expect(() => lifeCoverMinor({ ...base, debtsMinor: -1 })).toThrow(CalculatorError);
  });

  it('refuses part of a year of support', () => {
    expect(() => lifeCoverMinor({ ...base, yearsOfSupport: 2.5 })).toThrow(CalculatorError);
  });

  it('refuses a needs sum too large to hold exactly, even though every input on its own is safe', () => {
    expect(() =>
      lifeCoverMinor({
        annualNeedTodayMinor: 0,
        yearsOfSupport: 0,
        inflationBps: 350,
        returnBps: 500,
        debtsMinor: 5_000_000_000_000_000,
        educationMinor: 5_000_000_000_000_000,
        finalExpensesMinor: 0,
        liquidAssetsMinor: 0,
        inForceCoverMinor: 0,
      }),
    ).toThrow(CalculatorError);
  });

  it('refuses a resources sum too large to hold exactly', () => {
    expect(() =>
      lifeCoverMinor({
        annualNeedTodayMinor: 0,
        yearsOfSupport: 0,
        inflationBps: 350,
        returnBps: 500,
        debtsMinor: 0,
        educationMinor: 0,
        finalExpensesMinor: 0,
        liquidAssetsMinor: 5_000_000_000_000_000,
        inForceCoverMinor: 5_000_000_000_000_000,
      }),
    ).toThrow(CalculatorError);
  });
});
