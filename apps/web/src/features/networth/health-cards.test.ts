import type { Goal, HealthRatio } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { emergencyGoalBase, JOINT_RATIO_KEYS, periodChoices, periodRange, ratioDisplay, ratioInputs, ratioTotals, withEmergencyLoading, withJointRatios } from './health-cards';
import { jointRows, type ReceivedItem } from './joint-rows';

const TODAY = '2026-09-12';

const ratio = (partial: Partial<HealthRatio> = {}): HealthRatio => ({
  key: 'emergency_fund',
  name: 'Emergency fund',
  value: 4.7,
  unit: 'months',
  status: 'good',
  target: 6,
  max: 9,
  lowerBetter: false,
  benchmarkText: '3–6 months',
  companion: false,
  guide: 'Cash ÷ monthly outgoings.',
  ...partial,
});

describe('periodRange', () => {
  it('ends the rolling year today and starts twelve months back', () => {
    expect(periodRange({ key: 'ttm' }, TODAY)).toEqual({ from: '2025-10-01', to: TODAY, balanceDate: TODAY, label: 'Last 12 months' });
  });

  it('runs a calendar year from January to December with balances at the end', () => {
    expect(periodRange({ key: 'year', year: 2025 }, TODAY)).toEqual({ from: '2025-01-01', to: '2025-12-31', balanceDate: '2025-12-31', label: '2025' });
  });
});

describe('periodChoices', () => {
  it('offers the rolling year first, then each year back to the first with data', () => {
    expect(periodChoices(TODAY, 2024)).toEqual([{ key: 'ttm' }, { key: 'year', year: 2026 }, { key: 'year', year: 2025 }, { key: 'year', year: 2024 }]);
  });

  it('never offers a year later than this one', () => {
    expect(periodChoices(TODAY, 2030)).toEqual([{ key: 'ttm' }, { key: 'year', year: 2026 }]);
  });
});

describe('ratioDisplay', () => {
  it('shows months with one decimal', () => {
    expect(ratioDisplay(ratio()).value).toBe('4,7 months');
  });

  it('shows percentages with one decimal', () => {
    expect(ratioDisplay(ratio({ key: 'savings_ratio', unit: 'percent', value: 23.529, target: 10, max: 40 })).value).toBe('23,5%');
  });

  it('names the status in plain words', () => {
    expect(ratioDisplay(ratio({ status: 'watch' })).statusLabel).toBe('Watch');
    expect(ratioDisplay(ratio({ status: 'act' })).statusLabel).toBe('Act now');
  });

  it('fills the gauge to the value and marks the guide', () => {
    const display = ratioDisplay(ratio({ value: 4.5, target: 6, max: 9 }));
    expect(display.gaugePercent).toBeCloseTo(50, 5);
    expect(display.targetPercent).toBeCloseTo(66.67, 1);
  });

  it('caps the gauge at the end of the bar', () => {
    expect(ratioDisplay(ratio({ value: 24, max: 9 })).gaugePercent).toBe(100);
    expect(ratioDisplay(ratio({ value: -5, max: 9 })).gaugePercent).toBe(0);
  });

  it('says it does not know instead of drawing a bar', () => {
    const display = ratioDisplay(ratio({ value: null, status: 'unknown' }));
    expect(display).toMatchObject({ value: '—', statusLabel: 'Not enough data', gaugePercent: 0 });
  });
});

describe('withEmergencyLoading', () => {
  it('blanks only the emergency fund row while goals have not loaded, leaving the good grade it would otherwise flash', () => {
    const ratios = [ratio({ key: 'emergency_fund', status: 'good', value: 4.7 }), ratio({ key: 'savings_ratio', status: 'good', value: 23 })];
    const loading = withEmergencyLoading(ratios, true);
    expect(loading[0]).toMatchObject({ key: 'emergency_fund', value: null, status: 'unknown' });
    expect(loading[1]).toEqual(ratios[1]);
  });

  it('leaves every row exactly as computed once goals have loaded', () => {
    const ratios = [ratio({ key: 'emergency_fund', status: 'act', value: 4.7 })];
    expect(withEmergencyLoading(ratios, false)).toEqual(ratios);
  });
});

describe('the base the emergency card opens on', () => {
  const stage = (targetMonths: number | null, paidOn: string | null = null) => ({ targetMonths, paidOn });
  const goal = (id: string, kind: string, months: number[]) => ({ id, kind, stages: months.map((m) => stage(m)) }) as unknown as Pick<Goal, 'id' | 'kind' | 'stages'>;
  const worked = (goalId: string, base?: 'essential' | 'all') => ({ goalId, kind: 'emergency' as const, inputs: base ? { months: 6, base } : { months: 6 } });

  it('is the base of the emergency goal whose months it grades against', () => {
    expect(emergencyGoalBase([goal('e', 'emergency', [6])], [worked('e', 'all')])).toBe('all');
    // Two emergency goals: the one asking the most months is the one graded against.
    expect(emergencyGoalBase([goal('a', 'emergency', [3]), goal('b', 'emergency', [9])], [worked('a', 'all'), worked('b', 'essential')])).toBe('essential');
    expect(emergencyGoalBase([goal('a', 'emergency', [3]), goal('b', 'emergency', [9])], [worked('a', 'essential'), worked('b', 'all')])).toBe('all');
  });

  it('is essential for an emergency goal with no working, as the goal itself counts it', () => {
    expect(emergencyGoalBase([goal('e', 'emergency', [6])], [])).toBe('essential');
  });

  it('is null with no emergency goal, so the card opens on its own default', () => {
    expect(emergencyGoalBase([goal('h', 'holiday', [6])], [worked('h', 'all')])).toBeNull();
    expect(emergencyGoalBase([], [])).toBeNull();
  });
});

describe('ratioTotals', () => {
  const assets = [
    { accountId: 'bca', name: 'BCA Tahapan', planGroup: 'liquid' as const, subtype: 'bank', valueMinor: 50_000_000 },
    { accountId: 'fund', name: 'Money market fund', planGroup: 'invest' as const, subtype: 'investment', valueMinor: 20_000_000 },
    // A USD account on a day with no USD rate: sheetInputsAt gives its row 0 and names USD.
    { accountId: 'usd', name: 'Dollar Saver', planGroup: 'liquid' as const, subtype: 'bank', valueMinor: 0 },
  ];
  const liabilities = [{ accountId: 'card', name: 'Card', subtype: 'credit_card' as const, balanceMinor: 10_000_000, dueWithinYearMinor: 10_000_000, note: null }];

  it('are the balance sheet’s totals when every rate is there', () => {
    expect(ratioTotals({ assets, liabilities, missing: [] })).toEqual({
      totals: { liquidMinor: 50_000_000, investMinor: 20_000_000, assetsMinor: 70_000_000, liabilitiesMinor: 10_000_000, netWorthMinor: 60_000_000 },
      missing: [],
    });
  });

  it('are none, with the currency named, while a rate is missing — never totals that count that money as 0', () => {
    expect(ratioTotals({ assets, liabilities, missing: ['USD'] })).toEqual({ totals: null, missing: ['USD'] });
  });
});

describe('ratioInputs (joint net worth §8.2: health ratios use the household total)', () => {
  const own = {
    assets: [{ accountId: 'bca', name: 'Rina BCA', planGroup: 'liquid' as const, subtype: 'bank', valueMinor: 50_000_000 }],
    liabilities: [],
    missing: [],
  };
  const andi: ReceivedItem = {
    itemId: 'i-andi',
    owner: 'm-andi',
    kind: 'asset',
    subtype: 'bank',
    name: 'Andi Mandiri',
    currency: 'IDR',
    balanceMinor: 400_000_000,
    asOf: '2026-09-12',
    card: null,
    period: { start: '2026-09-01', end: '2026-09-30' },
    openingMinor: 400_000_000,
    householdMinor: 0,
    otherUseMinor: 0,
    transferMinor: 0,
    monthEnds: [],
    tax: null,
  };

  it('reads the joint sheet in joint mode, so net worth and cash are the household’s', () => {
    const joint = jointRows(own, [andi], 'm-rina', {}, 'IDR');
    const { totals } = ratioTotals(ratioInputs(own, joint));
    expect(totals?.netWorthMinor).toBe(450_000_000);
    expect(totals?.liquidMinor).toBe(450_000_000);
  });

  it('reads this phone’s own sheet when the household does not file jointly', () => {
    expect(ratioTotals(ratioInputs(own, null)).totals?.netWorthMinor).toBe(50_000_000);
  });

  it('a received item with no rate names its currency and gives no ratios', () => {
    const joint = jointRows(own, [{ ...andi, currency: 'USD' }], 'm-rina', {}, 'IDR');
    expect(ratioTotals(ratioInputs(own, joint))).toEqual({ totals: null, missing: ['USD'] });
  });
});

describe('withJointRatios (finding 8: only balance-sheet ratios are the household\'s)', () => {
  const keys = ['emergency_fund', 'savings_ratio', 'surplus', 'liquidity', 'debt_payments', 'consumer_debt_payments', 'debt_to_assets', 'solvency', 'investments_to_net_worth'] as const;
  const personal = keys.map((key) => ratio({ key, value: 1 }));
  const joint = keys.map((key) => ratio({ key, value: 2 }));

  it('takes net worth, debt to assets and the like from the joint sheet, and every ratio over income or spending from the own one', () => {
    const mixed = withJointRatios(personal, joint);
    expect(Object.fromEntries(mixed.map((r) => [r.key, r.value]))).toEqual({
      emergency_fund: 1,
      savings_ratio: 1,
      surplus: 1,
      liquidity: 1,
      debt_payments: 1,
      consumer_debt_payments: 1,
      debt_to_assets: 2,
      solvency: 2,
      investments_to_net_worth: 2,
    });
    expect([...JOINT_RATIO_KEYS].sort()).toEqual(['debt_to_assets', 'investments_to_net_worth', 'solvency']);
  });

  it('with the joint sheet not there (loading, an error, a month it cannot tell), the household\'s ratios are blank, never personal ones', () => {
    const mixed = withJointRatios(personal, null);
    for (const r of mixed) {
      if (JOINT_RATIO_KEYS.has(r.key)) expect(r).toMatchObject({ value: null, status: 'unknown' });
      else expect(r.value).toBe(1);
    }
  });

  it('personal mode is untouched', () => {
    expect(withJointRatios(personal, undefined)).toBe(personal);
  });
});
