import { describe, expect, it } from 'vitest';
import { payerPlan } from './bill-payer';

const accounts = [
  { id: 'bca', name: 'BCA', currency: 'IDR', kind: 'asset' },
  { id: 'wise', name: 'Wise USD', currency: 'USD', kind: 'asset' },
  { id: 'visa', name: 'Mandiri Visa', currency: 'IDR', kind: 'liability' },
];
const bill = (over: object) => ({ name: 'Internet', currency: null, amountMinor: 450_000 as number | null, moneyAccountId: 'bca', ...over });

describe('payerPlan', () => {
  it('with no choice, a bill is paid exactly as it is saved', () => {
    expect(payerPlan(bill({}), accounts, null, 'IDR')).toEqual({ payerId: 'bca', payerCurrency: 'IDR', billCurrency: 'IDR', foreign: false, refusal: null });
    expect(payerPlan(bill({ currency: 'SGD' }), accounts, null, 'IDR')).toMatchObject({ foreign: true, billCurrency: 'SGD', payerCurrency: 'IDR', refusal: null });
  });
  it('a chosen account in the same money changes only who pays', () => {
    expect(payerPlan(bill({}), accounts, 'visa', 'IDR')).toMatchObject({ payerId: 'visa', foreign: false, refusal: null });
  });
  it('a bill with its own currency is charged in the chosen account, and keeps its currency', () => {
    expect(payerPlan(bill({ currency: 'SGD' }), accounts, 'visa', 'IDR')).toMatchObject({ payerId: 'visa', billCurrency: 'SGD', payerCurrency: 'IDR', foreign: true });
    expect(payerPlan(bill({ currency: 'USD' }), accounts, 'wise', 'IDR')).toMatchObject({ foreign: false });
    expect(payerPlan(bill({ currency: 'SGD' }), accounts, 'wise', 'IDR')).toMatchObject({ payerCurrency: 'USD', foreign: true });
  });
  it('a fixed bill with no currency is refused on an account of other money, in words', () => {
    expect(payerPlan(bill({}), accounts, 'wise', 'IDR').refusal).toBe('Internet is in IDR; Wise USD holds USD. Pay it on its own.');
  });
  it('a bill that varies, with no currency, follows the chosen account', () => {
    expect(payerPlan(bill({ amountMinor: null }), accounts, 'wise', 'IDR')).toEqual({ payerId: 'wise', payerCurrency: 'USD', billCurrency: 'USD', foreign: false, refusal: null });
  });
  it('an account that is not there falls back to the bill own', () => {
    expect(payerPlan(bill({}), accounts, 'gone', 'IDR')).toMatchObject({ payerId: 'bca', refusal: null });
  });
});
