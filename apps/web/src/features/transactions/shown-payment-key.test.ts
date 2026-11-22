import type { AccountRow, CardRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { buildRowOptions } from './QuickRowEditor';
import { shownPaymentKey } from './quick-row';

// A purchase recorded on a card account with one card names that card (posting fills it in), but the account is one
// choice keyed by itself: the row's Paid with cell has to show it, not read as empty.
const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name: id, icon: null, currency: 'IDR', valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});
const accounts = [
  account('satu', 'liability', 'credit_card', { name: 'Kartu Satu' }),
  account('dua', 'liability', 'credit_card', { name: 'Kartu Dua' }),
  account('bank', 'asset', 'bank', { name: 'Bank Contoh' }),
];
const cards: CardRow[] = [
  { id: 'c-satu', accountId: 'satu', last4: '4417', holderName: null, isPrimary: true },
  { id: 'c-dua-a', accountId: 'dua', last4: '2222', holderName: null, isPrimary: true },
  { id: 'c-dua-b', accountId: 'dua', last4: '3333', holderName: 'Kedua', isPrimary: false },
];

describe('shownPaymentKey', () => {
  it('keys an account with one card by the account alone, whether or not the row names the card', () => {
    expect(shownPaymentKey('satu', 'c-satu', cards)).toBe('satu');
    expect(shownPaymentKey('satu', '', cards)).toBe('satu');
    expect(shownPaymentKey('bank', null, cards)).toBe('bank');
  });

  it('keeps the card on an account with several, which offers each card', () => {
    expect(shownPaymentKey('dua', 'c-dua-b', cards)).toBe('dua:c-dua-b');
    expect(shownPaymentKey('dua', '', cards)).toBe('dua');
  });

  it('is a key the row’s choices hold, so the cell shows the card', () => {
    const options = buildRowOptions(accounts, cards);
    const key = options.shownKey('satu', 'c-satu');
    expect(options.paidFor(key).find((option) => option.value === key)).toMatchObject({ label: 'Kartu Satu', meta: '4417' });
    const both = options.shownKey('dua', 'c-dua-b');
    expect(options.paidFor(both).find((option) => option.value === both)).toMatchObject({ label: 'Kartu Dua', meta: '3333' });
  });
});
