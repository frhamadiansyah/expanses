import type { AccountRow, CardRow, PurchasePayer, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { payerLine, payerToShow } from '../sharing/sharing-copy';
import { buildRows, paidWithLook } from './list-model';

/*
 * A Cashflow row in a shared workspace, on the phone of the member who paid it from an account of their own: it names
 * that account by its digits, exactly as the same row reads in a private workspace. Only a row someone else paid, or
 * one posted here against a placeholder, keeps the payer's own label.
 */

const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], name: string): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name, icon: null, currency: kind === 'expense' ? null : 'IDR', valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z',
});

const accounts = [
  account('teduh', 'asset', 'bank', 'Bank Teduh Harian'),
  account('lintang', 'liability', 'credit_card', 'Lintang Signature'),
  account('groceries', 'expense', 'category', 'Groceries'),
];
// Not among the accounts listed here: the placeholder another member's purchases are posted against.
const placeholder = { id: 'ph-rina', name: 'Rina', kind: 'asset' as const, subtype: 'cash' as const };
const byId = new Map<string, { name: string; kind: AccountRow['kind']; subtype: string }>([...accounts.map((a) => [a.id, a] as const), [placeholder.id, placeholder]]);
const cards: CardRow[] = [{ id: 'card-lintang', accountId: 'lintang', last4: '3958', holderName: null, isPrimary: true }];
// The bank account's own number (0080), read the way the page reads it.
const numbers = { teduh: '2704' };

let seq = 0;
function purchase(moneyAccountId: string, extra: Partial<TransactionView> = {}): TransactionView {
  seq += 1;
  const lines: [string, number][] = [['groceries', 63_500], [moneyAccountId, -63_500]];
  return {
    id: `fam${seq}`, occurredOn: '2026-11-08', description: 'Pasar Minggu', source: 'manual', status: 'posted', externalRef: null, originalCurrency: null, originalAmountMinor: null, mcc: null, cardId: null, goalId: null,
    createdAt: '2026-11-08T00:00:00Z',
    entries: lines.map(([accountId, amountMinor], i) => ({
      id: `fam${seq}e${i}`, accountId, accountName: byId.get(accountId)!.name, accountKind: byId.get(accountId)!.kind, accountSubtype: byId.get(accountId)!.subtype, amountMinor, currency: 'IDR', fxRateToBase: 1, amountBaseMinor: amountMinor, memo: null, spendCategoryId: null, bookId: 'book-family',
    })),
    ...extra,
  } as TransactionView;
}

const mine = (paidLabel: string): PurchasePayer => ({ paidBy: 'm-owner', paidLabel, payerName: 'Sari', mine: true, paidFrom: null });
const theirs = (paidLabel: string): PurchasePayer => ({ paidBy: 'm-rina', paidLabel, payerName: 'Rina', mine: false, paidFrom: null });
const known = new Set(accounts.map((a) => a.id));
const row = (t: TransactionView) => buildRows([t], [], accounts, cards, numbers, 'book-family')[0]!;

describe('a purchase in a shared workspace, paid from an account of this member’s own', () => {
  it('names the credit card by its digits alone, as in a private workspace', () => {
    const onCard = purchase('lintang', { cardId: 'card-lintang' });
    // As this device's own share recorded it: the account's full name and the card's digits.
    expect(payerToShow(mine('Lintang Signature ···· 3958'), onCard, known)).toBeNull();
    expect(paidWithLook(row(onCard))).toEqual({ name: '', last4: '3958' });
  });

  it('names the bank account by its own number alone', () => {
    const fromBank = purchase('teduh');
    expect(payerToShow(mine('Bank Teduh Harian'), fromBank, known)).toBeNull();
    expect(paidWithLook(row(fromBank))).toEqual({ name: '', last4: '2704' });
  });

  it('reads the same row the same way in the private workspace, where no payer is known', () => {
    const fromBank = purchase('teduh');
    expect(paidWithLook(buildRows([fromBank], [], accounts, cards, numbers, 'book-private')[0]!)).toEqual({ name: '', last4: '2704' });
  });
});

describe('a purchase in a shared workspace that keeps the payer’s label', () => {
  it('when another member paid it: their label, and who paid', () => {
    const t = purchase('ph-rina');
    const shown = payerToShow(theirs('Rina Visa ···· 1182'), t, known);
    expect(shown).not.toBeNull();
    expect(payerLine(shown!)).toBe('Rina Visa ···· 1182 · paid by Rina');
  });

  it('when another member paid from an account of this member’s own: still who paid', () => {
    const t = purchase('teduh');
    expect(payerToShow(theirs('Sari’s Teduh account'), t, known)).not.toBeNull();
  });

  it('when this member’s purchase is posted here against a placeholder (another of their devices, a restore)', () => {
    const t = purchase('ph-rina');
    expect(payerToShow(mine('Bank Teduh Harian'), t, known)).toEqual(mine('Bank Teduh Harian'));
  });

  it('while the accounts are not read yet, so no row flashes a placeholder’s name', () => {
    const t = purchase('teduh');
    expect(payerToShow(mine('Bank Teduh Harian'), t, new Set())).toEqual(mine('Bank Teduh Harian'));
  });

  it('and no line at all when the purchase heads no shared purchase', () => {
    expect(payerToShow(null, purchase('teduh'), known)).toBeNull();
  });
});
