import type { PostingLine } from '@expanses/core';
import type { AccountRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { type Draft, draftFromTransaction, draftToExtras, draftToLines, draftToMemory, emptyDraft, isEditable } from './draft';

const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], currency: string | null, extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name: id, icon: null, currency, valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});

const accounts = [
  account('checking', 'asset', 'bank', 'IDR'),
  account('visa', 'liability', 'credit_card', 'IDR'),
  account('baht', 'asset', 'cash', 'THB'),
  account('groceries', 'expense', 'category', null),
  account('household', 'expense', 'category', null),
  account('salary', 'income', 'category', null),
  account('fx', 'equity', 'equity', null, { systemKey: 'currency_exchange' }),
  account('opening', 'equity', 'equity', null, { systemKey: 'opening_balance' }),
];

/** Simulates what the ledger returns after posting these lines. */
function view(
  lines: PostingLine[],
  status: TransactionView['status'] = 'posted',
  original: Pick<TransactionView, 'originalCurrency' | 'originalAmountMinor'> = { originalCurrency: null, originalAmountMinor: null },
): TransactionView {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return {
    id: 'tx1', occurredOn: '2026-09-11', description: 'Test', source: 'manual', status, externalRef: null, mcc: null, ...original, createdAt: '2026-09-11T00:00:00Z',
    entries: lines.map((l, i) => ({
      id: `e${i}`, accountId: l.accountId, accountName: l.accountId, accountKind: byId.get(l.accountId)!.kind,
      amountMinor: l.amountMinor, currency: l.currency, fxRateToBase: 1, amountBaseMinor: l.amountMinor, memo: null, spendCategoryId: null,
    })),
  };
}

const sortLines = (lines: PostingLine[]) => [...lines].map(({ accountId, amountMinor, currency }) => ({ accountId, amountMinor, currency })).sort((a, b) => a.accountId.localeCompare(b.accountId) || a.amountMinor - b.amountMinor);

function roundTrip(draft: Draft) {
  const lines = draftToLines(draft, accounts);
  const again = draftToLines(draftFromTransaction(view(lines)), accounts);
  expect(sortLines(again)).toEqual(sortLines(lines));
  return lines;
}

describe('transaction drafts', () => {
  const base = { ...emptyDraft('2026-09-11'), description: 'Test' };

  it('round-trips an expense, income, transfer, and card payment', () => {
    roundTrip({ ...base, moneyId: 'visa', categoryId: 'groceries', amount: '500.000' });
    roundTrip({ ...base, mode: 'income', moneyId: 'checking', categoryId: 'salary', amount: '10000000' });
    const payment = roundTrip({ ...base, mode: 'transfer', moneyId: 'checking', toId: 'visa', amount: '500000' });
    expect(payment.some((l) => l.accountId === 'groceries')).toBe(false);
  });

  it('round-trips and edits a split without a top-level amount', () => {
    const lines = roundTrip({ ...base, moneyId: 'visa', amount: '', splits: [{ categoryId: 'groceries', amount: '350000' }, { categoryId: 'household', amount: '150000' }] });
    expect(lines.find((l) => l.accountId === 'visa')?.amountMinor).toBe(-500_000);
  });

  it('round-trips a cross-currency exchange', () => {
    const lines = roundTrip({ ...base, mode: 'transfer', moneyId: 'checking', toId: 'baht', amount: '1000000', toAmount: '1860' });
    expect(lines).toHaveLength(4);
  });

  it('rejects incomplete drafts with readable messages', () => {
    expect(() => draftToLines({ ...base, moneyId: 'visa', amount: '1' }, accounts)).toThrow('Choose a category');
    expect(() => draftToLines({ ...base, moneyId: 'visa', categoryId: 'groceries', amount: '0' }, accounts)).toThrow('greater than zero');
    expect(() => draftToLines({ ...base, moneyId: 'visa', splits: [{ categoryId: '', amount: '1' }] }, accounts)).toThrow('split 1');
    expect(() => draftToLines({ ...base, mode: 'transfer', moneyId: 'visa', toId: 'visa', amount: '1' }, accounts)).toThrow('must differ');
  });

  it('does not offer editing for opening balances or voided rows', () => {
    const opening = view([{ accountId: 'checking', amountMinor: 1000, currency: 'IDR' }, { accountId: 'opening', amountMinor: -1000, currency: 'IDR' }]);
    expect(isEditable(opening)).toBe(false);
    const expense = view([{ accountId: 'groceries', amountMinor: 1000, currency: 'IDR' }, { accountId: 'visa', amountMinor: -1000, currency: 'IDR' }]);
    expect(isEditable(expense)).toBe(true);
    expect(isEditable({ ...expense, status: 'void' })).toBe(false);
  });
});

describe('original currency on card purchases', () => {
  const base = { ...emptyDraft('2026-09-11'), description: 'Cold Storage', moneyId: 'visa', categoryId: 'groceries', amount: '540.000' };
  const none = { originalCurrency: null, originalAmountMinor: null, mcc: null };

  it('round-trips an SGD 45,20 purchase billed to an IDR card', () => {
    const extras = draftToExtras({ ...base, originalCurrency: 'SGD', originalAmount: '45,20' }, accounts);
    expect(extras).toEqual({ originalCurrency: 'SGD', originalAmountMinor: 4520, mcc: null });
    const restored = draftFromTransaction(view(draftToLines(base, accounts), 'posted', extras));
    expect(restored).toMatchObject({ originalCurrency: 'SGD', originalAmount: '45.20' });
    expect(draftToExtras(restored, accounts)).toEqual(extras);
  });

  it('rejects an original amount without its currency, and a currency without an amount', () => {
    expect(() => draftToExtras({ ...base, originalAmount: '45,20' }, accounts)).toThrow('currency');
    expect(() => draftToExtras({ ...base, originalCurrency: 'SGD' }, accounts)).toThrow('amount');
    expect(() => draftToExtras({ ...base, originalCurrency: 'SGD', originalAmount: '0' }, accounts)).toThrow('greater than zero');
  });

  it('ignores original currency when unused, equal to the card currency, or not a card expense', () => {
    expect(draftToExtras(base, accounts)).toEqual(none);
    expect(draftToExtras({ ...base, originalCurrency: 'IDR', originalAmount: '540.000' }, accounts)).toEqual(none);
    expect(draftToExtras({ ...base, moneyId: 'checking', originalCurrency: 'SGD', originalAmount: '45,20' }, accounts)).toEqual(none);
    expect(draftToExtras({ ...base, mode: 'income', categoryId: 'salary', originalCurrency: 'SGD', originalAmount: '45,20' }, accounts)).toEqual(none);
  });

  it('starts empty for new drafts and for transactions without an original currency', () => {
    expect(emptyDraft('2026-09-11')).toMatchObject({ originalCurrency: '', originalAmount: '' });
    expect(draftFromTransaction(view(draftToLines(base, accounts)))).toMatchObject({ originalCurrency: '', originalAmount: '' });
  });
});

describe('MCC on card purchases', () => {
  const base = { ...emptyDraft('2026-09-11'), description: "MCDONALD'S SENAYAN", moneyId: 'visa', categoryId: 'groceries', amount: '60.000' };

  it('round-trips a typed MCC on a card expense', () => {
    expect(draftToExtras({ ...base, mcc: '5814' }, accounts).mcc).toBe('5814');
    const restored = draftFromTransaction({ ...view(draftToLines(base, accounts)), mcc: '5814' });
    expect(restored).toMatchObject({ mcc: '5814', rememberPattern: '' });
    expect(draftToExtras(restored, accounts).mcc).toBe('5814');
  });

  it('rejects an MCC that is not four digits, and a remembered merchant without an MCC', () => {
    expect(() => draftToExtras({ ...base, mcc: '581' }, accounts)).toThrow('four digits');
    expect(() => draftToMemory({ ...base, rememberPattern: 'mcdonald' }, accounts)).toThrow('MCC');
  });

  it('remembers the merchant instead of typing the MCC on the purchase', () => {
    const draft = { ...base, mcc: '5814', rememberPattern: " McDonald's  Senayan " };
    expect(draftToMemory(draft, accounts)).toEqual({ pattern: "mcdonald's senayan", mcc: '5814' });
    expect(draftToExtras(draft, accounts).mcc).toBeNull();
  });

  it('carries no MCC or merchant memory for other payments', () => {
    const draft = { ...base, moneyId: 'checking', mcc: '5814', rememberPattern: 'mcdonald' };
    expect(draftToExtras(draft, accounts).mcc).toBeNull();
    expect(draftToMemory(draft, accounts)).toBeNull();
    expect(emptyDraft('2026-09-11')).toMatchObject({ mcc: '', rememberPattern: '' });
  });
});
