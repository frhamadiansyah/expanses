import { describe, expect, it } from 'vitest';
import { debtDetailsFilled, debtDraftFor, debtDraftReady, debtDraftToInput, lentOutflowMinor, loanMoneyAccounts, loanNamed, openLoansWith } from './debts-form';
import { newDebtPath, openingSide, sideOf } from './sides';

describe('the two sides of Lend & borrow', () => {
  it('files money lent under Receivables and money borrowed under Payables', () => {
    expect(sideOf('lent')).toBe('owed');
    expect(sideOf('borrowed')).toBe('owe');
  });

  it('adds to each side on its own screen', () => {
    expect(newDebtPath('owed')).toBe('/net-worth/lend-borrow/new-receivable');
    expect(newDebtPath('owe')).toBe('/net-worth/lend-borrow/new-payable');
  });

  it('opens on the side the address asks for, which is how saving lands on what was just added to', () => {
    expect(openingSide({ asked: 'owe', owedToYouCount: 3 })).toBe('owe');
    expect(openingSide({ asked: 'owed', person: 'Dewi', owedToYouCount: 0 })).toBe('owed');
  });

  it('otherwise opens on the side a named person is on, and on Receivables for everyone', () => {
    expect(openingSide({ person: 'Dewi', owedToYouCount: 0 })).toBe('owe');
    expect(openingSide({ person: 'Dewi', owedToYouCount: 1 })).toBe('owed');
    expect(openingSide({ owedToYouCount: 0 })).toBe('owed');
  });
});

describe('a draft for one side', () => {
  it('takes the side from the screen, and leaves the sub-category for the reader to choose', () => {
    const lent = debtDraftFor('lent', '2026-09-27');
    const borrowed = debtDraftFor('borrowed', '2026-09-27');
    expect(lent.direction).toBe('lent');
    expect(borrowed.direction).toBe('borrowed');
    // Blank, never assumed: ✓ stays dim until one is picked.
    expect(lent.subCategory).toBe('');
    expect(borrowed.subCategory).toBe('');
  });

  it('asks for a sub category on a new loan, and not on money added to one of theirs', () => {
    const base = { ...debtDraftFor('lent', '2026-09-27', 'Dewi'), amount: '100.000', moneyId: 'bca' };
    expect(() => debtDraftToInput(base, 'IDR', '2026-09-27')).toThrow(/Choose a type/);
    expect(debtDraftToInput({ ...base, subCategory: '0202' }, 'IDR', '2026-09-27').coretaxCode).toBe('0202');
    expect(debtDraftToInput({ ...base, existingAccountId: 'dewi-loan' }, 'IDR', '2026-09-27').debtAccountId).toBe('dewi-loan');
  });

  it('starts with the person Lend & borrow was showing, and with nobody otherwise', () => {
    expect(debtDraftFor('lent', '2026-09-27', 'Dewi').personName).toBe('Dewi');
    expect(debtDraftFor('lent', '2026-09-27').personName).toBe('');
    expect(debtDraftFor('borrowed', '2026-09-27').occurredOn).toBe('2026-09-27');
  });
});

describe('the accounts a loan moves through', () => {
  const money = [
    { id: 'bca', kind: 'asset', subtype: 'bank' },
    { id: 'wallet', kind: 'asset', subtype: 'cash' },
    { id: 'cheque', kind: 'asset', subtype: 'other_cash' },
    { id: 'card', kind: 'liability', subtype: 'credit_card' },
  ];
  const ids = (direction: 'lent' | 'borrowed') => loanMoneyAccounts(money, direction).map((account) => account.id);

  it('lends from money you hold or from a card, which is how paying for a friend on your card is recorded', () => {
    expect(ids('lent')).toEqual(['bca', 'wallet', 'card']);
  });

  it('takes borrowed money only into money you hold — never onto a card', () => {
    expect(ids('borrowed')).toEqual(['bca', 'wallet']);
  });

  it('never moves a loan through a cheque, either way: a cheque is recorded where it is deposited', () => {
    expect(ids('lent')).not.toContain('cheque');
    expect(ids('borrowed')).not.toContain('cheque');
  });
});

describe('a fee typed on a loan', () => {
  const base = { ...debtDraftFor('lent', '2026-09-27', 'Toko Fandri'), amount: '4.000.000', moneyId: 'card', subCategory: '0201' };

  it('travels as its own figure and category, and the loan stays the loan', () => {
    const input = debtDraftToInput({ ...base, fee: '100.000', feeCategoryId: 'fees' }, 'IDR', '2026-09-27');
    expect(input).toMatchObject({ amountMinor: 4_000_000, feeMinor: 100_000, feeCategoryId: 'fees' });
  });

  it('sends nothing when no fee was typed', () => {
    const input = debtDraftToInput(base, 'IDR', '2026-09-27');
    expect(input.feeMinor).toBeUndefined();
    expect(input.feeCategoryId).toBeUndefined();
  });

  it('weighs the loan and its fee when asking whether the money was free', () => {
    expect(lentOutflowMinor({ ...base, fee: '100.000', feeCategoryId: 'fees' }, 'IDR', '2026-09-27')).toBe(4_100_000);
    expect(lentOutflowMinor(base, 'IDR', '2026-09-27')).toBe(4_000_000);
    expect(lentOutflowMinor({ ...debtDraftFor('borrowed', '2026-09-27'), amount: '1000', moneyId: 'bca', subCategory: '109' }, 'IDR', '2026-09-27')).toBe(0);
  });

  it('refuses a fee with no category, and a borrowing fee that takes everything that arrived', () => {
    expect(() => debtDraftToInput({ ...base, fee: '100.000' }, 'IDR', '2026-09-27')).toThrow(/category for the fee/);
    const borrowed = { ...debtDraftFor('borrowed', '2026-09-27', 'Dewi'), amount: '100.000', moneyId: 'bca', fee: '100.000', feeCategoryId: 'fees', subCategory: '109' };
    expect(() => debtDraftToInput(borrowed, 'IDR', '2026-09-27')).toThrow(/all of what was borrowed/);
  });
});

describe('whether the ✓ can save', () => {
  const today = '2026-09-27';
  const filled = { ...debtDraftFor('lent', today, 'Toko Fandri'), amount: '4.000.000', moneyId: 'card', subCategory: '0201' };

  it('stays dim until a person, an account, an amount and a sub category are there', () => {
    expect(debtDraftReady(debtDraftFor('lent', today), 'IDR', today)).toBe(false);
    expect(debtDraftReady({ ...filled, personName: '' }, 'IDR', today)).toBe(false);
    expect(debtDraftReady({ ...filled, moneyId: '' }, 'IDR', today)).toBe(false);
    expect(debtDraftReady({ ...filled, amount: '' }, 'IDR', today)).toBe(false);
    expect(debtDraftReady({ ...filled, amount: '0' }, 'IDR', today)).toBe(false);
    expect(debtDraftReady({ ...filled, subCategory: '' }, 'IDR', today)).toBe(false);
    expect(debtDraftReady(filled, 'IDR', today)).toBe(true);
  });

  it('stays dim for a fee with no category, and for a date in the future', () => {
    expect(debtDraftReady({ ...filled, fee: '100.000' }, 'IDR', today)).toBe(false);
    expect(debtDraftReady({ ...filled, fee: '100.000', feeCategoryId: 'fees' }, 'IDR', today)).toBe(true);
    expect(debtDraftReady({ ...filled, occurredOn: '2026-09-28' }, 'IDR', today)).toBe(false);
  });
});

describe('the loans a new amount could be added to', () => {
  const loan = (accountId: string, reason: string | null, balanceMinor: number, status: 'open' | 'settled' | 'forgiven' = 'open') => ({
    accountId, reason, openedOn: '2026-09-01', originalMinor: balanceMinor, balanceMinor, repaidMinor: 0, dueOn: null, dueState: 'none' as const, dueLabel: '', status, currency: 'IDR',
  });
  const people = {
    owedToYou: [{ personName: 'Andi', direction: 'lent' as const, currency: 'IDR', totalMinor: 0, dueState: 'none' as const,
      loans: [loan('moto', 'Motorcycle repair', 1_500_000), loan('old', 'Phone', 0, 'settled'), loan('laptop', null, 8_000_000)] }],
    youOwe: [{ personName: 'Andi', direction: 'borrowed' as const, currency: 'IDR', totalMinor: 0, dueState: 'none' as const, loans: [loan('mine', 'Rent', 2_000_000)] }],
    settled: [],
  };

  it('offers each open loan with this person on this side, by its reason and what is left', () => {
    const choices = openLoansWith(people, 'lent', ' andi ');
    expect(choices.map((c) => c.accountId)).toEqual(['moto', 'laptop']);
    expect(choices[0]!.label).toMatch(/^Motorcycle repair · .*1\.500\.000 left$/);
    expect(choices[1]!.label).toMatch(/^No reason noted · /);
  });

  it('never offers a finished loan, the other side, or anyone for a name nobody has', () => {
    expect(openLoansWith(people, 'lent', 'Andi').map((c) => c.accountId)).not.toContain('old');
    expect(openLoansWith(people, 'borrowed', 'Andi').map((c) => c.accountId)).toEqual(['mine']);
    expect(openLoansWith(people, 'lent', 'Budi')).toEqual([]);
    expect(openLoansWith(undefined, 'lent', 'Andi')).toEqual([]);
  });

  it('adds to the loan whose reason is typed, and makes a new loan of anything else', () => {
    const choices = openLoansWith(people, 'lent', 'Andi');
    expect(loanNamed(choices, ' motorcycle REPAIR ')).toBe('moto');
    expect(loanNamed(choices, 'Motorcycle')).toBe('');
    expect(loanNamed(choices, 'Laptop')).toBe('');
    // A loan with no reason is picked from its chip, never by typing nothing.
    expect(loanNamed(choices, '')).toBe('');
  });
});

describe('whether the details open by themselves', () => {
  const blank = debtDraftFor('lent', '2026-09-27', 'Andi');
  it('stay folded over nothing, and open over anything filled in', () => {
    expect(debtDetailsFilled(blank)).toBe(false);
    // Loan and Type sit in the main box, so filling them opens nothing.
    expect(debtDetailsFilled({ ...blank, reason: 'Laptop' })).toBe(false);
    expect(debtDetailsFilled({ ...blank, dueOn: '2026-12-01' })).toBe(true);
    expect(debtDetailsFilled({ ...blank, personIdNumber: '123' })).toBe(true);
    expect(debtDetailsFilled({ ...blank, fee: '2.500' })).toBe(true);
    expect(debtDetailsFilled({ ...blank, subCategory: '0209' })).toBe(false);
  });
});
