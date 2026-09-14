import { afterEach, describe, expect, it } from 'vitest';
import { addCard, archiveCard, createAccount, listCards, listIssuers, saveCardIdentity } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const card = async (name: string, issuer: string) => {
    const account = await createAccount(database, ws, { name, kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await saveCardIdentity(database, ws, { accountId: account.id, issuer });
    return account;
  };
  return { database, ws, card };
}

describe('the plastic on an account', () => {
  it('takes a supplementary card beside the primary, each with its own digits', async () => {
    const { database, ws, card } = await workspace();
    const bonvoy = await card('Mandiri Marriott Bonvoy', 'Mandiri');

    await addCard(database, ws, { accountId: bonvoy.id, last4: '1467', holderName: 'Fandrian', isPrimary: true });
    await addCard(database, ws, { accountId: bonvoy.id, last4: '8802', holderName: 'Spouse' });

    // One statement, one limit, two pieces of plastic — which is the whole point of recording them.
    expect((await listCards(database, ws, bonvoy.id)).map((row) => [row.last4, row.holderName])).toEqual([
      ['8802', 'Spouse'],
      ['1467', 'Fandrian'],
    ]);
  });

  it('lets the same four digits repeat at another bank, but not at the same one', async () => {
    const { database, ws, card } = await workspace();
    const mandiri = await card('Mandiri Marriott Bonvoy', 'Mandiri');
    const bca = await card('BCA KrisFlyer', 'BCA');
    const mandiriToo = await card('Mandiri Prioritas', 'Mandiri');

    await addCard(database, ws, { accountId: mandiri.id, last4: '1467', isPrimary: true });
    // A different bank happening to end 1467 is a different card.
    await expect(addCard(database, ws, { accountId: bca.id, last4: '1467', isPrimary: true })).resolves.toEqual(expect.any(String));
    // The same bank twice is the same card typed twice, whichever account it is filed under.
    await expect(addCard(database, ws, { accountId: mandiriToo.id, last4: '1467', isPrimary: true })).rejects.toThrow(/already recorded for Mandiri/);
  });

  it('insists on four digits, and allows none at all', async () => {
    const { database, ws, card } = await workspace();
    const bca = await card('BCA KrisFlyer', 'BCA');

    await expect(addCard(database, ws, { accountId: bca.id, last4: '146' })).rejects.toThrow(/four numbers/);
    await expect(addCard(database, ws, { accountId: bca.id, last4: 'ABCD' })).rejects.toThrow(/four numbers/);
    // Not everyone wants the digits recorded, and the card is still a card.
    await expect(addCard(database, ws, { accountId: bca.id, last4: null })).resolves.toEqual(expect.any(String));
  });

  it('hangs a debit card off a bank account, and refuses accounts that carry no card', async () => {
    const { database, ws } = await workspace();
    const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const gold = await createAccount(database, ws, { name: 'Antam', kind: 'asset', subtype: 'investment', currency: 'IDR' });

    await expect(addCard(database, ws, { accountId: bca.id, last4: '3311', isPrimary: true })).resolves.toEqual(expect.any(String));
    await expect(addCard(database, ws, { accountId: gold.id, last4: '3312' })).rejects.toThrow(/carries no card|Only a credit card/);
  });

  it('frees the digits again once a card is archived', async () => {
    const { database, ws, card } = await workspace();
    const mandiri = await card('Mandiri Marriott Bonvoy', 'Mandiri');
    const id = await addCard(database, ws, { accountId: mandiri.id, last4: '1467', isPrimary: true });

    await archiveCard(database, ws, id);

    expect(await listCards(database, ws, mandiri.id)).toEqual([]);
    // A replacement card after a lost one carries the same digits often enough.
    await expect(addCard(database, ws, { accountId: mandiri.id, last4: '1467', isPrimary: true })).resolves.toEqual(expect.any(String));
  });

  it('offers the issuers the workspace already uses', async () => {
    const { database, ws, card } = await workspace();
    await card('Mandiri Marriott Bonvoy', 'Mandiri');
    await card('BCA KrisFlyer', 'BCA');

    expect(await listIssuers(database, ws)).toEqual(['BCA', 'Mandiri']);
  });
});
