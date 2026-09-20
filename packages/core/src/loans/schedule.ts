import { roundHalfAwayFromZero } from '../money/money';

export type LoanMethod = 'annuity' | 'flat' | 'zero';

export interface RatePeriod {
  /** First day this rate applies, as YYYY-MM-DD. */
  fromOn: string;
  rateBps: number;
  kind: 'fixed' | 'floating';
  /** The payment the bank asks for under this rate. 0 means "work it out". */
  paymentMinor: number;
}

export interface LoanTerms {
  originalMinor: number;
  firstPaymentOn: string;
  tenorMonths: number;
  method: LoanMethod;
  /** Day of the month the payment is taken, 1 to 28. */
  paymentDay: number;
}

export interface ScheduleRow {
  onDate: string;
  paymentMinor: number;
  principalMinor: number;
  interestMinor: number;
  /** What is still owed after this payment. */
  balanceMinor: number;
}

const BPS = 10_000;
const MONTHS_IN_YEAR = 12;

const monthlyRate = (rateBps: number): number => rateBps / BPS / MONTHS_IN_YEAR;

/** The nth payment date after the first one, keeping to the payment day. */
function paymentDate(firstPaymentOn: string, paymentDay: number, index: number): string {
  const [year, month] = firstPaymentOn.split('-').map(Number);
  const total = (month! - 1) + index;
  const onYear = year! + Math.floor(total / MONTHS_IN_YEAR);
  const onMonth = (total % MONTHS_IN_YEAR) + 1;
  return `${onYear}-${String(onMonth).padStart(2, '0')}-${String(paymentDay).padStart(2, '0')}`;
}

/** How many payments have already gone by the time we start looking. */
function monthsElapsed(firstPaymentOn: string, fromDate: string): number {
  const [firstYear, firstMonth] = firstPaymentOn.split('-').map(Number);
  const [fromYear, fromMonth] = fromDate.split('-').map(Number);
  const months = (fromYear! - firstYear!) * MONTHS_IN_YEAR + (fromMonth! - firstMonth!);
  return Math.max(0, months);
}

/**
 * The rate period covering a date: the last one that had started by then.
 *
 * A plain `periods.at(-1)` is the latest period however far ahead it begins, so a rate change recorded
 * for next year would make today read as next year's. Every screen that shows "the rate now" wants this.
 */
export function periodOn(periods: RatePeriod[], onDate: string): RatePeriod | undefined {
  const started = periods.filter((period) => period.fromOn <= onDate).sort((a, b) => a.fromOn.localeCompare(b.fromOn));
  return started.at(-1) ?? [...periods].sort((a, b) => a.fromOn.localeCompare(b.fromOn))[0];
}

/**
 * The level payment that clears a balance over this many months at this rate.
 * With no interest it is simply the balance shared out.
 */
export function annuityPaymentMinor(balanceMinor: number, rateBps: number, months: number): number {
  if (months <= 0) return balanceMinor;
  const rate = monthlyRate(rateBps);
  if (rate === 0) return roundHalfAwayFromZero(balanceMinor / months);
  const factor = (1 + rate) ** months;
  return roundHalfAwayFromZero((balanceMinor * rate * factor) / (factor - 1));
}

/**
 * The payments still to come, starting from the balance the ledger holds on `fromDate`.
 * Annuity charges interest on what is left; flat charges it on the original; zero has none.
 * The last row clears whatever remains, so rounding never leaves a few rupiah owing.
 */
export function loanSchedule(balanceMinor: number, terms: LoanTerms, periods: RatePeriod[], fromDate: string): ScheduleRow[] {
  if (balanceMinor <= 0 || terms.tenorMonths <= 0) return [];
  const done = monthsElapsed(terms.firstPaymentOn, fromDate);
  const left = terms.tenorMonths - done;
  if (left <= 0) return [];

  const rows: ScheduleRow[] = [];
  let balance = balanceMinor;
  // A flat loan charges interest on what was borrowed, however much has been repaid since.
  const flatInterest = roundHalfAwayFromZero((terms.originalMinor * monthlyRate(periodOn(periods, terms.firstPaymentOn)?.rateBps ?? 0)));
  const flatPrincipal = roundHalfAwayFromZero(terms.originalMinor / terms.tenorMonths);

  for (let index = 0; index < left && balance > 0; index += 1) {
    const onDate = paymentDate(terms.firstPaymentOn, terms.paymentDay, done + index);
    const period = periodOn(periods, onDate);
    const rateBps = period?.rateBps ?? 0;
    const monthsRemaining = left - index;

    let interestMinor: number;
    let paymentMinor: number;
    if (terms.method === 'zero') {
      interestMinor = 0;
      paymentMinor = roundHalfAwayFromZero(balance / monthsRemaining);
    } else if (terms.method === 'flat') {
      interestMinor = flatInterest;
      paymentMinor = flatPrincipal + flatInterest;
    } else {
      interestMinor = roundHalfAwayFromZero(balance * monthlyRate(rateBps));
      // The bank's own figure wins while it stands; otherwise the payment that clears what is left.
      paymentMinor = period?.paymentMinor && period.paymentMinor > 0 ? period.paymentMinor : annuityPaymentMinor(balance, rateBps, monthsRemaining);
    }

    let principalMinor = paymentMinor - interestMinor;
    // The last payment, and any payment that would overshoot, clears exactly what is left.
    if (principalMinor >= balance || index === left - 1) {
      principalMinor = balance;
      paymentMinor = principalMinor + interestMinor;
    }
    balance -= principalMinor;
    rows.push({ onDate, paymentMinor, principalMinor, interestMinor, balanceMinor: balance });
  }
  return rows;
}
