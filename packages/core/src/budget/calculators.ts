import { futureValueMinor, monthlyNeededMinor } from '../goals/plan';
import { divRound } from '../assets/units';
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

/** A figure outside the safe-integer range has already lost precision — refuse it rather than show it. */
function assertSafe(value: number, what: string): number {
  if (!Number.isSafeInteger(value)) throw new CalculatorError(`${what} is too large to work out exactly`);
  return value;
}

/** Months of everything that goes out, which is what the ratio card divides by. */
export function emergencyTargetMinor(months: number, monthlyOutgoingMinor: number): number {
  assertAbove(months, 0, 'The number of months');
  assertAbove(monthlyOutgoingMinor, 0, 'Monthly outgoings');
  return roundHalfAwayFromZero(months * monthlyOutgoingMinor);
}

/** A one-course education working from before levels existed (v1). Only `educationFromV1` reads it now. */
export interface EducationInputs {
  /** What one year costs at today's prices. */
  feeTodayMinor: number;
  startsInYears: number;
  yearsOfStudy: number;
  feeInflationBps: number;
}

/**
 * The annuity of a yearly amount in today's money, at the real rate: what a pot must hold to pay it for `years`.
 *
 * Exact, not floating point. The real growth factor is R ÷ I (R = 10000 + return bps, I = 10000 + inflation bps), so
 * Σ_{k=1}^{n} (I/R)^k = I·(Rⁿ − Iⁿ) ÷ (Rⁿ·(R − I)); multiplied by the amount and divided once, in BigInt, with
 * `divRound` (half away from zero). Each year is drawn at its end, as the old retirementTargetMinor assumed.
 */
export function presentValueOfYearsMinor(annualTodayMinor: number, years: number, inflationBps: number, returnBps: number): number {
  if (!Number.isSafeInteger(annualTodayMinor)) throw new CalculatorError('An amount is a whole number of minor units');
  if (!Number.isInteger(years) || years < 0) throw new CalculatorError('Years are whole years, not below nothing');
  if (!Number.isInteger(inflationBps) || !Number.isInteger(returnBps)) throw new CalculatorError('Rates are whole basis points');
  if (inflationBps <= -10_000 || returnBps <= -10_000) throw new CalculatorError('A rate cannot take away everything');
  if (years === 0) return 0;
  const i = 10_000n + BigInt(inflationBps);
  const r = 10_000n + BigInt(returnBps);
  const amount = BigInt(annualTodayMinor);
  // Earning exactly what prices do: every year has to be there in full.
  if (i === r) return assertSafe(Number(amount * BigInt(years)), 'The pot');
  const n = BigInt(years);
  let numerator = amount * i * (r ** n - i ** n);
  let denominator = r ** n * (r - i);
  // A return below inflation makes both halves negative; divRound wants the denominator above zero.
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  return assertSafe(Number(divRound(numerator, denominator)), 'The pot');
}

export interface RetirementInputs {
  version?: 2;
  /** What a year of retirement costs at today's prices. */
  annualSpendTodayMinor: number;
  yearsToRetirement: number;
  /** Whole years: the drawdown annuity is exact only for whole years. */
  yearsInRetirement: number;
  inflationBps: number;
  /** What the pot is expected to earn while it is being drawn down. */
  returnInRetirementBps: number;
  /** What the money earns while you are still saving it. Written as the goal's return. */
  returnBeforeBps?: number;
}

function checkRetirement(inputs: RetirementInputs): void {
  assertAbove(inputs.annualSpendTodayMinor, 0, 'Annual spending');
  assertAbove(inputs.yearsInRetirement, 0, 'The number of years in retirement');
  if (inputs.yearsToRetirement < 0) throw new CalculatorError('Retirement cannot be in the past');
}

/**
 * The pot needed on the day you stop, in today's money, drawn down over the years that follow. The money keeps
 * earning while it is spent, so the pot is smaller than the years times the spending — but only by however much
 * the return beats inflation. The goal engine inflates it to the day you stop.
 */
export function retirementTodayMinor(inputs: RetirementInputs): number {
  checkRetirement(inputs);
  return presentValueOfYearsMinor(inputs.annualSpendTodayMinor, inputs.yearsInRetirement, inputs.inflationBps, inputs.returnInRetirementBps);
}

/**
 * The same pot in the money of the day you stop — for showing, never for storing in a stage. Inflated by the goal
 * engine's own reader, so the Calculators page shows exactly what the goal will.
 */
export function retirementTargetMinor(inputs: RetirementInputs): number {
  return futureValueMinor(retirementTodayMinor(inputs), inputs.inflationBps, Math.round(inputs.yearsToRetirement * 12));
}

export interface LifeCoverInputs {
  /** What the family would need each year, at today's prices. */
  annualNeedTodayMinor: number;
  /** Whole years. */
  yearsOfSupport: number;
  inflationBps: number;
  /** What the payout earns while it is spent down. */
  returnBps: number;
  debtsMinor: number;
  educationMinor: number;
  finalExpensesMinor: number;
  liquidAssetsMinor: number;
  inForceCoverMinor: number;
}

export interface LifeCover {
  incomeNeedMinor: number;
  needsMinor: number;
  resourcesMinor: number;
  /** Never below nothing: when resources exceed needs, this is 0 and `surplusMinor` says by how much. */
  coverMinor: number;
  surplusMinor: number;
}

/**
 * Capital needs analysis: every need at death, minus what is already there. Debts are added and assets taken off
 * inside the method, once — never again afterwards, and never the lowest of several methods. Summed signed, then
 * clamped.
 */
export function lifeCoverMinor(inputs: LifeCoverInputs): LifeCover {
  const amounts = [
    inputs.annualNeedTodayMinor,
    inputs.debtsMinor,
    inputs.educationMinor,
    inputs.finalExpensesMinor,
    inputs.liquidAssetsMinor,
    inputs.inForceCoverMinor,
  ];
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) throw new CalculatorError('Amounts are whole minor units, not below nothing');
  if (!Number.isInteger(inputs.yearsOfSupport) || inputs.yearsOfSupport < 0) throw new CalculatorError('Years of support are whole years, not below nothing');
  const incomeNeedMinor = presentValueOfYearsMinor(inputs.annualNeedTodayMinor, inputs.yearsOfSupport, inputs.inflationBps, inputs.returnBps);
  const needsMinor = assertSafe(incomeNeedMinor + inputs.debtsMinor + inputs.educationMinor + inputs.finalExpensesMinor, 'What is needed');
  const resourcesMinor = assertSafe(inputs.liquidAssetsMinor + inputs.inForceCoverMinor, 'What is already there');
  const gap = needsMinor - resourcesMinor;
  return { incomeNeedMinor, needsMinor, resourcesMinor, coverMinor: Math.max(0, gap), surplusMinor: Math.max(0, -gap) };
}

export interface SavingPlanInput {
  targetMinor: number;
  /** What is already put aside for this, which keeps earning until the money is needed. */
  alreadySavedMinor: number;
  returnBps: number;
  months: number;
}

export interface SavingPlan {
  /** What still has to be found, after what you hold has grown. */
  gapMinor: number;
  monthlyMinor: number;
}

/**
 * What a target costs a month: the gap left after what you already hold has grown to the day it is
 * needed, spread over the months while the payments themselves earn the same rate.
 *
 * The same annuity `goalPlan` uses, exposed for a calculator answering the question without a goal.
 */
export function savingPlanFor(input: SavingPlanInput): SavingPlan {
  assertAbove(input.months, 0, 'The number of months');
  if (input.targetMinor < 0 || input.alreadySavedMinor < 0) throw new CalculatorError('Amounts cannot be below nothing');

  const grown = futureValueMinor(input.alreadySavedMinor, input.returnBps, input.months);
  const gapMinor = Math.max(0, input.targetMinor - grown);
  return { gapMinor, monthlyMinor: monthlyNeededMinor(gapMinor, input.returnBps, input.months) };
}
