import { describe, expect, it } from 'vitest';
import { healthRatios, type HealthRatio, type PeriodFlows, type RatioKey, type RatioSettings, type SheetTotals, WATCH_BAND } from '../src/index';

/**
 * Rp 61,2 jt take-home, Rp 46,8 jt spent, Rp 14,973 jt of debt payments — of which Rp 4,973 jt is
 * principal and the rest interest, already inside the spending — and Rp 7,8 jt put away, each month.
 */
const flows = (overrides: Partial<PeriodFlows> = {}): PeriodFlows => ({
  months: 12,
  incomeMinor: 734_400_000,
  spendingMinor: 561_600_000,
  debtPaymentsMinor: 179_676_000,
  nonMortgageDebtPaymentsMinor: 79_800_000,
  debtPrincipalMinor: 59_676_000,
  putAwayMinor: 93_600_000,
  ...overrides,
});

const totals = (overrides: Partial<SheetTotals> = {}): SheetTotals => ({
  liquidMinor: 200_000_000,
  investMinor: 200_000_000,
  assetsMinor: 2_000_000_000,
  liabilitiesMinor: 800_000_000,
  netWorthMinor: 1_200_000_000,
  ...overrides,
});

const by = (ratios: HealthRatio[], key: RatioKey) => ratios.find((ratio) => ratio.key === key)!;
const statusOf = (key: RatioKey, f: Partial<PeriodFlows> = {}, t: Partial<SheetTotals> = {}, settings?: RatioSettings) =>
  by(healthRatios(flows(f), totals(t), settings), key).status;
/** A month of take-home pay, to turn a percentage into a period total. */
const monthsOf = (percent: number) => Math.round(((percent / 100) * 61_200_000) * 12);

describe('the published set', () => {
  it('returns the nine rows in screen order, with surplus beside the savings ratio', () => {
    expect(healthRatios(flows(), totals()).map((ratio) => ratio.key)).toEqual([
      'emergency_fund',
      'savings_ratio',
      'surplus',
      'liquidity',
      'debt_payments',
      'consumer_debt_payments',
      'debt_to_assets',
      'solvency',
      'investments_to_net_worth',
    ]);
  });

  it('marks surplus as the companion and everything else as a guide ratio', () => {
    const ratios = healthRatios(flows(), totals());
    expect(by(ratios, 'surplus').companion).toBe(true);
    expect(ratios.filter((ratio) => ratio.companion)).toHaveLength(1);
  });

  it('says what each benchmark is, in words', () => {
    const ratios = healthRatios(flows(), totals());
    expect(by(ratios, 'savings_ratio').benchmarkText).toBe('at least 10%');
    expect(by(ratios, 'debt_payments').benchmarkText).toBe('at most 35%');
    expect(by(ratios, 'emergency_fund').benchmarkText).toBe('3–6 months');
    expect(by(ratios, 'debt_to_assets').benchmarkText).toBe('at most 50%');
  });
});

describe('savings ratio', () => {
  it('divides what was actually put away by take-home pay', () => {
    const ratio = by(healthRatios(flows(), totals()), 'savings_ratio');
    expect(ratio.value).toBeCloseTo((7_800_000 / 61_200_000) * 100, 2);
    expect(ratio.status).toBe('good');
  });

  it('watches the band between the benchmark and the benchmark divided by 1,2', () => {
    expect(statusOf('savings_ratio', { putAwayMinor: monthsOf(9) })).toBe('watch');
    expect(statusOf('savings_ratio', { putAwayMinor: monthsOf(5) })).toBe('act');
  });

  it('is unknown without income to divide by', () => {
    expect(statusOf('savings_ratio', { incomeMinor: 0 })).toBe('unknown');
    expect(by(healthRatios(flows({ incomeMinor: 0 }), totals()), 'savings_ratio').value).toBeNull();
  });
});

describe('surplus', () => {
  it('keeps the old formula: what was left over, spent or not', () => {
    const ratio = by(healthRatios(flows(), totals()), 'surplus');
    expect(ratio.value).toBeCloseTo(((734_400_000 - 561_600_000) / 734_400_000) * 100, 2);
  });

  it('sits above the savings ratio when money stayed as idle cash', () => {
    const ratios = healthRatios(flows(), totals());
    expect(by(ratios, 'surplus').value!).toBeGreaterThan(by(ratios, 'savings_ratio').value!);
  });
});

describe('emergency fund', () => {
  it('divides cash by spending and loan principal, which is what the emergency goal counts too', () => {
    const ratio = by(healthRatios(flows(), totals()), 'emergency_fund');
    expect(ratio.value).toBeCloseTo(200_000_000 / (46_800_000 + 4_973_000), 2);
    expect(ratio.status).toBe('good');
  });

  it('counts loan interest once: it is spending, not a second outgoing beside it', () => {
    const ratio = by(healthRatios(flows(), totals()), 'emergency_fund');
    // The interest is Rp 10 jt of the Rp 14,973 jt paid each month, and it is already inside the spending.
    expect(ratio.value).not.toBeCloseTo(200_000_000 / (46_800_000 + 14_973_000), 2);
    // Doubling the interest alone, with the principal untouched, must not move the target at all.
    const sameSpendingMoreInterest = flows({ debtPaymentsMinor: 179_676_000 + 120_000_000 });
    expect(by(healthRatios(sameSpendingMoreInterest, totals()), 'emergency_fund').value).toBe(ratio.value);
  });

  it('drops loan principal from the denominator when the setting is turned off', () => {
    const looser = by(healthRatios(flows(), totals(), { emergencyIncludesDebtPayments: false }), 'emergency_fund');
    expect(looser.value).toBeCloseTo(200_000_000 / 46_800_000, 2);
    expect(looser.value!).toBeGreaterThan(by(healthRatios(flows(), totals()), 'emergency_fund').value!);
  });

  it('says which denominator it used, so the card is not ambiguous', () => {
    expect(by(healthRatios(flows(), totals()), 'emergency_fund').guide).toContain('spending plus loan principal');
    expect(by(healthRatios(flows(), totals(), { emergencyIncludesDebtPayments: false }), 'emergency_fund').guide).toContain('monthly spending.');
  });

  it('grades against three months, watching down to three divided by 1,2', () => {
    expect(statusOf('emergency_fund', {}, { liquidMinor: 186_000_000 })).toBe('good');
    expect(statusOf('emergency_fund', {}, { liquidMinor: 140_000_000 })).toBe('watch');
    expect(statusOf('emergency_fund', {}, { liquidMinor: 120_000_000 })).toBe('act');
  });
});

describe('debt servicing', () => {
  it('follows the guide at 35%', () => {
    expect(by(healthRatios(flows(), totals()), 'debt_payments').value).toBeCloseTo((14_973_000 / 61_200_000) * 100, 2);
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(34) })).toBe('good');
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(40) })).toBe('watch');
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(43) })).toBe('act');
  });

  it('moves with the 30% setting that Indonesian lenders quote', () => {
    const strict: RatioSettings = { debtServiceBenchmarkBps: 3000 };
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(29) }, {}, strict)).toBe('good');
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(34) }, {}, strict)).toBe('watch');
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(37) }, {}, strict)).toBe('act');
    expect(by(healthRatios(flows(), totals(), strict), 'debt_payments').benchmarkText).toBe('at most 30%');
  });

  it('holds non-mortgage payments to 15%', () => {
    expect(statusOf('consumer_debt_payments')).toBe('good');
    expect(statusOf('consumer_debt_payments', { nonMortgageDebtPaymentsMinor: monthsOf(17) })).toBe('watch');
    expect(statusOf('consumer_debt_payments', { nonMortgageDebtPaymentsMinor: monthsOf(25) })).toBe('act');
  });
});

describe('the balance-sheet ratios', () => {
  it('reads liquidity, debt to assets, solvency and investments from the totals', () => {
    const ratios = healthRatios(flows(), totals());
    expect(by(ratios, 'liquidity').value).toBeCloseTo(16.67, 1);
    expect(by(ratios, 'debt_to_assets').value).toBeCloseTo(40, 2);
    expect(by(ratios, 'solvency').value).toBeCloseTo(60, 2);
    expect(by(ratios, 'investments_to_net_worth').value).toBeCloseTo(16.67, 1);
  });

  it('grades each one against its published benchmark', () => {
    expect(statusOf('liquidity', {}, { liquidMinor: 150_000_000 })).toBe('watch');
    expect(statusOf('liquidity', {}, { liquidMinor: 100_000_000 })).toBe('act');
    expect(statusOf('debt_to_assets', {}, { liabilitiesMinor: 1_100_000_000 })).toBe('watch');
    expect(statusOf('debt_to_assets', {}, { liabilitiesMinor: 1_400_000_000 })).toBe('act');
    expect(statusOf('solvency', {}, { netWorthMinor: 900_000_000 })).toBe('watch');
    expect(statusOf('solvency', {}, { netWorthMinor: 400_000_000 })).toBe('act');
  });

  it('holds investments to the same 50% guide, with no special case', () => {
    expect(statusOf('investments_to_net_worth')).toBe('act');
    expect(statusOf('investments_to_net_worth', {}, { investMinor: 1_000_000_000 })).toBe('good');
    expect(statusOf('investments_to_net_worth', {}, { investMinor: 520_000_000 })).toBe('watch');
  });

  it('is unknown when there is nothing to divide by', () => {
    expect(statusOf('liquidity', {}, { netWorthMinor: 0 })).toBe('unknown');
    expect(statusOf('debt_to_assets', {}, { assetsMinor: 0 })).toBe('unknown');
    // Both, now that loan principal is in the denominator: either one alone still leaves something to divide by.
    expect(statusOf('emergency_fund', { spendingMinor: 0, debtPrincipalMinor: 0 })).toBe('unknown');
  });
});

describe('bands', () => {
  it('always sits at 1,2 times the benchmark', () => {
    expect(WATCH_BAND).toBe(1.2);
  });

  it('treats a period with no data as unknown throughout', () => {
    const ratios = healthRatios(flows({ months: 0, incomeMinor: 0, spendingMinor: 0, debtPaymentsMinor: 0, nonMortgageDebtPaymentsMinor: 0, debtPrincipalMinor: 0, putAwayMinor: 0 }), totals());
    for (const key of ['emergency_fund', 'savings_ratio', 'surplus', 'debt_payments', 'consumer_debt_payments'] as RatioKey[]) {
      expect(by(ratios, key).status, key).toBe('unknown');
    }
  });
});
