import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  addPhoto,
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  goalContributionsFor,
  goalHistory,
  goalLinksFor,
  listEarmarks,
  listPhotos,
  listTransactions,
  migrate,
  MIGRATIONS,
  nativeBalances,
  recordTaggedTransfer,
  recordTrade,
  replaceTransaction,
  saveAssetProfile,
  saveEarmark,
  saveEvent,
  saveGoal,
  upsertPrice,
  voidTaggedTransfer,
  voidTransaction,
  type WorkspaceContext,
  goalsSchema,
} from '../src/index';
import { eq } from 'drizzle-orm';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
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

/*
 * The web deletes through `voidTransaction` and edits through `replaceTransaction`; neither is `voidTaggedTransfer`.
 * Since a tagged transfer moves the goal's own promise off the source, a door that gave the source back without
 * taking the destination back would leave the goal counting the same money in two accounts. Every figure is chosen
 * so that a door that forgets either side reads differently: the destination already held a promise of its own
 * before the transfer, so "cleared to nothing" and "taken back" differ too.
 */
describe('deleting or editing a tagged transfer through the ledger\'s own doors', () => {
  const snapshot = async () => (await listEarmarks(database, ws)).filter((row) => row.goalId === hajjId).map((row) => [row.accountId, row.amountMinor]).sort();

  describe('in rupiah', () => {
    beforeEach(async () => {
      await saveEarmark(database, ws, { goalId: hajjId, accountId: bca.id, amountMinor: 7_500_000 });
      await saveEarmark(database, ws, { goalId: hajjId, accountId: rdn.id, amountMinor: 2_000_000 });
    });

    it('a delete leaves the goal\'s set-asides exactly as before the transfer', async () => {
      const before = await snapshot();
      const result = await park(3_000_000, hajjId);
      await expect(setAsideFor(hajjId, bca.id)).resolves.toBe(4_500_000);
      await expect(setAsideFor(hajjId, rdn.id)).resolves.toBe(5_000_000);

      await voidTransaction(database, ws, result.transactionId);

      await expect(snapshot()).resolves.toEqual(before);
      await expect(setAsideFor(hajjId, bca.id)).resolves.toBe(7_500_000);
      await expect(setAsideFor(hajjId, rdn.id)).resolves.toBe(2_000_000);
    });

    it('an edit leaves them as before the transfer too: the replacement is a plain transfer', async () => {
      const before = await snapshot();
      const result = await park(3_000_000, hajjId);

      await replaceTransaction(database, ws, result.transactionId, {
        occurredOn: '2026-09-05',
        description: 'Transfer to RDN',
        lines: [
          { accountId: rdn.id, amountMinor: 2_500_000, currency: 'IDR' },
          { accountId: bca.id, amountMinor: -2_500_000, currency: 'IDR' },
        ],
      });

      await expect(snapshot()).resolves.toEqual(before);
      await expect(setAsideFor(hajjId, rdn.id)).resolves.toBe(2_000_000);
    });

    it('voidTaggedTransfer still does the same, once', async () => {
      const before = await snapshot();
      const result = await park(3_000_000, hajjId);
      await voidTaggedTransfer(database, ws, result.transactionId);
      await expect(snapshot()).resolves.toEqual(before);
    });
  });

  describe('across currencies', () => {
    let wise: AccountRow;
    const toWise = () =>
      recordTaggedTransfer(database, ws, {
        occurredOn: '2026-09-05',
        description: 'To the Wise account',
        amountMinor: 1_600_000,
        toAmountMinor: 10_003,
        fromAccountId: bca.id,
        toAccountId: wise.id,
        goalId: hajjId,
        ratesToBase: { USD: 16_000 },
      });

    beforeEach(async () => {
      wise = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD' });
      await saveEarmark(database, ws, { goalId: hajjId, accountId: bca.id, amountMinor: 7_500_000 });
      await saveEarmark(database, ws, { goalId: hajjId, accountId: wise.id, amountMinor: 5_001 });
    });

    it('a delete takes the US$100,03 back off Wise and gives the Rp 1.600.000 back to BCA', async () => {
      const before = await snapshot();
      const result = await toWise();
      await expect(setAsideFor(hajjId, bca.id)).resolves.toBe(5_900_000);
      await expect(setAsideFor(hajjId, wise.id)).resolves.toBe(15_004);

      await voidTransaction(database, ws, result.transactionId);

      await expect(snapshot()).resolves.toEqual(before);
      await expect(setAsideFor(hajjId, wise.id)).resolves.toBe(5_001);
      await expect(setAsideFor(hajjId, bca.id)).resolves.toBe(7_500_000);
    });

    it('an edit that reposts the same money leaves them as before the transfer', async () => {
      const before = await snapshot();
      const result = await toWise();
      const original = (await listTransactions(database, ws, { id: result.transactionId }))[0]!;

      await replaceTransaction(database, ws, result.transactionId, {
        occurredOn: original.occurredOn,
        description: original.description,
        lines: original.entries.map((entry) => ({ accountId: entry.accountId, amountMinor: entry.amountMinor, currency: entry.currency })),
        ratesToBase: { USD: 16_000 },
      });

      await expect(snapshot()).resolves.toEqual(before);
      await expect(setAsideFor(hajjId, wise.id)).resolves.toBe(5_001);
    });
  });
});

/*
 * Before 0050 there is no draw to undo a moved promise with, so the tagged transfer must not move one: the source keeps
 * its promise exactly as it did before the feature, and a void takes only the arrival back.
 */
describe('a tagged transfer on a database stopped at 49', () => {
  let executor: NodeExecutor | undefined;
  afterEach(() => executor?.close());

  it('parks exactly as before, and a void leaves the goal its source promise', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 49));
    const oldWs = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const jenius = await createAccount(older, oldWs, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 42_500_000, openedOn: '2026-01-01' });
    const bank = await createAccount(older, oldWs, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const umrah = await saveGoal(older, oldWs, { name: 'Umrah', kind: 'umrah', growthBps: 0, returnBps: 0, stages: [{ name: 'Tickets', targetMinor: 7_500_000, targetMonths: null, dueOn: '2027-03-31' }] });
    await saveEarmark(older, oldWs, { goalId: umrah, accountId: jenius.id, amountMinor: 7_500_000 });
    const held = async (accountId: string) => (await listEarmarks(older, oldWs)).find((row) => row.accountId === accountId)?.amountMinor ?? 0;
    const month = async () => (await goalContributionsFor(older, oldWs, '2026-07'))[umrah] ?? 0;

    const result = await recordTaggedTransfer(older, oldWs, { occurredOn: '2026-07-15', description: 'To BCA', amountMinor: 7_500_000, fromAccountId: jenius.id, toAccountId: bank.id, goalId: umrah });
    expect(await held(jenius.id)).toBe(7_500_000);
    expect(await held(bank.id)).toBe(7_500_000);
    // The arrival only: no own move was logged against it.
    expect(await month()).toBe(7_500_000);

    await voidTaggedTransfer(older, oldWs, result.transactionId);
    // Moving the source promise here left nothing anywhere after the void (and the month at −7.500.000).
    expect(await held(jenius.id)).toBe(7_500_000);
    expect(await held(bank.id)).toBe(0);
    expect(await month()).toBe(0);
  });
});

/*
 * Dated in July, a month the suite never runs in, so a figure logged "today" instead of on the transfer's own day
 * lands in the wrong month and shows. Every case sets Hajj's own promise aside first: saveEarmark logs it today.
 */
describe('what a tagged transfer of a goal\'s own money does to its month', () => {
  const JULY = '2026-07-15';
  const month = async (m: string) => (await goalContributionsFor(database, ws, m))[hajjId] ?? 0;
  const draws = () => database.db.select().from(goalsSchema.goalDraws).where(eq(goalsSchema.goalDraws.workspaceId, ws.workspaceId));

  beforeEach(async () => {
    await saveEarmark(database, ws, { goalId: hajjId, accountId: bca.id, amountMinor: 7_500_000 });
  });

  it('moves part of the promise: only what it carried, and a void gives back only that', async () => {
    const result = await park(5_000_000, hajjId, JULY);
    // Moving the whole promise would read 0 here; the whole amount, clamped, reads the same.
    await expect(setAsideFor(hajjId, bca.id)).resolves.toBe(2_500_000);
    await expect(setAsideFor(hajjId, rdn.id)).resolves.toBe(5_000_000);
    expect(await draws()).toEqual([expect.objectContaining({ intent: 'move', amountMinor: 5_000_000, toAccountId: null, occurredOn: JULY })]);
    // +5.000.000 arrived, −5.000.000 of promise left BCA: nought, in July.
    expect(await month('2026-07')).toBe(0);

    await voidTaggedTransfer(database, ws, result.transactionId);
    await expect(setAsideFor(hajjId, bca.id)).resolves.toBe(7_500_000);
    await expect(setAsideFor(hajjId, rdn.id)).resolves.toBe(0);
    expect(await month('2026-07')).toBe(0);
  });

  it('moves no more than was promised, and a void gives back no more either', async () => {
    const result = await park(10_000_000, hajjId, JULY);
    await expect(setAsideFor(hajjId, bca.id)).resolves.toBe(0);
    await expect(setAsideFor(hajjId, rdn.id)).resolves.toBe(10_000_000);
    // The draw says 7.500.000: saying 10.000.000 would give Hajj 2.500.000 it never had on the void.
    expect((await draws())[0]).toMatchObject({ amountMinor: 7_500_000 });
    // 10.000.000 arrived, 7.500.000 of it was already set aside: 2.500.000 is new this month.
    expect(await month('2026-07')).toBe(2_500_000);

    await voidTaggedTransfer(database, ws, result.transactionId);
    await expect(setAsideFor(hajjId, bca.id)).resolves.toBe(7_500_000);
    expect(await month('2026-07')).toBe(0);
  });

  it('dates the move on the transfer\'s own day, in July and not today', async () => {
    const today = new Date().toISOString().slice(0, 7);
    const before = await month(today);
    await park(7_500_000, hajjId, JULY);
    expect(await month('2026-07')).toBe(0);
    expect(await month(today)).toBe(before);
  });

  it('into a card: the promise stays on the source, and nothing is drawn', async () => {
    const card = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await recordTaggedTransfer(database, ws, { occurredOn: JULY, description: 'Pay card', amountMinor: 5_000_000, fromAccountId: bca.id, toAccountId: card.id, goalId: hajjId });
    await expect(setAsideFor(hajjId, bca.id)).resolves.toBe(7_500_000);
    expect(await draws()).toEqual([]);
  });

  it('across currencies, IDR to USD: the arrival counts once, and the move nets it to nought', async () => {
    const wise = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD' });
    // Rp 7.500.000 → US$468,75 at 16.000. The exchange account is credited Rp 7.500.000 too: counting it read +7.500.000.
    await recordTaggedTransfer(database, ws, { occurredOn: JULY, description: 'To Wise', amountMinor: 7_500_000, toAmountMinor: 46_875, fromAccountId: bca.id, toAccountId: wise.id, goalId: hajjId, ratesToBase: { USD: 16_000 } });
    await expect(setAsideFor(hajjId, wise.id)).resolves.toBe(46_875);
    expect(await month('2026-07')).toBe(0);
    const july = ((await goalHistory(database, ws, '2026-07-31'))[hajjId] ?? []).filter((entry) => entry.occurredOn === JULY);
    expect(july.map((entry) => [entry.kind, entry.amountMinor, entry.currency]).sort()).toEqual([
      ['set-aside', 7_500_000, 'IDR'],
      ['taken-back', -7_500_000, 'IDR'],
    ]);
  });

  it('across accounts in USD: the move is counted in base, never in cents beside rupiah', async () => {
    const wise = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD' });
    const ibkr = await createAccount(database, ws, { name: 'IBKR cash', kind: 'asset', subtype: 'bank', currency: 'USD' });
    await saveEarmark(database, ws, { goalId: hajjId, accountId: wise.id, amountMinor: 10_000 });
    const result = await recordTaggedTransfer(database, ws, { occurredOn: JULY, description: 'To IBKR', amountMinor: 10_000, fromAccountId: wise.id, toAccountId: ibkr.id, goalId: hajjId, ratesToBase: { USD: 16_000 } });
    await expect(setAsideFor(hajjId, wise.id)).resolves.toBe(0);
    await expect(setAsideFor(hajjId, ibkr.id)).resolves.toBe(10_000);
    // +1.600.000 arrived (base) and −1.600.000 left the Wise promise (base). Logging −10.000 cents read +1.590.000.
    expect(await month('2026-07')).toBe(0);
    await voidTaggedTransfer(database, ws, result.transactionId);
    await expect(setAsideFor(hajjId, wise.id)).resolves.toBe(10_000);
    expect(await month('2026-07')).toBe(0);
  });
});
