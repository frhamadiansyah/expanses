import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveAccount,
  coretaxInputsFor,
  createAccount,
  type Database,
  linkHolding,
  openCashAccount,
  recordTrade,
  saveAssetProfile,
  upsertPrice,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

const rdn = (name: string) => openCashAccount(database, ws, { item: 'fund', name, bank: 'CIMB Niaga', currency: 'IDR', openingBalanceMinor: 8_000_000, openedOn: '2026-01-02' });

describe('a fund account is one broker’s RDN', () => {
  it('refuses a second open fund account for the same broker, whatever its case', async () => {
    await rdn('Stockbit Sekuritas');
    await expect(rdn(' stockbit sekuritas ')).rejects.toThrow('Stockbit Sekuritas already has a fund account');
    // Another broker is another RDN.
    await expect(rdn('Mirae Asset Sekuritas')).resolves.toMatchObject({ name: 'Mirae Asset Sekuritas' });
  });

  it('lets the broker open one again once the old one is archived', async () => {
    const old = await openCashAccount(database, ws, { item: 'fund', name: 'Ajaib Sekuritas', currency: 'IDR' });
    await archiveAccount(database, ws, old.id);
    await expect(rdn('Ajaib Sekuritas')).resolves.toMatchObject({ name: 'Ajaib Sekuritas' });
  });
});

describe('the tax report reads the broker and the RDN bank each where it belongs', () => {
  it('files the RDN’s cash under its bank and the shares kept there under the broker', async () => {
    const broker = await rdn('Stockbit Sekuritas');
    const shares = await createAccount(database, ws, { name: 'BBRI', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: shares.id, assetKind: 'stock' });
    await recordTrade(database, ws, { accountId: shares.id, kind: 'buy', occurredOn: '2026-02-10', unitsMicro: 500_000_000, grossMinor: 2_100_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
    await upsertPrice(database, ws, { accountId: shares.id, onDate: '2026-09-30', priceMicro: 4_650_000_000 });
    await linkHolding(database, ws, { accountId: shares.id, brokerAccountId: broker.id });

    const inputs = await coretaxInputsFor(database, ws, 2026);
    expect(inputs.cash.find((row) => row.accountId === broker.id)!.fields.inst).toBe('CIMB Niaga');
    expect(inputs.holdings.find((row) => row.accountId === shares.id)!.fields.inst).toBe('Stockbit Sekuritas');
  });

  it('keeps an institution typed on the holding itself', async () => {
    const broker = await rdn('Stockbit Sekuritas');
    const shares = await createAccount(database, ws, { name: 'BBRI', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: shares.id, assetKind: 'stock', coretaxFields: { inst: 'KSEI' } });
    await recordTrade(database, ws, { accountId: shares.id, kind: 'buy', occurredOn: '2026-02-10', unitsMicro: 500_000_000, grossMinor: 2_100_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
    await linkHolding(database, ws, { accountId: shares.id, brokerAccountId: broker.id });
    expect((await coretaxInputsFor(database, ws, 2026)).holdings.find((row) => row.accountId === shares.id)!.fields.inst).toBe('KSEI');
  });
});
