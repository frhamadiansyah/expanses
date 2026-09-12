/**
 * The ratios a financial planner reads off a statement of financial position and a year of cash flow.
 * Thresholds live here and nowhere else.
 */
export interface PeriodFlows {
  /** Months with data in the period, 0 to 12. */
  months: number;
  /** Take-home pay over the period: every income category except realized gains. */
  incomeMinor: number;
  /** Spending over the period: every expense category except final tax. */
  spendingMinor: number;
  /** Loan payments and their interest over the period. */
  debtPaymentsMinor: number;
  /** The same, leaving out home loans. */
  nonMortgageDebtPaymentsMinor: number;
}

export interface SheetTotals {
  liquidMinor: number;
  investMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
}

export type RatioStatus = 'good' | 'watch' | 'act' | 'unknown';

export type RatioKey =
  | 'emergency_fund'
  | 'savings_rate'
  | 'liquidity'
  | 'debt_payments'
  | 'consumer_debt_payments'
  | 'debt_to_assets'
  | 'solvency'
  | 'investments_to_net_worth';

export interface HealthRatio {
  key: RatioKey;
  name: string;
  /** Months for the emergency fund, percent for the rest. Null when there is nothing to divide. */
  value: number | null;
  unit: 'months' | 'percent';
  status: RatioStatus;
  /** Where the guide sits, in the same unit as the value. */
  target: number;
  /** Top of the gauge, in the same unit. */
  max: number;
  lowerBetter: boolean;
  guide: string;
}

/** A period total as a monthly figure. */
export const monthly = (totalMinor: number, months: number): number => (months > 0 ? totalMinor / months : 0);

const higherIsBetter = (value: number, good: number, watch: number): RatioStatus => (value >= good ? 'good' : value >= watch ? 'watch' : 'act');
const lowerIsBetter = (value: number, good: number, watch: number): RatioStatus => (value <= good ? 'good' : value <= watch ? 'watch' : 'act');
const percent = (part: number, whole: number): number => (part / whole) * 100;

export function healthRatios(flows: PeriodFlows, totals: SheetTotals): HealthRatio[] {
  const hasPeriod = flows.months > 0;
  const income = monthly(flows.incomeMinor, flows.months);
  const spending = monthly(flows.spendingMinor, flows.months);
  const debtPayments = monthly(flows.debtPaymentsMinor, flows.months);
  const consumerDebtPayments = monthly(flows.nonMortgageDebtPaymentsMinor, flows.months);
  const monthlyOutgoing = spending + debtPayments;
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
    guide: string,
  ): HealthRatio => {
    if (!known) return { key, name, value: null, unit, status: 'unknown', target, max, lowerBetter, guide };
    const value = compute();
    return { key, name, value, unit, status: grade(value), target, max, lowerBetter, guide };
  };

  return [
    ratio(
      'emergency_fund',
      'Emergency fund',
      'months',
      hasPeriod && monthlyOutgoing > 0,
      () => totals.liquidMinor / monthlyOutgoing,
      (value) => higherIsBetter(value, 3, 1.5),
      6,
      9,
      false,
      'Cash & equivalents ÷ monthly spending and debt payments. Aim for 3–6 months, 6 or more with dependants.',
    ),
    ratio(
      'savings_rate',
      'Savings rate',
      'percent',
      hasIncome,
      () => percent(income - spending, income),
      (value) => higherIsBetter(value, 10, 5),
      10,
      40,
      false,
      '(Take-home pay − spending) ÷ take-home pay. Aim for at least 10%; 20% is strong.',
    ),
    ratio(
      'liquidity',
      'Liquidity',
      'percent',
      hasNetWorth,
      () => percent(totals.liquidMinor, totals.netWorthMinor),
      (value) => higherIsBetter(value, 15, 10),
      15,
      40,
      false,
      'Cash & equivalents ÷ net worth. Aim for about 15%.',
    ),
    ratio(
      'debt_payments',
      'Debt payments',
      'percent',
      hasIncome,
      () => percent(debtPayments, income),
      (value) => lowerIsBetter(value, 25, 30),
      30,
      50,
      true,
      'Loan payments ÷ take-home pay. Keep at or under 30%; card bills paid in full do not count.',
    ),
    ratio(
      'consumer_debt_payments',
      'Consumer debt payments',
      'percent',
      hasIncome,
      () => percent(consumerDebtPayments, income),
      (value) => lowerIsBetter(value, 15, 20),
      15,
      40,
      true,
      'Payments on everything except the home loan ÷ take-home pay. Keep at or under 15%.',
    ),
    ratio(
      'debt_to_assets',
      'Debt to assets',
      'percent',
      hasAssets,
      () => percent(totals.liabilitiesMinor, totals.assetsMinor),
      (value) => lowerIsBetter(value, 50, 70),
      50,
      100,
      true,
      'Everything you owe ÷ everything you own. Keep under 50%, falling with age.',
    ),
    ratio(
      'solvency',
      'Solvency',
      'percent',
      hasAssets,
      () => percent(totals.netWorthMinor, totals.assetsMinor),
      (value) => higherIsBetter(value, 50, 30),
      50,
      100,
      false,
      'Net worth ÷ everything you own. Above 50% means you own more than you owe.',
    ),
    ratio(
      'investments_to_net_worth',
      'Investments to net worth',
      'percent',
      hasNetWorth,
      () => percent(totals.investMinor, totals.netWorthMinor),
      (value) => (value >= 50 ? 'good' : 'watch'),
      50,
      100,
      false,
      'Investments ÷ net worth. Climbs toward 50% or more by retirement; a home and cars are not investments here.',
    ),
  ];
}
