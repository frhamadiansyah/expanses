import type { PeopleDebts, PersonDebtRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { type DebtDraft, debtDraftToInput, emptyDebtDraft, personSuggestions, type RepaymentDraft, repaymentDraftToInput } from './debts-form';

const TODAY = '2026-09-12';

const draft = (overrides: Partial<DebtDraft> = {}): DebtDraft => ({ ...emptyDebtDraft(TODAY), personName: 'Andi', amount: '10.000.000', moneyId: 'bca', ...overrides });

const person = (personName: string, direction: PersonDebtRow['direction'] = 'lent'): PersonDebtRow => ({
  personName,
  direction,
  currency: 'IDR',
  totalMinor: 1_000_000,
  loans: [],
  dueState: 'none',
});

const people: PeopleDebts = {
  owedToYou: [person('Andi'), person('Andini')],
  youOwe: [person('Budi', 'borrowed')],
  settled: [person('Citra')],
};

describe('debtDraftToInput', () => {
  it('reads an amount typed the Indonesian way', () => {
    const input = debtDraftToInput(draft(), 'IDR', TODAY);

    expect(input).toMatchObject({ amountMinor: 10_000_000, moneyAccountId: 'bca', occurredOn: TODAY });
    expect(input.person).toMatchObject({ name: 'Andi', direction: 'lent', currency: 'IDR' });
  });

  it('borrows when the direction says so', () => {
    const input = debtDraftToInput(draft({ direction: 'borrowed' }), 'IDR', TODAY);

    expect(input.person).toMatchObject({ direction: 'borrowed' });
  });

  it('uses the account a person already has instead of opening another', () => {
    const input = debtDraftToInput(draft({ existingAccountId: 'andi-account' }), 'IDR', TODAY);

    expect(input.debtAccountId).toBe('andi-account');
    expect(input.person).toBeUndefined();
  });

  it('keeps the category and MCC when a card paid, and drops them otherwise', () => {
    const onCard = debtDraftToInput(draft({ moneyId: 'card', moneyIsCard: true, spendCategoryId: 'shopping', mcc: '5311' }), 'IDR', TODAY);
    expect(onCard).toMatchObject({ spendCategoryId: 'shopping', mcc: '5311' });

    const fromBank = debtDraftToInput(draft({ spendCategoryId: 'shopping', mcc: '5311' }), 'IDR', TODAY);
    expect(fromBank.spendCategoryId).toBeNull();
    expect(fromBank.mcc).toBeNull();
  });

  it('carries the reason, the due date and the ID number when given', () => {
    const input = debtDraftToInput(draft({ reason: 'Motorcycle repair', dueOn: '2026-12-31', personIdNumber: '3174010101900001' }), 'IDR', TODAY);

    expect(input.person).toMatchObject({ reason: 'Motorcycle repair', dueOn: '2026-12-31', personIdNumber: '3174010101900001' });
  });

  it('says what is missing, in plain words', () => {
    expect(() => debtDraftToInput(draft({ personName: '  ', existingAccountId: '' }), 'IDR', TODAY)).toThrow(/who this is with/);
    expect(() => debtDraftToInput(draft({ amount: '' }), 'IDR', TODAY)).toThrow(/how much/);
    expect(() => debtDraftToInput(draft({ amount: 'abc' }), 'IDR', TODAY)).toThrow(/must be a number/);
    expect(() => debtDraftToInput(draft({ moneyId: '' }), 'IDR', TODAY)).toThrow(/which account/);
    expect(() => debtDraftToInput(draft({ occurredOn: '2026-09-13' }), 'IDR', TODAY)).toThrow(/after today/);
  });
});

describe('repaymentDraftToInput', () => {
  const repayment = (overrides: Partial<RepaymentDraft> = {}): RepaymentDraft => ({ amount: '3.000.000', interest: '', occurredOn: TODAY, moneyId: 'bca', ...overrides });

  it('reads the amount and leaves interest at zero', () => {
    const input = repaymentDraftToInput(repayment(), 'andi', 'IDR', 10_000_000, 'Andi');

    expect(input).toMatchObject({ debtAccountId: 'andi', amountMinor: 3_000_000, interestMinor: 0, moneyAccountId: 'bca' });
  });

  it('reads interest when it was typed', () => {
    const input = repaymentDraftToInput(repayment({ interest: '200.000' }), 'andi', 'IDR', 10_000_000, 'Andi');

    expect(input.interestMinor).toBe(200_000);
  });

  it('refuses more than is owed, naming the person', () => {
    expect(() => repaymentDraftToInput(repayment({ amount: '12.000.000' }), 'andi', 'IDR', 9_000_000, 'Andi')).toThrow(/Andi owes Rp\s?9\.000\.000/);
  });

  it('refuses an empty or unreadable amount', () => {
    expect(() => repaymentDraftToInput(repayment({ amount: '' }), 'andi', 'IDR', 9_000_000, 'Andi')).toThrow(/how much came back/);
    expect(() => repaymentDraftToInput(repayment({ amount: 'abc' }), 'andi', 'IDR', 9_000_000, 'Andi')).toThrow(/must be a number/);
  });
});

describe('personSuggestions', () => {
  it('suggests names already used, whatever the case', () => {
    expect(personSuggestions(people, 'an')).toEqual(['Andi', 'Andini']);
    expect(personSuggestions(people, 'BU')).toEqual(['Budi']);
  });

  it('looks at settled people too, since they may borrow again', () => {
    expect(personSuggestions(people, 'ci')).toEqual(['Citra']);
  });

  it('says nothing until something is typed', () => {
    expect(personSuggestions(people, '  ')).toEqual([]);
  });

  it('never repeats a name that is on both sides', () => {
    const both: PeopleDebts = { owedToYou: [person('Andi')], youOwe: [person('Andi', 'borrowed')], settled: [] };

    expect(personSuggestions(both, 'andi')).toEqual(['Andi']);
  });
});
