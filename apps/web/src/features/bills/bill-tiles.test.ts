import { billWindow } from '@expanses/core';
import type { MonthlyBill } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { billCount, billTiles, bucketOf } from './bill-tiles';
import { monthBoxOf } from './bills-desk-model';

// Invented bills in an invented December.
const bill = (over: Partial<MonthlyBill>): MonthlyBill => ({
  id: over.name ?? 'x',
  name: 'x',
  categoryAccountId: 'c',
  moneyAccountId: 'm',
  amountMinor: 100,
  dayOfMonth: 1,
  payByDay: null,
  startsMonth: '2026-08',
  active: true,
  billMonth: '2026-12',
  window: billWindow('2026-12', 1, null),
  state: 'open',
  days: 5,
  paidOn: null,
  paidMinor: null,
  paidCurrency: null,
  chargedMinor: null,
  chargedCurrency: null,
  currency: null,
  repeat: 'monthly',
  repeatMonth: null,
  repeatEvery: null,
  paymentId: null,
  paidFromAccountId: null,
  estimateMinor: 100,
  payableMonths: ['2026-12'],
  pausedUntil: null,
  pauseFrom: '2026-12',
  ...over,
});

const on = (day: number) => billWindow('2026-12', day, null);
const today = '2026-12-10';

const rows = [
  bill({ name: 'Water', state: 'paid', paidMinor: 214_500, amountMinor: 200_000, window: on(2), paidOn: '2026-12-02' }),
  bill({ name: 'Phone', state: 'paid', paidMinor: 150_000, window: on(5), paidOn: '2026-12-05' }),
  bill({ name: 'Health', state: 'overdue', days: 3, amountMinor: 450_000, window: on(7) }),
  bill({ name: 'Power', state: 'dueSoon', days: 2, amountMinor: null, estimateMinor: 1_180_000, window: on(12) }),
  bill({ name: 'Internet', state: 'open', amountMinor: 415_000, window: on(13) }),
  bill({ name: 'Loan', state: 'upcoming', amountMinor: 2_640_000, window: on(28) }),
  bill({ name: 'Gym', state: 'skipped', amountMinor: 300_000, window: on(4) }),
  bill({ name: 'Club', state: 'paused', amountMinor: 90_000, window: on(20) }),
];

describe('billTiles', () => {
  it('counts and adds up each bucket as the table groups them', () => {
    expect(billTiles(rows, today)).toEqual([
      { key: 'paid', count: 2, minor: 364_500, approximate: false },
      { key: 'dueSoon', count: 2, minor: 1_595_000, approximate: true },
      { key: 'later', count: 1, minor: 2_640_000, approximate: false },
      { key: 'late', count: 1, minor: 450_000, approximate: false },
    ]);
  });

  it('adds Late, Due soon and Later up to what the month still has to pay', () => {
    const [, soon, later, late] = billTiles(rows, today);
    expect(soon!.minor + later!.minor + late!.minor).toBe(monthBoxOf(rows, today).leftMinor);
    expect(billTiles(rows, today)[0]!.minor).toBe(monthBoxOf(rows, today).paidMinor);
  });

  it('leaves skipped and paused bills out of every tile', () => {
    expect(bucketOf(rows[6]!, today)).toBeNull();
    expect(bucketOf(rows[7]!, today)).toBeNull();
  });

  it('counts in words', () => {
    expect(billCount(1)).toBe('1 bill');
    expect(billCount(7)).toBe('7 bills');
  });
});
