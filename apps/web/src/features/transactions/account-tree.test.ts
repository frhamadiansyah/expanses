import type { PaymentOption } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { accountTreeSections, openingParent, type TreeRow, treeKindOf } from './account-tree';

// Invented accounts: names, digits and currencies are made up.
let order = 0;
const row = (id: string, subtype: string, currency: string | null, extra: Partial<AccountRow> = {}): AccountRow =>
  ({ id, name: id, kind: 'asset', subtype, currency, parentId: null, sortOrder: order++, archivedAt: null, ...extra }) as AccountRow;
const pocket = (id: string, parent: AccountRow, currency: string) => row(id, parent.subtype, currency, { parentId: parent.id, name: `${parent.name} · ${currency}` });

const cash = row('Kas Rumah', 'cash', null);
const bank = row('Bank Satu Harian', 'bank', null);
const accounts: AccountRow[] = [
  pocket('kas-idr', cash, 'IDR'),
  pocket('kas-try', cash, 'TRY'),
  pocket('kas-usd', cash, 'USD'),
  cash,
  pocket('bank-idr', bank, 'IDR'),
  pocket('bank-usd', bank, 'USD'),
  pocket('bank-eur', bank, 'EUR'),
  bank,
  row('Tabungan Dua', 'savings', 'IDR'),
  row('Dompet Hijau', 'ewallet', 'IDR'),
  row('Kartu Tol', 'emoney', 'IDR'),
  row('Giro Lain', 'other_cash', 'IDR'),
  row('RDN Tiga', 'fund', 'IDR'),
  row('Kartu Kredit Biru', 'credit_card', 'IDR', { kind: 'liability' }),
];
const byId = new Map(accounts.map((a) => [a.id, a]));
const option = (accountId: string, extra: Partial<PaymentOption> = {}): PaymentOption => ({
  accountId,
  cardId: null,
  accountName: byId.get(accountId)!.name,
  last4: null,
  holderName: null,
  ...extra,
});
// The order the sheet is handed its options in: the ledger's own, pockets scattered among the rest.
const options: PaymentOption[] = [
  option('kas-idr'),
  option('bank-usd', { last4: '4410' }),
  option('kas-try'),
  option('Dompet Hijau', { last4: '8812' }),
  option('bank-idr', { last4: '4410' }),
  option('Kartu Tol'),
  option('kas-usd'),
  option('bank-eur', { last4: '4410' }),
  option('Tabungan Dua'),
  option('Giro Lain'),
  option('RDN Tiga'),
  option('Kartu Kredit Biru'),
];

const shape = (r: TreeRow) =>
  r.type === 'parent'
    ? `${r.parent.name} › ${r.pockets.map((p) => byId.get(p.accountId)!.currency).join(' ')}`
    : r.parent
      ? `${r.parent.name} ${byId.get(r.option.accountId)!.currency}`
      : r.option.accountName;
const drawn = (opts: readonly PaymentOption[], tab: 'accounts' | 'cards' | null, typed = '', leadCurrency?: string) =>
  accountTreeSections(opts, accounts, { tab, typed, leadCurrency }).map((s) => [s.title, s.rows.map(shape)]);

describe('the account sheet, grouped by kind', () => {
  it('draws Cash, Bank accounts, Digital wallets & e-money, Other, then Credit cards, each account once', () => {
    expect(drawn(options, null)).toEqual([
      ['Cash', ['Kas Rumah › IDR TRY USD']],
      ['Bank accounts', ['Bank Satu Harian › IDR USD EUR', 'Tabungan Dua', 'RDN Tiga']],
      ['Digital wallets & e-money', ['Dompet Hijau', 'Kartu Tol']],
      ['Other', ['Giro Lain']],
      ['Credit cards', ['Kartu Kredit Biru']],
    ]);
  });

  it('leaves out a group with no rows, and keeps a tab to its own kind', () => {
    expect(drawn([option('Dompet Hijau'), option('Kartu Kredit Biru')], 'accounts')).toEqual([['Digital wallets & e-money', ['Dompet Hijau']]]);
    expect(drawn(options, 'cards')).toEqual([['Credit cards', ['Kartu Kredit Biru']]]);
  });

  it('puts a kind no group names under Other', () => {
    expect(treeKindOf('time_deposit')).toBe('other');
    expect(treeKindOf('savings')).toBe('bank');
    expect(treeKindOf('emoney')).toBe('wallet');
    expect(treeKindOf(undefined)).toBe('other');
  });

  it('gives an account with several pockets one parent row, with its digits when its pockets share them', () => {
    const sections = accountTreeSections(options, accounts, { tab: null, typed: '' });
    const parent = sections[1]!.rows[0]!;
    expect(parent.type).toBe('parent');
    expect(parent.type === 'parent' && parent.last4).toBe('4410');
    const cashRow = sections[0]!.rows[0]!;
    expect(cashRow.type === 'parent' && cashRow.last4).toBeNull();
  });

  it('draws a pocket offered alone as a single row named by its account', () => {
    expect(drawn([option('kas-usd'), option('bank-idr'), option('bank-eur')], null)).toEqual([
      ['Cash', ['Kas Rumah USD']],
      ['Bank accounts', ['Bank Satu Harian › IDR EUR']],
    ]);
    const [cashSection] = accountTreeSections([option('kas-usd')], accounts, { tab: null, typed: '' });
    expect(cashSection!.rows[0]).toMatchObject({ type: 'single', parent: { id: 'Kas Rumah' } });
  });

  it('treats a pocket whose account is not on the list as an account of its own', () => {
    const lone = accounts.filter((a) => a.id !== 'Kas Rumah');
    const sections = accountTreeSections([option('kas-idr'), option('kas-usd')], lone, { tab: null, typed: '' });
    expect(sections.map((s) => [s.title, s.rows.map((r) => (r.type === 'single' ? r.option.accountName : 'parent'))])).toEqual([
      ['Cash', ['Kas Rumah · IDR', 'Kas Rumah · USD']],
    ]);
  });
});

describe('To, after a From is chosen', () => {
  it('lists the pocket in the From’s currency first within its account', () => {
    // From was the bank's USD pocket: it is left out by the pairing rules, so it is not among the options.
    const to = options.filter((o) => o.accountId !== 'bank-usd');
    expect(drawn(to, null, '', 'USD').slice(0, 2)).toEqual([
      ['Cash', ['Kas Rumah › USD IDR TRY']],
      ['Bank accounts', ['Bank Satu Harian › IDR EUR', 'Tabungan Dua', 'RDN Tiga']],
    ]);
  });
});

describe('searching the sheet', () => {
  it('shows matching pockets flat, each named by its account with its currency, and no tree', () => {
    expect(drawn(options, 'accounts', 'usd')).toEqual([
      ['Cash', ['Kas Rumah USD']],
      ['Bank accounts', ['Bank Satu Harian USD']],
    ]);
  });

  it('matches an account’s name, digits and currency, across both tabs', () => {
    expect(drawn(options, 'cards', 'kas rumah')).toEqual([['Cash', ['Kas Rumah IDR', 'Kas Rumah TRY', 'Kas Rumah USD']]]);
    expect(drawn(options, 'cards', '4410')).toEqual([['Bank accounts', ['Bank Satu Harian USD', 'Bank Satu Harian IDR', 'Bank Satu Harian EUR']]]);
    expect(drawn(options, 'accounts', 'biru')).toEqual([['Credit cards', ['Kartu Kredit Biru']]]);
    expect(drawn(options, null, 'zzz')).toEqual([]);
  });

  it('matches a card by its holder', () => {
    const held = [...options, option('Kartu Kredit Biru', { cardId: 'c2', last4: '7788', holderName: 'Sari' })];
    expect(drawn(held, 'accounts', 'sari')).toEqual([['Credit cards', ['Kartu Kredit Biru']]]);
  });
});

describe('the parent open when the sheet opens', () => {
  const sections = accountTreeSections(options, accounts, { tab: null, typed: '' });
  it('is the one holding the chosen pocket', () => {
    expect(openingParent(sections, 'bank-eur')).toBe('Bank Satu Harian');
    expect(openingParent(sections, 'kas-try')).toBe('Kas Rumah');
  });
  it('is none for an account of one currency, or nothing chosen', () => {
    expect(openingParent(sections, 'Tabungan Dua')).toBeNull();
    expect(openingParent(sections, '')).toBeNull();
  });
});
