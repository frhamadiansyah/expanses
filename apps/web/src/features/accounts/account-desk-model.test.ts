import { describe, expect, it } from 'vitest';
import { type AccountMove, accountMonth, balancesAfter, monthEndBalances, moveLine, moveOf } from './account-desk-model';

const NOV = { from: '2026-11-01', to: '2026-11-30' };

// Newest first, as the list sorts them. Invented figures.
const moves: AccountMove[] = [
  { id: 'card-pay', on: '2026-11-18', minor: -175_000, type: 'transfer' },
  { id: 'topup', on: '2026-11-17', minor: -900_000, type: 'transfer' },
  { id: 'mart', on: '2026-11-16', minor: -38_500, type: 'expense' },
  { id: 'salary', on: '2026-11-15', minor: 21_400_000, type: 'income' },
  { id: 'refund', on: '2026-11-12', minor: 61_000, type: 'expense' },
  { id: 'from-wise', on: '2026-11-11', minor: 2_000_000, type: 'transfer' },
  { id: 'count', on: '2026-11-10', minor: -12_000, type: 'correction' },
  { id: 'pln', on: '2026-11-03', minor: -450_000, type: 'expense' },
  { id: 'oct-rent', on: '2026-10-28', minor: -4_100_000, type: 'expense' },
  { id: 'oct-pay', on: '2026-10-15', minor: 21_400_000, type: 'income' },
];

describe('the month box', () => {
  it('reads in, out, transfers in and out and adjustments, and they add up to the change', () => {
    const month = accountMonth(moves, NOV);
    expect(month.inMinor).toBe(21_400_000 + 61_000);
    expect(month.outMinor).toBe(38_500 + 450_000);
    expect(month.transferOutMinor).toBe(175_000 + 900_000);
    expect(month.transferInMinor).toBe(2_000_000);
    expect(month.adjustedMinor).toBe(-12_000);
    expect(month.openingMinor).toBe(0);
    expect(month.changeMinor).toBe(month.inMinor - month.outMinor + month.transferInMinor - month.transferOutMinor + month.adjustedMinor + month.openingMinor);
  });

  it('leaves out what is dated outside the month', () => {
    expect(accountMonth(moves, { from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ inMinor: 21_400_000, outMinor: 4_100_000, changeMinor: 17_300_000 });
  });

  it('counts an opening balance on a line of its own, so money in stays what came in', () => {
    const opened = accountMonth([{ id: 'open', on: '2026-11-02', minor: 3_000_000, type: 'opening' }, { id: 'x', on: '2026-11-04', minor: -50_000, type: 'expense' }], NOV);
    expect(opened).toMatchObject({ inMinor: 0, outMinor: 50_000, openingMinor: 3_000_000, changeMinor: 2_950_000 });
  });

  it('files a row by what it is, then by which way the money went', () => {
    expect(moveLine({ type: 'transfer', minor: 5 })).toBe('transferIn');
    expect(moveLine({ type: 'transfer', minor: -5 })).toBe('transferOut');
    expect(moveLine({ type: 'debt', minor: -5 })).toBe('out');
    expect(moveLine({ type: 'expense', minor: 5 })).toBe('in');
  });
});

describe('the balance after each row', () => {
  it('ends on today’s balance at the newest row and steps back down the list', () => {
    const after = balancesAfter(moves, 30_000_000);
    expect(after.get('card-pay')).toBe(30_000_000);
    expect(after.get('topup')).toBe(30_175_000);
    expect(after.get('mart')).toBe(31_075_000);
    expect(after.get('salary')).toBe(31_113_500);
    // Below the salary the balance was what it found: today's less everything above and including it.
    expect(after.get('refund')).toBe(31_113_500 - 21_400_000);
  });

  it('counts a row dated after today too, since today’s balance does', () => {
    const after = balancesAfter([{ id: 'later', on: '2026-12-01', minor: -100, type: 'expense' }, { id: 'now', on: '2026-11-20', minor: -50, type: 'expense' }], 1_000);
    expect(after.get('later')).toBe(1_000);
    expect(after.get('now')).toBe(1_100);
  });
});

describe('balance over time', () => {
  it('is each month’s closing balance, the running month ending on today’s', () => {
    const ends = monthEndBalances(moves, 30_000_000, [
      { month: '2026-09', to: '2026-09-30' },
      { month: '2026-10', to: '2026-10-31' },
      { month: '2026-11', to: '2026-11-30' },
    ]);
    const nov = accountMonth(moves, NOV).changeMinor;
    expect(ends[2]).toEqual({ month: '2026-11', minor: 30_000_000 });
    expect(ends[1]!.minor).toBe(30_000_000 - nov);
    expect(ends[0]!.minor).toBe(30_000_000 - nov - 17_300_000);
  });
});

describe('a transaction’s move', () => {
  it('adds the entries on the account, or on any of its pockets', () => {
    const tx = { entries: [{ accountId: 'a', amountMinor: -500 }, { accountId: 'b', amountMinor: 480 }, { accountId: 'fee', amountMinor: 20 }] };
    expect(moveOf(tx, new Set(['a']))).toBe(-500);
    expect(moveOf(tx, new Set(['a', 'b']))).toBe(-20);
  });
});
