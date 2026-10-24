import { CATALOG } from '@expanses/catalog';
import { describe, expect, it } from 'vitest';
import { cardAccountName, emptyDebtItemDraft, emptyNewCardDraft, issuerInName, type NewCardDraft, planNewCard, planNewDebt, splitCardName } from './debt-form';

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

describe('planning a card before anything is written', () => {
  const entryFor = (id: string) => {
    const entry = CATALOG.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`The catalogue no longer carries "${id}"`);
    return entry;
  };
  /** A card whose earning depends on the holder's standing with the bank, so a level has to be chosen. */
  const tiered = entryFor('jenius-platinum');
  const plain = entryFor('bca-unionpay');
  const card = (patch: Partial<NewCardDraft>) => ({ ...emptyNewCardDraft(), ...patch });

  it('refuses a card that earns by level until the level is chosen, so no account is opened first', () => {
    expect(() => planNewCard(card({ name: 'Jenius', statementDay: '25', dueDay: '12' }), tiered, 'IDR')).toThrow(/Choose the level before adding it/);
    expect(planNewCard(card({ name: 'Jenius', memberLevel: 'grow-plus', statementDay: '25', dueDay: '12' }), tiered, 'IDR')).toMatchObject({
      memberLevel: 'grow-plus',
      terms: { statementDay: 25, dueDay: 12 },
    });
  });

  it('takes the bank, the currency and the level from the entry, and the bank as typed without one', () => {
    expect(planNewCard(card({ name: 'BCA UnionPay', statementDay: '25', dueDay: '12' }), plain, 'IDR')).toMatchObject({ issuer: 'BCA', currency: 'IDR', memberLevel: null });
    expect(planNewCard(card({ name: 'Kartu lama', issuer: 'Bank Mega' }), null, 'IDR')).toMatchObject({ issuer: 'Bank Mega', terms: null });
  });

  it('opens a card from the catalogue with no dates at all: no terms, which its page asks for later', () => {
    expect(planNewCard(card({ name: 'BCA UnionPay', last4: '4821' }), plain, 'IDR')).toEqual({
      name: 'BCA UnionPay',
      issuer: 'BCA',
      last4: '4821',
      currency: 'IDR',
      openingBalanceMinor: 0,
      memberLevel: null,
      terms: null,
    });
    // Blanks are no dates either: a day typed and cleared again is not half of the terms.
    expect(planNewCard(card({ name: 'BCA UnionPay', statementDay: ' ', dueDay: '' }), plain, 'IDR').terms).toBeNull();
  });

  it('refuses one date without the other, whichever is missing, for any card', () => {
    const half = 'Give both the billing date and the due date, or leave both for later';
    expect(() => planNewCard(card({ name: 'BCA UnionPay', statementDay: '25' }), plain, 'IDR')).toThrow(half);
    expect(() => planNewCard(card({ name: 'BCA UnionPay', dueDay: '12' }), plain, 'IDR')).toThrow(half);
    expect(() => planNewCard(card({ name: 'Kartu lama', statementDay: '25' }), null, 'IDR')).toThrow(half);
  });

  it('takes the billing date from an issuer that closes every statement on one day, once a due date is given', () => {
    const fixed = entryFor('cimb-niaga-world-all-accor');
    expect(planNewCard(card({ name: fixed.name, dueDay: '12' }), fixed, 'IDR').terms).toEqual({ statementDay: 22, dueDay: 12 });
    // A day typed over the issuer's is the holder's own, and stands.
    expect(planNewCard(card({ name: fixed.name, statementDay: '20', dueDay: '12' }), fixed, 'IDR').terms).toEqual({ statementDay: 20, dueDay: 12 });
    // Nothing typed is still nothing: the issuer's day alone is not terms.
    expect(planNewCard(card({ name: fixed.name }), fixed, 'IDR').terms).toBeNull();
  });

  it('reads what is owed now in the card’s own currency, and nothing typed as nothing owed', () => {
    expect(planNewCard(card({ name: 'BCA UnionPay', owed: '1.250.000' }), plain, 'IDR').openingBalanceMinor).toBe(1_250_000);
    expect(planNewCard(card({ name: 'BCA UnionPay' }), plain, 'IDR').openingBalanceMinor).toBe(0);
    // A hand-typed card in dollars keeps its cents; the catalogue card above is read in the entry's rupiah.
    expect(planNewCard(card({ name: 'Travel card', owed: '120.50' }), null, 'IDR', 'USD')).toMatchObject({ currency: 'USD', openingBalanceMinor: 12_050 });
  });

  it('says what is missing, in words meant for the screen', () => {
    expect(() => planNewCard(card({ statementDay: '25', dueDay: '12' }), plain, 'IDR')).toThrow('Give the card a name');
    expect(() => planNewCard(card({ name: 'BCA UnionPay', statementDay: '25', dueDay: '40' }), plain, 'IDR')).toThrow('The due date is a day of the month, 1 to 31');
    expect(() => planNewCard(card({ name: 'BCA UnionPay', statementDay: 'soon', dueDay: '12' }), plain, 'IDR')).toThrow('The billing date is a day of the month, 1 to 31');
    expect(() => planNewCard(card({ name: 'Kartu lama', owed: 'lots' }), null, 'IDR')).toThrow('The amount must be a number');
  });
});

describe('the bank a hand-typed card name already says', () => {
  const banks = ['BCA', 'BNI', 'CIMB', 'CIMB Niaga', 'Mandiri', 'blu by BCA Digital'];

  it('is the bank its leading words name, whatever their case', () => {
    expect(issuerInName('Mandiri Signature', banks)).toBe('Mandiri');
    expect(issuerInName('bca everyday', banks)).toBe('BCA');
    expect(issuerInName('  BCA  ', banks)).toBe('BCA');
    // Of two banks that both lead the name, the longer is the more exact.
    expect(issuerInName('CIMB Niaga World', banks)).toBe('CIMB Niaga');
    expect(issuerInName('CIMB Octo', banks)).toBe('CIMB');
    expect(issuerInName('Blu by BCA Digital card', banks)).toBe('blu by BCA Digital');
  });

  it('is nothing when no bank leads the name — a bank later in it, or part of a word, is not one', () => {
    expect(issuerInName('Travel card', banks)).toBeNull();
    expect(issuerInName('Bcaxyz Gold', banks)).toBeNull();
    expect(issuerInName('My BCA card', banks)).toBeNull();
    expect(issuerInName('', banks)).toBeNull();
    expect(issuerInName('Mandiri', [])).toBeNull();
  });
});

describe('a hand-typed card name on the bank-and-name row, and back', () => {
  const banks = ['BCA', 'CIMB Niaga', 'Mandiri'];

  it('splits off the bank its name leads with, and keeps the rest as the card’s own name', () => {
    expect(splitCardName('Mandiri Signature', banks)).toEqual({ bank: 'Mandiri', name: 'Signature' });
    expect(splitCardName('  cimb   niaga World Mastercard ', banks)).toEqual({ bank: 'CIMB Niaga', name: 'World Mastercard' });
    // The bank alone is still the card's name; no bank leaves the name whole.
    expect(splitCardName('BCA', banks)).toEqual({ bank: 'BCA', name: 'BCA' });
    expect(splitCardName('Travel card', banks)).toEqual({ bank: '', name: 'Travel card' });
    expect(splitCardName('Bcaxyz Gold', banks)).toEqual({ bank: '', name: 'Bcaxyz Gold' });
  });

  it('saves the two read together, never naming the bank twice', () => {
    expect(cardAccountName('Mandiri', 'Signature')).toBe('Mandiri Signature');
    expect(cardAccountName('Mandiri', 'Mandiri Signature')).toBe('Mandiri Signature');
    expect(cardAccountName('BCA', 'BCA')).toBe('BCA');
    expect(cardAccountName('', 'Travel card')).toBe('Travel card');
    expect(cardAccountName(' UOB ', ' PRVI ')).toBe('UOB PRVI');
    // No name is no name, whatever the bank: the plan refuses it in words.
    expect(cardAccountName('BCA', '  ')).toBe('');
  });

  it('round-trips: what was searched for is what is saved', () => {
    for (const typed of ['Mandiri Signature', 'CIMB Niaga World', 'Travel card', 'BCA']) {
      const { bank, name } = splitCardName(typed, banks);
      expect(cardAccountName(bank, name)).toBe(typed);
    }
  });
});
