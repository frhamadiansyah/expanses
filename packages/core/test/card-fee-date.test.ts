import { describe, expect, it } from 'vitest';
import { chargeAfterWaiver, coveredCharge, feeDaysAway, feeWaived, nextFeeDate, upcomingFees } from '../src';

describe('nextFeeDate', () => {
  it('rolls a past date forward to the coming one', () => {
    expect(nextFeeDate('2023-03-12', '2026-10-26')).toBe('2027-03-12');
    expect(nextFeeDate('2023-12-01', '2026-10-26')).toBe('2026-12-01');
  });
  it('keeps today', () => expect(nextFeeDate('2024-10-26', '2026-10-26')).toBe('2026-10-26'));
  it('leaves a future date alone', () => expect(nextFeeDate('2028-05-01', '2026-10-26')).toBe('2028-05-01'));
  it('moves 29 Feb to 28 Feb in a common year and back in a leap year', () => {
    expect(nextFeeDate('2024-02-29', '2026-10-26')).toBe('2027-02-28');
    expect(nextFeeDate('2024-02-29', '2027-10-26')).toBe('2028-02-29');
    expect(nextFeeDate('2024-02-29', '2025-01-10')).toBe('2025-02-28');
  });
  it('counts days away', () => expect(feeDaysAway('2020-11-05', '2026-10-26')).toBe(10));
});

describe('upcomingFees', () => {
  const cards = [
    { id: 'a', annualFeeOn: '2020-11-20' },
    { id: 'b', annualFeeOn: '2020-12-26' },
    { id: 'c', annualFeeOn: '2020-11-25' },
    { id: 'd', annualFeeOn: null },
  ];
  it('lists only fees within 30 days, soonest first, and no card without a date', () => {
    expect(upcomingFees(cards, '2026-10-26').map((f) => f.card.id)).toEqual(['a', 'c']);
  });
  it('includes day 30 and excludes day 31', () => {
    expect(upcomingFees([{ annualFeeOn: '2026-11-25' }], '2026-10-26')).toHaveLength(1);
    expect(upcomingFees([{ annualFeeOn: '2026-11-26' }], '2026-10-26')).toHaveLength(0);
  });
});

describe('a waived fee', () => {
  it('covers the coming charge inside 30 days, else the one just passed', () => {
    expect(coveredCharge('2020-11-12', '2026-10-26')).toBe('2026-11-12');
    expect(coveredCharge('2020-11-12', '2026-12-20')).toBe('2026-11-12');
    expect(coveredCharge('2020-11-12', '2027-03-01')).toBe('2026-11-12');
  });
  it('reads as waived until the next charge comes within 30 days', () => {
    expect(feeWaived('2020-11-12', 2026, '2026-10-26')).toBe(true);
    expect(feeWaived('2020-11-12', 2026, '2027-03-01')).toBe(true);
    expect(feeWaived('2020-11-12', 2026, '2027-10-20')).toBe(false);
    expect(feeWaived('2020-11-12', null, '2026-10-26')).toBe(false);
  });
  it('names the charge after the waived one', () => {
    expect(chargeAfterWaiver('2020-11-12', '2026-10-26')).toBe('2027-11-12');
    expect(chargeAfterWaiver('2020-11-12', '2027-03-01')).toBe('2027-11-12');
  });
  it('leaves a waived card out of Recurring, and brings it back 30 days before the next charge', () => {
    const cards = [{ annualFeeOn: '2020-11-12', annualFeeWaivedYear: 2026 }];
    expect(upcomingFees(cards, '2026-10-26')).toHaveLength(0);
    expect(upcomingFees(cards, '2027-10-20')).toHaveLength(1);
  });
});
