import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { emptyForm, type FormDraft, formToPost, isExpenseTopUp, topUpWallets } from './tx-form';

const accounts = [
  { id: 'card', name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' },
  { id: 'gopay', name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR' },
  { id: 'ovo-usd', name: 'Travel wallet', kind: 'asset', subtype: 'ewallet', currency: 'USD' },
  { id: 'bank', name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' },
  { id: 'fees', name: 'Fees & charges', kind: 'expense', subtype: 'category', currency: null, systemKey: 'miscellaneous.fees_charges' },
  { id: 'topups', name: 'Top-ups', kind: 'expense', subtype: 'category', currency: null, systemKey: 'miscellaneous.top_ups' },
  { id: 'groceries', name: 'Groceries', kind: 'expense', subtype: 'category', currency: null, systemKey: 'household.groceries' },
] as AccountRow[];

const topUp: FormDraft = {
  ...emptyForm('b'),
  mode: 'expense',
  moneyId: 'card',
  categoryId: 'topups',
  toId: 'gopay',
  amount: '1010000',
  fee: '10000',
  feeCategoryId: 'fees',
  occurredOn: '2026-10-22',
  description: 'GoPay top-up',
};

const linesOf = (draft: FormDraft) => {
  const post = formToPost(draft, accounts);
  if (post.kind !== 'post') throw new Error('expected a post');
  return post.input.lines;
};

describe('a card purchase under Top-ups', () => {
  it('is a top-up: the typed amount is the charge, what lands is the charge less the fee, the fee is spending', () => {
    expect(isExpenseTopUp(topUp, accounts)).toBe(true);
    expect(linesOf(topUp)).toEqual([
      { accountId: 'gopay', amountMinor: 1_000_000, currency: 'IDR' },
      { accountId: 'card', amountMinor: -1_010_000, currency: 'IDR', spendCategoryId: 'topups' },
      { accountId: 'fees', amountMinor: 10_000, currency: 'IDR' },
    ]);
  });

  it('with no fee lands the whole charge, and finds Fees & charges itself when the fee was typed without one', () => {
    expect(linesOf({ ...topUp, fee: '', feeCategoryId: '' })).toEqual([
      { accountId: 'gopay', amountMinor: 1_010_000, currency: 'IDR' },
      { accountId: 'card', amountMinor: -1_010_000, currency: 'IDR', spendCategoryId: 'topups' },
    ]);
    expect(linesOf({ ...topUp, feeCategoryId: '' })[2]).toEqual({ accountId: 'fees', amountMinor: 10_000, currency: 'IDR' });
  });

  it('needs the wallet it went into, in the card’s currency, and a fee less than the charge', () => {
    expect(() => formToPost({ ...topUp, toId: '' }, accounts)).toThrow('Choose the wallet it went into');
    expect(() => formToPost({ ...topUp, toId: 'bank' }, accounts)).toThrow('Choose the wallet it went into');
    expect(() => formToPost({ ...topUp, toId: 'ovo-usd' }, accounts)).toThrow('Choose a wallet that holds IDR');
    expect(() => formToPost({ ...topUp, fee: '1010000' }, accounts)).toThrow('The fee must be less than the amount charged');
  });

  it('refuses a split and people on the bill', () => {
    expect(() => formToPost({ ...topUp, splits: [{ categoryId: 'groceries', amount: '10000' }] }, accounts)).toThrow('A top-up goes under Top-ups alone');
    expect(() => formToPost({ ...topUp, with: [{ debtAccountId: '', name: 'Dewi', amount: '' }] }, accounts)).toThrow();
  });

  it('stays an ordinary expense paid from anything but a card, and under any other category', () => {
    const fromBank = { ...topUp, moneyId: 'bank' };
    expect(isExpenseTopUp(fromBank, accounts)).toBe(false);
    expect(linesOf(fromBank)).toEqual([
      { accountId: 'topups', amountMinor: 1_010_000, currency: 'IDR', memo: null },
      { accountId: 'bank', amountMinor: -1_010_000, currency: 'IDR' },
    ]);
    const groceries = { ...topUp, categoryId: 'groceries' };
    expect(isExpenseTopUp(groceries, accounts)).toBe(false);
    expect(linesOf(groceries)).toEqual([
      { accountId: 'groceries', amountMinor: 1_010_000, currency: 'IDR', memo: null },
      { accountId: 'card', amountMinor: -1_010_000, currency: 'IDR' },
    ]);
  });

  it('offers only digital wallets in the card’s currency as Into', () => {
    expect(topUpWallets(accounts[0], accounts).map((a) => a.id)).toEqual(['gopay']);
    expect(topUpWallets(accounts.find((a) => a.id === 'bank'), accounts)).toEqual([]);
  });
});
