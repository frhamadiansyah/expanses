import type { PeopleDebts, PersonDebtRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import {
  type DebtDraft,
  DEFAULT_SUB_CATEGORY,
  debtDraftToInput,
  emptyDebtDraft,
  personSuggestions,
  type RepaymentDraft,
  repaymentDraftToInput,
  subCategories,
  subCategoryGloss,
} from './debts-form';

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

  it('files the loan under the sub-category chosen, whatever it is', () => {
    // Opening on the ledger's own default, and overriding it is what the form's row is for.
    expect(debtDraftToInput(draft(), 'IDR', TODAY).coretaxCode).toBe(DEFAULT_SUB_CATEGORY.lent);
    expect(debtDraftToInput(draft({ subCategory: '0202' }), 'IDR', TODAY).coretaxCode).toBe('0202');
    expect(debtDraftToInput(draft({ direction: 'borrowed', subCategory: '103' }), 'IDR', TODAY).coretaxCode).toBe('103');
  });

  it('files a loan added to somebody already on the list too: the sub-category is theirs, and it can change', () => {
    const input = debtDraftToInput(draft({ existingAccountId: 'andi-account', subCategory: '0209' }), 'IDR', TODAY);

    expect(input).toMatchObject({ debtAccountId: 'andi-account', coretaxCode: '0209' });
    expect(input.person).toBeUndefined();
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

describe('the sub-categories a loan can file as', () => {
  it('offers the three piutang for money lent, in the catalogue’s words', () => {
    expect(subCategories('lent').map((choice) => [choice.code, choice.label])).toEqual([
      ['0201', 'Trade receivables'],
      ['0202', 'Affiliate receivables'],
      ['0209', 'Other receivables'],
    ]);
  });

  it('offers the two utang a person’s debt can be, and never a bank loan', () => {
    // `101` is a bank or finance-company loan: it has terms and a schedule, and is opened as one.
    expect(subCategories('borrowed').map((choice) => [choice.code, choice.label])).toEqual([
      ['103', 'Affiliate debt — family or a related company'],
      ['109', 'Other debts'],
    ]);
  });

  it('glosses each one the way the tax report names it', () => {
    expect(subCategoryGloss('lent', '0201')).toBe('Piutang usaha');
    expect(subCategoryGloss('borrowed', '109')).toBe('Utang lainnya');
    // A code the report does not know leaves the form saying what the row is for rather than a blank.
    expect(subCategoryGloss('lent', '9999')).toBe('');
  });
});
