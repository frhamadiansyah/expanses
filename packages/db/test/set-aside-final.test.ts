/*
 * The money rules the G4+G5 review found unpinned (I1–I4, the db half of M1), and the two G2 findings ruled for G6
 * (M1: an archived goal's stage, M8: idle cash measured like with like). Each figure is chosen so the mutant the review
 * names beside the test reads a different number, stage, day or row.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { expenseLines, transferLines } from '@expanses/core';
import {
  type AccountRow,
  archiveGoal,
  createAccount,
  type Database,
  goalContributionEvents,
  goalContributionsFor,
  goalHistory,
  goalsSchema,
  idleCash,
  listDraws,
  listEarmarks,
  listGoals,
  postTransaction,
  recordTaggedTransfer,
  recordTrade,
  replaceTrade,
  replaceTransaction,
  saveAssetProfile,
  saveEarmark,
  saveGoal,
  type SetAsideChoice,
  setStagePaid,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const DAY = '2026-09-19';
const JULY = '2026-07-15';
let database: Database;
let ws: WorkspaceContext;
let jenius: AccountRow;
let bca: AccountRow;
let electronics: AccountRow;
let office: AccountRow;
let efId: string;
let umrahId: string;

const twoStages = (name: string) =>
  saveGoal(database, ws, {
    name,
    kind: 'umrah',
    growthBps: 0,
    returnBps: 0,
    stages: [
      { name: 'Tickets', targetMinor: 7_500_000, targetMonths: null, dueOn: '2027-03-31' },
      { name: 'Hotel', targetMinor: 5_000_000, targetMonths: null, dueOn: '2027-04-30' },
    ],
  });

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  jenius = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 42_500_000, openedOn: '2026-01-01' });
  bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  electronics = await createAccount(database, ws, { name: 'Electronics', kind: 'expense', subtype: 'category', currency: null });
  office = await createAccount(database, ws, { name: 'Office', kind: 'expense', subtype: 'category', currency: null });
  efId = await saveGoal(database, ws, { name: 'Emergency fund', kind: 'emergency', growthBps: 0, returnBps: 0, stages: [{ name: 'Emergency fund', targetMinor: 30_000_000, targetMonths: null, dueOn: '2027-12-31' }] });
  umrahId = await twoStages('Umrah 2027');
  await saveEarmark(database, ws, { goalId: efId, accountId: jenius.id, amountMinor: 30_000_000 });
  await saveEarmark(database, ws, { goalId: umrahId, accountId: jenius.id, amountMinor: 7_500_000 });
});

const stagesOf = async (goalId: string) => (await listGoals(database, ws)).find((goal) => goal.id === goalId)!.stages;
const paidOn = async (goalId: string) => (await stagesOf(goalId)).map((stage) => [stage.name, stage.paidOn]);
const promised = async (goalId: string, accountId: string) =>
  (await listEarmarks(database, ws)).find((row) => row.goalId === goalId && row.accountId === accountId)?.amountMinor ?? 0;
const laptop = (from: string, setAside?: SetAsideChoice | null, categoryAccountId = electronics.id) =>
  postTransaction(database, ws, {
    occurredOn: DAY,
    description: 'Laptop',
    lines: expenseLines({ categoryAccountId, paymentAccountId: from, amountMinor: 6_800_000, currency: 'IDR' }),
    ...(setAside === undefined ? {} : { setAside }),
  });
const refile = (id: string, from: string, setAside?: SetAsideChoice | null, categoryAccountId = office.id) =>
  replaceTransaction(database, ws, id, {
    occurredOn: DAY,
    description: 'Laptop',
    lines: expenseLines({ categoryAccountId, paymentAccountId: from, amountMinor: 6_800_000, currency: 'IDR' }),
    ...(setAside === undefined ? {} : { setAside }),
  });
const spendFrom = (goalId: string, accountId = jenius.id): SetAsideChoice => ({ accountId, goalId, intent: 'spend', overMinor: 1_800_000 });

describe('an edit re-answered as a spend from another goal pays that goal (I1)', () => {
  it('un-pays the first goal\'s stage and pays the new goal\'s earliest, not nothing', async () => {
    const holidayId = await twoStages('Holiday');
    await saveEarmark(database, ws, { goalId: holidayId, accountId: jenius.id, amountMinor: 9_000_000 });
    const id = await laptop(jenius.id, spendFrom(umrahId));
    expect(await paidOn(umrahId)).toEqual([['Tickets', DAY], ['Hotel', null]]);

    await refile(id, jenius.id, spendFrom(holidayId));

    // Carrying Umrah's stage id onto Holiday's answer finds no Holiday stage by that id and pays nothing.
    expect(await paidOn(holidayId)).toEqual([['Tickets', DAY], ['Hotel', null]]);
    expect(await paidOn(umrahId)).toEqual([['Tickets', null], ['Hotel', null]]);
    expect(await promised(umrahId, jenius.id)).toBe(7_500_000);
    expect(await promised(holidayId, jenius.id)).toBe(2_200_000);
  });
});

describe('the same spend edited to pay from another account stays on its stage (M1, S1b)', () => {
  it('keeps the hand-dated stage and never pays the next: one payment, one stage', async () => {
    await saveEarmark(database, ws, { goalId: umrahId, accountId: bca.id, amountMinor: 7_500_000 });
    const id = await laptop(jenius.id, spendFrom(umrahId));
    const tickets = (await stagesOf(umrahId))[0]!;
    await setStagePaid(database, ws, tickets.id, '2026-09-20');

    await refile(id, bca.id, spendFrom(umrahId, bca.id));

    // Picking afresh because the account changed pays Hotel with the money that paid Tickets.
    expect(await paidOn(umrahId)).toEqual([['Tickets', '2026-09-20'], ['Hotel', null]]);
    expect(await promised(umrahId, jenius.id)).toBe(7_500_000);
    expect(await promised(umrahId, bca.id)).toBe(700_000);
  });
});

describe('a carried spend that paid no stage still pays none (M1, S2b)', () => {
  it('does not pick afresh when a stage was un-marked since', async () => {
    const [tickets, hotel] = await stagesOf(umrahId);
    await setStagePaid(database, ws, tickets!.id, '2026-09-01');
    await setStagePaid(database, ws, hotel!.id, '2026-09-01');
    const id = await laptop(jenius.id, spendFrom(umrahId));
    const [draw] = await listDraws(database, ws);
    expect(draw).toMatchObject({ intent: 'spend', stageId: null });
    await setStagePaid(database, ws, hotel!.id, null);

    await refile(id, jenius.id);

    // Reading a carried null as "no answer" would pay Hotel on 19 Sep with a payment that paid no stage.
    expect(await paidOn(umrahId)).toEqual([['Tickets', '2026-09-01'], ['Hotel', null]]);
  });
});

describe('an archived goal is history (G2-M1)', () => {
  it('re-filing the payment that completed it leaves its stage paid', async () => {
    const car = await saveGoal(database, ws, { name: 'Car deposit', kind: 'vehicle', growthBps: 0, returnBps: 0, stages: [{ name: 'Deposit', targetMinor: 2_000_000, targetMonths: null, dueOn: '2027-06-30' }] });
    await saveEarmark(database, ws, { goalId: car, accountId: jenius.id, amountMinor: 2_000_000 });
    const id = await laptop(jenius.id, spendFrom(car));
    await archiveGoal(database, ws, car);

    const replacement = await refile(id, jenius.id);

    const [deposit] = await database.db.select().from(goalsSchema.goalStages).where(eq(goalsSchema.goalStages.goalId, car));
    // The void un-paid it and the dropped answer never paid it again: the archive would read not done.
    expect(deposit!.paidOn).toBe(DAY);
    expect(replacement).not.toBe(id);
    expect(await listDraws(database, ws)).toEqual([]);
  });

  it('a live goal\'s stage is still un-paid by a void', async () => {
    const id = await laptop(jenius.id, spendFrom(umrahId));
    await refile(id, jenius.id, null);
    expect(await paidOn(umrahId)).toEqual([['Tickets', null], ['Hotel', null]]);
  });
});

describe('a goal\'s own move out of a foreign account is valued in base, floored (I2)', () => {
  it('US$100,02 of a US$123,45 transfer at 16.235 is Rp 1.623.824 taken back, not 1.623.825', async () => {
    const wise = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD', openingBalanceMinor: 50_000, openedOn: '2026-01-01', openingRateToBase: 16_000 });
    const ibkr = await createAccount(database, ws, { name: 'IBKR cash', kind: 'asset', subtype: 'bank', currency: 'USD' });
    await saveEarmark(database, ws, { goalId: umrahId, accountId: wise.id, amountMinor: 10_002 });
    await recordTaggedTransfer(database, ws, { occurredOn: JULY, description: 'To IBKR', amountMinor: 12_345, fromAccountId: wise.id, toAccountId: ibkr.id, goalId: umrahId, ratesToBase: { USD: 16_235 } });
    // What left Wise is 12.345 × 162,35 = 2.004.210,75 → Rp 2.004.211 in base; the goal's own US$100,02 of it is
    // 10.002 × 2.004.211 ÷ 12.345 = 1.623.824,90 — floored. The arrival (+2.004.211) less it is the month's new money.
    expect((await goalContributionsFor(database, ws, '2026-07'))[umrahId]).toBe(2_004_211 - 1_623_824);
  });
});

describe('a promise moved with the money is not money taken back (I3)', () => {
  it('a "Move the promise" answer adds no transfer event and no Taken back line', async () => {
    await postTransaction(database, ws, {
      occurredOn: DAY,
      description: 'To BCA',
      lines: transferLines({ fromAccountId: jenius.id, toAccountId: bca.id, amountMinor: 20_000_000, currency: 'IDR' }),
      setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 15_000_000, toAccountId: bca.id },
    });
    expect(await promised(efId, bca.id)).toBe(15_000_000);
    const transfers = (await goalContributionEvents(database, ws)).filter((event) => event.goalId === efId && event.kind === 'transfer');
    // Read as a goal's own move, it would be −15.000.000 here and a "Taken back" line below.
    expect(transfers).toEqual([]);
    const history = (await goalHistory(database, ws, DAY))[efId] ?? [];
    expect(history.filter((entry) => entry.kind === 'taken-back')).toEqual([]);
    expect(history.filter((entry) => entry.kind === 'moved').map((entry) => entry.amountMinor)).toEqual([15_000_000]);
  });
});

describe('a goal\'s own move worth nothing in base is not a line (M1, B1f)', () => {
  it('Rp 50 of a rupiah transfer in a US-dollar book is under a cent: no "Taken back $0"', async () => {
    ({ database, ws } = await setupDb('USD'));
    const pot = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-01-01', openingRateToBase: 0.0000625 });
    const broker = await createAccount(database, ws, { name: 'Broker', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const trip = await saveGoal(database, ws, { name: 'Trip', kind: 'holiday', growthBps: 0, returnBps: 0, stages: [{ name: 'Trip', targetMinor: 100_000, targetMonths: null, dueOn: '2027-12-31' }] });
    await saveEarmark(database, ws, { goalId: trip, accountId: pot.id, amountMinor: 50 });
    await recordTaggedTransfer(database, ws, { occurredOn: JULY, description: 'To broker', amountMinor: 10_000, fromAccountId: pot.id, toAccountId: broker.id, goalId: trip, ratesToBase: { IDR: 0.0000625 } });
    // Rp 10.000 is 62,5 → 63 cents; the goal's own Rp 50 of it is 50 × 63 ÷ 10.000 = 0,315 → 0 cents: nothing to log.
    const transfers = (await goalContributionEvents(database, ws, { from: JULY, to: JULY })).filter((event) => event.goalId === trip);
    expect(transfers.map((event) => [event.kind, event.amountMinor])).toEqual([['transfer', 63]]);
  });
});

describe('editing a buy through replaceTrade (I4)', () => {
  let gold: AccountRow;
  beforeEach(async () => {
    gold = await createAccount(database, ws, { name: 'Antam', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  });
  const buy = (setAside?: SetAsideChoice | null) => ({
    accountId: gold.id,
    kind: 'buy' as const,
    occurredOn: DAY,
    unitsMicro: 4_000_000,
    grossMinor: 6_800_000,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId: jenius.id,
    goalId: null,
    ...(setAside === undefined ? {} : { setAside }),
  });

  it('drops a carried borrow whose goal was archived since, instead of refusing the edit (T1c)', async () => {
    const first = await recordTrade(database, ws, buy({ accountId: jenius.id, goalId: umrahId, intent: 'borrow', overMinor: 1_800_000 }));
    await archiveGoal(database, ws, umrahId);
    const edited = await replaceTrade(database, ws, first.tradeId, buy());
    expect(edited.transactionId).toBeTruthy();
    expect(await listDraws(database, ws)).toEqual([]);
  });

  it('keeps an edited spend on the stage it paid, carried or given again (T1e)', async () => {
    const first = await recordTrade(database, ws, buy(spendFrom(umrahId)));
    const tickets = (await stagesOf(umrahId))[0]!;
    await setStagePaid(database, ws, tickets.id, '2026-09-20');

    const again = await replaceTrade(database, ws, first.tradeId, buy(spendFrom(umrahId)));
    // Picking afresh pays Hotel on 19 Sep with the money that paid Tickets.
    expect(await paidOn(umrahId)).toEqual([['Tickets', '2026-09-20'], ['Hotel', null]]);
    await replaceTrade(database, ws, again.tradeId, buy());
    expect(await paidOn(umrahId)).toEqual([['Tickets', '2026-09-20'], ['Hotel', null]]);
    expect(await promised(umrahId, jenius.id)).toBe(700_000);
  });
});

describe('idle cash compares like with like (G2-M8)', () => {
  it('a unit holding with money promised on it is never idle cash: its worth is units, not its free ledger figure', async () => {
    const shares = await createAccount(database, ws, { name: 'Shares', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: shares.id, assetKind: 'stock' });
    // 8.000.000 lands on the holding, 5.000.000 of it for Umrah: 3.000.000 free on the ledger, 0 units, worth Rp 0.
    await recordTaggedTransfer(database, ws, { occurredOn: DAY, description: 'For Umrah', amountMinor: 5_000_000, fromAccountId: bca.id, toAccountId: shares.id, goalId: umrahId });
    await postTransaction(database, ws, { occurredOn: DAY, description: 'Top up', lines: transferLines({ fromAccountId: bca.id, toAccountId: shares.id, amountMinor: 3_000_000, currency: 'IDR' }) });
    const rows = await idleCash(database, ws, DAY);
    expect(rows.find((row) => row.accountId === shares.id)).toBeUndefined();
    // The money accounts are still measured by what is free on them.
    expect(rows.find((row) => row.accountId === jenius.id)!.amountMinor).toBe(5_000_000);
    expect(rows.find((row) => row.accountId === bca.id)!.amountMinor).toBe(42_000_000);
  });
});

describe('the whole history, for a reader that looks past the six a card shows (M3)', () => {
  it('keeps six by default and every entry with no limit', async () => {
    for (const minor of [7_600_000, 7_700_000, 7_800_000, 7_900_000, 8_000_000, 8_100_000, 8_200_000]) {
      await saveEarmark(database, ws, { goalId: umrahId, accountId: jenius.id, amountMinor: minor });
    }
    const today = new Date().toISOString().slice(0, 10);
    // The first 7.500.000 and seven raises: eight changes.
    expect((await goalHistory(database, ws, today))[umrahId]).toHaveLength(6);
    expect((await goalHistory(database, ws, today, { limit: null }))[umrahId]).toHaveLength(8);
  });
});
