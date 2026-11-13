import { describe, expect, it } from 'vitest';
import type { CycleBonus, SpendLine } from '../src/index';
import { bonusItem, daysBetween, type FeeWaiver, nearestFirst, timeLeftText, waiverItem, waiverSpend, waiverWindow } from '../src/index';

const line = (over: Partial<SpendLine>): SpendLine => ({
  transactionId: 't',
  entryId: 'e',
  occurredOn: '2026-10-20',
  categoryId: 'food',
  description: 'Shop',
  amountMinor: 100_000,
  currency: 'IDR',
  originalCurrency: null,
  mcc: null,
  mccSource: null,
  ...over,
});

const challenge: FeeWaiver = { kind: 'challenge', amountMinor: 1_500_000, countedFrom: '2026-10-14', spendBy: '2026-10-31', categoryIds: [] };
const automatic: FeeWaiver = { kind: 'automatic', amountMinor: 150_000_000, countedFrom: null, spendBy: null, categoryIds: [] };

describe('waiver window', () => {
  it('a challenge counts from its day to its deadline', () => {
    expect(waiverWindow(challenge, '2026-03-14', '2026-10-28')).toEqual({ from: '2026-10-14', to: '2026-10-31' });
  });
  it('an automatic one is the 12 months ending on the coming fee date', () => {
    expect(waiverWindow(automatic, '2024-03-14', '2026-10-28')).toEqual({ from: '2026-03-15', to: '2027-03-14' });
  });
  it('a fee date that is today ends today', () => {
    expect(waiverWindow(automatic, '2026-10-28', '2026-10-28')).toEqual({ from: '2025-10-29', to: '2026-10-28' });
  });
  it('29 Feb steps back to 28 Feb', () => {
    expect(waiverWindow(automatic, '2024-02-29', '2027-02-10')).toEqual({ from: '2026-03-01', to: '2027-02-28' });
  });
  it('without a fee date, the 12 months ending today', () => {
    expect(waiverWindow(automatic, null, '2026-10-28')).toEqual({ from: '2025-10-29', to: '2026-10-28' });
  });
});

describe('waiver spend', () => {
  const window = { from: '2026-10-14', to: '2026-10-31' };
  it('counts purchases inside the window only', () => {
    const lines = [line({ occurredOn: '2026-10-13' }), line({ occurredOn: '2026-10-14' }), line({ occurredOn: '2026-10-31' }), line({ occurredOn: '2026-11-01' })];
    expect(waiverSpend(challenge, window, lines, {})).toBe(200_000);
  });
  it('leaves out card fees, and takes refunds off', () => {
    const lines = [line({ amountMinor: 500_000 }), line({ amountMinor: 80_000, cardFee: true }), line({ amountMinor: -120_000 })];
    expect(waiverSpend(challenge, window, lines, {})).toBe(380_000);
  });
  it('counts only the chosen categories and their descendants', () => {
    const only: FeeWaiver = { ...challenge, categoryIds: ['food'] };
    const lines = [line({ categoryId: 'food' }), line({ categoryId: 'ramen', amountMinor: 50_000 }), line({ categoryId: 'fuel', amountMinor: 900_000 })];
    expect(waiverSpend(only, window, lines, { ramen: ['food'] })).toBe(150_000);
  });
  it('never goes below nothing', () => {
    expect(waiverSpend(challenge, window, [line({ amountMinor: -50_000 })], {})).toBe(0);
  });
});

describe('items', () => {
  const dining: CycleBonus = {
    id: 'b1',
    key: 'dining',
    name: 'Dining bonus',
    tiers: [
      { minSpendMinor: 5_000_000, bonus: 2_000 },
      { minSpendMinor: 10_000_000, bonus: 5_000 },
    ],
    match: {},
    validFrom: null,
    validTo: null,
  };
  it('a bonus works toward its next tier', () => {
    const item = bonusItem(dining, 7_200_000, 2_000, '2026-11-06', '2026-10-28');
    expect(item).toMatchObject({ kind: 'bonus', goalMinor: 10_000_000, remainingMinor: 2_800_000, rewardPoints: 5_000, reached: false, daysLeft: 9 });
    expect(item.fraction).toBeCloseTo(0.72);
  });
  it('a bonus past its top tier is reached and reports what it paid', () => {
    const item = bonusItem(dining, 12_000_000, 5_000, '2026-11-06', '2026-10-28');
    expect(item).toMatchObject({ reached: true, fraction: 1, remainingMinor: 0, rewardPoints: 5_000, goalMinor: 10_000_000 });
  });
  it('a challenge item is reached exactly at its amount', () => {
    const window = { from: '2026-10-14', to: '2026-10-31' };
    expect(waiverItem(challenge, window, 1_499_999, 800_000, '2026-10-28')).toMatchObject({ reached: false, remainingMinor: 1, daysLeft: 3, name: 'Fee waiver challenge', rewardMinor: 800_000 });
    expect(waiverItem(challenge, window, 1_500_000, 800_000, '2026-10-28')).toMatchObject({ reached: true, fraction: 1, remainingMinor: 0 });
  });
  it('an automatic item is the fee waiver target', () => {
    const item = waiverItem(automatic, { from: '2026-03-15', to: '2027-03-14' }, 78_000_000, 800_000, '2026-10-28');
    expect(item).toMatchObject({ kind: 'target', name: 'Fee waiver target' });
  });
  it('orders the fullest bar first, then the least left', () => {
    const rows = [
      { id: 'a', fraction: 0.5, remainingMinor: 10 },
      { id: 'b', fraction: 1, remainingMinor: 0 },
      { id: 'c', fraction: 0.5, remainingMinor: 5 },
    ];
    expect(nearestFirst(rows).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('words', () => {
  it('says how long is left', () => {
    expect(timeLeftText(-1)).toBe('Ended');
    expect(timeLeftText(0)).toBe('Ends today');
    expect(timeLeftText(1)).toBe('1 day left');
    expect(timeLeftText(9)).toBe('9 days left');
    expect(timeLeftText(120)).toBe('4 months left');
  });
  it('counts days', () => {
    expect(daysBetween('2026-10-28', '2026-11-06')).toBe(9);
  });
});
