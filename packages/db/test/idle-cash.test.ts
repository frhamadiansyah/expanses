import { beforeEach, describe, expect, it } from 'vitest';
import { type AccountRow, createAccount, type Database, idleCash, postTransaction, recordTrade, saveAssetProfile, type WorkspaceContext } from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-10-12';

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let rdn: AccountRow;
let empty: AccountRow;
let gold: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  rdn = await createAccount(database, ws, { name: 'RDN Stockbit', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  empty = await createAccount(database, ws, { name: 'RDN IPOT', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  await saveAssetProfile(database, ws, { accountId: rdn.id, assetKind: 'cash', planGroup: 'invest' });
  await saveAssetProfile(database, ws, { accountId: empty.id, assetKind: 'cash', planGroup: 'invest' });
});

const transfer = (occurredOn: string, from: string, to: string, amountMinor: number) =>
  postTransaction(database, ws, {
    occurredOn,
    description: 'Transfer',
    lines: [
      { accountId: to, amountMinor, currency: 'IDR' },
      { accountId: from, amountMinor: -amountMinor, currency: 'IDR' },
    ],
  });

const rowFor = async (accountId: string) => (await idleCash(database, ws, TODAY)).find((row) => row.accountId === accountId);

describe('idleCash', () => {
  it('names the broker account, what it holds and when the money arrived', async () => {
    await transfer('2026-10-05', bca.id, rdn.id, 1_000_000);

    expect(await rowFor(rdn.id)).toMatchObject({ name: 'RDN Stockbit', currency: 'IDR', planGroup: 'invest', amountMinor: 1_000_000, since: '2026-10-05' });
  });

  it('reports the newest arrival, not the first', async () => {
    await transfer('2026-09-05', bca.id, rdn.id, 1_000_000);
    await transfer('2026-10-05', bca.id, rdn.id, 1_000_000);

    expect(await rowFor(rdn.id)).toMatchObject({ amountMinor: 2_000_000, since: '2026-10-05' });
  });

  it('keeps the date the money arrived after a purchase spent part of it', async () => {
    await transfer('2026-10-05', bca.id, rdn.id, 2_000_000);
    await recordTrade(database, ws, {
      accountId: gold.id,
      kind: 'buy',
      occurredOn: '2026-10-08',
      unitsMicro: 500_000,
      grossMinor: 988_981,
      feeMinor: 0,
      taxMinor: 0,
      cashAccountId: rdn.id,
    });

    expect(await rowFor(rdn.id)).toMatchObject({ amountMinor: 1_011_019, since: '2026-10-05' });
  });

  it('lists an everyday bank account too, with its own group, so the screen can decide', async () => {
    expect(await rowFor(bca.id)).toMatchObject({ planGroup: 'liquid', amountMinor: 50_000_000 });
  });

  it('leaves out an account money never reached', async () => {
    expect(await rowFor(empty.id)).toBeUndefined();
  });

  it('leaves out holdings measured in units', async () => {
    expect(await rowFor(gold.id)).toBeUndefined();
  });

  it('ignores money that arrives after the date asked for', async () => {
    await transfer('2026-11-02', bca.id, rdn.id, 1_000_000);

    expect(await rowFor(rdn.id)).toBeUndefined();
  });
});
