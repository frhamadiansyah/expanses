import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { faceFor } from '../cards/debit-art/faces';
import { bankOf, faceKindsOf, moneyChip, readBalanceHidden, walletCredit, walletMoney, walletOrder, writeBalanceHidden } from './wallet-model';

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

  it('holds an account with pockets while one pocket is kept for spending, and leaves it once none is', () => {
    const cash = row('cash', 'cash');
    const idr = row('cash-idr', 'cash', { parentId: 'cash' });
    const lira = row('cash-try', 'cash', { parentId: 'cash', currency: 'TRY', forSpending: 0 });
    expect(walletMoney([cash, idr, lira]).map((a) => a.id)).toEqual(['cash']);
    expect(walletMoney([cash, { ...idr, forSpending: 0 }, lira])).toEqual([]);
  });

  it('leaves a credit card switched off "For spending" out of Wallet', () => {
    expect(walletCredit([...book, row('rare', 'credit_card', { kind: 'liability', forSpending: 0 })]).map((a) => a.id)).toEqual(['blue']);
  });

  it('holds credit cards only of what is owed: a loan and a person are read on Net worth', () => {
    expect(walletCredit(book).map((a) => a.id)).toEqual(['blue']);
  });
});

describe('the order Wallet draws its cards in', () => {
  const book = [
    row('gopay', 'ewallet'),
    row('everyday', 'bank'),
    row('wise', 'bank'),
    row('wise-usd', 'bank', { parentId: 'wise', currency: 'USD' }),
    row('closed', 'bank', { archivedAt: '2026-01-01' }),
    row('blue', 'credit_card', { kind: 'liability' }),
    row('gold', 'credit_card', { kind: 'liability' }),
  ];
  const ids = (rows: readonly AccountRow[]) => walletOrder(rows).map((a) => a.id);
  const placed = (places: Record<string, number>) => book.map((a) => (a.id in places ? { ...a, sortOrder: places[a.id]! } : a));

  it('is the default until any card has a place: money first, then the credit cards', () => {
    expect(ids(book)).toEqual(['everyday', 'wise', 'gopay', 'blue', 'gold']);
    expect(ids(book)).toEqual([...walletMoney(book), ...walletCredit(book)].map((a) => a.id));
  });

  it('is one mixed list once the cards are put in order: a credit card may lead', () => {
    expect(ids(placed({ gold: 1, gopay: 2, everyday: 3, blue: 4, wise: 5 }))).toEqual(['gold', 'gopay', 'everyday', 'blue', 'wise']);
  });

  it('puts a card added since (still at 0) at the end, the newcomers in the default order', () => {
    // gopay and blue came after the order was saved: blue is a credit card, so after gopay, as by default.
    expect(ids(placed({ gold: 1, wise: 2, everyday: 3 }))).toEqual(['gold', 'wise', 'everyday', 'gopay', 'blue']);
  });

  it('never holds a pocket, nor an archived account, whatever place they carry', () => {
    const order = ids(placed({ 'wise-usd': 1, closed: 2, blue: 3 }));
    expect(order).not.toContain('wise-usd');
    expect(order).not.toContain('closed');
    expect(order).toEqual(['blue', 'everyday', 'wise', 'gopay', 'gold']);
  });
});

describe('electronic money in Wallet', () => {
  it('is a card beside the wallets, after cash', () => {
    const book = [row('flazz', 'emoney'), row('gopay', 'ewallet'), row('cash', 'cash'), row('everyday', 'bank'), row('cheque', 'other_cash')];
    expect(walletMoney(book).map((a) => a.id)).toEqual(['everyday', 'cash', 'flazz', 'gopay', 'cheque']);
  });

  it('is only ever drawn as a prepaid card — never a wallet app, never a bank’s debit card', () => {
    expect(faceKindsOf('emoney')).toEqual(['emoney']);
    expect(faceFor(['Flazz'], faceKindsOf('emoney'))?.key).toBe('flazz');
    expect(faceFor(['Bank Central Asia', 'Flazz'], faceKindsOf('emoney'))?.key).toBe('flazz');
    expect(faceFor(['GoPay'], faceKindsOf('emoney'))).toBeNull();
  });
});

describe('a money card’s chip', () => {
  it('names a bank account as a debit card by its number, or as an account without one', () => {
    expect(moneyChip({ subtype: 'bank' }, '1102')).toBe('Debit ···· 1102');
    expect(moneyChip({ subtype: 'savings' }, '4410')).toBe('Debit ···· 4410');
    expect(moneyChip({ subtype: 'bank' }, null)).toBe('Account');
    expect(moneyChip({ subtype: 'cash' })).toBe('Cash');
    expect(moneyChip({ subtype: 'ewallet' })).toBe('E-wallet');
    expect(moneyChip({ subtype: 'emoney' })).toBe('E-money');
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

describe('faceKindsOf: which drawn faces each kind of money may be given', () => {
  it('a bank account is only a debit card, a wallet its app or a prepaid card, cash a prepaid card', () => {
    expect(faceKindsOf('bank')).toEqual(['debit']);
    expect(faceKindsOf('savings')).toEqual(['debit']);
    expect(faceKindsOf('ewallet')).toEqual(['ewallet', 'emoney']);
    expect(faceKindsOf('cash')).toEqual(['emoney']);
    expect(faceKindsOf('other_cash')).toEqual(['emoney']);
    expect(faceKindsOf('fund')).toEqual([]);
  });

  it('so savings called "Dana darurat" is not the DANA wallet, and a wallet called OVO is', () => {
    expect(faceFor([null, 'Dana darurat'], faceKindsOf('savings'))).toBeNull();
    expect(faceFor(['Bank Mandiri', 'Dana darurat'], faceKindsOf('savings'))?.key).toBe('mandiri');
    expect(faceFor([null, 'OVO'], faceKindsOf('ewallet'))?.key).toBe('ovo');
    expect(faceFor([null, 'Flazz'], faceKindsOf('other_cash'))?.key).toBe('flazz');
    expect(faceFor([null, 'Flazz'], faceKindsOf('bank'))).toBeNull();
  });
});

describe('bankOf: the bank an account is at, for its drawn face', () => {
  const profile = (accountId: string, inst?: string) => ({ accountId, coretaxFields: (inst === undefined ? {} : { inst }) as Record<string, string> });

  it('reads the account’s own institution, trimmed, and null when none is written', () => {
    const accounts = [row('payroll', 'bank'), row('cash', 'cash')];
    expect(bankOf('payroll', accounts, [profile('payroll', ' Bank Mandiri ')])).toBe('Bank Mandiri');
    expect(bankOf('payroll', accounts, [profile('payroll', '')])).toBeNull();
    expect(bankOf('cash', accounts, [profile('payroll', 'Bank Mandiri')])).toBeNull();
    expect(bankOf('payroll', accounts, [])).toBeNull();
  });

  it('an account with pockets is at the bank its pockets are at: the first pocket that names one', () => {
    const accounts = [row('wise', 'bank'), row('wise-usd', 'bank', { parentId: 'wise' }), row('wise-idr', 'bank', { parentId: 'wise' })];
    expect(bankOf('wise', accounts, [profile('wise-usd'), profile('wise-idr', 'Bank Jago')])).toBe('Bank Jago');
    // The parent's own, when it has one, comes first.
    expect(bankOf('wise', accounts, [profile('wise', 'Bank Permata'), profile('wise-idr', 'Bank Jago')])).toBe('Bank Permata');
  });
});
