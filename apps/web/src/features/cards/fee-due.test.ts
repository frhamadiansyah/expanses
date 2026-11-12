import { describe, expect, it } from 'vitest';
import { type DueFee, withRefundYears } from './fee-due';

const card: DueFee = { cardId: 'c1', name: 'Sample card', currency: 'IDR', annualFeeMinor: 450_000, annualFeeOn: '2025-11-20', annualFeeWaivedYear: null };

describe('a fee year refunded through the old Fee refunded', () => {
  // Today 12 Nov 2026: the covered charge is 20 Nov 2026, eight days ahead.
  it('reads as waived, so it is not due', () => {
    expect(withRefundYears([card], [{ transactionId: 't', accountId: 'c1', feeYear: 2026 }], '2026-11-12')[0]!.annualFeeWaivedYear).toBe(2026);
  });
  it('leaves a card whose refund was for another year, or another card, as it was', () => {
    expect(withRefundYears([card], [{ transactionId: 't', accountId: 'c1', feeYear: 2025 }], '2026-11-12')[0]).toBe(card);
    expect(withRefundYears([card], [{ transactionId: 't', accountId: 'c2', feeYear: 2026 }], '2026-11-12')[0]).toBe(card);
  });
});
