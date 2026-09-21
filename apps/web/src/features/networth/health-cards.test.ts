import type { Goal, HealthRatio } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { emergencyGoalBase, periodChoices, periodRange, ratioDisplay, withEmergencyLoading } from './health-cards';

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
