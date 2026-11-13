import { describe, expect, it } from 'vitest';
import { markReceiptAt, returnToReceipt, stepsBackToReceipt } from './receipt-return';

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

describe('returning to the receipt once a bill is linked', () => {
  const fakeHistory = (index: number) => {
    const calls: string[] = [];
    return {
      calls,
      history: {
        location: { state: { __TSR_index: index } },
        go: (n: number) => calls.push(`go ${n}`),
        replace: (href: string) => calls.push(`replace ${href}`),
        push: (href: string) => calls.push(`push ${href}`),
        flush: () => calls.push('flush'),
      },
    };
  };

  it('steps back to the receipt’s own entry when it is known', () => {
    markReceiptAt('r1', 3);
    const { calls, history } = fakeHistory(4);
    returnToReceipt(history, 'r1', () => '/transactions');
    expect(calls).toEqual(['go -1']);
  });

  it('with no entry known, puts the page the receipt came from under a fresh receipt, so its ‹ goes there', () => {
    const { calls, history } = fakeHistory(5);
    returnToReceipt(history, 'r-cold', () => '/transactions?view=list');
    expect(calls).toEqual(['replace /transactions?view=list', 'flush', 'push /transactions/r-cold']);
  });
});
