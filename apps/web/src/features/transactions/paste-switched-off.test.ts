import type { AccountRow, CardRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { buildRowOptions } from './QuickRowEditor';
import { pastedPayerOptions, payerOptions } from './quick-row';

// A card switched off "For spending" leaves every Paid with list picked from by hand, but an old list pasted in still
// names it (owner, 2026-11-22): the paste matches it, by name or by its last four, and the row shows it as its value.
const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name: id, icon: null, currency: 'IDR', valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});
const accounts = [
  account('harian', 'liability', 'credit_card', { name: 'Kartu Harian', forSpending: 1 }),
  account('contoh', 'liability', 'credit_card', { name: 'Kartu Contoh', forSpending: 0 }),
  account('simpan', 'asset', 'bank', { name: 'Tabungan Simpan', forSpending: 0 }),
  account('lama', 'liability', 'credit_card', { name: 'Kartu Lama', forSpending: 0, archivedAt: '2026-10-01T00:00:00Z' }),
  account('rumah', 'asset', 'property', { name: 'Rumah Contoh' }),
  account('groceries', 'expense', 'category', { currency: null, name: 'Groceries' }),
];
const cards: CardRow[] = [
  { id: 'c-harian', accountId: 'harian', last4: '2222', holderName: null, isPrimary: true },
  { id: 'c-contoh', accountId: 'contoh', last4: '4417', holderName: null, isPrimary: true },
  { id: 'c-lama', accountId: 'lama', last4: '5310', holderName: null, isPrimary: true },
];

describe('a paste names a card switched off For spending', () => {
  const options = buildRowOptions(accounts, cards);

  it('matches it by name and by its last four digits', () => {
    expect(options.resolvePastedPaid('Kartu Contoh')).toBe('contoh');
    expect(options.resolvePastedPaid('4417')).toBe('contoh');
    expect(options.resolvePastedPaid('Tabungan Simpan')).toBe('simpan');
  });

  it('still matches what is for spending as before', () => {
    expect(options.resolvePastedPaid('Kartu Harian')).toBe('harian');
    expect(options.resolvePastedPaid('2222')).toBe('harian');
  });

  it('is not offered when picking by hand, and typed text does not reach it', () => {
    const offered = options.paidFor('').map((option) => option.value);
    expect(offered).toContain('harian');
    expect(offered).not.toContain('contoh');
    expect(offered).not.toContain('simpan');
    expect(options.resolvePaid('Kartu Contoh')).toBeNull();
  });

  it('shows as the value of the row that names it', () => {
    const kept = options.paidFor('contoh');
    expect(kept.find((option) => option.value === 'contoh')).toMatchObject({ label: 'Kartu Contoh', meta: '4417' });
  });

  it('never names an archived card, or a house', () => {
    expect(options.resolvePastedPaid('Kartu Lama')).toBeNull();
    expect(options.resolvePastedPaid('5310')).toBeNull();
    expect(options.resolvePastedPaid('Rumah Contoh')).toBeNull();
  });

  it('leaves two cards with the same last four unanswered, as before', () => {
    const twins = [...accounts, account('dua', 'liability', 'credit_card', { name: 'Kartu Dua', forSpending: 1 }), account('tiga', 'liability', 'credit_card', { name: 'Kartu Tiga', forSpending: 0 })];
    const twinCards: CardRow[] = [
      ...cards,
      { id: 'c-dua', accountId: 'dua', last4: '2222', holderName: null, isPrimary: true },
      { id: 'c-tiga', accountId: 'tiga', last4: '4417', holderName: null, isPrimary: true },
    ];
    const both = buildRowOptions(twins, twinCards);
    // Two for spending.
    expect(both.resolvePastedPaid('2222')).toBeNull();
    // Two switched off.
    expect(both.resolvePastedPaid('4417')).toBeNull();
  });

  it('prefers the card for spending when one switched off shares its name or digits', () => {
    const shared = [...accounts, account('lain', 'liability', 'credit_card', { name: 'Kartu Harian Lain', forSpending: 0 })];
    const sharedCards: CardRow[] = [...cards, { id: 'c-lain', accountId: 'lain', last4: '2222', holderName: null, isPrimary: true }];
    const prefer = buildRowOptions(shared, sharedCards);
    expect(prefer.resolvePastedPaid('2222')).toBe('harian');
    expect(prefer.resolvePastedPaid('Kartu Harian')).toBe('harian');
    expect(prefer.resolvePastedPaid('Kartu Harian Lain')).toBe('lain');
  });
});

describe('pastedPayerOptions', () => {
  it('holds every way to pay by hand, and the ones switched off', () => {
    const live = accounts.filter((a) => a.archivedAt === null);
    const byHand = payerOptions(live, cards, '').map((o) => o.accountId);
    const pasteable = pastedPayerOptions(live, cards).map((o) => o.accountId);
    expect(pasteable).toEqual(expect.arrayContaining(byHand));
    expect(pasteable).toEqual(expect.arrayContaining(['contoh', 'simpan']));
    expect(pasteable).not.toContain('rumah');
  });
});
