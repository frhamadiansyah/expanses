import type { AccountRow, CardRow, DraftRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { isQuickEditable, paymentOptions, quickFromDraft, quickFromTransaction, quickToInput, readQuick, shortDate } from './quick-row';

const TODAY = '2026-09-15';
const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], currency: string | null, extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name: id, icon: null, currency, valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});
const accounts = [
  account('bca', 'asset', 'bank', 'IDR', { name: 'BCA Tahapan' }),
  account('bonvoy', 'liability', 'credit_card', 'IDR', { name: 'Mandiri Bonvoy' }),
  account('wise', 'asset', 'bank', 'USD', { name: 'Wise USD' }),
  account('groceries', 'expense', 'category', null),
  account('salary', 'income', 'category', null),
];
const cards: CardRow[] = [
  { id: 'c1', accountId: 'bonvoy', last4: '1467', holderName: 'Fandrian', isPrimary: true },
  { id: 'c2', accountId: 'bonvoy', last4: '8802', holderName: 'Aisyah', isPrimary: false },
];

function tx(entries: [string, number][], extra: Partial<TransactionView> = {}): TransactionView {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return {
    id: 't1', occurredOn: '2026-09-12', description: 'Superindo', source: 'manual', status: 'posted', externalRef: null, originalCurrency: null, originalAmountMinor: null, mcc: '5411', cardId: 'c2', goalId: null, createdAt: '',
    entries: entries.map(([accountId, amountMinor], i) => ({ id: `e${i}`, accountId, accountName: accountId, accountKind: byId.get(accountId)!.kind, amountMinor, currency: byId.get(accountId)!.currency ?? 'IDR', fxRateToBase: 1, amountBaseMinor: amountMinor, memo: null, spendCategoryId: null })),
    ...extra,
  };
}

const purchase = tx([['groceries', 45000000], ['bonvoy', -45000000]]);

describe('which rows fit', () => {
  it('takes a plain purchase and leaves the rest to the form', () => {
    expect(isQuickEditable(purchase)).toBe(true);
    expect(isQuickEditable({ ...purchase, status: 'void' })).toBe(false);
    expect(isQuickEditable({ ...purchase, originalCurrency: 'SGD', originalAmountMinor: 4000 })).toBe(false);
    expect(isQuickEditable(tx([['salary', -100], ['bca', 100]]))).toBe(false);
    expect(isQuickEditable(tx([['groceries', 60], ['groceries', 40], ['bca', -100]]))).toBe(false);
    expect(isQuickEditable(tx([['bca', -100], ['bonvoy', 100]]))).toBe(false);
  });
});

describe('cells', () => {
  it('shows a date short, with the year only when it is not this one', () => {
    expect(shortDate('2026-09-12', TODAY)).toBe('12 Sep');
    expect(shortDate('2025-12-31', TODAY)).toBe('31 Dec 2025');
  });

  it('reads a purchase back exactly as it was recorded', () => {
    const values = quickFromTransaction(purchase, TODAY);
    expect(values).toMatchObject({ date: '12 Sep', accountId: 'bonvoy', cardId: 'c2', categoryId: 'groceries' });
    expect(readQuick(values, accounts, TODAY, 'IDR').read).toEqual({ occurredOn: '2026-09-12', description: 'Superindo', amountMinor: 45000000, currency: 'IDR', accountId: 'bonvoy', cardId: 'c2', categoryId: 'groceries' });
  });

  it('reads an amount in the currency of the account paying', () => {
    const read = readQuick({ date: '1/9', description: 'Hosting', amount: '12.50', accountId: 'wise', cardId: '', categoryId: 'groceries' }, accounts, TODAY, 'IDR').read!;
    expect(read).toMatchObject({ occurredOn: '2026-09-01', currency: 'USD' });
    expect(read.amountMinor).toBe(1250);
  });

  it('says what a row still needs, in cell order', () => {
    expect(readQuick({ date: 'soon', description: '', amount: '0', accountId: '', cardId: '', categoryId: 'salary' }, accounts, TODAY, 'IDR').needs).toEqual(['date', 'description', 'amount', 'paid with', 'category']);
  });

  it('fills cells from a draft, leaving an unreadable date as it came', () => {
    const draft: DraftRow = { id: 'd1', source: 'csv', status: 'pending', rawPayload: null, occurredOn: '31/02', description: 'APOTEK', amountMinor: 0, currency: 'IDR', accountId: null, categoryAccountId: null, cardId: null, confidence: null, externalRef: null, transactionId: null };
    expect(quickFromDraft(draft, TODAY)).toEqual({ date: '31/02', description: 'APOTEK', amount: '', accountId: '', cardId: '', categoryId: '' });
  });
});

describe('what the ledger gets', () => {
  it('keeps a card purchase’s hidden details, and drops them when it moves to a bank', () => {
    const read = readQuick(quickFromTransaction(purchase, TODAY), accounts, TODAY, 'IDR').read!;
    const onCard = quickToInput(read, accounts);
    expect(onCard.cardId).toBe('c2');
    expect('mcc' in onCard).toBe(false);
    expect(quickToInput({ ...read, accountId: 'bca' }, accounts)).toMatchObject({ cardId: null, mcc: null, originalCurrency: null, originalAmountMinor: null });
  });
});

describe('paymentOptions', () => {
  it('offers each card on a shared statement, and an account with one card once', () => {
    const options = paymentOptions(accounts.filter((a) => a.kind === 'asset' || a.kind === 'liability'), cards);
    expect(options.filter((o) => o.accountId === 'bonvoy').map((o) => o.last4)).toEqual(['1467', '8802']);
    expect(options.filter((o) => o.accountId === 'bca')).toHaveLength(1);
  });
});
