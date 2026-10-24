import { describe, expect, it } from 'vitest';
import { cardTopUpLines } from '../src/index';

const base = { cardAccountId: 'card', walletAccountId: 'gopay', currency: 'IDR', topUpsCategoryId: 'topups', feeCategoryId: 'fees' };

describe('cardTopUpLines', () => {
  it('splits one charge into what landed, the card owing the whole of it under Top-ups, and the fee as spending', () => {
    const lines = cardTopUpLines({ ...base, chargedMinor: 1_010_000, feeMinor: 10_000 });
    expect(lines).toEqual([
      { accountId: 'gopay', amountMinor: 1_000_000, currency: 'IDR' },
      { accountId: 'card', amountMinor: -1_010_000, currency: 'IDR', spendCategoryId: 'topups' },
      { accountId: 'fees', amountMinor: 10_000, currency: 'IDR' },
    ]);
    expect(lines.reduce((sum, line) => sum + line.amountMinor, 0)).toBe(0);
  });

  it('with no fee, lands the whole charge and has no fee line, nor needs a fee category', () => {
    expect(cardTopUpLines({ ...base, feeCategoryId: null, chargedMinor: 250_000, feeMinor: 0 })).toEqual([
      { accountId: 'gopay', amountMinor: 250_000, currency: 'IDR' },
      { accountId: 'card', amountMinor: -250_000, currency: 'IDR', spendCategoryId: 'topups' },
    ]);
  });

  it('refuses a fee as large as the charge, a fee below zero, and a charge of nothing', () => {
    expect(() => cardTopUpLines({ ...base, chargedMinor: 10_000, feeMinor: 10_000 })).toThrow('The fee must be less than the amount charged');
    expect(() => cardTopUpLines({ ...base, chargedMinor: 10_000, feeMinor: 12_000 })).toThrow('The fee must be less than the amount charged');
    expect(() => cardTopUpLines({ ...base, chargedMinor: 10_000, feeMinor: -1 })).toThrow('A fee cannot be below zero');
    expect(() => cardTopUpLines({ ...base, chargedMinor: 0, feeMinor: 0 })).toThrow('Enter the amount charged');
  });

  it('needs the wallet it went into, and a category for a fee', () => {
    expect(() => cardTopUpLines({ ...base, walletAccountId: '', chargedMinor: 10_000, feeMinor: 0 })).toThrow('Choose the wallet it went into');
    expect(() => cardTopUpLines({ ...base, feeCategoryId: null, chargedMinor: 10_000, feeMinor: 500 })).toThrow('Choose a category for the fee');
  });
});
