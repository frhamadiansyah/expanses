import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AccountError,
  type AccountRow,
  createAccount,
  createWorkspace,
  type Database,
  getAssetProfile,
  listAccounts,
  listCardTiers,
  nativeBalances,
  openCashAccount,
  openPocketedAccount,
  periodFlows,
  postTransaction,
  saveAssetProfile,
  setAccountCardTier,
  setAccountForSpending,
  setAccountNumberLast4,
  setMoneyAccountKind,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

/*
 * A current account and a saving account are both 0102 on the tax report, so picking the other one under Description
 * changes what the account is — its subtype — and nothing else: bank ↔ savings, never any other pair.
 */

let database: Database;
let ws: WorkspaceContext;
beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

const YEAR = { from: '2026-01-01', to: '2026-12-31' };

const open = (item: 'bank' | 'savings', name: string, openingBalanceMinor = 0) =>
  openCashAccount(database, ws, { item, name, currency: 'IDR', bank: 'Bank Lima', openingBalanceMinor, openedOn: '2026-01-05' });

const row = async (id: string) => (await listAccounts(database, ws, { includeArchived: true })).find((account) => account.id === id)!;

/** Everything stored about an account, but its subtype: what the change must leave alone. */
async function everythingBut(id: string) {
  const { subtype: _subtype, ...rest } = (await row(id)) as AccountRow;
  const [raw] = await database.db.values(sql`SELECT * FROM accounts WHERE id = ${id}`);
  const entries = await database.db.values(sql`SELECT id, transaction_id, amount_minor, currency, amount_base_minor FROM entries WHERE account_id = ${id} ORDER BY id`);
  const share = await database.db.values(sql`SELECT setting FROM nw_share_settings WHERE account_id = ${id}`);
  const joint = await database.db.values(sql`SELECT account_id FROM nw_joint_accounts WHERE account_id = ${id}`);
  const cards = await database.db.values(sql`SELECT id, last4, is_primary, archived_at FROM cards WHERE account_id = ${id} ORDER BY id`);
  return {
    rest,
    // The raw row with its subtype column taken out, so a column no list reads is held still too.
    raw: (raw as unknown[]).filter((value) => value !== 'bank' && value !== 'savings'),
    balance: (await nativeBalances(database, ws))[id],
    profile: await getAssetProfile(database, ws, id),
    entries,
    share,
    joint,
    cards,
    tier: (await listCardTiers(database, ws))[id] ?? null,
  };
}

describe('setMoneyAccountKind', () => {
  it('turns a current account into a saving account and keeps everything else about it', async () => {
    const account = await open('bank', 'Harian', 4_250_000_00);
    await saveAssetProfile(database, ws, { accountId: account.id, assetKind: 'cash', planGroup: 'invest', coretaxCode: '0102', coretaxFields: { inst: 'Bank Lima', acct: '0071' } });
    await setAccountForSpending(database, ws, account.id, false);
    await setAccountNumberLast4(database, ws, account.id, '3108');
    await setAccountCardTier(database, ws, account.id, 'gold');
    await database.db.run(sql`INSERT INTO nw_share_settings (account_id, setting) VALUES (${account.id}, 'total')`);
    await database.db.run(sql`INSERT INTO nw_joint_accounts (account_id) VALUES (${account.id})`);
    const before = await everythingBut(account.id);

    await setMoneyAccountKind(database, ws, account.id, 'savings');

    expect((await row(account.id)).subtype).toBe('savings');
    expect(await everythingBut(account.id)).toEqual(before);
    // The For spending switch is the owner's own answer, not the kind's: still off.
    expect((await row(account.id)).forSpending).toBe(0);
  });

  it('turns a saving account into a current account, and a saving account kept for spending stays for spending', async () => {
    const account = await open('savings', 'Simpanan', 1_900_000_00);
    const before = await everythingBut(account.id);

    await setMoneyAccountKind(database, ws, account.id, 'bank');

    expect((await row(account.id)).subtype).toBe('bank');
    expect(await everythingBut(account.id)).toEqual(before);
    expect((await row(account.id)).forSpending).toBe(1);
  });

  it('changes an account with pockets and every pocket under it together, leaving each pocket its own', async () => {
    const { parent, pockets } = await openPocketedAccount(database, ws, {
      item: 'savings',
      name: 'Valas',
      bank: 'Bank Lima',
      openedOn: '2026-02-03',
      pockets: [
        { currency: 'USD', openingBalanceMinor: 310_00, openingRateToBase: 16_020 },
        { currency: 'JPY', openingBalanceMinor: 52_000, openingRateToBase: 104.5 },
      ],
    });
    await setAccountForSpending(database, ws, pockets[1]!.id, false);
    const before = await Promise.all([parent.id, ...pockets.map((pocket) => pocket.id)].map(everythingBut));

    await setMoneyAccountKind(database, ws, parent.id, 'bank');

    for (const id of [parent.id, ...pockets.map((pocket) => pocket.id)]) expect((await row(id)).subtype).toBe('bank');
    expect(await Promise.all([parent.id, ...pockets.map((pocket) => pocket.id)].map(everythingBut))).toEqual(before);
  });

  it('refuses a pocket, which is the kind its account is', async () => {
    const { pockets } = await openPocketedAccount(database, ws, {
      item: 'bank',
      name: 'Valas',
      openedOn: '2026-02-03',
      pockets: [
        { currency: 'USD', openingBalanceMinor: 120_00, openingRateToBase: 16_020 },
        { currency: 'SGD', openingBalanceMinor: 75_00, openingRateToBase: 12_380 },
      ],
    });
    await expect(setMoneyAccountKind(database, ws, pockets[0]!.id, 'savings')).rejects.toThrow(AccountError);
    expect((await row(pockets[0]!.id)).subtype).toBe('bank');
  });

  it('refuses any account that is not a current or saving account, and any kind but those two', async () => {
    const others = [
      await createAccount(database, ws, { name: 'Dompet', kind: 'asset', subtype: 'cash', currency: 'IDR' }),
      await createAccount(database, ws, { name: 'Dompet digital', kind: 'asset', subtype: 'ewallet', currency: 'IDR' }),
      await createAccount(database, ws, { name: 'Kas broker', kind: 'asset', subtype: 'fund', currency: 'IDR' }),
      await createAccount(database, ws, { name: 'Kartu', kind: 'liability', subtype: 'credit_card', currency: 'IDR' }),
      await createAccount(database, ws, { name: 'Rumah', kind: 'asset', subtype: 'property', currency: 'IDR' }),
    ];
    for (const other of others) {
      await expect(setMoneyAccountKind(database, ws, other.id, 'savings')).rejects.toThrow(AccountError);
      await expect(setMoneyAccountKind(database, ws, other.id, 'bank')).rejects.toThrow(AccountError);
      expect((await row(other.id)).subtype).toBe(other.subtype);
    }
    const account = await open('bank', 'Harian');
    for (const kind of ['fund', 'cash', 'time_deposit', 'credit_card'] as const) {
      await expect(setMoneyAccountKind(database, ws, account.id, kind as unknown as 'savings')).rejects.toThrow(AccountError);
    }
    expect((await row(account.id)).subtype).toBe('bank');
  });

  it("refuses an account of another workspace, and one that is not there", async () => {
    const other = await createWorkspace(database, { name: 'Business', type: 'business', baseCurrency: 'IDR' });
    const theirs = await openCashAccount(database, other, { item: 'bank', name: 'Operasional', currency: 'IDR' });
    await expect(setMoneyAccountKind(database, ws, theirs.id, 'savings')).rejects.toThrow('Account not found');
    await expect(setMoneyAccountKind(database, ws, 'no-such-account', 'savings')).rejects.toThrow('Account not found');
  });

  it('is nothing at all when the account already is that kind', async () => {
    const account = await open('savings', 'Simpanan');
    const audits = async () => (await database.db.values<[number]>(sql`SELECT count(*) FROM audit_log WHERE entity_id = ${account.id}`))[0]![0];
    const was = await audits();
    await setMoneyAccountKind(database, ws, account.id, 'savings');
    expect((await row(account.id)).subtype).toBe('savings');
    expect(await audits()).toBe(was);
  });

  it('moves the account between spending money and savings in the savings ratio, its history included', async () => {
    const everyday = await open('bank', 'Harian', 20_000_000_00);
    const target = await open('bank', 'Tujuan');
    await postTransaction(database, ws, {
      occurredOn: '2026-03-14',
      description: 'Transfer',
      lines: [
        { accountId: target.id, amountMinor: 1_500_000_00, currency: 'IDR' },
        { accountId: everyday.id, amountMinor: -1_500_000_00, currency: 'IDR' },
      ],
    });
    const putAway = async () => (await periodFlows(database, ws, YEAR)).putAwayMinor;
    expect(await putAway()).toBe(0);
    await setMoneyAccountKind(database, ws, target.id, 'savings');
    expect(await putAway()).toBe(1_500_000_00);
    await setMoneyAccountKind(database, ws, target.id, 'bank');
    expect(await putAway()).toBe(0);
  });
});
