import type { MemberPayer, PurchasePayer } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { billAccountName } from './bill-view';

/*
 * The account a Recurring row names on its second line. A month the partner paid from an account of their own is
 * posted here against the partner's placeholder, which this phone's accounts never list (owner report 15 Nov: the
 * line came out empty). Such a row names it as Cashflow does: the label the partner's phone gave it, and who paid.
 * Invented names and digits throughout.
 */

const accounts = [
  { id: 'teduh', name: 'Bank Teduh Harian' },
  { id: 'lintang', name: 'Lintang Signature' },
];
const members = new Map<string, MemberPayer>([
  ['ph-bayu', { name: 'Bayu', self: false }],
  ['ph-sari', { name: 'Sari', self: true }],
]);
const theirs = (paidLabel: string): PurchasePayer => ({ paidBy: 'm-bayu', paidLabel, payerName: 'Bayu', mine: false, paidFrom: null });
const mine = (paidLabel: string): PurchasePayer => ({ paidBy: 'm-sari', paidLabel, payerName: 'Sari', mine: true, paidFrom: null });

describe('a paid bill row in a shared workspace', () => {
  it('paid by the partner from his own account: his label and who paid', () => {
    const bill = { moneyAccountId: 'teduh', paidFromAccountId: 'ph-bayu' };
    expect(billAccountName(bill, accounts, theirs('Bayu Kartu ···· 0917'), members)).toBe('Bayu Kartu ···· 0917 · paid by Bayu');
  });

  it('paid by the partner, his label not read yet: who paid, never an empty line', () => {
    const bill = { moneyAccountId: 'teduh', paidFromAccountId: 'ph-bayu' };
    expect(billAccountName(bill, accounts, null, members)).toBe('Paid by Bayu');
  });

  it('paid by the partner from an account of this member’s own: that account, and who paid', () => {
    const bill = { moneyAccountId: 'teduh', paidFromAccountId: 'teduh' };
    expect(billAccountName(bill, accounts, theirs('Bank Teduh Harian'), members)).toBe('Bank Teduh Harian · paid by Bayu');
  });

  it('paid from this member’s own account: its name, as before', () => {
    const bill = { moneyAccountId: 'teduh', paidFromAccountId: 'lintang' };
    expect(billAccountName(bill, accounts, mine('Lintang Signature ···· 3958'), members)).toBe('Lintang Signature');
    expect(billAccountName(bill, accounts, null, undefined)).toBe('Lintang Signature');
  });

  it('paid by this member against a placeholder of their own (a restored phone): their label alone', () => {
    const bill = { moneyAccountId: 'teduh', paidFromAccountId: 'ph-sari' };
    expect(billAccountName(bill, accounts, mine('Bank Teduh Harian'), members)).toBe('Bank Teduh Harian');
    expect(billAccountName(bill, accounts, null, members)).toBe('Sari');
  });
});

describe('an unpaid bill row', () => {
  it('names its own account', () => {
    expect(billAccountName({ moneyAccountId: 'teduh', paidFromAccountId: null }, accounts, null, members)).toBe('Bank Teduh Harian');
  });

  it('one the partner pays from an account of his own names him, as the bill’s own page does', () => {
    expect(billAccountName({ moneyAccountId: 'ph-bayu', paidFromAccountId: null }, accounts, null, members)).toBe('Bayu');
  });

  it('an account known nowhere reads as nothing', () => {
    expect(billAccountName({ moneyAccountId: 'gone', paidFromAccountId: null }, accounts, null, members)).toBe('');
  });
});
