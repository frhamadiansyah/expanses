import { assumedReturnBps } from '../goals/assumptions';
import { monthsUntil } from '../goals/plan';
import { CalculatorError, type EducationInputs } from './calculators';

export type FeeCharge = 'once' | 'yearly';

export interface EducationFee {
  id: string;
  name: string;
  amountTodayMinor: number;
  /** Load-bearing: a once fee is paid in the level's first year only; a yearly fee in every year of it. */
  charged: FeeCharge;
}

export interface EducationLevel {
  id: string;
  name: string;
  /** Ages against the goal's birthday — or, with no birthday, calendar years. Never "in N years", which goes stale. */
  startAge: number | null;
  untilAge: number | null;
  startYear: number | null;
  untilYear: number | null;
  fees: EducationFee[];
  /** Chosen for this level; null follows the band for the months until it starts. */
  returnBps: number | null;
}

export interface EducationPlanInputs {
  version: 2;
  birthday: string | null;
  feeInflationBps: number;
  levels: EducationLevel[];
}

export interface EducationStage {
  /** `${levelId}:${index of the year}` — how a re-worked goal finds the same stage, and its paid mark, again. */
  key: string;
  levelId: string;
  name: string;
  dueOn: string;
  /** In today's money: the goal engine inflates it to `dueOn` at the goal's growth. */
  targetTodayMinor: number;
  returnBps: number;
}

export const OFFERED_LEVELS = ['Preschool', 'Primary School', 'Middle School', 'High School', 'University'] as const;
export const DEFAULT_FEES: readonly { name: string; charged: FeeCharge }[] = [
  { name: 'Enrollment', charged: 'once' },
  { name: 'Academic', charged: 'yearly' },
  { name: 'Other', charged: 'once' },
];

const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);

function whole(value: number, what: string): number {
  if (!Number.isInteger(value)) throw new CalculatorError(`${what} is a whole number`);
  return value;
}

/**
 * `Date.UTC` and `toISOString` are silent about a birthday that does not parse — the first gives `NaN`,
 * which is only Invalid Date, and the second throws a bare `RangeError` no calculator caller catches.
 * So the birthday is checked here, by round-trip: a real calendar date reads back exactly as typed.
 */
function parsedBirthday(birthday: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  if (!match) throw new CalculatorError("The child's birthday is not a date");
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !== birthday) {
    throw new CalculatorError("The child's birthday is not a date");
  }
  return { y, m, d };
}

function span(level: EducationLevel, birthday: string | null): { first: string; years: number; dueOf: (i: number) => string } {
  if (level.startAge !== null && level.untilAge !== null) {
    if (!birthday) throw new CalculatorError(`${level.name} is set by age, which needs the child's birthday`);
    const { y, m, d } = parsedBirthday(birthday);
    const startAge = whole(level.startAge, `${level.name}'s starting age`);
    const years = whole(level.untilAge, `${level.name}'s last age`) - startAge;
    if (startAge < 0 || years < 1) throw new CalculatorError(`${level.name} has to end after it starts`);
    // Year i is due on the day the child turns start age + i.
    const dueOf = (i: number) => iso(y + startAge + i, m, d);
    return { first: dueOf(0), years, dueOf };
  }
  if (level.startYear === null || level.untilYear === null) throw new CalculatorError(`${level.name} needs a start and an end`);
  const startYear = whole(level.startYear, `${level.name}'s first year`);
  const years = whole(level.untilYear, `${level.name}'s last year`) - startYear;
  if (years < 1) throw new CalculatorError(`${level.name} has to end after it starts`);
  // With no birthday, a level's year falls on 1 January — the level's row says so.
  const dueOf = (i: number) => iso(startYear + i, 1, 1);
  return { first: dueOf(0), years, dueOf };
}

/** The day a level's first year is due: the birthday it starts at, or 1 January of its first year. */
export function levelStartsOn(level: EducationLevel, birthday: string | null): string {
  return span(level, birthday).first;
}

/**
 * One stage per year of each level, in today's money; a year with nothing to pay is not a stage. The goal engine
 * inflates each to its own date at the goal's fee inflation — never inflated here, so never twice.
 */
export function educationPlanStages(inputs: EducationPlanInputs, today: string): EducationStage[] {
  if (inputs.feeInflationBps < 0) throw new CalculatorError('Fees cannot inflate by less than nothing');
  if (inputs.levels.length === 0) throw new CalculatorError('Add a level to work out');
  if (new Set(inputs.levels.map((level) => level.id)).size !== inputs.levels.length) throw new CalculatorError('Two levels cannot share one id');
  return inputs.levels.flatMap((level) => {
    if (level.fees.some((fee) => !Number.isSafeInteger(fee.amountTodayMinor) || fee.amountTodayMinor < 0)) {
      throw new CalculatorError(`A fee of ${level.name} is not an amount`);
    }
    const once = level.fees.filter((fee) => fee.charged === 'once').reduce((total, fee) => total + fee.amountTodayMinor, 0);
    const yearly = level.fees.filter((fee) => fee.charged === 'yearly').reduce((total, fee) => total + fee.amountTodayMinor, 0);
    if (once + yearly <= 0) throw new CalculatorError(`${level.name} has nothing to pay`);
    const { first, years, dueOf } = span(level, inputs.birthday);
    const returnBps = level.returnBps ?? assumedReturnBps(monthsUntil(today, first));
    return Array.from({ length: years }, (_, i) => ({
      key: `${level.id}:${i}`,
      levelId: level.id,
      name: years > 1 ? `${level.name} · year ${i + 1}` : level.name,
      dueOn: dueOf(i),
      targetTodayMinor: yearly + (i === 0 ? once : 0),
      returnBps,
    })).filter((stage) => stage.targetTodayMinor > 0);
  });
}

/**
 * A working from before levels existed: one course, in calendar years counted from the day it was worked out. The
 * goal's own return, when given, becomes the course's typed return — a saved return is never rewritten (spec §8), and
 * a typed return is one the bands leave alone.
 */
export function educationFromV1(v1: EducationInputs, computedOn: string, goalReturnBps: number | null = null): EducationPlanInputs {
  const startYear = Number(computedOn.slice(0, 4)) + Math.round(v1.startsInYears);
  return {
    version: 2,
    birthday: null,
    feeInflationBps: v1.feeInflationBps,
    levels: [
      {
        id: 'course',
        name: 'Course',
        startAge: null,
        untilAge: null,
        startYear,
        untilYear: startYear + Math.round(v1.yearsOfStudy),
        returnBps: goalReturnBps,
        fees: [{ id: 'fee', name: 'Fee', amountTodayMinor: v1.feeTodayMinor, charged: 'yearly' }],
      },
    ],
  };
}
