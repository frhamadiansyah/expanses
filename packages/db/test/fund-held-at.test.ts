import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  coretaxInputsFor,
  createAccount,
  type Database,
  linkHolding,
  listAssetProfiles,
  listHoldingLinks,
  moveHeldAtToInstitutions,
  recordTrade,
  sameFundAs,
  saveAssetProfile,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let bank: AccountRow;
let app: AccountRow;
let atBank: AccountRow;
let atApp: AccountRow;

const fund = async (name: string) => {
  const account = await createAccount(database, ws, { name, kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: account.id, assetKind: 'fund' });
  return account;
};

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bank = await createAccount(database, ws, { name: 'Bank Mandiri', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-01' });
  app = await createAccount(database, ws, { name: 'Bibit', kind: 'asset', subtype: 'ewallet', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-01-01' });
  atBank = await fund('Sucor Money Market · Mandiri');
  atApp = await fund('Sucor Money Market · Bibit');
});

const linkOf = async (accountId: string) => (await listHoldingLinks(database, ws)).find((link) => link.accountId === accountId);

describe('where a fund is held', () => {
  it('is a bank or a fund app as well as a broker', async () => {
    await linkHolding(database, ws, { accountId: atBank.id, brokerAccountId: bank.id });
    await linkHolding(database, ws, { accountId: atApp.id, brokerAccountId: app.id });
    expect(await linkOf(atBank.id)).toMatchObject({ brokerAccountId: bank.id });
    expect(await linkOf(atApp.id)).toMatchObject({ brokerAccountId: app.id });
  });

  it('is never a credit card, and a share is still kept only at a broker', async () => {
    const card = await createAccount(database, ws, { name: 'Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await expect(linkHolding(database, ws, { accountId: atBank.id, brokerAccountId: card.id })).rejects.toThrow('It is held at a broker, a bank or a fund app');
    const share = await createAccount(database, ws, { name: 'BBCA', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: share.id, assetKind: 'stock' });
    await expect(linkHolding(database, ws, { accountId: share.id, brokerAccountId: bank.id })).rejects.toThrow('A broker is the cash account kept there');
  });

  it('groups the same fund at two places under one fund, each keeping its own place', async () => {
    await linkHolding(database, ws, { accountId: atBank.id, brokerAccountId: bank.id });
    await linkHolding(database, ws, { accountId: atApp.id, brokerAccountId: app.id });
    await sameFundAs(database, ws, atApp.id, atBank.id);
    const [one, two] = [await linkOf(atBank.id), await linkOf(atApp.id)];
    expect(one?.securityId).toBeTruthy();
    expect(two).toMatchObject({ securityId: one!.securityId, brokerAccountId: app.id });

    await sameFundAs(database, ws, atApp.id, null);
    expect((await linkOf(atApp.id))?.securityId).toBeNull();
  });

  it('files one tax row per place, named with the place and its Nama institusi', async () => {
    await linkHolding(database, ws, { accountId: atBank.id, brokerAccountId: bank.id });
    await linkHolding(database, ws, { accountId: atApp.id, brokerAccountId: app.id });
    await sameFundAs(database, ws, atApp.id, atBank.id);
    const buy = (accountId: string, grossMinor: number, cashAccountId: string) =>
      recordTrade(database, ws, { accountId, kind: 'buy', occurredOn: '2026-03-01', unitsMicro: 0, grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId });
    await buy(atBank.id, 1_000_000, bank.id);
    await buy(atApp.id, 400_000, app.id);

    const rows = (await coretaxInputsFor(database, ws, 2026)).holdings.filter((row) => row.accountId === atBank.id || row.accountId === atApp.id);
    expect(rows.map((row) => [row.name, row.fields.inst, row.valueMinor]).sort()).toEqual([
      ['Sucor Money Market · Mandiri — Bank Mandiri', 'Bank Mandiri', 1_000_000],
      ['Sucor Money Market · Mandiri — Bibit', 'Bibit', 400_000],
    ].sort());
  });
});

describe('held at an institution, not an account', () => {
  it('moves a fund or bond linked to an account onto its institution, keeps a typed name, and leaves a share at its broker', async () => {
    const { database, ws } = await setupDb();
    const mandiri = await createAccount(database, ws, { name: 'Mandiri Tabungan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: mandiri.id, assetKind: 'cash', coretaxFields: { inst: 'Bank Mandiri' } });
    const rdn = await createAccount(database, ws, { name: 'Stockbit', kind: 'asset', subtype: 'fund', currency: 'IDR' });
    const fund = await createAccount(database, ws, { name: 'Money market', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    const bond = await createAccount(database, ws, { name: 'Retail bond', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    const named = await createAccount(database, ws, { name: 'Typed fund', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    const share = await createAccount(database, ws, { name: 'Bank shares', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: fund.id, assetKind: 'fund' });
    await saveAssetProfile(database, ws, { accountId: bond.id, assetKind: 'bond' });
    await saveAssetProfile(database, ws, { accountId: named.id, assetKind: 'fund', coretaxFields: { inst: 'Bibit' } });
    await saveAssetProfile(database, ws, { accountId: share.id, assetKind: 'stock' });
    await linkHolding(database, ws, { accountId: fund.id, brokerAccountId: mandiri.id });
    await linkHolding(database, ws, { accountId: bond.id, brokerAccountId: rdn.id });
    await linkHolding(database, ws, { accountId: named.id, brokerAccountId: mandiri.id });
    await linkHolding(database, ws, { accountId: share.id, brokerAccountId: rdn.id });

    expect(await moveHeldAtToInstitutions(database, ws)).toBe(3);
    const inst = async (id: string) => (await listAssetProfiles(database, ws)).find((p) => p.accountId === id)!.coretaxFields.inst;
    expect(await inst(fund.id)).toBe('Bank Mandiri');
    expect(await inst(bond.id)).toBe('Stockbit');
    expect(await inst(named.id)).toBe('Bibit');
    const links = await listHoldingLinks(database, ws);
    expect(links.find((l) => l.accountId === fund.id)?.brokerAccountId ?? null).toBeNull();
    expect(links.find((l) => l.accountId === share.id)?.brokerAccountId).toBe(rdn.id);
    expect(await moveHeldAtToInstitutions(database, ws)).toBe(0);
  });
});
