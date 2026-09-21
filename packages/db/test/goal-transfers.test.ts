import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  addPhoto,
  createAccount,
  createWorkspace,
  type Database,
  goalContributionsFor,
  goalLinksFor,
  listEarmarks,
  listPhotos,
  listTransactions,
  nativeBalances,
  recordTaggedTransfer,
  recordTrade,
  saveAssetProfile,
  saveEarmark,
  saveEvent,
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

  it('gives the goal its own promise back on the source when a transfer that moved it is voided', async () => {
    await saveEarmark(database, ws, { goalId: hajjId, accountId: bca.id, amountMinor: 7_500_000 });
    const month = async () => (await goalContributionsFor(database, ws, '2026-09'))[hajjId] ?? 0;
    const before = await month();

    const result = await park(7_500_000, hajjId);
    await expect(setAsideFor(hajjId, bca.id)).resolves.toBe(0);
    await expect(setAsideFor(hajjId, rdn.id)).resolves.toBe(7_500_000);
    // +7.500.000 arrived at RDN, −7.500.000 left the BCA promise: the month did not change.
    await expect(month()).resolves.toBe(before);

    await voidTaggedTransfer(database, ws, result.transactionId);

    await expect(setAsideFor(hajjId, bca.id)).resolves.toBe(7_500_000);
    await expect(setAsideFor(hajjId, rdn.id)).resolves.toBe(0);
    // The arrival is void and the taken-back promise is logged back: still nothing new this month.
    await expect(month()).resolves.toBe(before);
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

describe('the transaction a tagged transfer writes', () => {
  it('carries the goal, so the Transactions list can say what the money is for', async () => {
    const result = await park(1_000_000, hajjId);

    const tx = (await listTransactions(database, ws, {})).find((row) => row.id === result.transactionId);
    expect(tx?.goalId).toBe(hajjId);
  });

  it('carries no goal when the money was just moved', async () => {
    const result = await park(1_000_000, null);

    const tx = (await listTransactions(database, ws, {})).find((row) => row.id === result.transactionId);
    expect(tx?.goalId).toBeNull();
  });
});

describe('what a tagged transfer keeps beside the goal', () => {
  it('carries the exclusion, the event and the photos an untagged transfer would have carried', async () => {
    const eventId = await saveEvent(database, ws, { name: 'Umrah 2027', startsOn: '2027-01-10', endsOn: '2027-01-24' });
    // The photo row a form writes before the transaction has an id, exactly as PhotosSheet does.
    const photoId = await addPhoto(database, ws, { transactionId: '', fileName: '0192fa.jpg', mime: 'image/jpeg', byteSize: 64 });

    const result = await recordTaggedTransfer(database, ws, {
      occurredOn: '2026-09-05',
      description: 'Setoran awal',
      amountMinor: 1_000_000,
      fromAccountId: bca.id,
      toAccountId: rdn.id,
      goalId: hajjId,
      excludedFromReport: true,
      eventId,
      photoIds: [photoId],
    });

    const tx = (await listTransactions(database, ws, {})).find((row) => row.id === result.transactionId);
    expect(tx).toMatchObject({ goalId: hajjId, eventId, excluded: true, photoCount: 1 });
    expect((await listPhotos(database, ws, result.transactionId)).map((row) => row.id)).toEqual([photoId]);
  });
});

describe('a transfer that crosses currencies and is tagged to a goal', () => {
  /** A USD account to land in, opened with nothing in it so the opening balance needs no rate of its own. */
  const openWise = () => createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD' });

  it('posts what left and what landed, each in its own currency, and parks the figure that landed', async () => {
    const wise = await openWise();
    // Rp 1.600.000 out, US$100,03 in. An odd number of cents, so a figure read at the wrong scale or rounded
    // the wrong way cannot pass for the right one.
    const result = await recordTaggedTransfer(database, ws, {
      occurredOn: '2026-09-05',
      description: 'To the Wise account',
      amountMinor: 1_600_000,
      toAmountMinor: 10_003,
      fromAccountId: bca.id,
      toAccountId: wise.id,
      goalId: hajjId,
      ratesToBase: { USD: 16_000 },
    });

    const balances = await nativeBalances(database, ws);
    expect(balances[wise.id]).toBe(10_003);
    expect(balances[bca.id]).toBe(50_000_000 - 1_600_000);
    // The set-aside sits on the destination account, so it is counted in that account's own money: US$100,03,
    // never Rp 1.600.000 of a USD balance.
    expect(await setAsideFor(hajjId, wise.id)).toBe(10_003);
    const tx = (await listTransactions(database, ws, {})).find((row) => row.id === result.transactionId);
    expect(tx?.goalId).toBe(hajjId);
  });

  it('asks for what landed rather than posting the source figure on both legs', async () => {
    const wise = await openWise();
    // The old failure was `Lines in USD sum to 1600000, expected 0` — the ledger's own words, after Save, with
    // nothing moved. The refusal now names the field the screen asks for and the currency it is read in.
    await expect(
      recordTaggedTransfer(database, ws, {
        occurredOn: '2026-09-05',
        description: 'To the Wise account',
        amountMinor: 1_600_000,
        fromAccountId: bca.id,
        toAccountId: wise.id,
        goalId: hajjId,
        ratesToBase: { USD: 16_000 },
      }),
    ).rejects.toThrow('Enter what landed in the destination account, in USD');
  });

  it('takes the landed money back out of the goal when the transfer is voided', async () => {
    const wise = await openWise();
    const result = await recordTaggedTransfer(database, ws, {
      occurredOn: '2026-09-05',
      description: 'To the Wise account',
      amountMinor: 1_600_000,
      toAmountMinor: 10_003,
      fromAccountId: bca.id,
      toAccountId: wise.id,
      goalId: hajjId,
      ratesToBase: { USD: 16_000 },
    });
    await voidTaggedTransfer(database, ws, result.transactionId);
    expect(await setAsideFor(hajjId, wise.id)).toBe(0);
  });
});
