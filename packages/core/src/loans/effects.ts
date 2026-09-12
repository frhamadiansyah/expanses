import { roundHalfAwayFromZero } from '../money/money';
import { annuityPaymentMinor, type LoanTerms, loanSchedule, type RatePeriod, type ScheduleRow } from './schedule';

export interface ExtraPayment {
  amountMinor: number;
  onDate: string;
  /** Once, or the same amount every month from that date. */
  repeat: 'once' | 'monthly';
  /** Keep paying the same and finish sooner, or pay less over the same tenor. */
  keep: 'payment' | 'tenor';
  /** What the bank charges for paying early, as a share of the amount. */
  penaltyBps?: number;
}

export interface ExtraPaymentEffect {
  interestSavedMinor: number;
  monthsEarlier: number;
  /** The new payment when the tenor is kept instead of shortened; null when it is not. */
  newPaymentMinor: number | null;
  /** The month it now finishes, as YYYY-MM. */
  payoffMonth: string;
  penaltyMinor: number;
}

const BPS = 10_000;
const MONTHS_IN_YEAR = 12;

const interestOf = (rows: ScheduleRow[]): number => rows.reduce((total, row) => total + row.interestMinor, 0);
const monthOfRow = (rows: ScheduleRow[]): string => rows.at(-1)?.onDate.slice(0, 7) ?? '';

/**
 * What paying extra off the principal does: how much interest it saves, how much sooner the loan
 * ends, and — when the tenor is kept instead — what the payment becomes. Nothing is written; this
 * is the figure shown beside the form before the owner decides.
 */
export function extraPaymentEffect(
  balanceMinor: number,
  terms: LoanTerms,
  periods: RatePeriod[],
  fromDate: string,
  extra: ExtraPayment,
): ExtraPaymentEffect {
  const asIs = loanSchedule(balanceMinor, terms, periods, fromDate);
  const penaltyMinor = extra.penaltyBps ? roundHalfAwayFromZero((extra.amountMinor * extra.penaltyBps) / BPS) : 0;
  if (!(extra.amountMinor > 0) || asIs.length === 0) {
    return { interestSavedMinor: 0, monthsEarlier: 0, newPaymentMinor: null, payoffMonth: monthOfRow(asIs), penaltyMinor: 0 };
  }

  if (extra.keep === 'tenor') {
    // The same number of months, against a smaller balance: the payment falls instead.
    const left = Math.max(0, balanceMinor - extra.amountMinor);
    const rateBps = periods.find((period) => period.fromOn <= extra.onDate)?.rateBps ?? periods[0]?.rateBps ?? 0;
    const withLess = loanSchedule(left, terms, periods, fromDate);
    return {
      interestSavedMinor: interestOf(asIs) - interestOf(withLess),
      monthsEarlier: 0,
      newPaymentMinor: annuityPaymentMinor(left, rateBps, asIs.length),
      payoffMonth: monthOfRow(asIs),
      penaltyMinor,
    };
  }

  // Keeping the payment: walk the same schedule, dropping the extra onto the balance as it falls due.
  const kept = asIs[0]!.paymentMinor;
  const shortened: ScheduleRow[] = [];
  let balance = balanceMinor;
  for (const row of asIs) {
    if (balance <= 0) break;
    const applies = extra.repeat === 'monthly' ? row.onDate >= extra.onDate : row.onDate === extra.onDate;
    // The rate this row was built at: its interest over the balance it was charged on.
    const chargedOn = row.balanceMinor + row.principalMinor;
    const rate = chargedOn > 0 ? row.interestMinor / chargedOn : 0;
    const interest = roundHalfAwayFromZero(balance * rate);
    let principal = Math.max(0, kept - interest) + (applies ? extra.amountMinor : 0);
    if (principal > balance) principal = balance;
    balance -= principal;
    shortened.push({ onDate: row.onDate, paymentMinor: principal + interest, principalMinor: principal, interestMinor: interest, balanceMinor: balance });
  }

  return {
    interestSavedMinor: interestOf(asIs) - interestOf(shortened),
    monthsEarlier: asIs.length - shortened.length,
    newPaymentMinor: null,
    payoffMonth: monthOfRow(shortened),
    penaltyMinor,
  };
}

/**
 * A flat rate as the effective rate it really is. A flat loan charges interest on the whole
 * original amount every month, though the owner only still owes part of it — so the true cost is
 * close to double what the lender quotes.
 */
export function flatToEffectiveBps(flatBps: number, tenorMonths: number): number {
  if (flatBps === 0 || tenorMonths <= 1) return flatBps;
  const principal = 1_000_000_000;
  const monthlyInterest = (principal * (flatBps / BPS)) / MONTHS_IN_YEAR;
  const monthlyPrincipal = principal / tenorMonths;
  const payment = monthlyPrincipal + monthlyInterest;

  // Find the monthly rate whose annuity payment matches what a flat loan asks for.
  let low = 0;
  let high = 1;
  for (let step = 0; step < 60; step += 1) {
    const mid = (low + high) / 2;
    const factor = (1 + mid) ** tenorMonths;
    const guess = mid === 0 ? principal / tenorMonths : (principal * mid * factor) / (factor - 1);
    if (guess < payment) low = mid;
    else high = mid;
  }
  return Math.round(((low + high) / 2) * MONTHS_IN_YEAR * BPS);
}

/** Warn the owner when onboarding figures disagree by more than this many months. */
export const PAYOFF_TOLERANCE_MONTHS = 2;

/** Months between where the terms say the loan ends and where the schedule says it does. */
export function payoffMismatchMonths(schedule: ScheduleRow[], terms: LoanTerms): number {
  const last = schedule.at(-1);
  if (!last) return 0;
  const [endYear, endMonth] = last.onDate.split('-').map(Number);
  const [firstYear, firstMonth] = terms.firstPaymentOn.split('-').map(Number);
  const scheduled = (endYear! - firstYear!) * MONTHS_IN_YEAR + (endMonth! - firstMonth!) + 1;
  return Math.abs(terms.tenorMonths - scheduled);
}
