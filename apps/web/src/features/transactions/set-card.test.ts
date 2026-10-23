import { describe, expect, it } from 'vitest';
import { setCardAccount, sharedCard } from './set-card';

const visa = 'acct-visa';
const amex = 'acct-amex';
const bank = 'acct-bank';
const groceries = 'cat-groceries';
const isCreditCard = (id: string) => id === visa || id === amex;
const cards = [
  { accountId: visa, id: 'v1' },
  { accountId: visa, id: 'v2' },
  { accountId: amex, id: 'a1' },
];
const on = (account: string, cardId: string | null = null) => ({ cardId, entries: [{ accountId: groceries }, { accountId: account }] });

describe('Set card in select mode', () => {
  it('is offered when every ticked purchase is on one credit card account with two cards', () => {
    expect(setCardAccount([on(visa), on(visa, 'v1')], isCreditCard, cards)).toBe(visa);
  });

  it('is not offered for nothing ticked, for two card accounts, or for a purchase off the card', () => {
    expect(setCardAccount([], isCreditCard, cards)).toBeNull();
    expect(setCardAccount([on(visa), on(amex)], isCreditCard, [...cards, { accountId: amex, id: 'a2' }])).toBeNull();
    expect(setCardAccount([on(visa), on(bank)], isCreditCard, cards)).toBeNull();
  });

  it('is not offered for an account with one card', () => {
    expect(setCardAccount([on(amex)], isCreditCard, cards)).toBeNull();
  });

  it('is not offered for a transfer between two card accounts', () => {
    expect(setCardAccount([{ cardId: null, entries: [{ accountId: visa }, { accountId: amex }] }], isCreditCard, cards)).toBeNull();
  });

  it('marks the card they all already name, and none when they differ', () => {
    expect(sharedCard([on(visa, 'v1'), on(visa, 'v1')])).toBe('v1');
    expect(sharedCard([on(visa, 'v1'), on(visa, 'v2')])).toBe('');
    expect(sharedCard([on(visa), on(visa)])).toBe('');
  });
});
