/*
 * The rules the G2 and G3 reviews found no test for (combined fix round). Each figure is chosen so that the nearest
 * wrong rule — the mutant the review names beside the test — reads a different number, day, sign or currency.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exchangeLines, expenseLines, formatMinor, transferLines } from '@expanses/core';
import {
  type AccountRow,
  archiveGoal,
  convertToPurchase,
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  goalHistory,
  goalPlansFor,
  goalsSchema,
  goalWholeness,
  listEarmarks,
  listGoals,
  migrate,
  MIGRATIONS,
  postTransaction,
  recordTaggedTransfer,
  replaceTransaction,
  saveAssetProfile,
  saveEarmark,
  saveGoal,
  type SetAsideChoice,
  setAsideChoiceOf,
  setAsideView,
  setStagePaid,
  systemAccountId,
  voidTransaction,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const DAY = '2026-09-19';
let database: Database;
let ws: WorkspaceContext;
let jenius: AccountRow;
let bca: AccountRow;
let wise: AccountRow;
let electronics: AccountRow;
let efId: string;
let umrahId: string;

const goal = (name: string, targetMinor: number, kind: 'other' | 'emergency' = 'other') =>
  saveGoal(database, ws, { name, kind, growthBps: 0, returnBps: 0, stages: [{ name, targetMinor, targetMonths: null, dueOn: '2027-12-31' }] });
const spend = (from: string, amountMinor: number, setAside?: SetAsideChoice, occurredOn = DAY) =>
  postTransaction(database, ws, { occurredOn, description: 'Laptop', lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: from, amountMinor, currency: 'IDR' }), setAside });
const promised = async (goalId: string, accountId: string) =>
  (await listEarmarks(database, ws)).find((row) => row.goalId === goalId && row.accountId === accountId)?.amountMinor ?? 0;
const draws = () => database.db.select().from(goalsSchema.goalDraws).where(eq(goalsSchema.goalDraws.workspaceId, ws.workspaceId));
const shares = async (accountId: string) =>
  Object.fromEntries((await setAsideView(database, ws, accountId, { date: DAY }))!.goals.map((g) => [g.goalId, g.shortMinor]));
/** Rp 20.000.000 from Jenius lands US$1.234,65 on Wise: 15.000.000 of the Emergency fund's promise follows it. */
const toWise = async () =>
  postTransaction(database, ws, {
    occurredOn: DAY,
    description: 'To Wise',
    lines: exchangeLines({
      fromAccountId: jenius.id,
      fromAmountMinor: 20_000_000,
      fromCurrency: 'IDR',
      toAccountId: wise.id,
      toAmountMinor: 123_465,
      toCurrency: 'USD',
      exchangeAccountId: await systemAccountId(database.db, ws, 'currency_exchange'),
    }),
    ratesToBase: { USD: 16_200 },
    setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 15_000_000, toAccountId: wise.id },
  });

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  jenius = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 42_500_000, openedOn: '2026-01-01' });
  bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  // US$50,01 held, and the Emergency fund already promised all of it: a destination that holds a promise of its own.
  wise = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD', openingBalanceMinor: 5_001, openedOn: '2026-01-01', openingRateToBase: 16_000 });
  electronics = await createAccount(database, ws, { name: 'Electronics', kind: 'expense', subtype: 'category', currency: null });
  efId = await goal('Emergency fund', 30_000_000);
  umrahId = await goal('Umrah 2027', 7_500_000);
  await saveEarmark(database, ws, { goalId: efId, accountId: jenius.id, amountMinor: 30_000_000 });
  await saveEarmark(database, ws, { goalId: umrahId, accountId: jenius.id, amountMinor: 7_500_000 });
  await saveEarmark(database, ws, { goalId: efId, accountId: wise.id, amountMinor: 5_001 });
});

describe('an edit of a cross-currency move, asked about as if it were not there (G2-I2)', () => {
  it('gives the source its promise back and takes the landed cents off the destination', async () => {
    const moved = await toWise();
    // 15.000.000 × 123.465 ÷ 20.000.000 = 92.598,75 → 92.598 cents landed beside the 5.001 already promised.
    expect(await promised(efId, wise.id)).toBe(97_599);
    const jeniusView = await setAsideView(database, ws, jenius.id, { date: DAY, excludeTransactionId: moved });
    const wiseView = await setAsideView(database, ws, wise.id, { date: DAY, excludeTransactionId: moved });
    // Without the source give-back (V3): 22.500.000 set aside, 20.000.000 free.
    expect(jeniusView).toMatchObject({ balanceMinor: 42_500_000, setAsideMinor: 37_500_000, freeMinor: 5_000_000 });
    // Without the destination reversal (V2): 97.599 set aside. Reversed by the rupiah 15.000.000 (V4): clamped to 0.
    expect(wiseView).toMatchObject({ currency: 'USD', balanceMinor: 5_001, setAsideMinor: 5_001, freeMinor: 0 });
  });
});

describe('borrows in the share-out (G2-I3)', () => {
  it('an edit does not blame the goal its own transaction borrowed from (V8)', async () => {
    await spend(jenius.id, 8_000_000, { accountId: jenius.id, goalId: umrahId, intent: 'borrow', overMinor: 3_000_000 });
    const laptop = await spend(jenius.id, 6_800_000, { accountId: jenius.id, goalId: efId, intent: 'borrow', overMinor: 1_800_000 });
    // Without the laptop: 34.500.000 held, 37.500.000 promised — short 3.000.000, and Umrah's borrow carries it all.
    const view = await setAsideView(database, ws, jenius.id, { date: DAY, excludeTransactionId: laptop });
    const short = Object.fromEntries(view!.goals.map((g) => [g.goalId, g.shortMinor]));
    // Still counting the laptop's borrow reads EF 1.800.000, Umrah 1.200.000.
    expect(short).toEqual({ [efId]: 0, [umrahId]: 3_000_000 });
  });

  it('a borrow on another account does not reorder this one (V12)', async () => {
    await saveEarmark(database, ws, { goalId: efId, accountId: bca.id, amountMinor: 45_000_000 });
    await spend(bca.id, 6_000_000, { accountId: bca.id, goalId: efId, intent: 'borrow', overMinor: 1_000_000 });
    // Jenius short 1.000.000 with no borrow of its own: the lowest-ranked goal carries it.
    await spend(jenius.id, 6_000_000);
    expect(await shares(jenius.id)).toEqual({ [efId]: 0, [umrahId]: 1_000_000 });
  });

  it('a borrow dated after the day asked about does not reorder that day (V9)', async () => {
    await spend(jenius.id, 6_000_000);
    await spend(jenius.id, 100_000, { accountId: jenius.id, goalId: efId, intent: 'borrow', overMinor: 100_000 }, '2026-12-01');
    // On 19 Sep the December borrow has not happened: Umrah carries the 1.000.000, not EF 100.000 + Umrah 900.000.
    expect(await shares(jenius.id)).toEqual({ [efId]: 0, [umrahId]: 1_000_000 });
  });
});

describe('moves: clamped, voided across currencies, carried by an edit (G2-I4)', () => {
  const transfer = (amountMinor: number, to: string) => transferLines({ fromAccountId: jenius.id, toAccountId: to, amountMinor, currency: 'IDR' });

  it('moves no more than the goal promised, whatever the answer says (A8)', async () => {
    await postTransaction(database, ws, { occurredOn: DAY, description: 'To BCA', lines: transfer(40_000_000, bca.id), setAside: { accountId: jenius.id, goalId: umrahId, intent: 'move', overMinor: 10_000_000, toAccountId: bca.id } });
    expect(await promised(umrahId, jenius.id)).toBe(0);
    // Unclamped, BCA would gain 10.000.000 of a 7.500.000 promise.
    expect(await promised(umrahId, bca.id)).toBe(7_500_000);
    expect((await draws())[0]).toMatchObject({ amountMinor: 7_500_000, toAmountMinor: 7_500_000 });
  });

  it('a void of an IDR→USD move takes the landed cents back, not the rupiah (U5)', async () => {
    const moved = await toWise();
    await voidTransaction(database, ws, moved);
    expect(await promised(efId, wise.id)).toBe(5_001);
    expect(await promised(efId, jenius.id)).toBe(30_000_000);
  });

  it('an edit that still reaches the destination carries the move, clamped to what it now moves (C5)', async () => {
    const id = await postTransaction(database, ws, { occurredOn: DAY, description: 'To BCA', lines: transfer(20_000_000, bca.id), setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 15_000_000, toAccountId: bca.id } });
    const edited = await replaceTransaction(database, ws, id, { occurredOn: DAY, description: 'To BCA', lines: transfer(10_000_000, bca.id) });
    expect(await draws()).toEqual([expect.objectContaining({ transactionId: edited, intent: 'move', amountMinor: 10_000_000, toAccountId: bca.id })]);
    expect(await promised(efId, jenius.id)).toBe(20_000_000);
    expect(await promised(efId, bca.id)).toBe(10_000_000);
  });

  it('an edit that sends the money elsewhere drops it, and both promises stand as before (C7)', async () => {
    const mandiri = await createAccount(database, ws, { name: 'Mandiri', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const id = await postTransaction(database, ws, { occurredOn: DAY, description: 'To BCA', lines: transfer(20_000_000, bca.id), setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 15_000_000, toAccountId: bca.id } });
    await replaceTransaction(database, ws, id, { occurredOn: DAY, description: 'To Mandiri', lines: transfer(20_000_000, mandiri.id) });
    expect(await draws()).toEqual([]);
    expect(await promised(efId, jenius.id)).toBe(30_000_000);
    expect(await promised(efId, bca.id)).toBe(0);
    expect(await promised(efId, mandiri.id)).toBe(0);
  });
});

describe('a foreign account speaks its own currency (G2-I5)', () => {
  it('the short sentence prints a USD shortfall in dollars (G4)', async () => {
    await saveEarmark(database, ws, { goalId: efId, accountId: wise.id, amountMinor: 10_003 });
    const ef = (await goalPlansFor(database, ws, DAY)).plans.find((plan) => plan.goalId === efId)!;
    // US$100,03 promised on US$50,01: short 5.002 cents.
    expect(ef.earmarkWarning).toContain(`short by ${formatMinor(5_002, 'USD')} there`);
    expect(ef.earmarkWarning).not.toContain(formatMinor(5_002, 'IDR'));
  });

  it('history rows for a USD set-aside and a USD draw are in dollars (G14, G15)', async () => {
    const food = await createAccount(database, ws, { name: 'Food', kind: 'expense', subtype: 'category', currency: null });
    await postTransaction(database, ws, {
      occurredOn: DAY,
      description: 'Dinner abroad',
      lines: expenseLines({ categoryAccountId: food.id, paymentAccountId: wise.id, amountMinor: 3_000, currency: 'USD' }),
      ratesToBase: { USD: 16_000 },
      setAside: { accountId: wise.id, goalId: efId, intent: 'borrow', overMinor: 3_000 },
    });
    // saveEarmark dated the Wise set-aside by the real clock, so read the history from a day after any of it.
    const rows = (await goalHistory(database, ws, '2099-12-31'))[efId]!;
    expect(rows.find((row) => row.kind === 'borrowed')).toMatchObject({ amountMinor: -3_000, currency: 'USD' });
    expect(rows.find((row) => row.kind === 'set-aside' && row.text === 'Wise USD')).toMatchObject({ amountMinor: 5_001, currency: 'USD' });
  });
});

describe('the day a goal stood whole, and its history (G2-I6)', () => {
  afterEach(() => vi.useRealTimers());
  const at = (iso: string) => vi.setSystemTime(new Date(`${iso}T09:00:00Z`));

  /** House fund: 24.000.000 in Feb, 30.000.000 (the target) on 3 Aug, 31.000.000 on 1 Sep — whole since 3 Aug. */
  async function dated(kind: 'other' | 'emergency' = 'other') {
    vi.useFakeTimers({ toFake: ['Date'] });
    const pot = await createAccount(database, ws, { name: 'Pot', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 40_000_000, openedOn: '2026-01-01' });
    const fund = await goal('House fund', 30_000_000, kind);
    at('2026-02-04');
    await saveEarmark(database, ws, { goalId: fund, accountId: pot.id, amountMinor: 24_000_000 });
    at('2026-08-03');
    await saveEarmark(database, ws, { goalId: fund, accountId: pot.id, amountMinor: 30_000_000 });
    at('2026-09-01');
    await saveEarmark(database, ws, { goalId: fund, accountId: pot.id, amountMinor: 31_000_000 });
    at(DAY);
    return { pot, fund };
  }
  const wholeness = async (fund: string, date = DAY) => (await goalWholeness(database, ws, date))[fund];

  it('is not whole while one of its accounts is short, though the total reaches the target (G6)', async () => {
    const { fund } = await dated();
    const empty = await createAccount(database, ws, { name: 'Empty', kind: 'asset', subtype: 'savings', currency: 'IDR' });
    await saveEarmark(database, ws, { goalId: fund, accountId: empty.id, amountMinor: 5_000_000 });
    expect(await wholeness(fund)).toEqual({ whole: false, since: null });
  });

  it('cannot date a goal part-held in another currency (G7)', async () => {
    const { fund } = await dated();
    const revolut = await createAccount(database, ws, { name: 'Revolut USD', kind: 'asset', subtype: 'bank', currency: 'USD', openingBalanceMinor: 1_000, openedOn: '2026-01-01', openingRateToBase: 16_000 });
    await saveEarmark(database, ws, { goalId: fund, accountId: revolut.id, amountMinor: 1_000 });
    expect(await wholeness(fund)).toEqual({ whole: true, since: null });
  });

  it('walks a spend back as money that left: 3 Aug, not 1 Sep (G8, G9)', async () => {
    // An emergency fund: the spend pays no stage, so the target stays 30.000.000 and the goal stays whole.
    const { pot, fund } = await dated('emergency');
    await spend(pot.id, 500_000, { accountId: pot.id, goalId: fund, intent: 'spend', overMinor: 500_000 });
    // 30.500.000 now. Walked back: +500.000 (the spend undone) → 31.000.000, −1.000.000 → 30.000.000, −6.000.000 → below.
    // Sign flipped or the spend dropped, the walk falls below the target at 1 Sep.
    expect(await wholeness(fund)).toEqual({ whole: true, since: '2026-08-03' });
  });

  it('stops at a borrow: after it, the day it was whole again is recorded nowhere (G10)', async () => {
    const { pot, fund } = await dated();
    await spend(pot.id, 100_000, { accountId: pot.id, goalId: fund, intent: 'borrow', overMinor: 100_000 }, '2026-08-20');
    expect(await wholeness(fund)).toEqual({ whole: true, since: null });
  });

  it('a goal with nothing left to pay is not whole (G22)', async () => {
    const paid = await goal('Paid off', 1_000_000);
    const [stage] = (await listGoals(database, ws)).find((row) => row.id === paid)!.stages;
    await setStagePaid(database, ws, stage!.id, '2026-09-01');
    expect(await wholeness(paid)).toEqual({ whole: false, since: null });
  });

  it('reads money taken back as taken back, in the history (G20)', async () => {
    const { pot, fund } = await dated();
    await saveEarmark(database, ws, { goalId: fund, accountId: pot.id, amountMinor: 30_500_000 });
    expect((await goalHistory(database, ws, DAY))[fund]![0]).toMatchObject({ kind: 'taken-back', amountMinor: -500_000, occurredOn: DAY });
  });

  it('shows a moved promise as moved, positive, to where it went (G12, G24)', async () => {
    await postTransaction(database, ws, { occurredOn: DAY, description: 'To BCA', lines: transferLines({ fromAccountId: jenius.id, toAccountId: bca.id, amountMinor: 20_000_000, currency: 'IDR' }), setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 15_000_000, toAccountId: bca.id } });
    expect((await goalHistory(database, ws, DAY))[efId]!.find((row) => row.kind === 'moved')).toMatchObject({ amountMinor: 15_000_000, text: 'to BCA' });
  });

  it('does not list a tagged transfer\'s own move a third time (G13)', async () => {
    const broker = await createAccount(database, ws, { name: 'Broker', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await recordTaggedTransfer(database, ws, { occurredOn: DAY, description: 'To broker', amountMinor: 7_500_000, fromAccountId: jenius.id, toAccountId: broker.id, goalId: umrahId });
    const day = (await goalHistory(database, ws, DAY))[umrahId]!.filter((row) => row.occurredOn === DAY);
    expect(day.map((row) => [row.kind, row.amountMinor]).sort()).toEqual([['set-aside', 7_500_000], ['taken-back', -7_500_000]]);
  });

  it('keeps six entries, newest first (G17)', async () => {
    const { pot, fund } = await dated();
    for (const [on, minor] of [['2026-09-05', 31_100_000], ['2026-09-06', 31_200_000], ['2026-09-07', 31_300_000], ['2026-09-08', 31_400_000]] as const) {
      at(on);
      await saveEarmark(database, ws, { goalId: fund, accountId: pot.id, amountMinor: minor });
    }
    at(DAY);
    const rows = (await goalHistory(database, ws, DAY))[fund]!;
    expect(rows.map((row) => row.occurredOn)).toEqual(['2026-09-08', '2026-09-07', '2026-09-06', '2026-09-05', '2026-09-01', '2026-08-03']);
  });

  it('dates "reached" from the latest borrow from a whole goal (G18)', async () => {
    const { pot, fund } = await dated();
    await spend(pot.id, 100_000, { accountId: pot.id, goalId: fund, intent: 'borrow', overMinor: 100_000, wasWhole: true, wholeSince: '2026-08-03' }, '2026-08-25');
    await spend(pot.id, 100_000, { accountId: pot.id, goalId: fund, intent: 'borrow', overMinor: 100_000, wasWhole: true, wholeSince: '2026-09-01' });
    const reached = (await goalHistory(database, ws, DAY))[fund]!.filter((row) => row.kind === 'reached');
    expect(reached.map((row) => row.occurredOn)).toEqual(['2026-09-01']);
  });

  it('an earlier day\'s history holds nothing recorded after it (G23, K3, V15)', async () => {
    const { pot, fund } = await dated();
    await spend(pot.id, 100_000, { accountId: pot.id, goalId: fund, intent: 'borrow', overMinor: 100_000 });
    const rows = (await goalHistory(database, ws, '2026-08-15'))[fund]!;
    expect(rows.map((row) => [row.kind, row.occurredOn])).toEqual([['set-aside', '2026-08-03'], ['set-aside', '2026-02-04']]);
  });
});

describe('the smaller rules (G2 minors)', () => {
  it('pays the stage due first, not the one listed first (A5)', async () => {
    const trip = await saveGoal(database, ws, {
      name: 'Trip',
      kind: 'umrah',
      growthBps: 0,
      returnBps: 0,
      stages: [
        { name: 'Hotel', targetMinor: 5_000_000, targetMonths: null, dueOn: '2027-04-30' },
        { name: 'Tickets', targetMinor: 7_500_000, targetMonths: null, dueOn: '2027-03-31' },
      ],
    });
    await saveEarmark(database, ws, { goalId: trip, accountId: bca.id, amountMinor: 7_500_000 });
    await spend(bca.id, 6_800_000, { accountId: bca.id, goalId: trip, intent: 'spend', overMinor: 1 });
    const stages = (await listGoals(database, ws)).find((row) => row.id === trip)!.stages;
    expect(Object.fromEntries(stages.map((stage) => [stage.name, stage.paidOn]))).toEqual({ Hotel: null, Tickets: DAY });
  });

  it.each([0, -1, 1.5])('refuses an answer that says %s came out of the goal (A13)', async (overMinor) => {
    await expect(spend(jenius.id, 6_800_000, { accountId: jenius.id, goalId: efId, intent: 'borrow', overMinor })).rejects.toThrow(/Say how much/);
    expect(await draws()).toEqual([]);
  });

  it('keeps no "whole since" day on a borrow from a goal that was not whole (A17)', async () => {
    await spend(jenius.id, 6_800_000, { accountId: jenius.id, goalId: efId, intent: 'borrow', overMinor: 1_800_000, wasWhole: false, wholeSince: '2026-08-03' });
    expect((await draws())[0]).toMatchObject({ wasWhole: 0, wholeSince: null });
  });

  it('asks about an edit whose goal was archived since without failing (V11)', async () => {
    const spent = await spend(jenius.id, 6_800_000, { accountId: jenius.id, goalId: umrahId, intent: 'spend', overMinor: 1_800_000 });
    await archiveGoal(database, ws, umrahId);
    // Umrah promises nothing now; without the laptop Jenius holds 42.500.000 against EF's 30.000.000.
    expect(await setAsideView(database, ws, jenius.id, { date: DAY, excludeTransactionId: spent })).toMatchObject({ setAsideMinor: 30_000_000, freeMinor: 12_500_000 });
  });
});

describe('a database stopped at 49 (G2-M6, G3-M1)', () => {
  let executor: NodeExecutor | undefined;
  afterEach(() => executor?.close());

  it('reads no saved answer, and turns an expense into a purchase without the table', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 49));
    const oldWs = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const pot = await createAccount(older, oldWs, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-01' });
    const cat = await createAccount(older, oldWs, { name: 'Gold', kind: 'expense', subtype: 'category', currency: null });
    const antam = await createAccount(older, oldWs, { name: 'Antam', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(older, oldWs, { accountId: antam.id, assetKind: 'gold' });
    const id = await postTransaction(older, oldWs, { occurredOn: DAY, description: 'Gold', lines: expenseLines({ categoryAccountId: cat.id, paymentAccountId: pot.id, amountMinor: 6_800_000, currency: 'IDR' }) });
    await expect(setAsideChoiceOf(older, oldWs, id)).resolves.toBeNull();
    const { transactionId } = await convertToPurchase(older, oldWs, { transactionId: id, accountId: antam.id, unitsMicro: 4_000_000 });
    expect(transactionId).toBeTruthy();
  });
});
