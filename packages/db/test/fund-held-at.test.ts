import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  coretaxInputsFor,
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  linkFundInstitutionsOnce,
  linkHolding,
  listAssetProfiles,
  listHoldingLinks,
  migrate,
  MIGRATIONS,
  moveHeldAtToInstitutions,
  recordTrade,
  sameFundAs,
  saveAssetProfile,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
/** Two brokers' cash accounts: the only accounts a fund's Institution links to (owner, 25 Nov 2026). */
let brokerA: AccountRow;
let brokerB: AccountRow;
let atA: AccountRow;
let atB: AccountRow;

const fund = async (name: string) => {
  const account = await createAccount(database, ws, { name, kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: account.id, assetKind: 'fund' });
  return account;
};

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  brokerA = await createAccount(database, ws, { name: 'Contoh Sekuritas', kind: 'asset', subtype: 'fund', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-01' });
  brokerB = await createAccount(database, ws, { name: 'Lain Sekuritas', kind: 'asset', subtype: 'fund', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-01-01' });
  atA = await fund('Pasar Uang Contoh · A');
  atB = await fund('Pasar Uang Contoh · B');
});

const linkOf = async (accountId: string) => (await listHoldingLinks(database, ws)).find((link) => link.accountId === accountId);

describe('where a fund is held', () => {
  it('links its Institution to a broker’s cash account', async () => {
    await linkHolding(database, ws, { accountId: atA.id, brokerAccountId: brokerA.id });
    await linkHolding(database, ws, { accountId: atB.id, brokerAccountId: brokerB.id });
    expect(await linkOf(atA.id)).toMatchObject({ brokerAccountId: brokerA.id });
    expect(await linkOf(atB.id)).toMatchObject({ brokerAccountId: brokerB.id });
  });

  it('never links to a bank, savings, wallet or card account, and a share is still kept only at a broker', async () => {
    for (const [name, kind, subtype] of [
      ['Tabungan Contoh', 'asset', 'bank'],
      ['Simpanan Contoh', 'asset', 'savings'],
      ['Dompet Contoh', 'asset', 'ewallet'],
      ['Kartu Contoh', 'liability', 'credit_card'],
    ] as const) {
      const other = await createAccount(database, ws, { name, kind, subtype, currency: 'IDR' });
      await expect(linkHolding(database, ws, { accountId: atA.id, brokerAccountId: other.id })).rejects.toThrow('An Institution links to a broker’s cash account only');
    }
    expect((await linkOf(atA.id))?.brokerAccountId ?? null).toBeNull();
    const bank = await createAccount(database, ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const share = await createAccount(database, ws, { name: 'BBCA', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: share.id, assetKind: 'stock' });
    await expect(linkHolding(database, ws, { accountId: share.id, brokerAccountId: bank.id })).rejects.toThrow('A broker is the cash account kept there');
  });

  it('groups the same fund at two places under one fund, each keeping its own place', async () => {
    await linkHolding(database, ws, { accountId: atA.id, brokerAccountId: brokerA.id });
    await linkHolding(database, ws, { accountId: atB.id, brokerAccountId: brokerB.id });
    await sameFundAs(database, ws, atB.id, atA.id);
    const [one, two] = [await linkOf(atA.id), await linkOf(atB.id)];
    expect(one?.securityId).toBeTruthy();
    expect(two).toMatchObject({ securityId: one!.securityId, brokerAccountId: brokerB.id });

    await sameFundAs(database, ws, atB.id, null);
    expect((await linkOf(atB.id))?.securityId).toBeNull();
  });

  it('files one tax row per place, named with the linked account as it is now, whatever name was typed before', async () => {
    // Each broker's cash keeps its own Nama institusi, its RDN bank: that names its own cash row, never the fund's.
    await saveAssetProfile(database, ws, { accountId: brokerA.id, assetKind: 'cash', coretaxFields: { inst: 'Bank Contoh' } });
    await saveAssetProfile(database, ws, { accountId: brokerB.id, assetKind: 'cash', coretaxFields: { inst: 'Bank Lain' } });
    await linkHolding(database, ws, { accountId: atA.id, brokerAccountId: brokerA.id });
    await linkHolding(database, ws, { accountId: atB.id, brokerAccountId: brokerB.id });
    await sameFundAs(database, ws, atB.id, atA.id);
    // A name typed before the link: the link is what the tax row names.
    await saveAssetProfile(database, ws, { accountId: atB.id, assetKind: 'fund', coretaxFields: { inst: 'PT Lain Sekuritas Lama' } });
    const buy = (accountId: string, grossMinor: number, cashAccountId: string) =>
      recordTrade(database, ws, { accountId, kind: 'buy', occurredOn: '2026-03-01', unitsMicro: 0, grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId });
    await buy(atA.id, 1_000_000, brokerA.id);
    await buy(atB.id, 400_000, brokerB.id);

    const rows = (await coretaxInputsFor(database, ws, 2026)).holdings.filter((row) => row.accountId === atA.id || row.accountId === atB.id);
    expect(rows.map((row) => [row.name, row.fields.inst, row.valueMinor]).sort()).toEqual([
      ['Pasar Uang Contoh · A — Contoh Sekuritas', 'Contoh Sekuritas', 1_000_000],
      ['Pasar Uang Contoh · A — Lain Sekuritas', 'Lain Sekuritas', 400_000],
    ].sort());
    const cash = (await coretaxInputsFor(database, ws, 2026)).cash.filter((row) => row.accountId === brokerA.id || row.accountId === brokerB.id);
    expect(cash.map((row) => [row.name, row.fields.inst]).sort()).toEqual([
      ['Contoh Sekuritas', 'Bank Contoh'],
      ['Lain Sekuritas', 'Bank Lain'],
    ]);
  });

  it('files a typed place (Other place) by its typed name, with no link', async () => {
    await saveAssetProfile(database, ws, { accountId: atA.id, assetKind: 'fund', coretaxFields: { inst: 'Aplikasi Reksa' } });
    await recordTrade(database, ws, { accountId: atA.id, kind: 'buy', occurredOn: '2026-03-01', unitsMicro: 0, grossMinor: 300_000, feeMinor: 0, taxMinor: 0, cashAccountId: brokerA.id });
    const row = (await coretaxInputsFor(database, ws, 2026)).holdings.find((h) => h.accountId === atA.id);
    expect(row?.fields.inst).toBe('Aplikasi Reksa');
  });
});

describe('held at an institution, never at a bank account', () => {
  it('lets go of a fund or bond linked to a bank, keeps a typed name, and keeps a link to a broker’s cash', async () => {
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
    // Links to a bank written before the rule, as an older build left them.
    await database.db.run(sql`INSERT INTO holding_links (account_id, workspace_id, security_id, broker_account_id, created_at) VALUES
      (${fund.id}, ${ws.workspaceId}, NULL, ${mandiri.id}, '2026-01-01T00:00:00.000Z'),
      (${named.id}, ${ws.workspaceId}, NULL, ${mandiri.id}, '2026-01-01T00:00:00.000Z')`);
    await linkHolding(database, ws, { accountId: bond.id, brokerAccountId: rdn.id });
    await linkHolding(database, ws, { accountId: share.id, brokerAccountId: rdn.id });

    expect(await moveHeldAtToInstitutions(database, ws)).toBe(2);
    const inst = async (id: string) => (await listAssetProfiles(database, ws)).find((p) => p.accountId === id)!.coretaxFields.inst;
    expect(await inst(fund.id)).toBe('Bank Mandiri');
    expect(await inst(named.id)).toBe('Bibit');
    const links = await listHoldingLinks(database, ws);
    expect(links.find((l) => l.accountId === fund.id)?.brokerAccountId ?? null).toBeNull();
    expect(links.find((l) => l.accountId === bond.id)?.brokerAccountId).toBe(rdn.id);
    expect(links.find((l) => l.accountId === share.id)?.brokerAccountId).toBe(rdn.id);
    expect(await moveHeldAtToInstitutions(database, ws)).toBe(0);
  });
});

describe('after migration 0131: a typed Institution naming one broker’s cash is linked to it, once', () => {
  it('links a name matching exactly one broker cash account, either way round and whatever the case; leaves the rest typed', async () => {
    const old = createDatabase(createNodeExecutor());
    await migrate(old, MIGRATIONS.filter((m) => m.version < 131));
    const w = await createWorkspace(old, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const open = (name: string, subtype: 'fund' | 'bank' | 'investment') => createAccount(old, w, { name, kind: 'asset', subtype, currency: 'IDR' });
    const broker = await open('Contoh Sekuritas', 'fund');
    await open('Contoh Sekuritas Syariah', 'fund');
    const lain = await open('Lain Sekuritas', 'fund');
    await open('Bank Lain', 'bank');
    const held = async (name: string, inst: string, kind: 'fund' | 'bond' = 'fund') => {
      const account = await open(name, 'investment');
      await saveAssetProfile(old, w, { accountId: account.id, assetKind: kind, coretaxFields: inst ? { inst } : {} });
      return account;
    };
    const exact = await held('Exact', 'lain sekuritas');
    const longer = await held('Longer', 'PT Lain Sekuritas Indonesia', 'bond');
    const two = await held('Two', 'Contoh Sekuritas');
    const app = await held('App', 'Aplikasi Reksa');
    const bankName = await held('Bank name', 'Bank Lain');
    const none = await held('None', '');
    // Already linked elsewhere: left as it is.
    const linked = await held('Linked', 'Lain Sekuritas');
    await linkHolding(old, w, { accountId: linked.id, brokerAccountId: broker.id });

    await migrate(old);
    expect(await linkFundInstitutionsOnce(old)).toBe(2);
    // Once: the mark is gone, so a later open (after Other place or None) links nothing again.
    expect(await linkFundInstitutionsOnce(old)).toBe(0);
    const links = await listHoldingLinks(old, w);
    const of = (id: string) => links.find((l) => l.accountId === id)?.brokerAccountId ?? null;
    expect(of(exact.id)).toBe(lain.id);
    expect(of(longer.id)).toBe(lain.id);
    expect(of(two.id)).toBeNull();
    expect(of(app.id)).toBeNull();
    expect(of(bankName.id)).toBeNull();
    expect(of(none.id)).toBeNull();
    expect(of(linked.id)).toBe(broker.id);
    // The typed names are left as they were.
    const inst = async (id: string) => (await listAssetProfiles(old, w)).find((p) => p.accountId === id)!.coretaxFields.inst;
    expect(await inst(exact.id)).toBe('lain sekuritas');
    expect(await inst(longer.id)).toBe('PT Lain Sekuritas Indonesia');
  });
});
