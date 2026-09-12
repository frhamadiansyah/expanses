import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  categoryIdsByKey,
  createAccount,
  type Database,
  periodFlows,
  postTransaction,
  recordTrade,
  saveAssetProfile,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const YEAR = { from: '2026-01-01', to: '2026-12-31' };

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let mandiri: AccountRow;
let deposit: AccountRow;
let rdn: AccountRow;
let gold: AccountRow;
let card: AccountRow;
let kpr: AccountRow;
let categories: Record<string, string>;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 100_000_000, openedOn: '2026-01-01' });
  mandiri = await createAccount(database, ws, { name: 'Mandiri savings', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-01' });
  deposit = await createAccount(database, ws, { name: 'BCA time deposit', kind: 'asset', subtype: 'savings', currency: 'IDR' });
  rdn = await createAccount(database, ws, { name: 'RDN cash', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  kpr = await createAccount(database, ws, { name: 'KPR Bintaro', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 700_000_000, openedOn: '2026-01-01' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  // Broker cash counts as an investment destination, not the emergency buffer.
  await saveAssetProfile(database, ws, { accountId: rdn.id, assetKind: 'cash', planGroup: 'invest' });
  categories = await categoryIdsByKey(database, ws);
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

const buyGold = (occurredOn: string, grams: number, grossMinor: number, cashAccountId: string | null) =>
  recordTrade(database, ws, {
    accountId: gold.id,
    kind: 'buy',
    occurredOn,
    unitsMicro: grams * 1_000_000,
    grossMinor,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId,
  });

const putAway = async () => (await periodFlows(database, ws, YEAR)).putAwayMinor;

describe('what actually went into savings and investments', () => {
  it('counts a purchase paid from the bank', async () => {
    await buyGold('2026-03-09', 10, 18_600_000, bca.id);

    await expect(putAway()).resolves.toBe(18_600_000);
  });

  it('counts a purchase paid by credit card', async () => {
    await buyGold('2026-03-09', 2, 3_980_000, card.id);

    await expect(putAway()).resolves.toBe(3_980_000);
  });

  it('leaves an opening position out, since no money moved', async () => {
    await buyGold('2026-02-01', 10, 18_600_000, null);

    await expect(putAway()).resolves.toBe(0);
  });

  it('counts money moved into broker cash, which is grouped as investments', async () => {
    await transfer('2026-09-05', bca.id, rdn.id, 1_000_000);

    await expect(putAway()).resolves.toBe(1_000_000);
  });

  it('counts money moved into a deposit', async () => {
    await transfer('2026-04-14', bca.id, deposit.id, 50_000_000);

    await expect(putAway()).resolves.toBe(50_000_000);
  });

  it('counts nothing when money moves between two spending accounts', async () => {
    await transfer('2026-05-02', bca.id, mandiri.id, 5_000_000);

    await expect(putAway()).resolves.toBe(0);
  });

  it('subtracts money taken back out', async () => {
    await transfer('2026-09-05', bca.id, rdn.id, 1_000_000);
    await transfer('2026-10-05', rdn.id, bca.id, 400_000);

    await expect(putAway()).resolves.toBe(600_000);
  });

  it('counts loan principal but not the interest', async () => {
    await postTransaction(database, ws, {
      occurredOn: '2026-01-25',
      description: 'KPR installment',
      lines: [
        { accountId: kpr.id, amountMinor: 2_000_000, currency: 'IDR' },
        { accountId: categories['fees.interest']!, amountMinor: 6_000_000, currency: 'IDR' },
        { accountId: bca.id, amountMinor: -8_000_000, currency: 'IDR' },
      ],
    });

    await expect(putAway()).resolves.toBe(2_000_000);
  });

  it('ignores ordinary spending', async () => {
    await postTransaction(database, ws, {
      occurredOn: '2026-01-15',
      description: 'Superindo',
      lines: [
        { accountId: categories['food.groceries']!, amountMinor: 4_000_000, currency: 'IDR' },
        { accountId: bca.id, amountMinor: -4_000_000, currency: 'IDR' },
      ],
    });

    await expect(putAway()).resolves.toBe(0);
  });

  it('adds up everything in the period', async () => {
    await buyGold('2026-03-09', 10, 18_600_000, bca.id);
    await transfer('2026-09-05', bca.id, rdn.id, 1_000_000);
    await postTransaction(database, ws, {
      occurredOn: '2026-01-25',
      description: 'KPR installment',
      lines: [
        { accountId: kpr.id, amountMinor: 2_000_000, currency: 'IDR' },
        { accountId: categories['fees.interest']!, amountMinor: 6_000_000, currency: 'IDR' },
        { accountId: bca.id, amountMinor: -8_000_000, currency: 'IDR' },
      ],
    });

    await expect(putAway()).resolves.toBe(18_600_000 + 1_000_000 + 2_000_000);
  });

  it('is zero for a workspace with nothing recorded', async () => {
    await expect(putAway()).resolves.toBe(0);
  });
});
