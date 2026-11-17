import { CARD_CASHBACK, refundLines } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { offeredCategories } from '../categories/offered';
import { draftIn } from './move-workspace';
import { CARD_CASHBACK_CHOICE, cardCashbackOffered, emptyForm, type FormDraft, formToPost, isCardCashbackChoice, withCardCashback, withoutStrayCashback } from './tx-form';

// Invented: a Rp 75.000 promo cashback onto BCA Visa.
const accounts = [
  { id: 'acct-bank', name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', archivedAt: null },
  { id: 'acct-card', name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR', archivedAt: null },
  { id: 'acct-gopay', name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR', archivedAt: null },
  { id: 'cat-groceries', name: 'Groceries', kind: 'expense', subtype: 'category', currency: null, systemKey: 'household.groceries', parentId: null, archivedAt: null },
  { id: 'cat-cashback', name: 'Cashback & Rewards', kind: 'expense', subtype: 'category', currency: null, systemKey: CARD_CASHBACK.key, parentId: null, archivedAt: null },
] as AccountRow[];

const cashback: FormDraft = { ...emptyForm('ws-1'), mode: 'expense', moneyId: 'acct-card', amount: '-75000', description: 'Promo cashback', categoryId: CARD_CASHBACK_CHOICE };

describe('Cashback & Rewards on the Add screen', () => {
  it('is offered only for money back (a minus first) into a credit card', () => {
    expect(cardCashbackOffered(cashback, accounts)).toBe(true);
    expect(cardCashbackOffered({ ...cashback, amount: '−75000' }, accounts)).toBe(true);
    // A purchase on the card, money back into a bank or a wallet, and income are not.
    expect(cardCashbackOffered({ ...cashback, amount: '75000' }, accounts)).toBe(false);
    expect(cardCashbackOffered({ ...cashback, moneyId: 'acct-bank' }, accounts)).toBe(false);
    expect(cardCashbackOffered({ ...cashback, moneyId: 'acct-gopay' }, accounts)).toBe(false);
    expect(cardCashbackOffered({ ...cashback, mode: 'income' }, accounts)).toBe(false);
    expect(cardCashbackOffered({ ...cashback, moneyId: '' }, accounts)).toBe(false);
  });

  it('is never in the ordinary list of spending categories (nor the editor, which reads the same list)', () => {
    expect(offeredCategories(accounts, 'expense', {}, () => true).map((a) => a.id)).toEqual(['cat-groceries']);
  });

  it('knows the choice by its stand-in and by the category itself', () => {
    expect(isCardCashbackChoice(CARD_CASHBACK_CHOICE, accounts)).toBe(true);
    expect(isCardCashbackChoice('cat-cashback', accounts)).toBe(true);
    expect(isCardCashbackChoice('cat-groceries', accounts)).toBe(false);
    expect(isCardCashbackChoice('', accounts)).toBe(false);
  });

  it('posts as money back into the card under the book’s own Cashback & Rewards once Save has made it', () => {
    const post = formToPost(withCardCashback(cashback, 'cat-cashback'), accounts);
    expect(post.kind === 'post' && post.input.lines).toEqual(refundLines({ categoryAccountId: 'cat-cashback', paymentAccountId: 'acct-card', amountMinor: 75_000, currency: 'IDR' }));
    // Any other category is left as it is.
    expect(withCardCashback({ ...cashback, categoryId: 'cat-groceries' }, 'cat-cashback').categoryId).toBe('cat-groceries');
  });

  it('is refused anywhere else, so it can never be saved on a purchase or into a bank', () => {
    const refusal = 'Cashback & Rewards is money back into a credit card: start the amount with a minus and choose the card in Into';
    expect(() => formToPost({ ...cashback, categoryId: 'cat-cashback', amount: '75000' }, accounts)).toThrow(refusal);
    expect(() => formToPost({ ...cashback, categoryId: 'cat-cashback', moneyId: 'acct-bank' }, accounts)).toThrow(refusal);
  });

  it('is cleared when Into stops being a credit card or the minus goes, and kept otherwise', () => {
    expect(withoutStrayCashback({ ...cashback, moneyId: 'acct-bank' }, accounts).categoryId).toBe('');
    expect(withoutStrayCashback({ ...cashback, categoryId: 'cat-cashback', amount: '75000' }, accounts).categoryId).toBe('');
    expect(withoutStrayCashback(cashback, accounts)).toBe(cashback);
    // Groceries on a refund into a bank is an ordinary refund: left alone.
    const groceries = { ...cashback, categoryId: 'cat-groceries', moneyId: 'acct-bank' };
    expect(withoutStrayCashback(groceries, accounts)).toBe(groceries);
    // While the accounts are still loading nothing is known, so nothing is cleared.
    expect(withoutStrayCashback({ ...cashback, categoryId: 'cat-cashback' }, [])).toMatchObject({ categoryId: 'cat-cashback' });
  });

  it('moves to another workspace as the stand-in, so Save makes that workspace’s own', () => {
    const books = { 'cat-cashback': 'book-1', 'cat-groceries': 'book-1' };
    expect(draftIn({ ...cashback, categoryId: 'cat-cashback' }, 'book-2', accounts, books)).toEqual({ draft: { ...cashback, categoryId: CARD_CASHBACK_CHOICE }, missing: [] });
    expect(draftIn(cashback, 'book-2', accounts, books)).toEqual({ draft: cashback, missing: [] });
  });
});
