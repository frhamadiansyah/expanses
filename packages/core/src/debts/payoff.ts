import { roundHalfAwayFromZero } from '../money/money';
import { addMonths } from '../reports/periods';
import { type LoanMethod, periodOn, type RatePeriod, type ScheduleRow } from '../loans/schedule';

export type PayoffMethod = 'snowball' | 'avalanche' | 'byHand';
export type PayoffInterest = { kind: 'balance' } | { kind: 'fixed'; minor: number } | { kind: 'none' };

export interface PayoffDebt {
  key: string;
  name: string;
  /** What is owed now, base currency, minor units. Debts at 0 are ignored. */
  balanceMinor: number;
  /** Yearly basis points for month 0, 1, …; the last holds after; [] is 0%. Null: rate unknown (a loan with no terms). */
  ratesBps: readonly number[] | null;
  interest: PayoffInterest;
  /** What its own schedule asks in month 0, 1, …; the month after the last, everything left is due. [] = no schedule. */
  minimumsMinor: readonly number[];
  /** What keeps rolling to other debts each month once this one's schedule has ended. */
  regularMinor: number;
  /** Month index its own months begin; before it nothing accrues and nothing is due. Default 0. */
  firstMonth?: number;
  late: boolean;
  daysLate: number;
}

export interface PayoffOptions {
  /** YYYY-MM of month 0. */
  startMonth: string;
  method: PayoffMethod;
  byHand?: readonly string[];
  extraMinor: number;
  capMonths?: number;
}

export interface PayoffDebtResult {
  key: string;
  endMonth: string | null;
  interestMinor: number;
  paidMinor: number;
}

export interface PayoffPlan {
  order: string[];
  debtFreeMonth: string | null;
  /** Months until nothing is owed, counting month 0 as 1. Null when unknown. */
  months: number | null;
  unknown: null | { reason: 'noRate' | 'neverCleared'; keys: string[] };
  interestMinor: number;
  debts: PayoffDebtResult[];
  /**
   * What is left in all at the end of month 0, 1, … (the same balances the months are worked on, added up), up to the
   * month the last debt clears — or the cap when one never does. Empty when nothing is owed.
   */
  leftByMonth: number[];
}

export interface ExtraEffect {
  plan: PayoffPlan;
  baseline: PayoffPlan;
  interestSavedMinor: number | null;
  monthsSooner: number | null;
}

export interface MethodSuggestion {
  method: 'avalanche' | 'snowball';
  reason: 'ratesDiffer' | 'manySmall' | 'ratesUnknown';
  highestKey?: string;
  lowestKey?: string;
  smallCount?: number;
}

export interface ScheduledLoanInput {
  key: string;
  name: string;
  balanceMinor: number;
  rows: readonly ScheduleRow[];
  method: LoanMethod;
  periods: readonly RatePeriod[];
  startMonth: string;
  late: boolean;
  daysLate: number;
}

export const PAYOFF_CAP_MONTHS = 600;
/** Avalanche is suggested when interest-charging rates are this far apart (yearly bps). */
export const RATE_SPREAD_BPS = 500;
/** A debt is small when it is at most this share of what is left in all (bps). */
export const SMALL_DEBT_SHARE_BPS = 1_000;
export const SMALL_DEBT_COUNT = 3;

const BPS = 10_000;
const MONTHS_IN_YEAR = 12;
// The same expression loanSchedule uses, so a single loan's interest matches its schedule to the unit.
const monthlyRate = (rateBps: number): number => rateBps / BPS / MONTHS_IN_YEAR;

const rateAt = (debt: PayoffDebt, month: number): number | null => {
  if (debt.ratesBps === null) return null;
  if (debt.ratesBps.length === 0) return 0;
  return debt.ratesBps[Math.min(month, debt.ratesBps.length - 1)]!;
};

const currentRate = (debt: PayoffDebt): number | null => rateAt(debt, 0);

const byName = (a: PayoffDebt, b: PayoffDebt) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key);

const snowball = (a: PayoffDebt, b: PayoffDebt) =>
  a.balanceMinor - b.balanceMinor || (currentRate(b) ?? -1) - (currentRate(a) ?? -1) || byName(a, b);

/** Positive rates above unknown ones, unknown above 0%. */
const avalancheRank = (debt: PayoffDebt): number => {
  const rate = currentRate(debt);
  if (rate === null) return 1;
  return rate > 0 ? rate + 1 : 0;
};

const avalanche = (a: PayoffDebt, b: PayoffDebt) => avalancheRank(b) - avalancheRank(a) || a.balanceMinor - b.balanceMinor || byName(a, b);

/** Late debts first (most days late first) in every method; then the method's own order. */
export function payoffOrder(debts: readonly PayoffDebt[], method: PayoffMethod, byHand?: readonly string[]): string[] {
  const late = debts.filter((d) => d.late).sort((a, b) => b.daysLate - a.daysLate || byName(a, b));
  const rest = debts.filter((d) => !d.late);
  let ordered: PayoffDebt[];
  if (method === 'avalanche') ordered = [...rest].sort(avalanche);
  else if (method === 'snowball') ordered = [...rest].sort(snowball);
  else {
    const byKey = new Map(rest.map((d) => [d.key, d]));
    const saved: PayoffDebt[] = [];
    for (const key of byHand ?? []) {
      const debt = byKey.get(key);
      if (debt && !saved.includes(debt)) saved.push(debt);
    }
    const others = rest.filter((d) => !saved.includes(d)).sort(snowball);
    ordered = [...saved, ...others];
  }
  return [...late, ...ordered].map((d) => d.key);
}

interface Running {
  debt: PayoffDebt;
  balance: number;
  interest: number;
  paid: number;
  endIndex: number | null;
}

const minimumFor = (debt: PayoffDebt, month: number, balance: number): number => {
  if (month < debt.minimumsMinor.length) return debt.minimumsMinor[month]!;
  return debt.minimumsMinor.length > 0 ? balance : 0;
};

/**
 * Month by month: each debt accrues and pays its own minimum; then the extra and every cleared debt's freed payment
 * go down the order. Month 0 has no freed money, so nothing already paid this month rolls over.
 */
export function simulatePayoff(debts: readonly PayoffDebt[], options: PayoffOptions): PayoffPlan {
  const active = debts.filter((d) => d.balanceMinor > 0);
  const order = payoffOrder(active, options.method, options.byHand);
  const byKey = new Map(active.map((d) => [d.key, d]));
  const running: Running[] = order.map((key) => ({ debt: byKey.get(key)!, balance: byKey.get(key)!.balanceMinor, interest: 0, paid: 0, endIndex: null }));
  const cap = options.capMonths ?? PAYOFF_CAP_MONTHS;
  const extra = Math.max(0, options.extraMinor);

  const owed = () => running.some((r) => r.balance > 0);
  const leftByMonth: number[] = [];
  for (let m = 0; m < cap && owed(); m += 1) {
    for (const r of running) {
      if (r.balance <= 0 || m < (r.debt.firstMonth ?? 0)) continue;
      let charge = 0;
      if (r.debt.interest.kind === 'fixed') charge = r.debt.interest.minor;
      else if (r.debt.interest.kind === 'balance') {
        const rate = rateAt(r.debt, m);
        charge = rate === null ? 0 : roundHalfAwayFromZero(r.balance * monthlyRate(rate));
      }
      r.balance += charge;
      r.interest += charge;
      const pay = Math.min(Math.max(0, minimumFor(r.debt, m, r.balance)), r.balance);
      r.balance -= pay;
      r.paid += pay;
      if (r.balance === 0) r.endIndex = m;
    }

    let left = extra;
    for (const r of running) {
      if (r.endIndex === null || r.endIndex >= m) continue;
      left += m < r.debt.minimumsMinor.length ? r.debt.minimumsMinor[m]! : r.debt.regularMinor;
    }
    for (const r of running) {
      if (left <= 0) break;
      if (r.balance <= 0) continue;
      const pay = Math.min(left, r.balance);
      r.balance -= pay;
      r.paid += pay;
      left -= pay;
      if (r.balance === 0) r.endIndex = m;
    }
    leftByMonth.push(running.reduce((sum, r) => sum + Math.max(0, r.balance), 0));
  }

  const noRate = running.filter((r) => r.debt.ratesBps === null).map((r) => r.debt.key);
  const stillOwed = running.filter((r) => r.balance > 0).map((r) => r.debt.key);
  const unknown: PayoffPlan['unknown'] = noRate.length > 0 ? { reason: 'noRate', keys: noRate } : stillOwed.length > 0 ? { reason: 'neverCleared', keys: stillOwed } : null;
  const last = running.reduce<number | null>((max, r) => (r.endIndex === null ? max : Math.max(max ?? 0, r.endIndex)), null);
  return {
    order,
    debtFreeMonth: unknown || last === null ? null : addMonths(options.startMonth, last),
    months: unknown ? null : last === null ? 0 : last + 1,
    unknown,
    interestMinor: running.reduce((s, r) => s + r.interest, 0),
    debts: running.map((r) => ({
      key: r.debt.key,
      endMonth: r.endIndex === null ? null : addMonths(options.startMonth, r.endIndex),
      interestMinor: r.interest,
      paidMinor: r.paid,
    })),
    leftByMonth,
  };
}

/** The plan with the extra beside the same plan without it. */
export function extraEffect(debts: readonly PayoffDebt[], options: PayoffOptions): ExtraEffect {
  const plan = simulatePayoff(debts, options);
  const baseline = simulatePayoff(debts, { ...options, extraMinor: 0 });
  const known = plan.unknown === null && baseline.unknown === null;
  return {
    plan,
    baseline,
    interestSavedMinor: known ? baseline.interestMinor - plan.interestMinor : null,
    monthsSooner: known && plan.months !== null && baseline.months !== null ? baseline.months - plan.months : null,
  };
}

/** Spec §8: rates far apart → Avalanche; many small debts → Snowball; a rate unknown → Snowball; else nothing. */
export function suggestMethod(debts: readonly PayoffDebt[]): MethodSuggestion | null {
  const active = debts.filter((d) => d.balanceMinor > 0);
  const allKnown = active.every((d) => d.ratesBps !== null);
  if (allKnown) {
    const charging = active.filter((d) => (currentRate(d) ?? 0) > 0).sort((a, b) => currentRate(b)! - currentRate(a)! || byName(a, b));
    if (charging.length >= 2) {
      const highest = charging[0]!;
      const lowest = charging.at(-1)!;
      if (currentRate(highest)! - currentRate(lowest)! >= RATE_SPREAD_BPS) return { method: 'avalanche', reason: 'ratesDiffer', highestKey: highest.key, lowestKey: lowest.key };
    }
  }
  const total = active.reduce((s, d) => s + d.balanceMinor, 0);
  const smallCount = active.filter((d) => d.balanceMinor * BPS <= total * SMALL_DEBT_SHARE_BPS).length;
  if (smallCount >= SMALL_DEBT_COUNT) return { method: 'snowball', reason: 'manySmall', smallCount };
  if (!allKnown) return { method: 'snowball', reason: 'ratesUnknown' };
  return null;
}

const monthsBetween = (from: string, to: string): number =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * MONTHS_IN_YEAR + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

/** A loan's own schedule as engine input: its payments month by month, its rate periods, its interest kind. */
export function payoffDebtFromSchedule(input: ScheduledLoanInput): PayoffDebt {
  const periods = [...input.periods];
  const interest: PayoffInterest =
    input.method === 'flat' ? { kind: 'fixed', minor: input.rows[0]?.interestMinor ?? 0 } : input.method === 'zero' ? { kind: 'none' } : { kind: 'balance' };
  const base = { key: input.key, name: input.name, balanceMinor: input.balanceMinor, interest, late: input.late, daysLate: input.daysLate };
  const placed = input.rows
    .map((row) => ({ row, index: monthsBetween(input.startMonth, row.onDate.slice(0, 7)) }))
    .filter((p) => p.index >= 0);
  if (placed.length === 0) {
    return { ...base, ratesBps: [periodOn(periods, `${input.startMonth}-01`)?.rateBps ?? 0], minimumsMinor: [], regularMinor: 0, firstMonth: 0 };
  }
  const length = placed.at(-1)!.index + 1;
  const minimums = Array<number>(length).fill(0);
  const rates = Array<number | null>(length).fill(null);
  for (const { row, index } of placed) {
    minimums[index]! += row.paymentMinor;
    if (rates[index] === null) rates[index] = periodOn(periods, row.onDate)?.rateBps ?? 0;
  }
  // A month with no row takes the next row's rate.
  for (let i = length - 2; i >= 0; i -= 1) if (rates[i] === null) rates[i] = rates[i + 1]!;
  return {
    ...base,
    ratesBps: rates as number[],
    minimumsMinor: minimums,
    regularMinor: placed.find((p) => p.row.paymentMinor > 0)?.row.paymentMinor ?? 0,
    firstMonth: placed[0]!.index,
  };
}
