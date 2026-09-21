import type { Goal } from '../goals/plan';
import type { BalanceSheet } from './balance-sheet';

/**
 * The personal financial ratios the planning guides use, with their benchmarks. Formulas and benchmarks live here and nowhere else; status bands are derived
 * from the benchmark rather than chosen per ratio.
 */
export interface PeriodFlows {
  /** Months with cash flow in the period, 0 to 12. */
  months: number;
  /** Take-home pay over the period: every income category except realized gains. */
  incomeMinor: number;
  /** Spending over the period: every expense category except final tax. */
  spendingMinor: number;
  /** Loan payments and their interest over the period. */
  debtPaymentsMinor: number;
  /** The same, leaving out home loans. */
  nonMortgageDebtPaymentsMinor: number;
  /**
   * The part of those payments that is not already inside `spendingMinor`: loan principal, and
   * instalments billed on a card. Loan interest is an expense entry, so spending carries it
   * already; adding the whole payment beside spending would count the interest twice.
   */
  debtPrincipalMinor: number;
  /** The part of `spendingMinor` in categories that resolve to lifestyle, summed signed like spending itself. */
  lifestyleSpendingMinor: number;
  /** Money that actually moved into holdings, savings or loan principal over the period. */
  putAwayMinor: number;
}

export interface SheetTotals {
  liquidMinor: number;
  investMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
}

/**
 * The five totals the ratios read, from a balance sheet: every account is inside its group's total, so nothing listed
 * by hand can fall outside one (the workbook's gold and jewellery). The net-worth page and the life cover prefill both
 * call this, so the two cannot disagree.
 */
export function sheetTotals(sheet: BalanceSheet): SheetTotals {
  const groupTotal = (key: string) => sheet.assetGroups.find((group) => group.key === key)?.totalMinor ?? 0;
  return {
    liquidMinor: groupTotal('liquid'),
    investMinor: groupTotal('invest'),
    assetsMinor: sheet.assetsTotalMinor,
    liabilitiesMinor: sheet.liabilitiesTotalMinor,
    netWorthMinor: sheet.netWorthMinor,
  };
}

export type EmergencyBase = 'essential' | 'all';
export const EMERGENCY_BASES: readonly EmergencyBase[] = ['essential', 'all'];
export const DEFAULT_EMERGENCY_BASE: EmergencyBase = 'essential';

export interface RatioSettings {
  /**
   * What the emergency fund's months multiply: essential spending (lifestyle categories left out) or all of it.
   * Loan principal is added either way — it keeps arriving when income stops, and it is the only half of a loan
   * payment spending does not already hold. The interest is an expense entry, inside spending already.
   */
  emergencyBase?: EmergencyBase;
  /**
   * The household's own months — its emergency goal's (user decision Q5, 2026-09-21). The card grades against these
   * rather than a flat guide. Absent: `DEFAULT_EMERGENCY_TARGET_MONTHS`, and the card reads "3–6 months" as before.
   */
  emergencyTargetMonths?: number;
  /** 3000 by default; 3500 is the looser guide. */
  debtServiceBenchmarkBps?: number;
}

export type RatioStatus = 'good' | 'watch' | 'act' | 'unknown';

export type RatioKey =
  | 'emergency_fund'
  | 'savings_ratio'
  | 'surplus'
  | 'liquidity'
  | 'debt_payments'
  | 'consumer_debt_payments'
  | 'debt_to_assets'
  | 'solvency'
  | 'investments_to_net_worth';

export interface HealthRatio {
  key: RatioKey;
  name: string;
  /** Months for the emergency fund, percent for the rest. Null when there is nothing to divide by. */
  value: number | null;
  unit: 'months' | 'percent';
  status: RatioStatus;
  /** Where the guide sits, in the same unit as the value. */
  target: number;
  /** Top of the gauge, in the same unit. */
  max: number;
  lowerBetter: boolean;
  /** The benchmark in words, for the card: "at least 10%", "at most 35%", "3–6 months". */
  benchmarkText: string;
  /** True for surplus, which sits beside the savings ratio without being a guide ratio. */
  companion: boolean;
  guide: string;
}

/** Watch runs from the benchmark out to this multiple of it; beyond that, act. */
export const WATCH_BAND = 1.2;

export const DEFAULT_DEBT_SERVICE_BPS = 3000;
/** The guide's floor, used only while the household has set no months of its own. */
export const DEFAULT_EMERGENCY_TARGET_MONTHS = 3;

/**
 * The months the household asked of its emergency fund: the largest `targetMonths` on an unpaid stage of any
 * emergency goal, typed or worked out. Null when there is none.
 */
export function householdEmergencyMonths(goals: readonly Pick<Goal, 'kind' | 'stages'>[]): number | null {
  const months = goals
    .filter((goal) => goal.kind === 'emergency')
    .flatMap((goal) => goal.stages)
    .filter((stage) => !stage.paidOn && stage.targetMonths !== null && stage.targetMonths > 0)
    .map((stage) => stage.targetMonths!);
  return months.length > 0 ? Math.max(...months) : null;
}

/**
 * What an emergency fund covers over the period, as a total. The ratio card and the emergency goal both size
 * themselves with this and nothing else, so they cannot disagree. Signed: a refund lowers what it refunds.
 */
export function emergencyOutgoingMinor(
  flows: Pick<PeriodFlows, 'spendingMinor' | 'lifestyleSpendingMinor' | 'debtPrincipalMinor'>,
  base: EmergencyBase,
): number {
  const spending = base === 'essential' ? flows.spendingMinor - flows.lifestyleSpendingMinor : flows.spendingMinor;
  return spending + flows.debtPrincipalMinor;
}

/** A period total as a monthly figure. */
export const monthly = (totalMinor: number, months: number): number => (months > 0 ? totalMinor / months : 0);

const percent = (part: number, whole: number): number => (part / whole) * 100;
const higherIsBetter = (value: number, benchmark: number): RatioStatus =>
  value >= benchmark ? 'good' : value >= benchmark / WATCH_BAND ? 'watch' : 'act';
const lowerIsBetter = (value: number, benchmark: number): RatioStatus =>
  value <= benchmark ? 'good' : value <= benchmark * WATCH_BAND ? 'watch' : 'act';
const atLeast = (benchmark: number) => `at least ${benchmark}%`;
const atMost = (benchmark: number) => `at most ${benchmark}%`;

export function healthRatios(flows: PeriodFlows, totals: SheetTotals, settings: RatioSettings = {}): HealthRatio[] {
  const hasPeriod = flows.months > 0;
  const income = monthly(flows.incomeMinor, flows.months);
  const spending = monthly(flows.spendingMinor, flows.months);
  const debtPayments = monthly(flows.debtPaymentsMinor, flows.months);
  const consumerDebtPayments = monthly(flows.nonMortgageDebtPaymentsMinor, flows.months);
  const putAway = monthly(flows.putAwayMinor, flows.months);
  // Only the principal is added to spending: the interest is an expense entry, so spending already carries it, and
  // the whole payment would count the interest twice. The debt-servicing ratios below still take the whole payment.
  const base = settings.emergencyBase ?? DEFAULT_EMERGENCY_BASE;
  const emergencyOutgoing = monthly(emergencyOutgoingMinor(flows, base), flows.months);
  const ownMonths = settings.emergencyTargetMonths !== undefined && settings.emergencyTargetMonths > 0 ? settings.emergencyTargetMonths : null;
  const emergencyTarget = ownMonths ?? DEFAULT_EMERGENCY_TARGET_MONTHS;
  // With no months of its own the card is as it was (§3.3): graded at 3, its mark at the guide's 6.
  const emergencyMark = ownMonths ?? 6;
  const graded = ownMonths
    ? `Graded against the ${emergencyTarget} months your emergency fund asks for.`
    : 'The guide asks 3–6 months, more with dependants or irregular income; set an emergency fund to grade against your own.';
  const debtBenchmark = (settings.debtServiceBenchmarkBps ?? DEFAULT_DEBT_SERVICE_BPS) / 100;
  const hasIncome = hasPeriod && income > 0;
  const hasNetWorth = totals.netWorthMinor > 0;
  const hasAssets = totals.assetsMinor > 0;

  const ratio = (
    key: RatioKey,
    name: string,
    unit: HealthRatio['unit'],
    known: boolean,
    compute: () => number,
    grade: (value: number) => RatioStatus,
    target: number,
    max: number,
    lowerBetter: boolean,
    benchmarkText: string,
    guide: string,
    companion = false,
  ): HealthRatio => {
    const shared = { key, name, unit, target, max, lowerBetter, benchmarkText, companion, guide };
    if (!known) return { ...shared, value: null, status: 'unknown' };
    const value = compute();
    return { ...shared, value, status: grade(value) };
  };

  return [
    ratio(
      'emergency_fund',
      'Emergency fund',
      'months',
      hasPeriod && emergencyOutgoing > 0,
      () => totals.liquidMinor / emergencyOutgoing,
      (value) => higherIsBetter(value, emergencyTarget),
      emergencyMark,
      Math.max(9, emergencyMark * 1.5),
      false,
      ownMonths ? `${emergencyTarget} months · your household` : '3–6 months',
      base === 'essential'
        ? `Cash & equivalents ÷ monthly essential spending plus loan principal. Lifestyle categories are left out; loan interest is already inside spending. ${graded}`
        : `Cash & equivalents ÷ monthly spending plus loan principal. Loan interest is already inside spending. ${graded}`,
    ),
    ratio(
      'savings_ratio',
      'Savings ratio',
      'percent',
      hasIncome,
      () => percent(putAway, income),
      (value) => higherIsBetter(value, 10),
      10,
      40,
      false,
      atLeast(10),
      'What you put into savings and investments ÷ take-home pay. The guide asks 10%, and 20% is strong. Employer pension contributions are not counted yet.',
    ),
    ratio(
      'surplus',
      'Surplus',
      'percent',
      hasIncome,
      () => percent(income - spending, income),
      (value) => higherIsBetter(value, 10),
      10,
      40,
      false,
      atLeast(10),
      '(Take-home pay − spending) ÷ take-home pay: what was left over, placed or not. The gap against the savings ratio is money that stayed as cash.',
      true,
    ),
    ratio(
      'liquidity',
      'Liquid assets to net worth',
      'percent',
      hasNetWorth,
      () => percent(totals.liquidMinor, totals.netWorthMinor),
      (value) => higherIsBetter(value, 15),
      15,
      40,
      false,
      atLeast(15),
      'Cash & equivalents ÷ net worth. The guide asks about 15%.',
    ),
    ratio(
      'debt_payments',
      'Debt servicing',
      'percent',
      hasIncome,
      () => percent(debtPayments, income),
      (value) => lowerIsBetter(value, debtBenchmark),
      debtBenchmark,
      Math.max(50, debtBenchmark * 1.5),
      true,
      atMost(debtBenchmark),
      'Loan payments ÷ take-home pay. Card bills paid in full do not count.',
    ),
    ratio(
      'consumer_debt_payments',
      'Non-mortgage debt servicing',
      'percent',
      hasIncome,
      () => percent(consumerDebtPayments, income),
      (value) => lowerIsBetter(value, 15),
      15,
      40,
      true,
      atMost(15),
      'Payments on everything except the home loan ÷ take-home pay.',
    ),
    ratio(
      'debt_to_assets',
      'Debt to assets',
      'percent',
      hasAssets,
      () => percent(totals.liabilitiesMinor, totals.assetsMinor),
      (value) => lowerIsBetter(value, 50),
      50,
      100,
      true,
      atMost(50),
      'Everything you owe ÷ everything you own. The guide asks under 50%.',
    ),
    ratio(
      'solvency',
      'Solvency',
      'percent',
      hasAssets,
      () => percent(totals.netWorthMinor, totals.assetsMinor),
      (value) => higherIsBetter(value, 50),
      50,
      100,
      false,
      atLeast(50),
      'Net worth ÷ everything you own. Above 50% means you own more than you owe.',
    ),
    ratio(
      'investments_to_net_worth',
      'Investments to net worth',
      'percent',
      hasNetWorth,
      () => percent(totals.investMinor, totals.netWorthMinor),
      (value) => higherIsBetter(value, 50),
      50,
      100,
      false,
      atLeast(50),
      'Invested assets, with your home left out, ÷ net worth. The guide asks 50% or more, which rises in importance as retirement nears.',
    ),
  ];
}
