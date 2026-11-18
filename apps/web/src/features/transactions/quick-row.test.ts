import { matchPayment } from '@expanses/core';
import type { AccountRow, CardRow, DraftRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { cleanPastedCell, groupedAmountCell, isNotionPageLinks, isQuickEditable, keepsReadFigure, lastFourOf, matchLastFour, parsePastedRows, pastedCells, payerOptions, paymentOptions, placeholderLabel, quickFromDraft, quickFromTransaction, quickToInput, readQuick, shortDate, valuesFromCells, withoutPlaceholders } from './quick-row';

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

  it('groups a waiting row\'s amount as the rows beside it print theirs, and reads it back to the same money', () => {
    const values = { date: '1/9', description: 'TIKET.COM', amount: '320000', accountId: 'bca', cardId: '', categoryId: 'groceries' };
    const grouped = groupedAmountCell(values, 'IDR');
    expect(grouped.amount).toBe('320.000');
    expect(readQuick(grouped, accounts, TODAY, 'IDR').read!.amountMinor).toBe(320000);
    const dollars = groupedAmountCell({ ...values, amount: '1234.56', accountId: 'wise' }, 'USD');
    expect(dollars.amount).toBe('1.234,56');
    expect(readQuick(dollars, accounts, TODAY, 'IDR').read!.amountMinor).toBe(123456);
    // An empty cell, or one that is not an amount, is left as typed.
    expect(groupedAmountCell({ ...values, amount: '' }, 'IDR').amount).toBe('');
    expect(groupedAmountCell({ ...values, amount: 'abc' }, 'IDR').amount).toBe('abc');
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
    expect(quickFromDraft(draft, TODAY, accounts)).toEqual({ date: '31/02', description: 'APOTEK', amount: '', accountId: '', cardId: '', categoryId: '' });
  });

  describe('a draft read in a currency its account does not hold', () => {
    const waiting = (over: Partial<DraftRow> = {}): DraftRow => ({
      id: 'd2',
      source: 'notification',
      kind: 'expense',
      status: 'pending',
      rawPayload: null,
      occurredOn: '2026-09-12',
      description: 'TOKO KOPI CONTOH',
      amountMinor: 94_300,
      currency: 'KRW',
      accountId: 'bonvoy',
      toAccountId: null,
      categoryAccountId: 'groceries',
      cardId: null,
      sourceId: null,
      captureIds: [],
      imageFile: null,
      reading: null,
      mergedInto: null,
      confidence: null,
      externalRef: null,
      transactionId: null,
      ...over,
    });

    it('leaves the amount cell empty: the cell is typed in the account’s currency, and the figure is not in it', () => {
      const values = quickFromDraft(waiting(), TODAY, accounts);
      expect(values).toMatchObject({ amount: '', accountId: 'bonvoy', categoryId: 'groceries', description: 'TOKO KOPI CONTOH' });
      // So the row asks for its amount rather than offer to record won as rupiah.
      expect(readQuick(values, accounts, TODAY, 'IDR').needs).toEqual(['amount']);
    });

    it('shows the figure of a draft in its account’s own currency, and of one with no account yet', () => {
      expect(quickFromDraft(waiting({ currency: 'IDR' }), TODAY, accounts).amount).toBe('94300');
      expect(quickFromDraft(waiting({ accountId: null }), TODAY, accounts).amount).toBe('94300');
      expect(quickFromDraft(waiting({ currency: 'USD', amountMinor: 1_250, accountId: 'wise' }), TODAY, accounts).amount).toBe('12.50');
    });

    it('keeps the read figure when the row is saved with the cell still empty, and not once a figure is typed', () => {
      const draft = waiting();
      const values = quickFromDraft(draft, TODAY, accounts);
      expect(keepsReadFigure(draft, values, TODAY, accounts)).toBe(true);
      expect(keepsReadFigure(draft, { ...values, description: 'Kopi sama teman' }, TODAY, accounts)).toBe(true);
      expect(keepsReadFigure(draft, { ...values, amount: '1034500' }, TODAY, accounts)).toBe(false);
    });

    it('lets an emptied cell empty a figure the cell was showing, and has nothing to keep on a draft of no figure', () => {
      const own = waiting({ currency: 'IDR' });
      expect(keepsReadFigure(own, { ...quickFromDraft(own, TODAY, accounts), amount: '' }, TODAY, accounts)).toBe(false);
      const none = waiting({ amountMinor: 0 });
      expect(keepsReadFigure(none, quickFromDraft(none, TODAY, accounts), TODAY, accounts)).toBe(false);
    });
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

  it('reads spreadsheet rows in the list’s column order, skipping blank ones', () => {
    const rows = parsePastedRows('12/9\tSuperindo\t450.000\tBonvoy 8802\tGroceries\r\n\t\t\n13 Sep\tGrab\t32000\n');
    expect(rows).toEqual([
      ['12/9', 'Superindo', '450.000', 'Bonvoy 8802', 'Groceries'],
      ['13 Sep', 'Grab', '32000'],
    ]);
    const cells = pastedCells(rows, 'row');
    expect(valuesFromCells(cells[0]!, resolve, TODAY)).toEqual({ date: '12 Sep', description: 'Superindo', amount: '450.000', accountId: 'bonvoy', cardId: 'c2', categoryId: 'groceries' });
    expect(valuesFromCells(cells[1]!, resolve, TODAY)).toMatchObject({ date: '13 Sep', accountId: '', categoryId: '' });
  });

  it('reads the wide table’s order with no header: Date, Note, Category, Paid with, Amount', () => {
    const rows = parsePastedRows('12/9\tSuperindo\tGroceries\tBonvoy 8802\t450.000\n13 Sep\tGrab\tTransport\tBCA\t32000');
    expect(pastedCells(rows, 'desk')).toEqual([
      { date: '12/9', description: 'Superindo', category: 'Groceries', paid: 'Bonvoy 8802', amount: '450.000' },
      { date: '13 Sep', description: 'Grab', category: 'Transport', paid: 'BCA', amount: '32000' },
    ]);
    expect(valuesFromCells(pastedCells(rows, 'desk')[0]!, resolve, TODAY)).toEqual({ date: '12 Sep', description: 'Superindo', amount: '450.000', accountId: 'bonvoy', cardId: 'c2', categoryId: 'groceries' });
    // The same text in the list's order reads the category as the amount: each table reads its own order.
    expect(pastedCells(rows, 'row')[0]).toMatchObject({ amount: 'Groceries', category: '450.000' });
  });

  it('takes a sixth column as the table’s Counts as and leaves it out', () => {
    const rows = parsePastedRows('17 Nov 2026\tSuperindo\tGroceries\tBonvoy 8802\tEssential\tRp 450.000\n18 Nov 2026\tGrab\tTransport\tBCA\t\t32.000');
    expect(pastedCells(rows, 'desk')).toEqual([
      { date: '17 Nov 2026', description: 'Superindo', category: 'Groceries', paid: 'Bonvoy 8802', amount: 'Rp 450.000' },
      { date: '18 Nov 2026', description: 'Grab', category: 'Transport', paid: 'BCA', amount: '32.000' },
    ]);
  });

  it('maps a header row by its names, in any order and any case, and does not keep it', () => {
    const rows = parsePastedRows('AMOUNT\tKeterangan\tTanggal\tSource\tAkun\tKategori\n50.000\tSuperindo\t17/11/2026\tsheet\tBonvoy 8802\tGroceries');
    expect(pastedCells(rows, 'desk')).toEqual([{ date: '17/11/2026', description: 'Superindo', category: 'Groceries', paid: 'Bonvoy 8802', amount: '50.000' }]);
    // English names, Counts as named and left out.
    const english = parsePastedRows('Paid with\tCounts as\tNote\tDate\tCategory\tAmount\nBCA\tEssential\tGrab\t2026-11-17\tTransport\t32000');
    expect(pastedCells(english, 'desk')).toEqual([{ date: '2026-11-17', description: 'Grab', category: 'Transport', paid: 'BCA', amount: '32000' }]);
    expect(pastedCells(parsePastedRows('Description\tAccount\tNominal\nGojek\tBCA\t15000'), 'row')).toEqual([{ date: '', description: 'Gojek', category: '', paid: 'BCA', amount: '15000' }]);
  });

  it('a header with nothing under it pastes no rows', () => {
    expect(pastedCells(parsePastedRows('Date\tNote\tCategory\tPaid with\tAmount\n'), 'desk')).toEqual([]);
    expect(pastedCells(parsePastedRows('Tanggal\tJumlah'), 'desk')).toEqual([]);
  });

  it('reads the dates Sheets and Notion copy, and leaves one it cannot read as it was, never guessed', () => {
    const date = (text: string) => valuesFromCells({ date: text, description: 'x', amount: '1', paid: '', category: '' }, resolve, '2026-11-18').date;
    for (const text of ['2026-11-17', '17/11/2026', '17-11-2026', '17 Nov 2026', '17 Nov', 'November 17, 2026', 'Nov 17, 2026']) expect(date(text), text).toBe('17 Nov');
    expect(date('sometime')).toBe('sometime');
    expect(date('31/02/2026')).toBe('31/02/2026');
  });

  it('reads the amounts a sheet holds, with or without the money’s name, and refuses one that is not a figure', () => {
    const values = (amount: string) => valuesFromCells({ date: '17 Nov', description: 'x', amount, paid: '8802', category: 'Groceries' }, resolve, TODAY);
    for (const amount of ['Rp 50.000', '50.000', '50,000', '50000', 'Rp50.000', 'IDR 50.000']) {
      const read = readQuick(values(amount), accounts, TODAY, 'IDR');
      expect(read.needs, amount).toEqual([]);
      expect(read.read?.amountMinor, amount).toBe(50_000);
    }
    expect(readQuick(values('lima puluh'), accounts, TODAY, 'IDR').needs).toEqual(['amount']);
  });
});

describe('pasting from Notion', () => {
  const resolve = { paid: (text: string) => (text === '5521' ? 'bonvoy:c2' : null), category: (text: string) => (text === 'Groceries' ? 'groceries' : null) };

  it('maps Notion’s own column names: Name or Title as the note, Sub Categories as the category, Account, Card or Bank as Paid with', () => {
    const rows = parsePastedRows('Date\tName\tSub Categories\tAccount\tAmount\n2026/10/03\tToko Sumber Rejeki\tGroceries\t5521\t123,400');
    expect(pastedCells(rows, 'desk')).toEqual([{ date: '2026/10/03', description: 'Toko Sumber Rejeki', category: 'Groceries', paid: '5521', amount: '123,400' }]);
    expect(valuesFromCells(pastedCells(rows, 'desk')[0]!, resolve, TODAY)).toEqual({ date: '3 Oct', description: 'Toko Sumber Rejeki', amount: '123,400', accountId: 'bonvoy', cardId: 'c2', categoryId: 'groceries' });
    for (const [note, category, paid] of [
      ['Title', 'Sub Category', 'Card'],
      ['NAME', 'subcategory', 'bank'],
      ['title', 'Sub-category', 'CARD'],
    ] as const) {
      const header = parsePastedRows(`${paid}\t${note}\t${category}\tAmount\nBCA\tKopi\tCafe\t9.000`);
      expect(pastedCells(header, 'desk'), note).toEqual([{ date: '', description: 'Kopi', category: 'Cafe', paid: 'BCA', amount: '9.000' }]);
    }
  });

  it('reads a header in another order, and six columns with no header as the table’s own', () => {
    const rows = parsePastedRows('Amount\tAccount\tSub Categories\tDate\tName\n77,250\t5521\tGroceries\t2026/9/7\tPasar Minggu');
    expect(valuesFromCells(pastedCells(rows, 'desk')[0]!, resolve, TODAY)).toEqual({ date: '7 Sep', description: 'Pasar Minggu', amount: '77,250', accountId: 'bonvoy', cardId: 'c2', categoryId: 'groceries' });
    const six = parsePastedRows('2026/09/08\tWarung Bu Tini\tGroceries\t5521\tEssential\t18,500');
    expect(pastedCells(six, 'desk')).toEqual([{ date: '2026/09/08', description: 'Warung Bu Tini', category: 'Groceries', paid: '5521', amount: '18,500' }]);
  });

  it('a Notion header with nothing under it pastes no rows', () => {
    expect(pastedCells(parsePastedRows('Date\tName\tSub Categories\tAccount\tAmount'), 'desk')).toEqual([]);
  });

  it('reads Notion’s YYYY/MM/DD dates', () => {
    const date = (text: string) => valuesFromCells({ date: text, description: 'x', amount: '1', paid: '', category: '' }, resolve, '2026-11-18').date;
    expect(date('2026/10/03')).toBe('3 Oct');
    expect(date('2026/1/9')).toBe('9 Jan');
    expect(date('2025/12/31')).toBe('31 Dec 2025');
    expect(date('2026/02/30')).toBe('2026/02/30');
  });

  it('reads a figure written with comma grouping, as Notion shows it', () => {
    const values = (amount: string) => valuesFromCells({ date: '17 Nov', description: 'x', amount, paid: '5521', category: 'Groceries' }, resolve, TODAY);
    for (const [amount, minor] of [['123,400', 123_400], ['1,250,000', 1_250_000], ['Rp 98,000', 98_000]] as const) {
      expect(readQuick(values(amount), accounts, TODAY, 'IDR').read?.amountMinor, amount).toBe(minor);
    }
  });

  it('leaves a relation’s or a link’s address out, in every column', () => {
    expect(cleanPastedCell('Groceries (https://www.notion.so/Groceries-0a1b2c3d4e5f)')).toBe('Groceries');
    expect(cleanPastedCell('[Groceries](https://www.notion.so/0a1b2c3d4e5f)')).toBe('Groceries');
    expect(cleanPastedCell(' 5521 (https://app.notion.com/p/abc) ')).toBe('5521');
    expect(cleanPastedCell('Kopi (oat)')).toBe('Kopi (oat)');
    const rows = parsePastedRows('2026/10/03\t[Toko Sumber Rejeki](https://www.notion.so/x1)\tGroceries (https://www.notion.so/x2)\t5521 (https://www.notion.so/x3)\t123,400');
    expect(valuesFromCells(pastedCells(rows, 'desk')[0]!, resolve, TODAY)).toMatchObject({ description: 'Toko Sumber Rejeki', categoryId: 'groceries', accountId: 'bonvoy', cardId: 'c2' });
  });

  it('tells Notion’s whole rows (page links, no cells) from cells', () => {
    const html = '<meta charset="utf-8"><p><a href="https://app.notion.com/p/Toko-0a1b">Toko</a></p><p><a href="https://app.notion.com/p/Kopi-2c3d">Kopi</a></p>';
    expect(isNotionPageLinks('# Toko\n\nToko\n\nKopi', html)).toBe(true);
    expect(isNotionPageLinks('Toko\nKopi', '<a href="https://www.notion.so/Toko-0a1b">Toko</a>')).toBe(true);
    // Cells carry tabs; a sheet's HTML carries no Notion links; and plain text has no HTML at all.
    expect(isNotionPageLinks('2026/10/03\tToko\t5521', html)).toBe(false);
    expect(isNotionPageLinks('Toko\nKopi', '<table><tr><td>Toko</td></tr></table>')).toBe(false);
    expect(isNotionPageLinks('Toko\nKopi', '')).toBe(false);
  });
});

describe('a Paid with cell of four digits', () => {
  const options = paymentOptions(accounts, cards);

  it('reads the digits bare or after a mask, and nothing else', () => {
    for (const text of ['5521', '····5521', '•••• 5521', 'xxxx5521', 'XXXX 5521', '**** 5521', 'x5521']) expect(lastFourOf(text), text).toBe('5521');
    for (const text of ['552', '55210', 'BCA 5521', '5521 BCA', '']) expect(lastFourOf(text), text).toBeNull();
  });

  it('names the one card, or the one account by its own number, whose last four they are', () => {
    expect(matchLastFour('8802', options)).toBe('bonvoy:c2');
    expect(matchLastFour('1467', options)).toBe('bonvoy:c1');
    // An account with no card is known by the digits the app shows beside it (its number).
    expect(matchLastFour('3021', options, { bca: '3021' })).toBe('bca');
  });

  it('leaves the cell for the owner when no card or several show those digits', () => {
    expect(matchLastFour('0000', options)).toBeNull();
    expect(matchLastFour('8802', options, { bca: '8802' })).toBeNull();
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
