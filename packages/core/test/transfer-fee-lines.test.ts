import { describe, expect, it } from 'vitest';
import { transferWithFeeLines } from '../src/index';

const base = { fromAccountId: 'bank', toAccountId: 'wallet', currency: 'IDR', feeCategoryId: 'fees' };

describe('transferWithFeeLines', () => {
  it('takes the transfer and its fee from the source, lands the transfer alone, and spends the fee', () => {
    const lines = transferWithFeeLines({ ...base, amountMinor: 1_000_000, feeMinor: 2_500 });
    expect(lines).toEqual([
      { accountId: 'wallet', amountMinor: 1_000_000, currency: 'IDR' },
      { accountId: 'bank', amountMinor: -1_002_500, currency: 'IDR' },
      { accountId: 'fees', amountMinor: 2_500, currency: 'IDR' },
    ]);
    expect(lines.reduce((sum, line) => sum + line.amountMinor, 0)).toBe(0);
  });

  it('from a card, names the fee category on the card line', () => {
    expect(transferWithFeeLines({ ...base, fromAccountId: 'card', amountMinor: 400_000, feeMinor: 6_500, fromIsCard: true })[1]).toEqual({
      accountId: 'card',
      amountMinor: -406_500,
      currency: 'IDR',
      spendCategoryId: 'fees',
    });
  });

  it('with no fee, is the plain transfer and needs no fee category', () => {
    expect(transferWithFeeLines({ ...base, feeCategoryId: null, amountMinor: 300_000, feeMinor: 0 })).toEqual([
      { accountId: 'wallet', amountMinor: 300_000, currency: 'IDR' },
      { accountId: 'bank', amountMinor: -300_000, currency: 'IDR' },
    ]);
  });

  it('refuses a fee below zero, and a fee with no category', () => {
    expect(() => transferWithFeeLines({ ...base, amountMinor: 10_000, feeMinor: -1 })).toThrow('A fee cannot be below zero');
    expect(() => transferWithFeeLines({ ...base, feeCategoryId: null, amountMinor: 10_000, feeMinor: 500 })).toThrow('Choose a category for the fee');
  });
});
