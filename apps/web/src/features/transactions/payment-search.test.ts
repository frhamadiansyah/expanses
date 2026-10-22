import type { PaymentOption } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { matchesPayment } from './PaymentSheet';

const option = (over: Partial<PaymentOption>): PaymentOption => ({ accountId: 'a', accountName: 'BCA Tahapan', ...over }) as PaymentOption;

describe('searching Paid with', () => {
  it('finds a row by its name, a card by its last digits, by whose it is, or by its currency', () => {
    expect(matchesPayment(option({}), 'IDR', 'bca')).toBe(true);
    expect(matchesPayment(option({ accountName: 'Mandiri Bonvoy', cardId: 'c', last4: '7788' }), 'IDR', '7788')).toBe(true);
    expect(matchesPayment(option({ holderName: 'Andi' }), 'IDR', 'andi')).toBe(true);
    expect(matchesPayment(option({ accountName: 'Wise' }), 'USD', 'usd')).toBe(true);
    expect(matchesPayment(option({}), 'IDR', 'jago')).toBe(false);
    // An account with one card, a bank account's number, a wallet's phone: their digits find them too.
    expect(matchesPayment(option({ accountName: 'BCA Visa', cardId: null, last4: '1467' }), 'IDR', '1467')).toBe(true);
  });

  it('keeps every row while nothing is typed', () => {
    expect(matchesPayment(option({}), 'IDR', '  ')).toBe(true);
  });
});
