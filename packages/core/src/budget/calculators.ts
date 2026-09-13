import { roundHalfAwayFromZero } from '../money/money';

/**
 * What a goal has to be worth. Each calculator answers only "how much", and the goal engine works out
 * the monthly amount from there — `goalPlan` already solves that annuity.
 *
 * Rates are in basis points, as everywhere else. Nothing here uses the 4% rule: it encodes American
 * inflation, and at Indonesian rates it understates the pot badly.
 */

export class CalculatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculatorError';
  }
}

function assertAbove(value: number, zero: number, what: string): void {
  if (!Number.isFinite(value) || value <= zero) throw new CalculatorError(`${what} must be above ${zero}`);
}

/** Months of everything that goes out, which is what the ratio card divides by. */
export function emergencyTargetMinor(months: number, monthlyOutgoingMinor: number): number {
  assertAbove(months, 0, 'The number of months');
  assertAbove(monthlyOutgoingMinor, 0, 'Monthly outgoings');
  return roundHalfAwayFromZero(months * monthlyOutgoingMinor);
}

export interface EducationInputs {
  /** What one year costs at today's prices. */
  feeTodayMinor: number;
  startsInYears: number;
  yearsOfStudy: number;
  feeInflationBps: number;
}

export interface CalculatedStage {
  dueOn: string;
  targetMinor: number;
}

/**
 * One stage per year of study, each inflated to the year it is actually paid — a fourth year costs
 * more than a first, and paying for all four at first-year prices is the usual way to come up short.
 */
export function educationStages(inputs: EducationInputs, today: string): CalculatedStage[] {
  assertAbove(inputs.feeTodayMinor, 0, 'The fee');
  assertAbove(inputs.yearsOfStudy, 0, 'The number of years of study');
  if (inputs.startsInYears < 0) throw new CalculatorError('A course cannot start in the past');
  if (inputs.feeInflationBps < 0) throw new CalculatorError('Fees cannot inflate by less than nothing');

  const inflation = 1 + inputs.feeInflationBps / 10_000;
  const [year, month, day] = today.split('-').map(Number);

  return Array.from({ length: inputs.yearsOfStudy }, (_, index) => {
    const yearsAway = inputs.startsInYears + index;
    const due = new Date(Date.UTC(year! + yearsAway, month! - 1, day!));
    return {
      dueOn: due.toISOString().slice(0, 10),
      targetMinor: roundHalfAwayFromZero(inputs.feeTodayMinor * inflation ** yearsAway),
    };
  });
}

export interface RetirementInputs {
  /** What a year of retirement costs at today's prices. */
  annualSpendTodayMinor: number;
  yearsToRetirement: number;
  yearsInRetirement: number;
  inflationBps: number;
  /** What the pot is expected to earn while it is being drawn down. */
  returnInRetirementBps: number;
}

/**
 * The pot needed on the day you stop, drawn down over the years that follow. The money keeps earning
 * while it is spent, so the pot is smaller than the years times the spending — but only by however
 * much the return beats inflation, which in rupiah is often nothing at all.
 */
export function retirementTargetMinor(inputs: RetirementInputs): number {
  assertAbove(inputs.annualSpendTodayMinor, 0, 'Annual spending');
  assertAbove(inputs.yearsInRetirement, 0, 'The number of years in retirement');
  if (inputs.yearsToRetirement < 0) throw new CalculatorError('Retirement cannot be in the past');

  const inflation = 1 + inputs.inflationBps / 10_000;
  const spendAtRetirement = inputs.annualSpendTodayMinor * inflation ** inputs.yearsToRetirement;
  const real = (1 + inputs.returnInRetirementBps / 10_000) / inflation - 1;

  // Earning exactly what prices do: every year has to be there in full.
  if (Math.abs(real) < 1e-12) return roundHalfAwayFromZero(spendAtRetirement * inputs.yearsInRetirement);
  return roundHalfAwayFromZero((spendAtRetirement * (1 - (1 + real) ** -inputs.yearsInRetirement)) / real);
}
