import { describe, expect, it } from 'vitest';
import { CalculatorError, educationStages, emergencyTargetMinor, retirementTargetMinor, savingPlanFor } from '../src/index';

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

describe('education', () => {
  const inputs = { feeTodayMinor: 100_000_000, startsInYears: 10, yearsOfStudy: 4, feeInflationBps: 1000 };

  it('gives each year of study its own stage', () => {
    expect(educationStages(inputs, TODAY)).toHaveLength(4);
  });

  it('inflates each year to the year it falls due, not to the first one', () => {
    const stages = educationStages(inputs, TODAY);

    expect(stages[0]!.targetMinor).toBe(Math.round(100_000_000 * 1.1 ** 10));
    expect(stages[3]!.targetMinor).toBe(Math.round(100_000_000 * 1.1 ** 13));
    expect(stages[3]!.targetMinor).toBeGreaterThan(stages[0]!.targetMinor);
  });

  it('dates the stages a year apart, from when the course starts', () => {
    const stages = educationStages(inputs, TODAY);

    expect(stages[0]!.dueOn).toBe('2036-09-13');
    expect(stages[3]!.dueOn).toBe('2039-09-13');
  });

  it('leaves the fee alone when nothing is expected to inflate', () => {
    expect(educationStages({ ...inputs, feeInflationBps: 0 }, TODAY)[0]!.targetMinor).toBe(100_000_000);
  });

  it('refuses a course that lasts no years, or a fee of nothing', () => {
    expect(() => educationStages({ ...inputs, yearsOfStudy: 0 }, TODAY)).toThrow(CalculatorError);
    expect(() => educationStages({ ...inputs, feeTodayMinor: 0 }, TODAY)).toThrow(CalculatorError);
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
