import type { PaymentOption } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { openingPaymentTab, paymentSections } from './PaymentSheet';

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
