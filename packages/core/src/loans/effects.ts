import { roundHalfAwayFromZero } from '../money/money';
import { annuityPaymentMinor, type LoanTerms, loanSchedule, type RatePeriod, type ScheduleRow } from './schedule';

export interface ExtraPayment {
  amountMinor: number;
  onDate: string;
  /**
   * Once, on the first instalment on or after `onDate`; the same amount on that instalment and every twelfth one
   * after it; or on every instalment from it.
   */
  repeat: 'once' | 'yearly' | 'monthly';
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

  // The instalments the extra lands on: the first on or after its date, then every twelfth or every one after it.
  const first = asIs.findIndex((row) => row.onDate >= extra.onDate);
  const lands = (index: number): boolean => {
    if (first < 0 || index < first) return false;
    if (extra.repeat === 'monthly') return true;
    if (extra.repeat === 'yearly') return (index - first) % MONTHS_IN_YEAR === 0;
    return index === first;
  };
  // The rate a row was built at: its interest over the balance it was charged on.
  const rateOf = (row: ScheduleRow): number => {
    const chargedOn = row.balanceMinor + row.principalMinor;
    return chargedOn > 0 ? row.interestMinor / chargedOn : 0;
  };

  if (extra.keep === 'tenor' && extra.repeat === 'once') {
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

  if (extra.keep === 'tenor') {
    // A repeating extra over the same months: each one comes off the balance, and the payment is worked out again
    // over the months still left. The figure reported is the payment after the first extra.
    const lowered: ScheduleRow[] = [];
    let balance = balanceMinor;
    let payment = asIs[0]!.paymentMinor;
    let newPaymentMinor: number | null = null;
    for (const [index, row] of asIs.entries()) {
      if (balance <= 0) break;
      const rate = rateOf(row);
      if (lands(index)) {
        balance = Math.max(0, balance - extra.amountMinor);
        payment = annuityPaymentMinor(balance, Math.round(rate * MONTHS_IN_YEAR * BPS), asIs.length - index);
        newPaymentMinor ??= payment;
        if (balance <= 0) break;
      }
      const interest = roundHalfAwayFromZero(balance * rate);
      let principal = Math.max(0, payment - interest);
      if (principal > balance || index === asIs.length - 1) principal = balance;
      balance -= principal;
      lowered.push({ onDate: row.onDate, paymentMinor: principal + interest, principalMinor: principal, interestMinor: interest, balanceMinor: balance });
    }
    return {
      interestSavedMinor: interestOf(asIs) - interestOf(lowered),
      monthsEarlier: asIs.length - lowered.length,
      newPaymentMinor,
      payoffMonth: monthOfRow(lowered.length > 0 ? lowered : asIs),
      penaltyMinor,
    };
  }

  // Keeping the payment: walk the same schedule, dropping the extra onto the balance as it falls due.
  const kept = asIs[0]!.paymentMinor;
  const shortened: ScheduleRow[] = [];
  let balance = balanceMinor;
  for (const [index, row] of asIs.entries()) {
    if (balance <= 0) break;
    const applies = lands(index);
    const rate = rateOf(row);
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

/** An early-settlement fee as the bank states it: a sum, or a share of what is owed. */
export type SettlementFee = { kind: 'amount'; amountMinor: number } | { kind: 'percent'; bps: number };

export interface PayoffQuote {
  /** The principal the ledger holds today. Interest since the last instalment is not worked out. */
  owedMinor: number;
  feeMinor: number;
  totalMinor: number;
}

/**
 * What paying a loan off today comes to: what is owed, the bank's fee for settling early, and the two together. A fee
 * given as a share is a share of what is owed, rounded to the nearest unit; a fee below nothing is none.
 */
export function payoffQuote(owedMinor: number, fee: SettlementFee | null): PayoffQuote {
  const owed = Math.max(0, owedMinor);
  const raw = !fee ? 0 : fee.kind === 'amount' ? fee.amountMinor : roundHalfAwayFromZero((owed * fee.bps) / BPS);
  const feeMinor = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  return { owedMinor: owed, feeMinor, totalMinor: owed + feeMinor };
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
