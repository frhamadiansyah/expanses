import { matchPayment } from '@expanses/core';
import type { AccountRow, CardRow, DraftRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { isQuickEditable, parsePastedRows, payerOptions, paymentOptions, placeholderLabel, quickFromDraft, quickFromTransaction, quickToInput, readQuick, shortDate, valuesFromCells, withoutPlaceholders } from './quick-row';

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
    const draft: DraftRow = {
      id: 'd1',
      source: 'csv',
      kind: 'expense',
      status: 'pending',
      rawPayload: null,
      occurredOn: '31/02',
      description: 'APOTEK',
      amountMinor: 0,
      currency: 'IDR',
      accountId: null,
      toAccountId: null,
      categoryAccountId: null,
      cardId: null,
      sourceId: null,
      captureIds: [],
      imageFile: null,
      reading: null,
      mergedInto: null,
      confidence: null,
      externalRef: null,
      transactionId: null,
    };
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
  it('offers each card on a shared statement and never the account alone, which names no card', () => {
    const options = paymentOptions(accounts.filter((a) => a.kind === 'asset' || a.kind === 'liability'), cards);
    // The primary and the supplementary, and nothing else: an account carrying cards is paid with one of them.
    expect(options.filter((o) => o.accountId === 'bonvoy').map((o) => [o.cardId, o.last4])).toEqual([
      ['c1', '1467'],
      ['c2', '8802'],
    ]);
    // A search for one card's digits finds that card; the account's name alone still says which account, and leaves the card to be said.
    expect(matchPayment('1467', options)).toEqual({ accountId: 'bonvoy', cardId: 'c1' });
    expect(matchPayment('Mandiri Bonvoy', options)).toEqual({ accountId: 'bonvoy', cardId: null });
  });

  it('offers just the two cards after the primary was removed and a primary and a supplementary were added again', () => {
    // What `listCards` hands over after that sequence: the removed card is archived, so only the two new ones are left.
    const again: CardRow[] = [
      { id: 'c4', accountId: 'bonvoy', last4: '7723', holderName: 'Spouse', isPrimary: false },
      { id: 'c3', accountId: 'bonvoy', last4: '4410', holderName: 'Fandrian', isPrimary: true },
    ];
    const options = paymentOptions(accounts.filter((a) => a.kind === 'asset' || a.kind === 'liability'), again);
    expect(options.filter((o) => o.accountId === 'bonvoy').map((o) => o.cardId)).toEqual(['c4', 'c3']);
  });

  it('offers an account with one card once, and shows its digits', () => {
    const options = paymentOptions(accounts.filter((a) => a.kind === 'asset' || a.kind === 'liability'), cards);
    expect(options.filter((o) => o.accountId === 'bca')).toHaveLength(1);
  });

  it('still offers a card account with no card recorded, or only removed ones, as the account itself', () => {
    // `listCards` leaves archived cards out, so an account whose cards were all removed reaches here with none.
    const options = paymentOptions(accounts.filter((a) => a.kind === 'asset' || a.kind === 'liability'), []);
    expect(options.filter((o) => o.accountId === 'bonvoy')).toEqual([{ accountId: 'bonvoy', cardId: null, accountName: 'Mandiri Bonvoy', last4: null, holderName: null }]);
  });

  it('keeps the account alone only as the value a row already names, so an older purchase with no card still shows what paid it', () => {
    const money = accounts.filter((a) => a.kind === 'asset' || a.kind === 'liability');
    expect(payerOptions(money, cards, 'bonvoy').filter((o) => o.accountId === 'bonvoy').map((o) => o.cardId)).toEqual(['c1', 'c2', null]);
    // A row naming one of the cards, or another account, is offered the cards alone.
    expect(payerOptions(money, cards, 'bonvoy:c2').filter((o) => o.accountId === 'bonvoy').map((o) => o.cardId)).toEqual(['c1', 'c2']);
    expect(payerOptions(money, cards, 'bca').filter((o) => o.accountId === 'bonvoy').map((o) => o.cardId)).toEqual(['c1', 'c2']);
  });
});

describe('what a row may say paid', () => {
  const money = [
    ...accounts.filter((a) => a.kind === 'asset' || a.kind === 'liability'),
    account('rumah', 'asset', 'property', 'IDR', { name: 'Rumah Bintaro' }),
    account('deposito', 'asset', 'time_deposit', 'IDR', { name: 'Deposito BCA' }),
  ];

  it('offers money that can move, and never a house or a locked deposit', () => {
    const ids = payerOptions(money, cards, '').map((o) => o.accountId);
    expect(ids).toContain('bca');
    expect(ids).toContain('bonvoy');
    expect(ids).not.toContain('rumah');
    expect(ids).not.toContain('deposito');
  });

  it('keeps the account the row already names, so an old purchase still shows what paid it', () => {
    const ids = payerOptions(money, cards, 'rumah').map((o) => o.accountId);
    expect(ids).toContain('rumah');
    // Keeping one is not loosening the rule: everything else is as strict as before.
    expect(ids).not.toContain('deposito');
  });
});

describe('pasting rows', () => {
  const resolve = { paid: (text: string) => (text.includes('8802') ? 'bonvoy:c2' : null), category: (text: string) => (text === 'Groceries' ? 'groceries' : null) };

  it('leaves an ordinary one-cell paste alone', () => {
    expect(parsePastedRows('Superindo Kebayoran')).toEqual([]);
    expect(parsePastedRows('Superindo\n')).toEqual([]);
  });

  it('reads spreadsheet rows in column order, skipping blank ones', () => {
    const rows = parsePastedRows('12/9\tSuperindo\t450.000\tBonvoy 8802\tGroceries\r\n\t\t\n13 Sep\tGrab\t32000\n');
    expect(rows).toEqual([
      ['12/9', 'Superindo', '450.000', 'Bonvoy 8802', 'Groceries'],
      ['13 Sep', 'Grab', '32000'],
    ]);
    expect(valuesFromCells(rows[0]!, resolve, TODAY)).toEqual({ date: '12 Sep', description: 'Superindo', amount: '450.000', accountId: 'bonvoy', cardId: 'c2', categoryId: 'groceries' });
    expect(valuesFromCells(rows[1]!, resolve, TODAY)).toMatchObject({ date: '13 Sep', accountId: '', categoryId: '' });
  });
});

describe('a placeholder in the Paid-with picker (§4.4, final review minor 2)', () => {
  const dewi = account('ph-dewi', 'asset', 'bank', 'IDR', { name: 'Dewi' });
  const budi = account('ph-budi', 'asset', 'bank', 'IDR', { name: 'Budi' });
  const listed = new Set(['bca', 'bonvoy', 'wise']);

  it('is never offered, and the one the row already names is kept as its current value only', () => {
    const options = paymentOptions([...accounts.filter((a) => a.kind !== 'expense' && a.kind !== 'income'), dewi, budi], cards);
    expect(withoutPlaceholders(options, listed, 'ph-dewi').map((o) => o.accountId)).toEqual(['bca', 'bonvoy', 'bonvoy', 'wise', 'ph-dewi']);
    expect(withoutPlaceholders(options, listed, 'bca').map((o) => o.accountId)).toEqual(['bca', 'bonvoy', 'bonvoy', 'wise']);
    expect(withoutPlaceholders(options, listed, '').some((o) => o.accountId.startsWith('ph-'))).toBe(false);
  });

  it('reads as who paid, never as an account of yours', () => {
    expect(placeholderLabel('Dewi')).toBe('Paid by Dewi');
  });
});
