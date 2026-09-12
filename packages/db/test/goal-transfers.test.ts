import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  createWorkspace,
  type Database,
  goalLinksFor,
  listEarmarks,
  nativeBalances,
  recordTaggedTransfer,
  recordTrade,
  saveAssetProfile,
  saveGoal,
  upsertPrice,
  voidTaggedTransfer,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-12';

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let rdn: AccountRow;
let gold: AccountRow;
let retireId: string;
let hajjId: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  rdn = await createAccount(database, ws, { name: 'RDN cash', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: rdn.id, assetKind: 'cash', planGroup: 'invest' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  // A gram costs exactly Rp 987.500 here, so a purchase leaves a clean remainder.
  await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-11', priceMicro: 987_500_000_000 });
  retireId = await saveGoal(database, ws, {
    name: 'Retirement at 55',
    kind: 'retirement',
    growthBps: 400,
    returnBps: 900,
    stages: [{ name: 'Retirement fund', targetMinor: 4_000_000_000, targetMonths: null, dueOn: '2046-12-31' }],
  });
  hajjId = await saveGoal(database, ws, {
    name: 'Hajj for two',
    kind: 'hajj',
    growthBps: 500,
    returnBps: 600,
    stages: [{ name: 'Setoran awal', targetMinor: 50_000_000, targetMonths: null, dueOn: '2027-06-30' }],
  });
});

const park = (amountMinor: number, goalId: string | null, occurredOn = '2026-09-05') =>
  recordTaggedTransfer(database, ws, { occurredOn, description: 'Transfer to RDN', amountMinor, fromAccountId: bca.id, toAccountId: rdn.id, goalId });

const buyGold = (grams: number, grossMinor: number, cashAccountId: string, goalId: string | null, occurredOn = '2026-09-10') =>
  recordTrade(database, ws, {
    accountId: gold.id,
    kind: 'buy',
    occurredOn,
    unitsMicro: grams * 1_000_000,
    grossMinor,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId,
    goalId,
  });

const setAsideFor = async (goalId: string, accountId: string) =>
  (await listEarmarks(database, ws)).find((earmark) => earmark.goalId === goalId && earmark.accountId === accountId)?.amountMinor ?? 0;

const goalValue = async (goalId: string) =>
  (await goalLinksFor(database, ws, TODAY)).filter((link) => link.goalId === goalId).reduce((total, link) => total + link.valueMinor, 0);

describe('a transfer tagged to a goal', () => {
  it('parks the money against the goal straight away', async () => {
    const result = await park(1_000_000, retireId);

    expect(result.setAsideMinor).toBe(1_000_000);
    await expect(setAsideFor(retireId, rdn.id)).resolves.toBe(1_000_000);
    await expect(goalValue(retireId)).resolves.toBe(1_000_000);
  });

  it('still moves the money in the ledger', async () => {
    await park(1_000_000, retireId);

    const balances = await nativeBalances(database, ws);
    expect(balances[bca.id]).toBe(49_000_000);
    expect(balances[rdn.id]).toBe(1_000_000);
  });

  it('parks nothing when no goal is named', async () => {
    const result = await park(1_000_000, null);

    expect(result.setAsideMinor).toBe(0);
    await expect(listEarmarks(database, ws)).resolves.toEqual([]);
  });

  it('adds up month after month', async () => {
    await park(1_000_000, retireId, '2026-08-05');
    await park(1_000_000, retireId, '2026-09-05');

    await expect(setAsideFor(retireId, rdn.id)).resolves.toBe(2_000_000);
  });

  it('takes it back down when the transfer is voided', async () => {
    const result = await park(1_000_000, retireId);

    await voidTaggedTransfer(database, ws, result.transactionId);

    await expect(setAsideFor(retireId, rdn.id)).resolves.toBe(0);
  });
});

describe('buying with money that was parked', () => {
  it('turns parked cash into units without changing what the goal is worth', async () => {
    await park(1_000_000, retireId);
    const before = await goalValue(retireId);

    await buyGold(1, 987_500, rdn.id, retireId);

    expect(await goalValue(retireId)).toBe(before);
    await expect(setAsideFor(retireId, rdn.id)).resolves.toBe(12_500);
  });

  it('leaves the remainder waiting for next time', async () => {
    await park(1_000_000, retireId);
    await buyGold(1, 987_500, rdn.id, retireId);
    await park(1_000_000, retireId, '2026-10-05');

    await expect(setAsideFor(retireId, rdn.id)).resolves.toBe(1_012_500);
  });

  it('floors at zero when the purchase is bigger than what was parked', async () => {
    await park(1_000_000, retireId);

    await buyGold(2, 1_975_000, rdn.id, retireId);

    await expect(setAsideFor(retireId, rdn.id)).resolves.toBe(0);
  });

  it('leaves another goal alone', async () => {
    await park(1_000_000, retireId);
    await park(2_000_000, hajjId, '2026-09-06');

    await buyGold(1, 987_500, rdn.id, retireId);

    await expect(setAsideFor(hajjId, rdn.id)).resolves.toBe(2_000_000);
  });

  it('does not touch the parked money when the purchase is paid from the bank', async () => {
    await park(1_000_000, retireId);

    await buyGold(1, 987_500, bca.id, retireId);

    await expect(setAsideFor(retireId, rdn.id)).resolves.toBe(1_000_000);
  });

  it('does not touch it when the purchase names no goal', async () => {
    await park(1_000_000, retireId);

    await buyGold(1, 987_500, rdn.id, null);

    await expect(setAsideFor(retireId, rdn.id)).resolves.toBe(1_000_000);
  });
});

describe('workspace boundaries', () => {
  it('refuses a goal from another workspace', async () => {
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });

    await expect(
      recordTaggedTransfer(database, other, { occurredOn: '2026-09-05', description: 'Transfer', amountMinor: 1_000_000, fromAccountId: bca.id, toAccountId: rdn.id, goalId: retireId }),
    ).rejects.toThrow();
  });
});
