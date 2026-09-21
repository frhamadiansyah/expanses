import { describe, expect, it } from 'vitest';
import { CalculatorError, educationFromV1, type EducationPlanInputs, educationPlanStages, type Goal, goalPlan, levelStartsOn } from '../src/index';

const fee = (id: string, amountTodayMinor: number, charged: 'once' | 'yearly') => ({ id, name: id, amountTodayMinor, charged });
const primary = (overrides = {}) => ({
  id: 'primary', name: 'Primary School', startAge: null, untilAge: null, startYear: 2032, untilYear: 2038,
  fees: [fee('Enrollment', 45_000_000, 'once'), fee('Academic', 20_000_000, 'yearly')], returnBps: null, ...overrides,
});
const plan = (levels: EducationPlanInputs['levels'], birthday: string | null = null): EducationPlanInputs => ({ version: 2, birthday, feeInflationBps: 1200, levels });

describe('a level’s years', () => {
  it('puts a once fee in the first year only and a yearly fee in every year, in today’s money', () => {
    const stages = educationPlanStages(plan([primary()]), '2026-01-01');
    expect(stages.map((stage) => stage.targetTodayMinor)).toEqual([65_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000]);
    expect(stages.map((stage) => stage.dueOn)).toEqual(['2032-01-01', '2033-01-01', '2034-01-01', '2035-01-01', '2036-01-01', '2037-01-01']);
    expect(stages[0]).toMatchObject({ key: 'primary:0', name: 'Primary School · year 1' });
  });

  it('comes to the mockup’s figure once the goal engine inflates each year to its own date', () => {
    const stages = educationPlanStages(plan([primary()]), '2026-01-01');
    const goal: Goal = {
      id: 'g', name: 'Aisha', kind: 'education', rank: 0, growthBps: 1200, returnBps: 800, standingMonthlyMinor: 0, standingNote: null,
      stages: stages.map((stage) => ({ id: stage.key, name: stage.name, targetMinor: stage.targetTodayMinor, targetMonths: null, dueOn: stage.dueOn, paidOn: null })),
    };
    // 88.822.021 for the once fee plus 320.358.885 for six yearly fees. Pricing all six at the first year's
    // price, as the workbook does, gives 325.680.745.
    expect(goalPlan(goal, [], 0, 0, '2026-01-01').totalTargetMinor).toBe(409_180_906);
  });

  it('dates years by the child’s birthday when there is one', () => {
    const stages = educationPlanStages(plan([primary({ startAge: 6, untilAge: 8, startYear: null, untilYear: null })], '2020-07-15'), '2026-01-01');
    expect(stages.map((stage) => stage.dueOn)).toEqual(['2026-07-15', '2027-07-15']);
    expect(levelStartsOn(primary({ startAge: 6, untilAge: 8, startYear: null, untilYear: null }), '2020-07-15')).toBe('2026-07-15');
  });

  it('with no birthday, starts a level on 1 January of its first year', () => {
    expect(levelStartsOn(primary(), null)).toBe('2032-01-01');
  });

  it('prefills a level’s return from the band for the months until it starts, unless one was chosen', () => {
    expect(educationPlanStages(plan([primary()]), '2026-01-01')[0]!.returnBps).toBe(800); // 72 months
    expect(educationPlanStages(plan([primary({ startYear: 2028, untilYear: 2029 })]), '2026-01-01')[0]!.returnBps).toBe(500); // 24 months
    expect(educationPlanStages(plan([primary({ returnBps: 450 })]), '2026-01-01')[0]!.returnBps).toBe(450);
  });

  it('gives every year of a level the return of the level, read at its start', () => {
    const returns = educationPlanStages(plan([primary({ startYear: 2028, untilYear: 2032 })]), '2026-01-01').map((stage) => stage.returnBps);
    expect(returns).toEqual([500, 500, 500, 500]);
  });

  it('leaves out a year with nothing to pay, and names a one-year level plainly', () => {
    const onceOnly = educationPlanStages(plan([primary({ fees: [fee('Enrollment', 45_000_000, 'once')] })]), '2026-01-01');
    expect(onceOnly.map((stage) => [stage.key, stage.targetTodayMinor])).toEqual([['primary:0', 45_000_000]]);
    expect(educationPlanStages(plan([primary({ untilYear: 2033 })]), '2026-01-01')[0]!.name).toBe('Primary School');
  });

  it('raises the total when a level is added, leaving the first level’s stages and keys as they were', () => {
    const one = educationPlanStages(plan([primary()]), '2026-01-01');
    const two = educationPlanStages(plan([primary(), { ...primary(), id: 'middle', name: 'Middle School', startYear: 2038, untilYear: 2041 }]), '2026-01-01');
    expect(two.slice(0, one.length)).toEqual(one);
    expect(two.length).toBe(one.length + 3);
  });

  it('refuses a level that ends before it starts, or has nothing to pay', () => {
    expect(() => educationPlanStages(plan([primary({ untilYear: 2032 })]), '2026-01-01')).toThrow(CalculatorError);
    expect(() => educationPlanStages(plan([primary({ fees: [] })]), '2026-01-01')).toThrow(CalculatorError);
    expect(() => educationPlanStages(plan([primary({ startAge: 6, untilAge: 12, startYear: null, untilYear: null })], null), '2026-01-01')).toThrow(/birthday/);
  });

  it('refuses part of a year, a fee below nothing, and two levels with one id', () => {
    expect(() => educationPlanStages(plan([primary({ startYear: 2032.5 })]), '2026-01-01')).toThrow(CalculatorError);
    expect(() => educationPlanStages(plan([primary({ fees: [fee('Academic', -1, 'yearly'), fee('Other', 5, 'once')] })]), '2026-01-01')).toThrow(CalculatorError);
    expect(() => educationPlanStages(plan([primary(), primary({ startYear: 2038, untilYear: 2041 })]), '2026-01-01')).toThrow(CalculatorError);
  });

  it('refuses a level set by age that ends before it starts, rather than silently make no stages', () => {
    const sameAge = primary({ startAge: 8, untilAge: 8, startYear: null, untilYear: null });
    expect(() => educationPlanStages(plan([sameAge], '2020-07-15'), '2026-01-01')).toThrow(CalculatorError);
  });

  it('refuses a starting age below nothing', () => {
    const negativeAge = primary({ startAge: -1, untilAge: 5, startYear: null, untilYear: null });
    expect(() => educationPlanStages(plan([negativeAge], '2020-07-15'), '2026-01-01')).toThrow(CalculatorError);
  });

  it('refuses a level with no start and no end at all', () => {
    const nothingSet = primary({ startAge: null, untilAge: null, startYear: null, untilYear: null });
    expect(() => educationPlanStages(plan([nothingSet]), '2026-01-01')).toThrow(CalculatorError);
  });

  it('refuses fees that inflate by less than nothing', () => {
    expect(() => educationPlanStages({ ...plan([primary()]), feeInflationBps: -1 }, '2026-01-01')).toThrow(CalculatorError);
  });

  it('refuses a working with no level at all', () => {
    expect(() => educationPlanStages(plan([]), '2026-01-01')).toThrow(CalculatorError);
  });

  it('refuses a birthday that does not parse, as a CalculatorError rather than a raw RangeError', () => {
    const byAge = primary({ startAge: 5, untilAge: 6, startYear: null, untilYear: null });
    expect(() => educationPlanStages(plan([byAge], 'not-a-date'), '2026-01-01')).toThrow(CalculatorError);
    expect(() => educationPlanStages(plan([byAge], '2021-02-30'), '2026-01-01')).toThrow(CalculatorError); // February has no 30th.
  });

  it('rolls a 29 February birthday to 1 March when the year it falls due is not a leap year', () => {
    // 2020 is a leap year; the child turns 10 in 2030, which is not — documented here, not silently rolled.
    const byAge = primary({ startAge: 10, untilAge: 11, startYear: null, untilYear: null });
    const stages = educationPlanStages(plan([byAge], '2020-02-29'), '2026-01-01');
    expect(stages[0]!.dueOn).toBe('2030-03-01');
  });
});

describe('a working from before levels', () => {
  it('becomes one yearly-fee level in calendar years from the day it was worked out', () => {
    expect(educationFromV1({ feeTodayMinor: 100_000_000, startsInYears: 10, yearsOfStudy: 4, feeInflationBps: 1000 }, '2026-09-13')).toEqual({
      version: 2,
      birthday: null,
      feeInflationBps: 1000,
      levels: [{ id: 'course', name: 'Course', startAge: null, untilAge: null, startYear: 2036, untilYear: 2040, returnBps: null, fees: [{ id: 'fee', name: 'Fee', amountTodayMinor: 100_000_000, charged: 'yearly' }] }],
    });
  });

  it('rounds a part year, unlike v1’s own Date.UTC, which truncated it', () => {
    // Math.round(2.5) = 3, so 2026 + 3 = 2029 — not the 2028 that Math.floor (v1's own Date.UTC coercion)
    // would give. Math.round(3.5) = 4, so the course runs 2029..2033, not 2028..2032.
    const plan = educationFromV1({ feeTodayMinor: 100_000_000, startsInYears: 2.5, yearsOfStudy: 3.5, feeInflationBps: 1000 }, '2026-09-13');
    expect(plan.levels[0]!.startYear).toBe(2029);
    expect(plan.levels[0]!.untilYear).toBe(2033);
  });
});
