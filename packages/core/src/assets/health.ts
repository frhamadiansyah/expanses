/**
 * The personal financial ratios as the CFP-aligned guides define them, with their published
 * benchmarks. Formulas and benchmarks live here and nowhere else; status bands are derived
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

export interface RatioSettings {
  /** Adds debt payments to the emergency fund denominator. On by default, because the emergency goal counts them too. */
  emergencyIncludesDebtPayments?: boolean;
  /** 3500 by the guide; 3000 is what OJK and Indonesian lenders quote. */
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

export const DEFAULT_DEBT_SERVICE_BPS = 3500;

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
  // On unless turned off. A loan payment is the least skippable outgoing when income stops, and the
  // emergency goal already sizes itself on spending plus debt payments, so the card agrees with it.
  const countsDebtPayments = settings.emergencyIncludesDebtPayments ?? true;
  const emergencyOutgoing = spending + (countsDebtPayments ? debtPayments : 0);
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
      (value) => higherIsBetter(value, 3),
      6,
      9,
      false,
      '3–6 months',
      countsDebtPayments
        ? 'Cash & equivalents ÷ monthly spending and debt payments. The guide asks 3–6 months, 12 with dependants.'
        : 'Cash & equivalents ÷ monthly spending. The guide asks 3–6 months, 12 with dependants.',
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
      'What you put into savings and investments ÷ take-home pay. The guide asks 10%, and 20% is strong. Employer JHT and DPLK are not counted yet.',
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
