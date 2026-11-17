import { describe, expect, it } from 'vitest';
import { newScreenTitle, newTransactionSearch } from './new-search';

/* A credit card's round Pay and Spend open the ordinary Add screen, locked to one job (owner, 17 Nov 2026). */
describe('the Add screen opened by a card’s Pay or Spend', () => {
  it('reads Pay: the card it pays and the figure it fills in', () => {
    expect(newTransactionSearch({ pay: 'card-1', amount: '3200000' })).toEqual({ pay: 'card-1', amount: '3200000' });
    expect(newTransactionSearch({ pay: 'card-1' })).toEqual({ pay: 'card-1' });
  });

  it('drops a Pay with no card, and an amount carried without one', () => {
    expect(newTransactionSearch({ pay: '', amount: '5' })).toEqual({});
    expect(newTransactionSearch({ amount: '5' })).toEqual({});
  });

  it('reads the statement’s Pay: the purchases ticked and the statement they were ticked on, all four or none', () => {
    const statement = { pay: 'card-1', purchases: 'a,b', start: '2026-07-21', end: '2026-08-20', today: '2026-09-01' };
    expect(newTransactionSearch(statement)).toEqual(statement);
    // Half an address is no statement to read: the screen opens as the card's own Pay.
    expect(newTransactionSearch({ ...statement, today: '' })).toEqual({ pay: 'card-1' });
    expect(newTransactionSearch({ purchases: 'a', start: '2026-07-21', end: '2026-08-20', today: '2026-09-01' })).toEqual({});
  });

  it('reads Spend’s one kind: no tabs', () => {
    expect(newTransactionSearch({ mode: 'expense', account: 'card-1', fixed: true })).toEqual({ mode: 'expense', account: 'card-1', fixed: true });
    expect(newTransactionSearch({ mode: 'expense', account: 'card-1', fixed: '1' })).toEqual({ mode: 'expense', account: 'card-1', fixed: true });
    expect(newTransactionSearch({ mode: 'expense', fixed: 'no' })).toEqual({ mode: 'expense' });
  });

  it('titles the screen by its job, never by the card’s name', () => {
    expect(newScreenTitle({ pay: 'card-1' })).toBe('Pay credit card');
    expect(newScreenTitle({ mode: 'expense', fixed: true })).toBe('New expense');
    expect(newScreenTitle({ mode: 'expense' })).toBe('New transaction');
    expect(newScreenTitle({})).toBe('New transaction');
  });
});
