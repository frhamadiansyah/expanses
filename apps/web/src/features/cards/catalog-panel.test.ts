import { findEntry } from '@expanses/catalog';
import type { CycleBonus } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { activeDuring, bonusStanding, pendingUpdate } from './catalog-panel';

describe('activeDuring', () => {
  it('keeps rows whose dates overlap the cycle', () => {
    expect(activeDuring({ validFrom: '2025-09-23', validTo: null }, '2026-08-26', '2026-09-25')).toBe(true);
    expect(activeDuring({ validFrom: '2024-08-12', validTo: '2025-09-22' }, '2026-08-26', '2026-09-25')).toBe(false);
    expect(activeDuring({ validFrom: null, validTo: null }, '2026-08-26', '2026-09-25')).toBe(true);
    expect(activeDuring({ validFrom: null, validTo: '2026-08-26' }, '2026-08-26', '2026-09-25')).toBe(true);
    expect(activeDuring({ validFrom: '2026-09-26', validTo: null }, '2026-08-26', '2026-09-25')).toBe(false);
  });
});

describe('pendingUpdate', () => {
  const v2 = { ...findEntry('bca-unionpay')!, entryVersion: 2 };
  it('offers a newer entry to a customised program until it is applied or skipped', () => {
    expect(pendingUpdate({ status: 'customised', entryVersion: 1, dismissedVersion: null, entry: v2 })).toBe(v2);
    expect(pendingUpdate({ status: 'customised', entryVersion: 1, dismissedVersion: 2, entry: v2 })).toBeNull();
    expect(pendingUpdate({ status: 'customised', entryVersion: 2, dismissedVersion: null, entry: v2 })).toBeNull();
  });

  it('never offers updates to linked or unlinked programs, or when the entry is gone', () => {
    expect(pendingUpdate({ status: 'linked', entryVersion: 1, dismissedVersion: null, entry: v2 })).toBeNull();
    expect(pendingUpdate({ status: null, entryVersion: null, dismissedVersion: null, entry: undefined })).toBeNull();
    expect(pendingUpdate({ status: 'customised', entryVersion: 1, dismissedVersion: null, entry: undefined })).toBeNull();
  });
});

describe('bonusStanding', () => {
  const infinite: CycleBonus = {
    id: 'b1', key: 'monthly-spend', name: 'Monthly spend bonus', match: {}, validFrom: null, validTo: null,
    tiers: [{ minSpendMinor: 20_000_000, bonus: 1000 }, { minSpendMinor: 50_000_000, bonus: 2000 }],
  };

  it('measures progress toward the next tier', () => {
    expect(bonusStanding(infinite, 21_000_000, 1000)).toEqual({ awarded: 1000, eligibleSpendMinor: 21_000_000, next: { minSpendMinor: 50_000_000, bonus: 2000 }, remainingMinor: 29_000_000, fraction: 0.42 });
    expect(bonusStanding(infinite, 5_000_000, 0)).toMatchObject({ next: { minSpendMinor: 20_000_000, bonus: 1000 }, remainingMinor: 15_000_000, fraction: 0.25 });
  });

  it('is complete once the top tier is reached', () => {
    expect(bonusStanding(infinite, 60_000_000, 2000)).toMatchObject({ next: null, remainingMinor: 0, fraction: 1 });
    expect(bonusStanding({ ...infinite, tiers: [{ minSpendMinor: 20_000_000, bonus: 1000 }] }, 20_000_000, 1000)).toMatchObject({ next: null, fraction: 1 });
  });
});
