import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { moneyChip, readBalanceHidden, walletCredit, walletMoney, writeBalanceHidden } from './wallet-model';

const row = (id: string, subtype: string, extra: Partial<AccountRow> = {}) =>
  ({ id, name: id, parentId: null, kind: 'asset', subtype, currency: 'IDR', archivedAt: null, sortOrder: 0, forSpending: 1, ...extra }) as AccountRow;

describe('the cards Wallet holds', () => {
  const book = [
    row('gopay', 'ewallet'),
    row('cash', 'cash'),
    row('everyday', 'bank'),
    row('rainy', 'savings', { forSpending: 0 }),
    row('tahapan', 'savings'),
    row('wise', 'bank'),
    row('wise-usd', 'bank', { parentId: 'wise', currency: 'USD' }),
    row('deposit', 'time_deposit'),
    row('rdn', 'fund'),
    row('lent', 'receivable'),
    row('closed', 'bank', { archivedAt: '2026-01-01' }),
    row('blue', 'credit_card', { kind: 'liability' }),
    row('loan', 'loan', { kind: 'liability' }),
    row('owe', 'payable', { kind: 'liability' }),
  ];

  it('holds money kept for spending, banks first, then cash, then wallets — one card per account with pockets', () => {
    expect(walletMoney(book).map((a) => a.id)).toEqual(['everyday', 'tahapan', 'wise', 'cash', 'gopay']);
  });

  it('leaves out savings switched off, a deposit, a broker’s cash and money lent to a person', () => {
    const ids = walletMoney(book).map((a) => a.id);
    for (const id of ['rainy', 'deposit', 'rdn', 'lent', 'wise-usd', 'closed']) expect(ids).not.toContain(id);
  });

  it('holds credit cards only of what is owed: a loan and a person are read on Net worth', () => {
    expect(walletCredit(book).map((a) => a.id)).toEqual(['blue']);
  });
});

describe('a money card’s chip', () => {
  it('names a bank account as a debit card by its number, or as an account without one', () => {
    expect(moneyChip({ subtype: 'bank' }, '1102')).toBe('Debit ···· 1102');
    expect(moneyChip({ subtype: 'savings' }, '4410')).toBe('Debit ···· 4410');
    expect(moneyChip({ subtype: 'bank' }, null)).toBe('Account');
    expect(moneyChip({ subtype: 'cash' })).toBe('Cash');
    expect(moneyChip({ subtype: 'ewallet' })).toBe('E-wallet');
    expect(moneyChip({ subtype: 'other_cash' })).toBe('Account');
  });
});

describe('the Balance box, hidden on this device', () => {
  const memory = () => {
    const kept = new Map<string, string>();
    return { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
  };

  it('is remembered, and forgotten when shown again', () => {
    const storage = memory();
    expect(readBalanceHidden(storage)).toBe(false);
    writeBalanceHidden(true, storage);
    expect(readBalanceHidden(storage)).toBe(true);
    writeBalanceHidden(false, storage);
    expect(readBalanceHidden(storage)).toBe(false);
  });

  it('reads as shown, and does not throw, where storage refuses', () => {
    const refusing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(readBalanceHidden(refusing)).toBe(false);
    expect(() => writeBalanceHidden(true, refusing)).not.toThrow();
  });
});
