import type { AccountRow, CardRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { pastedCategories } from './paste-categories';
import { buildRowOptions } from './QuickRowEditor';

// The desk's own reading of a pasted Paid with cell (masked digits, an account's number, a remembered name), with a
// card or account switched off "For spending" (owner, 2026-11-22). The rule itself is `paste-switched-off.test.ts`.
const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name: id, icon: null, currency: 'IDR', valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});
const accounts = [
  account('harian', 'liability', 'credit_card', { name: 'Kartu Harian', forSpending: 1 }),
  account('contoh', 'liability', 'credit_card', { name: 'Kartu Contoh', forSpending: 0 }),
  account('simpan', 'asset', 'bank', { name: 'Tabungan Simpan', forSpending: 0 }),
  account('lama', 'liability', 'credit_card', { name: 'Kartu Lama', forSpending: 0, archivedAt: '2026-10-01T00:00:00Z' }),
  account('rumah', 'asset', 'property', { name: 'Rumah Contoh' }),
];
const cards: CardRow[] = [
  { id: 'c-harian', accountId: 'harian', last4: '2222', holderName: null, isPrimary: true },
  { id: 'c-contoh', accountId: 'contoh', last4: '4417', holderName: null, isPrimary: true },
  { id: 'c-lama', accountId: 'lama', last4: '5310', holderName: null, isPrimary: true },
];
const options = buildRowOptions(accounts, cards, () => true, {}, true, { simpan: '9031' });

describe('the desk paste and a card switched off For spending', () => {
  it('reads masked digits and an account number as it', () => {
    expect(options.resolvePastedPaid('····4417')).toBe('contoh');
    expect(options.resolvePastedPaid('xxxx 4417')).toBe('contoh');
    expect(options.resolvePastedPaid('9031')).toBe('simpan');
  });

  it('never reads an archived card', () => {
    expect(options.resolvePastedPaid('····5310')).toBeNull();
  });

  it('lets a remembered name fill in a card switched off, never an archived one or a house', () => {
    expect(options.pasteMayName('contoh')).toBe(true);
    expect(options.pasteMayName('harian')).toBe(true);
    expect(options.pasteMayName('lama')).toBe(false);
    expect(options.pasteMayName('rumah')).toBe(false);
  });

  it('fills a waiting row from what an earlier paste remembered', async () => {
    const blank = { date: '3 Sep', description: 'Toko Contoh', amount: '45.000', accountId: '', cardId: '', categoryId: '' };
    const [row] = await pastedCategories([{ cells: { date: '3/9', description: 'Toko Contoh', amount: '45.000', paid: 'Kartu Kuning', category: '' }, values: blank }], {
      remembered: () => null,
      history: async () => null,
      offered: () => false,
      rememberedPaid: (text) => (text === 'Kartu Kuning' ? 'contoh' : null),
      offeredPaid: options.pasteMayName,
    });
    expect(row!.values).toMatchObject({ accountId: 'contoh', cardId: '' });
  });
});
