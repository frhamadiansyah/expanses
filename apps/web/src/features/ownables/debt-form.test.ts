import { describe, expect, it } from 'vitest';
import { emptyDebtItemDraft, planNewDebt } from './debt-form';

const draft = (id: string, patch: Record<string, string>) => ({ ...emptyDebtItemDraft(id, '2026-09-18'), ...patch });

describe('planning a debt from the picker', () => {
  it('opens a loan account for what is still owed, and terms when the months left are known', () => {
    const plan = planNewDebt(draft('home_mortgage', { owed: '650000000', lender: 'Bank BTN', rate: '9', term: '168' }), 'IDR', '2026-09-18');
    expect(plan.account).toMatchObject({ kind: 'liability', subtype: 'loan', name: 'Bank BTN', openingBalanceMinor: 650_000_000 });
    expect(plan.terms).toMatchObject({
      lenderName: 'Bank BTN',
      originalMinor: 650_000_000,
      tenorMonths: 168,
      method: 'annuity',
      rateBps: 900,
      paymentDay: 18,
      firstPaymentOn: '2026-10-18',
      coretaxCode: '101',
    });
  });

  it('clamps a first payment past the 28th, so every month has the day', () => {
    expect(planNewDebt(draft('personal_loan', { owed: '10000000', lender: 'Bank Jago', term: '12' }), 'IDR', '2026-09-30').terms).toMatchObject({
      paymentDay: 28,
      firstPaymentOn: '2026-10-28',
      method: 'zero',
      rateBps: 0,
    });
  });

  it('opens the account alone when the months left are not known', () => {
    const plan = planNewDebt(draft('vehicle_leasing', { owed: '45000000', lender: 'Adira' }), 'IDR', '2026-09-18');
    expect(plan.account).toMatchObject({ subtype: 'loan', openingBalanceMinor: 45_000_000 });
    expect(plan.terms).toBeNull();
  });

  it('files a paylater as a bank debt and never asks it for a rate', () => {
    expect(planNewDebt(draft('online_loan', { owed: '2400000', lender: 'SPayLater', term: '6' }), 'IDR', '2026-09-18').terms).toMatchObject({ coretaxCode: '101', method: 'zero' });
  });

  it('files family under 103 and anything else under 109, as a debt to a person', () => {
    expect(planNewDebt(draft('affiliate_debt', { owed: '10000000', person: 'Ibu' }), 'IDR', '2026-09-18').person).toMatchObject({
      direction: 'borrowed',
      personName: 'Ibu',
      balanceMinor: 10_000_000,
      coretaxCode: '103',
    });
    expect(planNewDebt(draft('other_debt', { owed: '500000', person: 'Arisan RT' }), 'IDR', '2026-09-18').person).toMatchObject({ coretaxCode: '109' });
  });

  it('hands a credit card over rather than opening one itself', () => {
    expect(planNewDebt(draft('credit_card', {}), 'IDR', '2026-09-18')).toMatchObject({ handOver: 'card' });
  });

  it('says what is missing, in words meant for the screen', () => {
    expect(() => planNewDebt(draft('home_mortgage', { owed: '650000000', term: '168' }), 'IDR', '2026-09-18')).toThrow('Say who lent the money');
    expect(() => planNewDebt(draft('home_mortgage', { lender: 'Bank BTN' }), 'IDR', '2026-09-18')).toThrow('Enter how much is still owed');
    expect(() => planNewDebt(draft('affiliate_debt', { owed: '10000000' }), 'IDR', '2026-09-18')).toThrow('Say who this is with');
    expect(() => planNewDebt(draft('personal_loan', { owed: '1000000', lender: 'Andi', term: '0' }), 'IDR', '2026-09-18')).toThrow('A loan runs for at least one month');
  });
});
