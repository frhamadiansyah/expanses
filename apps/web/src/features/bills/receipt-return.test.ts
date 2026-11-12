import { describe, expect, it } from 'vitest';
import { markReceiptAt, stepsBackToReceipt } from './receipt-return';

describe('the way back to a receipt from its bill pages', () => {
  it('goes back to the receipt’s own entry, however many bill pages were opened from it', () => {
    markReceiptAt('t1', 4);
    // Receipt (4) → bill list (5) → month (6).
    expect(stepsBackToReceipt('t1', 6)).toBe(-2);
    expect(stepsBackToReceipt('t1', 5)).toBe(-1);
  });

  it('knows no way back for a receipt it never saw open its bill list, or from an entry before it', () => {
    expect(stepsBackToReceipt('t-unknown', 6)).toBeNull();
    markReceiptAt('t2', 9);
    expect(stepsBackToReceipt('t2', 9)).toBeNull();
    expect(stepsBackToReceipt('t2', 3)).toBeNull();
  });

  it('remembers the latest receipt entry for the same transaction', () => {
    markReceiptAt('t3', 2);
    markReceiptAt('t3', 7);
    expect(stepsBackToReceipt('t3', 9)).toBe(-2);
  });
});
