import { describe, expect, it } from 'vitest';
import { displayAmount, netWorth } from '../src/index';

describe('displayAmount', () => {
  it('flips credit-normal kinds', () => {
    expect(displayAmount('asset', 100)).toBe(100);
    expect(displayAmount('expense', 100)).toBe(100);
    expect(displayAmount('liability', -700)).toBe(700);
    expect(displayAmount('income', -50)).toBe(50);
    expect(Object.is(displayAmount('liability', 0), 0)).toBe(true);
  });
});

describe('netWorth', () => {
  it('sums assets minus liabilities converted at the as-of rates', () => {
    const result = netWorth({
      baseCurrency: 'IDR',
      accounts: [
        { id: 'checking', kind: 'asset', currency: 'IDR' },
        { id: 'thbCash', kind: 'asset', currency: 'THB' },
        { id: 'visa', kind: 'liability', currency: 'IDR' },
        { id: 'usdBroker', kind: 'asset', currency: 'USD' },
        { id: 'groceries', kind: 'expense', currency: null },
      ],
      nativeBalances: { checking: 10_000_000, thbCash: 100_000, visa: -2_500_000, usdBroker: 5000, groceries: 999 },
      ratesToBase: { THB: 500 },
    });
    expect(result).toEqual({
      assetsBaseMinor: 10_500_000,
      liabilitiesBaseMinor: 2_500_000,
      netWorthBaseMinor: 8_000_000,
      missingRates: ['USD'],
    });
  });
});
