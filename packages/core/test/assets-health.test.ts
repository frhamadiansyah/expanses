import { describe, expect, it } from 'vitest';
import {
  emergencyOutgoingMinor,
  type Goal,
  healthRatios,
  type HealthRatio,
  householdEmergencyMonths,
  type PeriodFlows,
  type RatioKey,
  type RatioSettings,
  type SheetTotals,
  WATCH_BAND,
} from '../src/index';

/**
 * Rp 61,2 jt take-home, Rp 46,8 jt spent — Rp 10 jt of it in lifestyle categories — Rp 14,973 jt of debt
 * payments — of which Rp 4,973 jt is principal and the rest interest, already inside the spending — and Rp 7,8 jt
 * put away, each month.
 */
const flows = (overrides: Partial<PeriodFlows> = {}): PeriodFlows => ({
  months: 12,
  incomeMinor: 734_400_000,
  spendingMinor: 561_600_000,
  lifestyleSpendingMinor: 120_000_000,
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
    expect(by(ratios, 'debt_payments').benchmarkText).toBe('at most 30%');
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
  it('divides cash by essential spending plus loan principal by default', () => {
    const ratio = by(healthRatios(flows(), totals()), 'emergency_fund');
    // Rp 46,8 jt spent, Rp 10 jt of it lifestyle, Rp 4,973 jt principal. Adding lifestyle back, or the whole
    // Rp 14,973 jt payment, would each give a different figure.
    expect(ratio.value).toBeCloseTo(200_000_000 / (36_800_000 + 4_973_000), 4);
  });

  it('divides by all spending plus loan principal when asked', () => {
    const all = by(healthRatios(flows(), totals(), { emergencyBase: 'all' }), 'emergency_fund');
    expect(all.value).toBeCloseTo(200_000_000 / (46_800_000 + 4_973_000), 4);
  });

  it('is the same either way while nothing is marked lifestyle', () => {
    const unmarked = flows({ lifestyleSpendingMinor: 0 });
    expect(by(healthRatios(unmarked, totals()), 'emergency_fund').value).toBe(by(healthRatios(unmarked, totals(), { emergencyBase: 'all' }), 'emergency_fund').value);
  });

  it('has nothing to divide by when every outgoing is lifestyle and there is no loan', () => {
    const ratio = by(healthRatios(flows({ lifestyleSpendingMinor: 561_600_000, debtPrincipalMinor: 0 }), totals()), 'emergency_fund');
    expect(ratio.value).toBeNull();
    expect(ratio.status).toBe('unknown');
  });

  it('counts loan interest once: it is spending, not a second outgoing beside it', () => {
    const ratio = by(healthRatios(flows(), totals()), 'emergency_fund');
    // The interest is Rp 10 jt of the Rp 14,973 jt paid each month, and it is already inside the spending.
    expect(ratio.value).not.toBeCloseTo(200_000_000 / (46_800_000 + 14_973_000), 2);
    // Doubling the interest alone, with the principal untouched, must not move the target at all.
    const sameSpendingMoreInterest = flows({ debtPaymentsMinor: 179_676_000 + 120_000_000 });
    expect(by(healthRatios(sameSpendingMoreInterest, totals()), 'emergency_fund').value).toBe(ratio.value);
  });

  it('grades against three months, watching down to three divided by 1,2', () => {
    // Against Rp 41,773 jt a month: 3,02, 2,63 and 2,39 months.
    expect(statusOf('emergency_fund', {}, { liquidMinor: 126_000_000 })).toBe('good');
    expect(statusOf('emergency_fund', {}, { liquidMinor: 110_000_000 })).toBe('watch');
    expect(statusOf('emergency_fund', {}, { liquidMinor: 100_000_000 })).toBe('act');
  });
});

describe('emergencyOutgoingMinor', () => {
  it('takes lifestyle out only for the essential base, and adds principal to both', () => {
    const period = { spendingMinor: 30_000_000, lifestyleSpendingMinor: 7_000_000, debtPrincipalMinor: 2_000_000 };
    expect(emergencyOutgoingMinor(period, 'essential')).toBe(25_000_000);
    expect(emergencyOutgoingMinor(period, 'all')).toBe(32_000_000);
  });

  it('sums signed: a lifestyle refund larger than lifestyle spending raises the essential base', () => {
    expect(emergencyOutgoingMinor({ spendingMinor: 10_000_000, lifestyleSpendingMinor: -500_000, debtPrincipalMinor: 0 }, 'essential')).toBe(10_500_000);
  });

  it('sums signed across the whole formula, never abs or clamping a term on its own', () => {
    // A refund-heavy window: spending alone is negative. Summing signed with the principal gives -1 jt.
    // Taking `Math.abs` of each term first would give 5 jt; clamping each term at 0 first would give 2 jt.
    expect(emergencyOutgoingMinor({ spendingMinor: -3_000_000, lifestyleSpendingMinor: 0, debtPrincipalMinor: 2_000_000 }, 'essential')).toBe(-1_000_000);
  });
});

describe('debt servicing', () => {
  it('follows the 30% guide by default', () => {
    // 32% is inside 30%'s watch band (to 36%) and would be "good" under 35%.
    expect(by(healthRatios(flows(), totals()), 'debt_payments').value).toBeCloseTo((14_973_000 / 61_200_000) * 100, 2);
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(32) })).toBe('watch');
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(29) })).toBe('good');
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(37) })).toBe('act');
    expect(by(healthRatios(flows(), totals()), 'debt_payments').target).toBe(30);
  });

  it('moves with the looser 35% setting', () => {
    const looser: RatioSettings = { debtServiceBenchmarkBps: 3500 };
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(34) }, {}, looser)).toBe('good');
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(40) }, {}, looser)).toBe('watch');
  });

  it('holds non-mortgage payments to 15%', () => {
    expect(statusOf('consumer_debt_payments')).toBe('good');
    expect(statusOf('consumer_debt_payments', { nonMortgageDebtPaymentsMinor: monthsOf(17) })).toBe('watch');
    expect(statusOf('consumer_debt_payments', { nonMortgageDebtPaymentsMinor: monthsOf(25) })).toBe('act');
  });
});

describe('the emergency card grades against the household’s own months', () => {
  // 200 jt ÷ 41,773 jt a month = 4,79 months.
  it('is good at 4,79 months against the guide’s 3 when the household has set no months', () => {
    const ratio = by(healthRatios(flows(), totals()), 'emergency_fund');
    expect(ratio.status).toBe('good');
    expect(ratio.target).toBe(3);
    expect(ratio.benchmarkText).toBe('3–6 months');
  });

  it('is act at the same 4,79 months when the household’s own figure is 12', () => {
    // A flat 3–6 guide would call this good; 12 months ÷ 1,2 = 10 is the watch floor, so 4,79 is act.
    const ratio = by(healthRatios(flows(), totals(), { emergencyTargetMonths: 12 }), 'emergency_fund');
    expect(ratio.status).toBe('act');
    expect(ratio.target).toBe(12);
    expect(ratio.benchmarkText).toBe('12 months · your household');
  });

  it('is watch between the watch floor and the household’s months', () => {
    // 440 jt ÷ 41,773 jt = 10,53 months: at least 12 ÷ 1,2 = 10, below 12.
    expect(statusOf('emergency_fund', {}, { liquidMinor: 440_000_000 }, { emergencyTargetMonths: 12 })).toBe('watch');
    expect(statusOf('emergency_fund', {}, { liquidMinor: 502_000_000 }, { emergencyTargetMonths: 12 })).toBe('good');
  });
});

describe('householdEmergencyMonths', () => {
  const g = (kind: Goal['kind'], months: (number | null)[], paid = false): Pick<Goal, 'kind' | 'stages'> => ({
    kind,
    stages: months.map((targetMonths, i) => ({ id: `s${i}`, name: 's', targetMinor: targetMonths === null ? 1 : null, targetMonths, dueOn: '2028-01-01', paidOn: paid ? '2026-01-01' : null })),
  });

  it('reads the months on the emergency goal, the largest when there are several, ignoring other kinds and paid stages', () => {
    expect(householdEmergencyMonths([g('holiday', [null]), g('emergency', [6]), g('emergency', [12])])).toBe(12);
    expect(householdEmergencyMonths([g('emergency', [24], true), g('emergency', [6])])).toBe(6);
    expect(householdEmergencyMonths([g('holiday', [null])])).toBeNull();
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
    expect(statusOf('emergency_fund', { spendingMinor: 0, lifestyleSpendingMinor: 0, debtPrincipalMinor: 0 })).toBe('unknown');
  });
});

describe('bands', () => {
  it('always sits at 1,2 times the benchmark', () => {
    expect(WATCH_BAND).toBe(1.2);
  });

  it('treats a period with no data as unknown throughout', () => {
    const ratios = healthRatios(flows({ months: 0, incomeMinor: 0, spendingMinor: 0, lifestyleSpendingMinor: 0, debtPaymentsMinor: 0, nonMortgageDebtPaymentsMinor: 0, debtPrincipalMinor: 0, putAwayMinor: 0 }), totals());
    for (const key of ['emergency_fund', 'savings_ratio', 'surplus', 'debt_payments', 'consumer_debt_payments'] as RatioKey[]) {
      expect(by(ratios, key).status, key).toBe('unknown');
    }
  });
});
