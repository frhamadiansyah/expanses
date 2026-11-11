import { describe, expect, it } from 'vitest';
import { billPay, cardPay, loanPay, personPay } from './pay-target';

describe('pay targets', () => {
  it('a loan instalment opens the loan page’s pay sheet; the extra its Pay extra sheet', () => {
    expect(loanPay('L1')).toEqual({ to: '/net-worth/loans/$accountId', params: { accountId: 'L1' }, search: { pay: 'due' } });
    expect(loanPay('L1', 'extra')).toEqual({ to: '/net-worth/loans/$accountId', params: { accountId: 'L1' }, search: { pay: 'extra' } });
  });
  it('a card, a bill and a Lend & borrow loan open their own', () => {
    expect(cardPay('C1')).toEqual({ to: '/cards/$cardId', params: { cardId: 'C1' }, search: { pay: true } });
    expect(billPay('B1')).toEqual({ to: '/bills/$billId', params: { billId: 'B1' }, search: { pay: true } });
    expect(personPay('P1')).toEqual({ to: '/net-worth/lend-borrow/loan/$accountId', params: { accountId: 'P1' }, search: { repay: true } });
  });
});
