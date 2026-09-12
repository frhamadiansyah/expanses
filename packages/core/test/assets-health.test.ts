import { describe, expect, it } from 'vitest';
import { healthRatios, type HealthRatio, type PeriodFlows, type RatioKey, type SheetTotals } from '../src/index';

const flows = (overrides: Partial<PeriodFlows> = {}): PeriodFlows => ({
  months: 12,
  incomeMinor: 734_400_000, // Rp 61,2 jt a month
  spendingMinor: 561_600_000, // Rp 46,8 jt a month
  debtPaymentsMinor: 179_676_000, // Rp 14,973 jt a month
  nonMortgageDebtPaymentsMinor: 79_800_000, // Rp 6,65 jt a month
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
const statusOf = (key: RatioKey, f: Partial<PeriodFlows> = {}, t: Partial<SheetTotals> = {}) => by(healthRatios(flows(f), totals(t)), key).status;

describe('healthRatios', () => {
  it('returns the eight ratios in the order the screen shows them', () => {
    expect(healthRatios(flows(), totals()).map((ratio) => ratio.key)).toEqual([
      'emergency_fund',
      'savings_rate',
      'liquidity',
      'debt_payments',
      'consumer_debt_payments',
      'debt_to_assets',
      'solvency',
      'investments_to_net_worth',
    ]);
  });

  it('gives every ratio a name, a guide line and a unit', () => {
    for (const ratio of healthRatios(flows(), totals())) {
      expect(ratio.name, ratio.key).toBeTruthy();
      expect(ratio.guide, ratio.key).toBeTruthy();
      expect(['months', 'percent'], ratio.key).toContain(ratio.unit);
    }
  });

  it('divides cash by monthly spending plus monthly debt payments for the emergency fund', () => {
    const ratio = by(healthRatios(flows(), totals()), 'emergency_fund');
    expect(ratio.unit).toBe('months');
    expect(ratio.value).toBeCloseTo(200_000_000 / (46_800_000 + 14_973_000), 2);
    expect(ratio.status).toBe('good');
  });

  it('grades the emergency fund against 3 months and 1,5 months', () => {
    expect(statusOf('emergency_fund', {}, { liquidMinor: 130_000_000 })).toBe('watch');
    expect(statusOf('emergency_fund', {}, { liquidMinor: 60_000_000 })).toBe('act');
  });

  it('works out the savings rate from take-home pay', () => {
    const ratio = by(healthRatios(flows(), totals()), 'savings_rate');
    expect(ratio.value).toBeCloseTo(((734_400_000 - 561_600_000) / 734_400_000) * 100, 2);
    expect(ratio.status).toBe('good');
    expect(statusOf('savings_rate', { spendingMinor: 700_000_000 })).toBe('watch');
    expect(statusOf('savings_rate', { spendingMinor: 730_000_000 })).toBe('act');
  });

  it('reads liquidity against net worth', () => {
    expect(by(healthRatios(flows(), totals()), 'liquidity').value).toBeCloseTo(16.67, 1);
    expect(statusOf('liquidity', {}, { liquidMinor: 150_000_000 })).toBe('watch');
    expect(statusOf('liquidity', {}, { liquidMinor: 100_000_000 })).toBe('act');
  });

  it('keeps debt payments under 25%, watches to 30% and acts above', () => {
    expect(by(healthRatios(flows(), totals()), 'debt_payments').value).toBeCloseTo(24.47, 1);
    expect(statusOf('debt_payments')).toBe('good');
    expect(statusOf('debt_payments', { debtPaymentsMinor: 190_000_000 })).toBe('watch');
    expect(statusOf('debt_payments', { debtPaymentsMinor: 230_000_000 })).toBe('act');
  });

  it('holds consumer debt payments to their own limits', () => {
    expect(statusOf('consumer_debt_payments')).toBe('good');
    expect(statusOf('consumer_debt_payments', { nonMortgageDebtPaymentsMinor: 130_000_000 })).toBe('watch');
    expect(statusOf('consumer_debt_payments', { nonMortgageDebtPaymentsMinor: 160_000_000 })).toBe('act');
  });

  it('reads debt to assets, solvency and investments from the totals', () => {
    const ratios = healthRatios(flows(), totals());
    expect(by(ratios, 'debt_to_assets').value).toBeCloseTo(40, 2);
    expect(by(ratios, 'solvency').value).toBeCloseTo(60, 2);
    expect(by(ratios, 'investments_to_net_worth').value).toBeCloseTo(16.67, 1);
    expect(statusOf('debt_to_assets', {}, { liabilitiesMinor: 1_200_000_000 })).toBe('watch');
    expect(statusOf('debt_to_assets', {}, { liabilitiesMinor: 1_600_000_000 })).toBe('act');
    expect(statusOf('solvency', {}, { netWorthMinor: 800_000_000 })).toBe('watch');
    expect(statusOf('solvency', {}, { netWorthMinor: 400_000_000 })).toBe('act');
  });

  it('never tells you to act on investments to net worth', () => {
    expect(statusOf('investments_to_net_worth')).toBe('watch');
    expect(statusOf('investments_to_net_worth', {}, { investMinor: 1_000_000_000 })).toBe('good');
    expect(statusOf('investments_to_net_worth', {}, { investMinor: 1 })).toBe('watch');
  });

  it('says it does not know instead of showing a misleading number', () => {
    expect(statusOf('savings_rate', { incomeMinor: 0 })).toBe('unknown');
    expect(statusOf('debt_payments', { incomeMinor: 0 })).toBe('unknown');
    expect(statusOf('liquidity', {}, { netWorthMinor: 0 })).toBe('unknown');
    expect(statusOf('solvency', {}, { netWorthMinor: -1, assetsMinor: 0 })).toBe('unknown');
    expect(statusOf('investments_to_net_worth', {}, { netWorthMinor: -5_000_000 })).toBe('unknown');
    expect(statusOf('emergency_fund', { spendingMinor: 0, debtPaymentsMinor: 0 })).toBe('unknown');
    expect(by(healthRatios(flows({ incomeMinor: 0 }), totals()), 'savings_rate').value).toBeNull();
  });

  it('treats a period with no data as unknown throughout', () => {
    const ratios = healthRatios(flows({ months: 0, incomeMinor: 0, spendingMinor: 0, debtPaymentsMinor: 0, nonMortgageDebtPaymentsMinor: 0 }), totals());
    for (const key of ['emergency_fund', 'savings_rate', 'debt_payments', 'consumer_debt_payments'] as RatioKey[]) {
      expect(by(ratios, key).status, key).toBe('unknown');
    }
  });

  it('divides by the months that have data, not always twelve', () => {
    const fiveMonths = flows({ months: 5, incomeMinor: 306_000_000, spendingMinor: 234_000_000, debtPaymentsMinor: 74_865_000, nonMortgageDebtPaymentsMinor: 33_250_000 });
    const ratio = by(healthRatios(fiveMonths, totals()), 'emergency_fund');
    expect(ratio.value).toBeCloseTo(200_000_000 / (46_800_000 + 14_973_000), 2);
  });
});
