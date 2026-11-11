import { roundHalfAwayFromZero } from '../money/money';
import { type LoanMethod, type LoanTerms, loanSchedule, paymentDate, type RatePeriod, type ScheduleRow } from './schedule';

/**
 * The loan calculator's working: a loan described the way it is quoted — an amount, a way interest is charged, and
 * one or more rate stages ("fixed 5,5% for 3 years, then floating 11%") — turned into the very terms and rate periods
 * a saved loan carries, and its schedule worked out by the same engine the loan's own page uses. So the table a
 * person studies before saving is, to the unit, the table the saved debt then shows.
 */

/** One rate stage: how many months it lasts, its rate in yearly basis points (a rate a month is stored ×12). */
export interface LoanCalcStage {
  months: number;
  rateBps: number;
  kind: 'fixed' | 'floating';
}

export interface LoanCalcInput {
  principalMinor: number;
  method: LoanMethod;
  /** In order; their months add up to the loan's length. A flat loan charges the first stage's rate throughout. */
  stages: readonly LoanCalcStage[];
  firstPaymentOn: string;
  /** Day of the month the payment is taken, 1 to 28. */
  paymentDay: number;
}

const BPS = 10_000;

/** The longest loan worked out: fifty years. Beyond it the payment dates and the annuity factor stop being sound. */
export const MAX_LOAN_MONTHS = 600;
/** The dearest rate worked out, in yearly basis points: 100% a year (a rate a month of about 8,33%). */
export const MAX_LOAN_RATE_BPS = 10_000;

/**
 * The terms and rate periods a saved loan would carry. The first period starts on the first payment — what
 * `saveLoanTerms` writes — and each later one on the first payment of its stage, which is where `periodOn` starts
 * applying it.
 */
export function calculatorLoan(input: LoanCalcInput): { terms: LoanTerms; periods: RatePeriod[] } {
  if (!(Number.isSafeInteger(input.principalMinor) && input.principalMinor > 0)) throw new Error('A loan needs an amount greater than zero');
  if (input.stages.length === 0) throw new Error('A loan needs a rate');
  if (input.stages.some((stage) => !Number.isInteger(stage.months) || stage.months < 1)) throw new Error('Each stage runs for at least one month');
  if (input.stages.some((stage) => !Number.isInteger(stage.rateBps) || stage.rateBps < 0)) throw new Error('A rate cannot be below nothing');
  if (input.stages.some((stage) => stage.rateBps > MAX_LOAN_RATE_BPS)) throw new Error('A rate is at most 100% a year');
  const tenorMonths = input.stages.reduce((total, stage) => total + stage.months, 0);
  if (tenorMonths > MAX_LOAN_MONTHS) throw new Error('A loan runs for at most 50 years');
  const periods: RatePeriod[] = [];
  let start = 0;
  for (const stage of input.stages) {
    periods.push({ fromOn: paymentDate(input.firstPaymentOn, input.paymentDay, start), rateBps: stage.rateBps, kind: stage.kind, paymentMinor: 0 });
    start += stage.months;
  }
  return {
    terms: { originalMinor: input.principalMinor, firstPaymentOn: input.firstPaymentOn, tenorMonths, method: input.method, paymentDay: input.paymentDay },
    periods,
  };
}

/** Every payment, from the first: the loan engine's own schedule of the terms above. */
export function calculatorSchedule(input: LoanCalcInput): ScheduleRow[] {
  const { terms, periods } = calculatorLoan(input);
  return loanSchedule(input.principalMinor, terms, periods, input.firstPaymentOn);
}

/** A stage as the result card names it: months a–b, its rate, and the payment it starts on. */
export interface StageLine {
  /** 1-based, inclusive. */
  fromMonth: number;
  toMonth: number;
  rateBps: number;
  kind: 'fixed' | 'floating';
  paymentMinor: number;
}

export function stageLines(rows: readonly ScheduleRow[], stages: readonly LoanCalcStage[]): StageLine[] {
  const lines: StageLine[] = [];
  let start = 0;
  for (const stage of stages) {
    const first = rows[start];
    if (!first) break;
    const toMonth = Math.min(start + stage.months, rows.length);
    lines.push({ fromMonth: start + 1, toMonth, rateBps: stage.rateBps, kind: stage.kind, paymentMinor: first.paymentMinor });
    start += stage.months;
  }
  return lines;
}

/** The first stage that asks more a month than the one before it: by how much, and by what share in basis points. */
export interface PaymentJump {
  from: StageLine;
  to: StageLine;
  upMinor: number;
  upBps: number;
}

export function paymentJump(lines: readonly StageLine[]): PaymentJump | null {
  for (let index = 1; index < lines.length; index += 1) {
    const from = lines[index - 1]!;
    const to = lines[index]!;
    const upMinor = to.paymentMinor - from.paymentMinor;
    if (upMinor > 0 && from.paymentMinor > 0) return { from, to, upMinor, upBps: roundHalfAwayFromZero((upMinor * BPS) / from.paymentMinor) };
  }
  return null;
}

/** The month (1-based) after which at least half of what was borrowed is repaid; null with nothing scheduled. */
export function halfRepaidMonth(rows: readonly ScheduleRow[], principalMinor: number): number | null {
  const index = rows.findIndex((row) => (principalMinor - row.balanceMinor) * 2 >= principalMinor);
  return index < 0 ? null : index + 1;
}

/** A year of the schedule: what its months paid, and what was left at its end. */
export interface YearRow {
  /** 1-based year of the loan. */
  index: number;
  paymentMinor: number;
  principalMinor: number;
  interestMinor: number;
  balanceMinor: number;
}

export function yearlyRows(rows: readonly ScheduleRow[]): YearRow[] {
  const years: YearRow[] = [];
  rows.forEach((row, month) => {
    const index = Math.floor(month / 12) + 1;
    let year = years.at(-1);
    if (!year || year.index !== index) {
      year = { index, paymentMinor: 0, principalMinor: 0, interestMinor: 0, balanceMinor: row.balanceMinor };
      years.push(year);
    }
    year.paymentMinor += row.paymentMinor;
    year.principalMinor += row.principalMinor;
    year.interestMinor += row.interestMinor;
    year.balanceMinor = row.balanceMinor;
  });
  return years;
}

/**
 * What borrowing really costs a year, as yearly basis points: the monthly rate at which the payments are worth exactly
 * what arrived (the loan less any fee taken at the start), compounded over twelve months. Null when nothing arrived or
 * nothing is paid; 0 when no more than what arrived is paid back.
 */
export function effectiveYearlyCostBps(receivedMinor: number, paymentsMinor: readonly number[]): number | null {
  if (!(receivedMinor > 0) || paymentsMinor.length === 0) return null;
  const total = paymentsMinor.reduce((sum, payment) => sum + payment, 0);
  if (total <= receivedMinor) return 0;
  const worth = (rate: number) => paymentsMinor.reduce((sum, payment, index) => sum + payment / (1 + rate) ** (index + 1), 0);
  let low = 0;
  let high = 1;
  // A rate a month high enough that the payments are worth less than what arrived; doubling finds one.
  while (worth(high) > receivedMinor && high < 1_000) high *= 2;
  for (let step = 0; step < 100; step += 1) {
    const mid = (low + high) / 2;
    if (worth(mid) > receivedMinor) low = mid;
    else high = mid;
  }
  const monthly = (low + high) / 2;
  return Math.round(((1 + monthly) ** 12 - 1) * BPS);
}
