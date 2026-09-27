import type { PersonDebtRow, PersonLoanRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { deleteLoanQuestion, loanFigureLabels, loanSubtitle, personDue, personParams, repaymentWord, shortDay } from './lend-borrow-view';

const TODAY = '2026-09-27';

const loan = (over: Partial<PersonLoanRow> = {}): PersonLoanRow => ({
  accountId: 'l1',
  reason: 'Laptop for college',
  openedOn: '2026-06-23',
  originalMinor: 5_000_000,
  balanceMinor: 5_000_000,
  repaidMinor: 0,
  dueOn: null,
  dueState: 'none',
  dueLabel: '',
  status: 'open',
  currency: 'IDR',
  ...over,
});

const person = (loans: PersonLoanRow[], over: Partial<PersonDebtRow> = {}): PersonDebtRow => ({
  personName: 'Andi',
  direction: 'lent',
  currency: 'IDR',
  totalMinor: loans.reduce((sum, l) => sum + l.balanceMinor, 0),
  loans,
  dueState: 'none',
  ...over,
});

describe('dates as a person says them', () => {
  it('drops the year when it is this year, and keeps it otherwise', () => {
    expect(shortDay('2026-06-23', TODAY)).toBe('23 Jun');
    expect(shortDay('2025-12-05', TODAY)).toBe('5 Dec 2025');
  });
});

describe('a person on the list', () => {
  it('shows the most urgent due date of their open loans, overdue before due soon', () => {
    const soon = loan({ accountId: 's', dueOn: '2026-10-03', dueState: 'due_soon' });
    const late = loan({ accountId: 'x', dueOn: '2026-09-16', dueState: 'overdue' });
    expect(personDue(person([soon, late]), TODAY)).toMatchObject({ tone: 'late', label: expect.stringMatching(/overdue/i) });
    expect(personDue(person([soon]), TODAY)).toMatchObject({ tone: 'soon' });
    expect(personDue(person([loan()]), TODAY)).toBeNull();
    // A settled loan's date is history, not a warning.
    expect(personDue(person([loan({ dueOn: '2026-09-16', dueState: 'overdue', status: 'settled' })]), TODAY)).toBeNull();
  });

  it('opens on the side they are on', () => {
    expect(personParams({ personName: 'Andi', direction: 'lent' })).toEqual({ side: 'owed', person: 'Andi' });
    expect(personParams({ personName: 'Dewi', direction: 'borrowed' })).toEqual({ side: 'owe', person: 'Dewi' });
  });
});

describe('one loan', () => {
  it('says since when, what it files as, and when it is due', () => {
    expect(loanSubtitle(loan(), 'Affiliate receivables', TODAY)).toBe('Since 23 Jun · Affiliate receivables');
    expect(loanSubtitle(loan({ dueOn: '2026-10-03', dueState: 'due_soon' }), 'Trade receivables', TODAY)).toMatch(/^Since 23 Jun · Trade receivables · .+/);
    expect(loanSubtitle(loan({ status: 'settled' }), '', TODAY)).toBe('Since 23 Jun · Settled');
  });

  it('says whose money it is in the words of the side', () => {
    // Money back on a loan you made is collected; money back on one you took is repaid.
    expect(repaymentWord('lent')).toBe('Collection');
    expect(repaymentWord('borrowed')).toBe('Repayment');
    expect(loanFigureLabels('lent')).toEqual({ given: 'Money lent', back: 'Money back' });
    expect(loanFigureLabels('borrowed')).toEqual({ given: 'Money borrowed', back: 'Paid back' });
  });

  it('asks before deleting, naming what goes with the loan', () => {
    expect(deleteLoanQuestion('lent', 0)).toBe('Delete this loan? Every balance goes back as if it was never recorded.');
    expect(deleteLoanQuestion('lent', 1)).toMatch(/^Delete this loan and its collection\?/);
    expect(deleteLoanQuestion('borrowed', 2)).toMatch(/^Delete this loan and its 2 repayments\?/);
  });
});
