import { afterEach, describe, expect, it } from 'vitest';
import { findEntry } from '@expanses/catalog';
import { applyCatalogEntry, createAccount, createCardAccount, listAccounts, listCardIdentities, listCards, nativeBalances } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

describe('opening a card account', () => {
  it('records the bank, the product and the card in one step', async () => {
    current = await setupDb();
    const { database, ws } = current;

    const account = await createCardAccount(database, ws, {
      name: 'Mandiri Marriott Bonvoy',
      issuer: 'Mandiri',
      subtype: 'credit_card',
      currency: 'IDR',
      last4: '1467',
      holderName: 'Fandrian',
    });

    // The name is the owner's own, exactly as typed.
    expect(account.name).toBe('Mandiri Marriott Bonvoy');
    expect((await listCardIdentities(database, ws))[0]).toMatchObject({ issuer: 'Mandiri' });
    expect(await listCards(database, ws, account.id)).toEqual([
      { id: expect.any(String), accountId: account.id, last4: '1467', holderName: 'Fandrian', isPrimary: true },
    ]);
  });

  it('carries an opening balance through, as the account form does', async () => {
    current = await setupDb();
    const { database, ws } = current;

    const account = await createCardAccount(database, ws, {
      name: 'BCA KrisFlyer',
      issuer: 'BCA',
      subtype: 'credit_card',
      currency: 'IDR',
      openingBalanceMinor: 2_500_000,
      openedOn: '2026-09-01',
    });

    expect((await nativeBalances(database, ws))[account.id]).toBe(-2_500_000);
  });

  it('opens a card with no bank and no digits at all', async () => {
    current = await setupDb();
    const { database, ws } = current;

    // The bank is optional: a catalogue entry fills it in later, or never.
    const account = await createCardAccount(database, ws, { name: 'Some Card', subtype: 'credit_card', currency: 'IDR' });

    expect(account.name).toBe('Some Card');
    expect(await listCardIdentities(database, ws)).toEqual([]);
    expect(await listCards(database, ws, account.id)).toEqual([]);
  });

  it('refuses digits already recorded at that bank, before opening anything', async () => {
    current = await setupDb();
    const { database, ws } = current;
    await createCardAccount(database, ws, { name: 'Mandiri Bonvoy', issuer: 'Mandiri', subtype: 'credit_card', currency: 'IDR', last4: '1467' });
    const before = (await listAccounts(database, ws)).length;

    await expect(
      createCardAccount(database, ws, { name: 'Mandiri Prioritas', issuer: 'Mandiri', subtype: 'credit_card', currency: 'IDR', last4: '1467' }),
    ).rejects.toThrow(/already recorded for Mandiri/);

    // Nothing half-made: the check runs before the account is opened.
    expect((await listAccounts(database, ws)).length).toBe(before);
  });

  it('opens a bank account with a debit card on it', async () => {
    current = await setupDb();
    const { database, ws } = current;

    const account = await createCardAccount(database, ws, { name: 'BCA Tahapan', issuer: 'BCA', subtype: 'bank', currency: 'IDR', last4: '3311' });

    expect(account).toMatchObject({ kind: 'asset', subtype: 'bank', name: 'BCA Tahapan' });
    expect((await listCards(database, ws, account.id))[0]?.last4).toBe('3311');
  });
});

describe('applying a catalogue entry', () => {
  it('fills in the bank the entry names', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const account = await createAccount(database, ws, { name: 'My KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });

    await applyCatalogEntry(database, ws, { cardAccountId: account.id, entry: findEntry('bca-sq-krisflyer-visa-signature')!, today: '2026-09-14', replaceManual: false });

    expect((await listCardIdentities(database, ws))[0]).toMatchObject({ accountId: account.id, issuer: 'BCA' });
  });
});
