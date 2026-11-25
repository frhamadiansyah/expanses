import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { accountChoiceName, accountKindLine, asBroker, brokerNameOf, shownAccounts, typedNameOf, withCustodianNames, withShownNames } from './account-name';

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

describe('a fund account: its custodian bank where money is listed, its broker where a broker is meant', () => {
  const rows = [
    row('mirae', 'fund', 'Mirae Sekuritas', 'CIMB Niaga'),
    row('mirae-usd', 'fund', 'Mirae Sekuritas · USD', 'CIMB Niaga', { parentId: 'mirae', currency: 'USD' }),
    row('stockbit', 'fund', 'Stockbit', 'Bank Jago'),
    row('ajaib', 'fund', 'Ajaib Sekuritas'),
    row('xpresi', 'savings', 'Xpresi', 'Bank Mandiri'),
    row('wallet', 'ewallet', 'GoPay', 'Gojek'),
  ];

  it('is titled by its custodian bank as written, a pocket with its currency, and by its broker when no bank is named', () => {
    expect(shownAccounts(rows).map((a) => a.name)).toEqual(['CIMB Niaga', 'CIMB Niaga · USD', 'Bank Jago', 'Ajaib Sekuritas', 'Mandiri Xpresi', 'GoPay']);
  });

  it('keeps the broker as the name typed, read twice or once', () => {
    const shown = shownAccounts(rows);
    expect(shown.map(typedNameOf)).toEqual(rows.map((a) => a.name));
    expect(shownAccounts(shown).map((a) => a.name)).toEqual(shown.map((a) => a.name));
    expect(shown.filter((a) => a.subtype === 'fund').map(brokerNameOf)).toEqual(['Mirae Sekuritas', 'Mirae Sekuritas · USD', 'Stockbit', 'Ajaib Sekuritas']);
  });

  it('keeps the line under it as today while its title is its own', () => {
    const shown = shownAccounts(rows);
    expect(shown.map((a) => a.tellApart)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(shown.map(accountKindLine)).toEqual(['Fund account', 'Fund account', 'Fund account', 'Fund account', 'Saving account', 'Digital wallet']);
  });

  it('names the broker under it when two brokers keep their cash at one bank', () => {
    const two = [...rows, row('bibit', 'fund', 'Bibit', 'cimb niaga')];
    const shown = shownAccounts(two);
    const line = (id: string) => accountKindLine(shown.find((a) => a.id === id)!);
    expect(line('mirae')).toBe('Fund account · Mirae Sekuritas');
    expect(line('bibit')).toBe('Fund account · Bibit');
    // A pocket goes by its account's broker; a bank of its own, or another kind, is left as it was.
    expect(line('mirae-usd')).toBe('Fund account · Mirae Sekuritas');
    expect(line('stockbit')).toBe('Fund account');
    expect(line('xpresi')).toBe('Saving account');
  });

  it('counts only live brokers, and never a bank account that happens to be named like the custodian', () => {
    const shown = shownAccounts([...rows, row('old', 'fund', 'Old Broker', 'CIMB Niaga', { archivedAt: '2026-01-01' }), row('cimb', 'bank', 'CIMB Niaga')]);
    expect(shown.find((a) => a.id === 'mirae')!.tellApart).toBeUndefined();
  });

  it('gives a broker list its brokers back, every other account as it was', () => {
    const shown = shownAccounts(rows);
    expect(shown.map(asBroker).map((a) => a.name)).toEqual(['Mirae Sekuritas', 'Mirae Sekuritas · USD', 'Stockbit', 'Ajaib Sekuritas', 'Mandiri Xpresi', 'GoPay']);
  });

  it('names an Assets row by its custodian, with its broker beside it when two share a bank', () => {
    const two = [...rows, row('bibit', 'fund', 'Bibit', 'CIMB Niaga')];
    const values = [
      { accountId: 'mirae', name: 'Mirae Sekuritas' },
      { accountId: 'stockbit', name: 'Stockbit' },
      { accountId: 'bibit', name: 'Bibit' },
    ];
    expect(withShownNames(values, two).map((v) => [v.name, v.typedName, v.tellApart])).toEqual([
      ['CIMB Niaga', 'Mirae Sekuritas', 'Mirae Sekuritas'],
      ['Bank Jago', 'Stockbit', undefined],
      ['CIMB Niaga', 'Bibit', 'Bibit'],
    ]);
  });

  it('names the balance sheet\'s rows as money lists do: bank accounts with their bank, brokers by their custodian', () => {
    const shown = shownAccounts([...rows, row('bibit', 'fund', 'Bibit', 'CIMB Niaga')]);
    const sheet = [
      { accountId: 'mirae', name: 'Mirae Sekuritas', note: null },
      { accountId: 'stockbit', name: 'Stockbit', note: null },
      { accountId: 'ajaib', name: 'Ajaib Sekuritas', note: null },
      { accountId: 'xpresi', name: 'Xpresi', note: null },
      { accountId: 'theirs', name: 'Partner Sekuritas', note: null },
    ];
    expect(withCustodianNames(sheet, shown).map((r) => [r.name, r.note])).toEqual([
      ['CIMB Niaga', 'Mirae Sekuritas'],
      ['Bank Jago', null],
      ['Ajaib Sekuritas', null],
      ['Mandiri Xpresi', null],
      ['Partner Sekuritas', null],
    ]);
  });

  it('names a one-line choice with its broker only when another shares its bank', () => {
    const shown = shownAccounts([...rows, row('bibit', 'fund', 'Bibit', 'CIMB Niaga')]);
    expect(['mirae', 'stockbit', 'xpresi'].map((id) => accountChoiceName(shown.find((a) => a.id === id)!))).toEqual(['CIMB Niaga · Mirae Sekuritas', 'Bank Jago', 'Mandiri Xpresi']);
  });
});
