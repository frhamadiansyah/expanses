import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { shownAccounts, typedNameOf, withShownNames } from './account-name';

const row = (id: string, subtype: string, name: string, bank: string | null = null, extra: Partial<AccountRow> = {}) =>
  ({ id, name, parentId: null, kind: 'asset', subtype, currency: 'IDR', archivedAt: null, sortOrder: 0, bank, ...extra }) as AccountRow;

describe('the names every list shows', () => {
  const rows = [
    row('xpresi', 'savings', 'Xpresi', 'Bank Mandiri'),
    row('xpresi-usd', 'savings', 'Xpresi · USD', 'Bank Mandiri', { parentId: 'xpresi', currency: 'USD' }),
    row('typed-in-full', 'bank', 'mandiri giro', 'Mandiri'),
    row('wallet', 'ewallet', 'GoPay'),
    row('cash', 'cash', 'Pocket money'),
    row('groceries', 'category', 'Groceries', null, { kind: 'expense', currency: null }),
  ];

  it('puts the bank in front of an account at a bank, and of each of its pockets, once', () => {
    expect(shownAccounts(rows).map((a) => a.name)).toEqual(['Mandiri Xpresi', 'Mandiri Xpresi · USD', 'mandiri giro', 'GoPay', 'Pocket money', 'Groceries']);
  });

  it('keeps the name as typed for anything that writes it back', () => {
    const shown = shownAccounts(rows);
    expect(shown.map(typedNameOf)).toEqual(rows.map((a) => a.name));
    // Read twice, still the name typed: never the shown one taken for it.
    expect(shownAccounts(shown).map(typedNameOf)).toEqual(rows.map((a) => a.name));
    expect(typedNameOf(rows[0]!)).toBe('Xpresi');
  });

  it('names Assets rows the same way, leaving a row called anything but its account alone', () => {
    const values = [
      { accountId: 'xpresi-usd', name: 'Xpresi · USD' },
      { accountId: 'wallet', name: 'GoPay' },
      { accountId: 'fund', name: 'Sucorinvest Money Market' },
      { accountId: 'xpresi', name: 'Something else' },
    ];
    expect(withShownNames(values, rows).map((v) => [v.name, v.typedName])).toEqual([
      ['Mandiri Xpresi · USD', 'Xpresi · USD'],
      ['GoPay', 'GoPay'],
      ['Sucorinvest Money Market', 'Sucorinvest Money Market'],
      ['Something else', 'Something else'],
    ]);
  });
});
