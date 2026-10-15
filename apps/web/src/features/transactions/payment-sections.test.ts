import type { PaymentOption } from '@expanses/core';
import type { AccountRow, CardRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { openingPaymentTab, paymentSections, pickedPayment, removedCardPayment } from './PaymentSheet';

const account = (id: string, kind: string, currency = 'IDR') => ({ id, kind, currency }) as AccountRow;
const accounts = [account('bca', 'asset'), account('wise', 'asset', 'USD'), account('krisflyer', 'liability'), account('bonvoy', 'liability')];
const options = [
  { accountId: 'bca', accountName: 'BCA Tahapan' },
  { accountId: 'wise', accountName: 'Wise USD' },
  { accountId: 'krisflyer', accountName: 'BCA KrisFlyer' },
  { accountId: 'bonvoy', accountName: 'Mandiri Bonvoy', cardId: 'c1', last4: '5521' },
  { accountId: 'bonvoy', accountName: 'Mandiri Bonvoy', cardId: 'c2', last4: '7788', holderName: 'Andi' },
] as PaymentOption[];
const names = (tab: 'accounts' | 'cards' | null, typed = '') =>
  paymentSections(options, accounts, tab, typed).map((section) => [section.title, section.options.map((o) => o.last4 ?? o.accountName)]);

describe('the Paid with tabs', () => {
  it('shows one kind on its own tab, and both when no tab narrows it', () => {
    expect(names(null)).toEqual([
      ['Accounts', ['BCA Tahapan', 'Wise USD']],
      ['Credit cards', ['BCA KrisFlyer', '5521', '7788']],
    ]);
    expect(names('cards')).toEqual([['Credit cards', ['BCA KrisFlyer', '5521', '7788']]]);
    expect(names('accounts')).toEqual([['Accounts', ['BCA Tahapan', 'Wise USD']]]);
  });

  it('searches across both kinds whatever tab is open, and drops a kind with nothing matching', () => {
    expect(names('accounts', 'mandiri')).toEqual([['Credit cards', ['5521', '7788']]]);
    expect(names('cards', 'bca')).toEqual([
      ['Accounts', ['BCA Tahapan']],
      ['Credit cards', ['BCA KrisFlyer']],
    ]);
    expect(names(null, 'zzz')).toEqual([]);
  });

  it('opens on the kind of what is chosen now, or Accounts when nothing is', () => {
    expect(openingPaymentTab(options, accounts, 'bonvoy', 'c2')).toBe('cards');
    expect(openingPaymentTab(options, accounts, 'krisflyer', '')).toBe('cards');
    expect(openingPaymentTab(options, accounts, 'bca', '')).toBe('accounts');
    expect(openingPaymentTab(options, accounts, '', '')).toBe('accounts');
  });
});

describe('the row Paid with marks as chosen', () => {
  it('is the row the purchase names, or the one row of an account whose purchase names its only card', () => {
    expect(pickedPayment(options, 'bonvoy', 'c2')?.last4).toBe('7788');
    // One card in use: the account is one row naming no card, and a purchase saved naming that card is on it.
    expect(pickedPayment(options, 'krisflyer', 'k1')?.accountName).toBe('BCA KrisFlyer');
    expect(pickedPayment(options, 'bca', '')?.accountName).toBe('BCA Tahapan');
  });

  it('is none for a purchase made on a card since removed, rather than another card on the account', () => {
    expect(pickedPayment(options, 'bonvoy', 'c-old')).toBeUndefined();
  });
});

describe('Paid with on a purchase made on a card since removed', () => {
  const cards: CardRow[] = [
    { id: 'c-old', accountId: 'bonvoy', last4: '1467', holderName: null, isPrimary: true, archived: true },
    { id: 'c1', accountId: 'bonvoy', last4: '5521', holderName: null, isPrimary: false, archived: false },
  ];
  const named = [...accounts.slice(0, 3), { ...account('bonvoy', 'liability'), name: 'Mandiri Bonvoy' }];

  it('reads as the account, with the removed card’s digits and that it was removed', () => {
    expect(removedCardPayment(cards, named, 'bonvoy', 'c-old')).toEqual({ value: 'Mandiri Bonvoy', caption: '···· 1467 · removed card' });
  });

  it('says nothing for a card still in use, no card, or a card on another account', () => {
    expect(removedCardPayment(cards, named, 'bonvoy', 'c1')).toBeNull();
    expect(removedCardPayment(cards, named, 'bonvoy', '')).toBeNull();
    expect(removedCardPayment(cards, named, 'krisflyer', 'c-old')).toBeNull();
  });
});
