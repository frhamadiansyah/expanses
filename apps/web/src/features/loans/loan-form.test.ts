import type { ScheduleRow } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  emptyLoanTermsDraft,
  type LoanTermsDraft,
  loanTermsDraftToInput,
  type PaymentDraft,
  paymentDraftFrom,
  paymentDraftToInput,
} from './loan-form';

const TODAY = '2026-09-12';

const draft = (overrides: Partial<LoanTermsDraft> = {}): LoanTermsDraft => ({
  ...emptyLoanTermsDraft('kpr', TODAY),
  lenderName: 'Bank BTN',
  originalAmount: '700.000.000',
  firstPaymentOn: '2026-01-25',
  tenorMonths: '180',
  paymentDay: '25',
  rate: '9',
  ...overrides,
});

const row = (partial: Partial<ScheduleRow> = {}): ScheduleRow => ({
  onDate: '2026-10-25',
  paymentMinor: 7_099_866,
  principalMinor: 1_849_866,
  interestMinor: 5_250_000,
  balanceMinor: 698_150_134,
  ...partial,
});

describe('loanTermsDraftToInput', () => {
  it('reads amounts and a rate typed the Indonesian way', () => {
    const input = loanTermsDraftToInput(draft(), 'IDR');

    expect(input).toMatchObject({
      accountId: 'kpr',
      lenderName: 'Bank BTN',
      originalMinor: 700_000_000,
      tenorMonths: 180,
      paymentDay: 25,
      rateBps: 900,
      method: 'annuity',
    });
  });

  it('reads a rate with a comma, as Indonesians write it', () => {
    expect(loanTermsDraftToInput(draft({ rate: '9,25' }), 'IDR').rateBps).toBe(925);
  });

  it('keeps the payment the bank asks for, when one is typed', () => {
    expect(loanTermsDraftToInput(draft({ payment: '7.100.000' }), 'IDR').paymentMinor).toBe(7_100_000);
  });

  it('carries the asset the loan bought', () => {
    expect(loanTermsDraftToInput(draft({ assetAccountId: 'house' }), 'IDR').assetAccountId).toBe('house');
  });

  it('leaves an empty asset, NPWP and purpose off', () => {
    const input = loanTermsDraftToInput(draft(), 'IDR');

    expect(input.assetAccountId).toBeNull();
    expect(input.lenderNpwp).toBeNull();
    expect(input.purpose).toBeNull();
  });

  it('says what is missing, in plain words', () => {
    expect(() => loanTermsDraftToInput(draft({ lenderName: '  ' }), 'IDR')).toThrow(/who lent/i);
    expect(() => loanTermsDraftToInput(draft({ originalAmount: '' }), 'IDR')).toThrow(/how much/i);
    expect(() => loanTermsDraftToInput(draft({ originalAmount: 'abc' }), 'IDR')).toThrow(/must be a number/);
    expect(() => loanTermsDraftToInput(draft({ tenorMonths: '0' }), 'IDR')).toThrow(/at least one month/);
    expect(() => loanTermsDraftToInput(draft({ paymentDay: '29' }), 'IDR')).toThrow(/between 1 and 28/);
    expect(() => loanTermsDraftToInput(draft({ firstPaymentOn: 'soon' }), 'IDR')).toThrow(/first payment/i);
  });

  it('accepts a flat loan, keeping the rate the lender quoted', () => {
    const input = loanTermsDraftToInput(draft({ method: 'flat', rate: '5' }), 'IDR');

    expect(input).toMatchObject({ method: 'flat', rateBps: 500 });
  });
});

describe('paymentDraftFrom', () => {
  it('fills the form in from the row the schedule says is next, dated today', () => {
    const filled = paymentDraftFrom(row(), TODAY, 'bca', 'IDR');

    // The row falls due later; the money moves now, so the date is today and the split is the row's.
    expect(filled).toMatchObject({ occurredOn: TODAY, moneyId: 'bca' });
    // Plain figures: the box has to be readable back by parseMajor when it is saved.
    expect(filled.principal).toBe('1849866');
    expect(filled.interest).toBe('5250000');
  });

  it('keeps the date of a payment that was already due, so a late one records truthfully', () => {
    const filled = paymentDraftFrom(row({ onDate: '2026-08-25' }), TODAY, 'bca', 'IDR');

    expect(filled.occurredOn).toBe('2026-08-25');
  });

  it('leaves the form blank rather than guessing when nothing is scheduled', () => {
    const filled = paymentDraftFrom(undefined, TODAY, 'bca', 'IDR');

    expect(filled).toMatchObject({ occurredOn: TODAY, principal: '', interest: '', moneyId: 'bca' });
  });
});

describe('paymentDraftToInput', () => {
  const payment = (overrides: Partial<PaymentDraft> = {}): PaymentDraft => ({
    occurredOn: '2026-10-25',
    moneyId: 'bca',
    principal: '1.849.866',
    interest: '5.250.000',
    extras: [],
    ...overrides,
  });

  it('reads the split as typed', () => {
    const input = paymentDraftToInput(payment(), 'kpr', 'IDR', 700_000_000, 'KPR Bintaro', '2026-10-25');

    expect(input).toMatchObject({ accountId: 'kpr', principalMinor: 1_849_866, interestMinor: 5_250_000, moneyAccountId: 'bca' });
  });

  it('keeps extras that name a category, and drops the rest', () => {
    const input = paymentDraftToInput(
      payment({ extras: [{ categoryId: 'insurance', amount: '150.000' }, { categoryId: '', amount: '50.000' }, { categoryId: 'admin', amount: '' }] }),
      'kpr',
      'IDR',
      700_000_000,
      'KPR Bintaro',
      '2026-10-25',
    );

    expect(input.extras).toEqual([{ categoryId: 'insurance', amountMinor: 150_000 }]);
  });

  it('refuses more principal than is left, naming the loan', () => {
    expect(() => paymentDraftToInput(payment({ principal: '800.000.000' }), 'kpr', 'IDR', 700_000_000, 'KPR Bintaro', '2026-10-25')).toThrow(/KPR Bintaro/);
  });

  it('refuses a payment of nothing', () => {
    expect(() => paymentDraftToInput(payment({ principal: '', interest: '' }), 'kpr', 'IDR', 700_000_000, 'KPR Bintaro', '2026-10-25')).toThrow(/what was paid/i);
  });

  it('allows a payment that is all interest', () => {
    const input = paymentDraftToInput(payment({ principal: '' }), 'kpr', 'IDR', 700_000_000, 'KPR Bintaro', '2026-10-25');

    expect(input).toMatchObject({ principalMinor: 0, interestMinor: 5_250_000 });
  });

  it('refuses a date in the future', () => {
    expect(() => paymentDraftToInput(payment({ occurredOn: '2099-01-01' }), 'kpr', 'IDR', 700_000_000, 'KPR Bintaro', TODAY)).toThrow(/after today/);
  });
});
