import { transferLines } from '@expanses/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCardAccount, type Database, getAssetProfile, listAccounts, listTransactions, openCashAccount, openPocketedAccount, postTransaction, saveAssetProfile, type WorkspaceContext } from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

const byName = async () => new Map((await listAccounts(database, ws)).map((account) => [account.name, account]));

describe('an account at a bank names its bank', () => {
  it('reads the bank off the account, and only for money held at a bank', async () => {
    await openCashAccount(database, ws, { item: 'savings', name: 'Xpresi', bank: 'Bank Mandiri', currency: 'IDR' });
    await openCashAccount(database, ws, { item: 'time_deposit', name: 'Six months', bank: 'Bank Jago', currency: 'IDR', maturesOn: '2027-04-30', rateBps: 450 });
    await openCashAccount(database, ws, { item: 'fund', name: 'Stockbit Sekuritas', bank: 'Bank Central Asia', currency: 'IDR' });
    await openCashAccount(database, ws, { item: 'ewallet', name: 'GoPay', currency: 'IDR' });
    await openCashAccount(database, ws, { item: 'bank', name: 'Payroll', currency: 'IDR' });
    const accounts = await byName();
    expect(accounts.get('Xpresi')?.bank).toBe('Bank Mandiri');
    expect(accounts.get('Six months')?.bank).toBe('Bank Jago');
    // A broker's custodian bank is what lists of money call it by (owner, 25 Nov); a wallet has no bank.
    expect(accounts.get('Stockbit Sekuritas')?.bank).toBe('Bank Central Asia');
    expect(accounts.get('GoPay')?.bank).toBeNull();
    expect(accounts.get('Payroll')?.bank).toBeNull();
    // What is stored is untouched: the name as typed, the institution as picked.
    const xpresi = accounts.get('Xpresi')!;
    expect((await getAssetProfile(database, ws, xpresi.id))?.coretaxFields.inst).toBe('Bank Mandiri');
  });

  it('gives an account with pockets, and every pocket, the bank its pockets keep', async () => {
    const { parent, pockets } = await openPocketedAccount(database, ws, {
      item: 'savings',
      name: 'Valas',
      bank: 'Bank Negara Indonesia',
      pockets: [{ currency: 'IDR', openingBalanceMinor: 0 }, { currency: 'USD', openingBalanceMinor: 0, openingRateToBase: 16_120 }],
    });
    const rows = await listAccounts(database, ws);
    for (const id of [parent.id, ...pockets.map((p) => p.id)]) expect(rows.find((row) => row.id === id)?.bank).toBe('Bank Negara Indonesia');
  });

  it('follows the Institution when it is changed in Settings', async () => {
    const account = await openCashAccount(database, ws, { item: 'bank', name: 'Everyday', currency: 'IDR' });
    const profile = (await getAssetProfile(database, ws, account.id))!;
    await saveAssetProfile(database, ws, { ...profile, accountId: account.id, coretaxFields: { ...profile.coretaxFields, inst: 'Hanseatic Bank' } });
    expect((await byName()).get('Everyday')?.bank).toBe('Hanseatic Bank');
  });

  it('names a transaction line on it with its bank, once', async () => {
    const xpresi = await openCashAccount(database, ws, { item: 'savings', name: 'Xpresi', bank: 'Bank Mandiri', currency: 'IDR', openingBalanceMinor: 900_000 });
    const tahapan = await openCashAccount(database, ws, { item: 'bank', name: 'BCA Tahapan', bank: 'Bank Central Asia', currency: 'IDR' });
    const gopay = await openCashAccount(database, ws, { item: 'ewallet', name: 'GoPay', currency: 'IDR' });
    await postTransaction(database, ws, { occurredOn: '2026-10-02', description: 'Transfer', lines: transferLines({ fromAccountId: xpresi.id, toAccountId: tahapan.id, amountMinor: 120_000, currency: 'IDR' }) });
    await postTransaction(database, ws, { occurredOn: '2026-10-03', description: 'Top up', lines: transferLines({ fromAccountId: xpresi.id, toAccountId: gopay.id, amountMinor: 45_000, currency: 'IDR' }) });
    const names = (await listTransactions(database, ws, { from: '2026-10-02', to: '2026-10-03' })).flatMap((tx) => tx.entries.map((e) => e.accountName)).sort();
    expect(names).toEqual(['BCA Tahapan', 'GoPay', 'Mandiri Xpresi', 'Mandiri Xpresi']);
  });

  it('reads a credit card’s bank off its issuer, kept apart from its name', async () => {
    await createCardAccount(database, ws, { name: 'UnionPay', subtype: 'credit_card', currency: 'IDR', issuer: 'BCA' });
    await createCardAccount(database, ws, { name: 'Mandiri Signature', subtype: 'credit_card', currency: 'IDR', issuer: 'Mandiri' });
    await createCardAccount(database, ws, { name: 'Nusa Voyager Travel', subtype: 'credit_card', currency: 'IDR' });
    const accounts = await byName();
    expect(accounts.get('UnionPay')?.bank).toBe('BCA');
    expect(accounts.get('Mandiri Signature')?.bank).toBe('Mandiri');
    expect(accounts.get('Nusa Voyager Travel')?.bank).toBeNull();
  });
});
