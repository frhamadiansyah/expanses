import { describe, expect, it } from 'vitest';
import { debtDraftFor, debtDraftReady, debtDraftToInput, lentOutflowMinor, loanMoneyAccounts } from './debts-form';
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
  it('takes the side from the screen, with the sub-category that belongs to it', () => {
    const lent = debtDraftFor('lent', '2026-09-27');
    const borrowed = debtDraftFor('borrowed', '2026-09-27');
    expect(lent.direction).toBe('lent');
    expect(borrowed.direction).toBe('borrowed');
    // A piutang code never stands over money you owe, nor an utang code over money owed to you.
    expect(lent.subCategory).toBe('0201');
    expect(borrowed.subCategory).toBe('109');
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
  const base = { ...debtDraftFor('lent', '2026-09-27', 'Toko Fandri'), amount: '4.000.000', moneyId: 'card' };

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
    expect(lentOutflowMinor({ ...debtDraftFor('borrowed', '2026-09-27'), amount: '1000', moneyId: 'bca' }, 'IDR', '2026-09-27')).toBe(0);
  });

  it('refuses a fee with no category, and a borrowing fee that takes everything that arrived', () => {
    expect(() => debtDraftToInput({ ...base, fee: '100.000' }, 'IDR', '2026-09-27')).toThrow(/category for the fee/);
    const borrowed = { ...debtDraftFor('borrowed', '2026-09-27', 'Dewi'), amount: '100.000', moneyId: 'bca', fee: '100.000', feeCategoryId: 'fees' };
    expect(() => debtDraftToInput(borrowed, 'IDR', '2026-09-27')).toThrow(/all of what you borrowed/);
  });
});

describe('whether the ✓ can save', () => {
  const today = '2026-09-27';
  const filled = { ...debtDraftFor('lent', today, 'Toko Fandri'), amount: '4.000.000', moneyId: 'card' };

  it('stays dim until a person, an account and an amount are there', () => {
    expect(debtDraftReady(debtDraftFor('lent', today), 'IDR', today)).toBe(false);
    expect(debtDraftReady({ ...filled, personName: '' }, 'IDR', today)).toBe(false);
    expect(debtDraftReady({ ...filled, moneyId: '' }, 'IDR', today)).toBe(false);
    expect(debtDraftReady({ ...filled, amount: '' }, 'IDR', today)).toBe(false);
    expect(debtDraftReady({ ...filled, amount: '0' }, 'IDR', today)).toBe(false);
    expect(debtDraftReady(filled, 'IDR', today)).toBe(true);
  });

  it('stays dim for a fee with no category, and for a date in the future', () => {
    expect(debtDraftReady({ ...filled, fee: '100.000' }, 'IDR', today)).toBe(false);
    expect(debtDraftReady({ ...filled, fee: '100.000', feeCategoryId: 'fees' }, 'IDR', today)).toBe(true);
    expect(debtDraftReady({ ...filled, occurredOn: '2026-09-28' }, 'IDR', today)).toBe(false);
  });
});
