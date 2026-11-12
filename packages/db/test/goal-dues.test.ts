import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  type AccountRow,
  activityOf,
  undoActivity,
  archiveGoal,
  changeGoalMonthAmount,
  createAccount,
  type Database,
  deleteGoal,
  dueDayOn,
  dueMonthsOf,
  goalContributionEvents,
  goalDueOf,
  createWorkspace,
  recordTaggedTransfer,
  saveGoalMonthly,
  setAsideView,
  type GoalDueSettings,
  listEarmarks,
  listGoalDues,
  listTransactions,
  nativeBalances,
  replaceTransaction,
  saveEarmark,
  saveGoal,
  saveGoalDue,
  setAsideGoalMonth,
  setStandingMonthly,
  skipGoalMonth,
  transferGoalMonth,
  undoGoalMonth,
  voidTransaction,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';
import { checkDueCapTx, dueCapFor } from '../src/repos/goal-due-link';

// Invented names and figures.
const TODAY = '2026-11-12';

let database: Database;
let ws: WorkspaceContext;
let tahapan: AccountRow;
let tabungan: AccountRow;
let umrahId: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  tahapan = await createAccount(database, ws, { name: 'Bank Sejahtera Giro', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 30_000_000, openedOn: '2026-01-01' });
  tabungan = await createAccount(database, ws, { name: 'Bank Sejahtera Tabungan', kind: 'asset', subtype: 'savings', currency: 'IDR' });
  umrahId = await saveGoal(database, ws, {
    name: 'Umrah',
    kind: 'umrah',
    growthBps: 400,
    returnBps: 500,
    stages: [{ name: 'Package', targetMinor: 45_000_000, targetMonths: null, dueOn: '2028-03-31' }],
  });
  await setStandingMonthly(database, ws, umrahId, 1_700_000);
});

const setAsideOn = async (accountId: string) =>
  (await listEarmarks(database, ws)).find((row) => row.goalId === umrahId && row.accountId === accountId)?.amountMinor ?? 0;

const turnOn = (over: Partial<Parameters<typeof saveGoalDue>[2]> = {}, today = TODAY) =>
  saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 20, mode: 'set_aside', accountId: tahapan.id, toAccountId: null, ...over }, today);

const monthsOf = async (today = TODAY) => (await listGoalDues(database, ws, today)).find((due) => due.settings.goalId === umrahId)?.months ?? [];

describe('the day a month comes due', () => {
  it('is the day picked', () => {
    expect(dueDayOn('2026-11', 20)).toBe('2026-11-20');
    expect(dueDayOn('2026-11', 1)).toBe('2026-11-01');
  });

  it('is the last day of a shorter month (29–31, Last day)', () => {
    expect(dueDayOn('2026-02', 31)).toBe('2026-02-28');
    expect(dueDayOn('2028-02', 31)).toBe('2028-02-29');
    expect(dueDayOn('2026-02', 29)).toBe('2026-02-28');
    expect(dueDayOn('2026-11', 31)).toBe('2026-11-30');
    expect(dueDayOn('2026-04', 30)).toBe('2026-04-30');
    expect(dueDayOn('2026-12', 31)).toBe('2026-12-31');
  });
});

describe('due months, worked out', () => {
  const settings: GoalDueSettings = { goalId: 'g', day: 31, mode: 'set_aside', accountId: 'a', toAccountId: null, startedMonth: '2026-09', active: true };

  it('runs from the month it was turned on to this month, newest first, all open', () => {
    const months = dueMonthsOf('g', settings, [], 500_000, '2026-11');
    expect(months.map((m) => [m.month, m.dueOn, m.state, m.amountMinor])).toEqual([
      ['2026-11', '2026-11-30', 'open', 500_000],
      ['2026-10', '2026-10-31', 'open', 500_000],
      ['2026-09', '2026-09-30', 'open', 500_000],
    ]);
  });

  it('crosses a year', () => {
    const months = dueMonthsOf('g', { ...settings, startedMonth: '2026-12' }, [], 1, '2027-02');
    expect(months.map((m) => m.month)).toEqual(['2027-02', '2027-01', '2026-12']);
    expect(months[0]!.dueOn).toBe('2027-02-28');
  });

  it('keeps done and skipped months, and a done month says what was done', () => {
    const months = dueMonthsOf(
      'g',
      settings,
      [
        { month: '2026-10', state: 'skipped', mode: null, amountMinor: null, occurredOn: null, accountId: null, toAccountId: null, transactionId: null, live: true },
        { month: '2026-09', state: 'done', mode: 'set_aside', amountMinor: 650_000, occurredOn: '2026-09-29', accountId: 'b', toAccountId: null, transactionId: null, live: true },
      ],
      500_000,
      '2026-11',
    );
    expect(months.map((m) => [m.month, m.state, m.amountMinor, m.accountId, m.occurredOn])).toEqual([
      ['2026-11', 'open', 500_000, 'a', null],
      ['2026-10', 'skipped', 500_000, 'a', null],
      ['2026-09', 'done', 650_000, 'b', '2026-09-29'],
    ]);
  });

  it('turned off: nothing more comes due, what was done stays', () => {
    const months = dueMonthsOf(
      'g',
      { ...settings, active: false },
      [{ month: '2026-09', state: 'done', mode: 'set_aside', amountMinor: 650_000, occurredOn: '2026-09-29', accountId: 'b', toAccountId: null, transactionId: null, live: true }],
      500_000,
      '2026-11',
    );
    expect(months.map((m) => [m.month, m.state])).toEqual([['2026-09', 'done']]);
  });

  it('a transfer month whose transfer is gone is open again', () => {
    const months = dueMonthsOf(
      'g',
      { ...settings, mode: 'transfer', toAccountId: 'c' },
      [{ month: '2026-11', state: 'done', mode: 'transfer', amountMinor: 650_000, occurredOn: '2026-11-02', accountId: 'a', toAccountId: 'c', transactionId: 't', live: false }],
      500_000,
      '2026-11',
    );
    expect(months[0]).toMatchObject({ month: '2026-11', state: 'open', amountMinor: 500_000, transactionId: null });
  });
});

describe('Due each month, saved', () => {
  it('starts in the month it was turned on', async () => {
    await turnOn();
    await expect(goalDueOf(database, ws, umrahId)).resolves.toMatchObject({ startedMonth: '2026-11', day: 20, mode: 'set_aside', accountId: tahapan.id, active: true });
    const months = await monthsOf();
    expect(months.map((m) => [m.month, m.dueOn, m.state, m.amountMinor])).toEqual([['2026-11', '2026-11-20', 'open', 1_700_000]]);
  });

  it('adds a month each month after', async () => {
    await turnOn();
    expect((await monthsOf('2027-01-05')).map((m) => m.month)).toEqual(['2027-01', '2026-12', '2026-11']);
  });

  it('keeps its start when changed while on, and moves it when turned on again after off', async () => {
    await turnOn({}, '2026-09-03');
    await turnOn({ day: 5 }, TODAY);
    expect((await goalDueOf(database, ws, umrahId))!.startedMonth).toBe('2026-09');
    await saveGoalDue(database, ws, { goalId: umrahId, on: false, day: 5, mode: 'set_aside', accountId: tahapan.id, toAccountId: null }, TODAY);
    expect(await monthsOf()).toEqual([]);
    await turnOn({}, '2027-01-02');
    expect((await goalDueOf(database, ws, umrahId))!.startedMonth).toBe('2027-01');
  });

  it('switched off changes nothing else: no month is due', async () => {
    await saveGoalDue(database, ws, { goalId: umrahId, on: false, day: 20, mode: 'set_aside', accountId: null, toAccountId: null }, TODAY);
    await expect(goalDueOf(database, ws, umrahId)).resolves.toBeNull();
    await expect(listGoalDues(database, ws, TODAY)).resolves.toEqual([]);
  });

  it('asks for the accounts it needs', async () => {
    await expect(turnOn({ accountId: null })).rejects.toThrow('Choose an account');
    await expect(turnOn({ mode: 'transfer', toAccountId: null })).rejects.toThrow('Choose the account it goes to');
    await expect(turnOn({ mode: 'transfer', toAccountId: tahapan.id })).rejects.toThrow('Choose two different accounts');
    await expect(turnOn({ day: 0 })).rejects.toThrow('Choose a day');
  });

  it('refuses an account that cannot hold a set-aside', async () => {
    const card = await createAccount(database, ws, { name: 'Kartu Kredit', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await expect(turnOn({ accountId: card.id })).rejects.toThrow('Only accounts that hold money');
  });
});

describe('a set-aside month', () => {
  beforeEach(() => turnOn());

  it('adds exactly the amount to the goal’s set-aside in the account, and posts nothing', async () => {
    await saveEarmark(database, ws, { goalId: umrahId, accountId: tahapan.id, amountMinor: 3_000_000 });
    const before = (await listTransactions(database, ws)).length;
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: TODAY });
    expect(await setAsideOn(tahapan.id)).toBe(4_700_000);
    expect((await listTransactions(database, ws)).length).toBe(before);
    expect((await nativeBalances(database, ws))[tahapan.id]).toBe(30_000_000);
    const [month] = await monthsOf();
    expect(month).toMatchObject({ month: '2026-11', state: 'done', mode: 'set_aside', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: TODAY });
  });

  it('can be another amount for this month only', async () => {
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 900_000, accountId: tahapan.id, occurredOn: TODAY });
    expect(await setAsideOn(tahapan.id)).toBe(900_000);
    expect((await monthsOf('2026-12-01')).map((m) => [m.month, m.state, m.amountMinor])).toEqual([
      ['2026-12', 'open', 1_700_000],
      ['2026-11', 'done', 900_000],
    ]);
  });

  it('is a contribution of the amount', async () => {
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: TODAY });
    const contributions = await database.db.values<[number]>(sql`SELECT delta_minor FROM goal_contributions WHERE goal_id = ${umrahId}`);
    expect(contributions).toEqual([[1_700_000]]);
  });

  it('undone, takes exactly the amount back off and opens the month', async () => {
    await saveEarmark(database, ws, { goalId: umrahId, accountId: tahapan.id, amountMinor: 3_000_000 });
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: TODAY });
    await undoGoalMonth(database, ws, umrahId, '2026-11');
    expect(await setAsideOn(tahapan.id)).toBe(3_000_000);
    expect((await monthsOf())[0]).toMatchObject({ state: 'open', amountMinor: 1_700_000 });
    const sum = await database.db.values<[number]>(sql`SELECT SUM(delta_minor) FROM goal_contributions WHERE goal_id = ${umrahId}`);
    expect(sum).toEqual([[3_000_000]]);
  });

  it('undone after some was used, takes back only what is left', async () => {
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: TODAY });
    await saveEarmark(database, ws, { goalId: umrahId, accountId: tahapan.id, amountMinor: 1_000_000 });
    await expect(undoGoalMonth(database, ws, umrahId, '2026-11')).resolves.toEqual({ undone: false, takenMinor: 1_000_000, leftMinor: 700_000 });
    expect(await setAsideOn(tahapan.id)).toBe(0);
    // It never reopens with money it could not take back: done, with what is still on it.
    expect((await monthsOf())[0]).toMatchObject({ state: 'done', amountMinor: 700_000 });
  });

  it('cannot be done twice', async () => {
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: TODAY });
    await expect(setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: TODAY })).rejects.toThrow(
      'November is already done',
    );
    expect(await setAsideOn(tahapan.id)).toBe(1_700_000);
  });

  it('changed, moves the set-aside by the difference', async () => {
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: TODAY });
    await changeGoalMonthAmount(database, ws, umrahId, '2026-11', 2_000_000);
    expect(await setAsideOn(tahapan.id)).toBe(2_000_000);
    await changeGoalMonthAmount(database, ws, umrahId, '2026-11', 500_000);
    expect(await setAsideOn(tahapan.id)).toBe(500_000);
    expect((await monthsOf())[0]).toMatchObject({ state: 'done', amountMinor: 500_000 });
  });

  it('refuses a month not due: before the start, or ahead', async () => {
    await expect(setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-10', amountMinor: 1, accountId: tahapan.id, occurredOn: TODAY })).rejects.toThrow('October is not due');
    await expect(setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-12', amountMinor: 1, accountId: tahapan.id, occurredOn: TODAY })).rejects.toThrow('December is not due');
    await expect(setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 0, accountId: tahapan.id, occurredOn: TODAY })).rejects.toThrow('greater than zero');
  });

  it('an earlier open month stays open and can still be done', async () => {
    const later = '2026-12-03';
    expect((await monthsOf(later)).map((m) => [m.month, m.state])).toEqual([
      ['2026-12', 'open'],
      ['2026-11', 'open'],
    ]);
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: later });
    expect((await monthsOf(later)).map((m) => [m.month, m.state])).toEqual([
      ['2026-12', 'open'],
      ['2026-11', 'done'],
    ]);
  });
});

describe('a skipped month', () => {
  beforeEach(() => turnOn());

  it('is skipped, and undone is open again; nothing moves', async () => {
    await skipGoalMonth(database, ws, umrahId, '2026-11', TODAY);
    expect((await monthsOf())[0]).toMatchObject({ state: 'skipped' });
    expect(await setAsideOn(tahapan.id)).toBe(0);
    await undoGoalMonth(database, ws, umrahId, '2026-11');
    expect((await monthsOf())[0]).toMatchObject({ state: 'open' });
  });

  it('can be set aside after all', async () => {
    await skipGoalMonth(database, ws, umrahId, '2026-11', TODAY);
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: TODAY });
    expect((await monthsOf())[0]).toMatchObject({ state: 'done', amountMinor: 1_700_000 });
  });

  it('a done month cannot be skipped', async () => {
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: TODAY });
    await expect(skipGoalMonth(database, ws, umrahId, '2026-11', TODAY)).rejects.toThrow('already done');
  });
});

describe('a transfer month', () => {
  beforeEach(() => turnOn({ mode: 'transfer', toAccountId: tabungan.id }));

  const transfer = (amountMinor = 1_700_000) =>
    transferGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor, fromAccountId: tahapan.id, toAccountId: tabungan.id, occurredOn: TODAY });

  it('posts a real transfer tagged to the goal, and the goal’s set-aside follows to the destination', async () => {
    const id = await transfer();
    const balances = await nativeBalances(database, ws);
    expect(balances[tahapan.id]).toBe(28_300_000);
    expect(balances[tabungan.id]).toBe(1_700_000);
    expect(await setAsideOn(tabungan.id)).toBe(1_700_000);
    const [goalTag] = await database.db.values<[string, string]>(sql`SELECT goal_id, description FROM transactions WHERE id = ${id}`);
    expect(goalTag).toEqual([umrahId, 'Umrah · November']);
    expect((await monthsOf())[0]).toMatchObject({ state: 'done', mode: 'transfer', amountMinor: 1_700_000, accountId: tahapan.id, toAccountId: tabungan.id, transactionId: id });
  });

  it('undone, voids the transfer and opens the month', async () => {
    await transfer();
    await undoGoalMonth(database, ws, umrahId, '2026-11');
    const balances = await nativeBalances(database, ws);
    expect(balances[tahapan.id]).toBe(30_000_000);
    expect(balances[tabungan.id] ?? 0).toBe(0);
    expect(await setAsideOn(tabungan.id)).toBe(0);
    expect((await monthsOf())[0]).toMatchObject({ state: 'open' });
  });

  it('voided elsewhere, the month is open again and can be transferred again', async () => {
    const id = await transfer();
    await voidTransaction(database, ws, id);
    expect((await monthsOf())[0]).toMatchObject({ state: 'open', transactionId: null });
    await transfer(1_000_000);
    expect((await monthsOf())[0]).toMatchObject({ state: 'done', amountMinor: 1_000_000 });
    expect((await nativeBalances(database, ws))[tabungan.id]).toBe(1_000_000);
  });

  it('edited elsewhere, stays done and follows the edit', async () => {
    const id = await transfer();
    const newId = await replaceTransaction(database, ws, id, {
      occurredOn: TODAY,
      description: 'Umrah · November',
      lines: [
        { accountId: tahapan.id, amountMinor: -1_800_000, currency: 'IDR' },
        { accountId: tabungan.id, amountMinor: 1_800_000, currency: 'IDR' },
      ],
    });
    expect((await monthsOf())[0]).toMatchObject({ state: 'done', transactionId: newId });
    await undoGoalMonth(database, ws, umrahId, '2026-11');
    expect((await nativeBalances(database, ws))[tabungan.id] ?? 0).toBe(0);
  });

  it('refuses a change of amount: a transfer is changed on itself', async () => {
    await transfer();
    await expect(changeGoalMonthAmount(database, ws, umrahId, '2026-11', 1)).rejects.toThrow('transfer is changed on the transfer itself');
  });
});

describe('the goal ending', () => {
  beforeEach(() => turnOn());

  it('archived, comes due no more', async () => {
    await archiveGoal(database, ws, umrahId);
    await expect(listGoalDues(database, ws, TODAY)).resolves.toEqual([]);
    await expect(goalDueOf(database, ws, umrahId)).resolves.toMatchObject({ active: false });
  });

  it('deleted, its dues go with it', async () => {
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: TODAY });
    await deleteGoal(database, ws, umrahId);
    expect(await database.db.values(sql`SELECT * FROM goal_dues`)).toEqual([]);
    expect(await database.db.values(sql`SELECT * FROM goal_due_months`)).toEqual([]);
  });
});

describe('review probes (fix round 1)', () => {
  let tabunganB: AccountRow;
  let tabunganC: AccountRow;
  beforeEach(async () => {
    tabunganB = tabungan;
    tabunganC = await createAccount(database, ws, { name: 'Bank Sejahtera Deposito', kind: 'asset', subtype: 'savings', currency: 'IDR' });
    await setStandingMonthly(database, ws, umrahId, 1_000_000);
  });

  const goalTotal = async () => (await listEarmarks(database, ws)).filter((row) => row.goalId === umrahId).reduce((sum, row) => sum + row.amountMinor, 0);
  const contributed = async () => (await goalContributionEvents(database, ws)).filter((event) => event.goalId === umrahId).reduce((sum, event) => sum + event.amountMinor, 0);
  const freeIn = async (accountId: string, date: string) => (await setAsideView(database, ws, accountId, { date }))?.freeMinor;

  it('Oct set aside in A, then Transfer A→B in Nov: the goal grows by both months', async () => {
    await saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 1, mode: 'set_aside', accountId: tahapan.id, toAccountId: null }, '2026-10-05');
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-10', amountMinor: 1_000_000, accountId: tahapan.id, occurredOn: '2026-10-05' });
    await saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 1, mode: 'transfer', accountId: tahapan.id, toAccountId: tabunganB.id }, TODAY);
    expect(await freeIn(tahapan.id, TODAY)).toBe(29_000_000);
    await transferGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_000_000, fromAccountId: tahapan.id, toAccountId: tabunganB.id, occurredOn: TODAY });

    expect(await goalTotal()).toBe(2_000_000);
    expect(await setAsideOn(tahapan.id)).toBe(1_000_000);
    expect(await setAsideOn(tabunganB.id)).toBe(1_000_000);
    expect(await contributed()).toBe(2_000_000);
    // A's Free to spend is down by the November transfer.
    expect(await freeIn(tahapan.id, TODAY)).toBe(28_000_000);
    expect((await monthsOf()).map((m) => [m.month, m.state, m.amountMinor])).toEqual([
      ['2026-11', 'done', 1_000_000],
      ['2026-10', 'done', 1_000_000],
    ]);
  });

  it('a Transfer past From’s free money takes the rest from the goal’s own promise there', async () => {
    const thin = await createAccount(database, ws, { name: 'Dompet Tipis', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 1_500_000, openedOn: '2026-01-01' });
    await saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 1, mode: 'set_aside', accountId: thin.id, toAccountId: null }, '2026-10-05');
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-10', amountMinor: 1_000_000, accountId: thin.id, occurredOn: '2026-10-05' });
    await saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 1, mode: 'transfer', accountId: thin.id, toAccountId: tabunganB.id }, TODAY);
    // Free there: 500.000. A 1.000.000 transfer moves 500.000 of the goal's own promise with it.
    await transferGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_000_000, fromAccountId: thin.id, toAccountId: tabunganB.id, occurredOn: TODAY });
    expect(await setAsideOn(thin.id)).toBe(500_000);
    expect(await setAsideOn(tabunganB.id)).toBe(1_000_000);
    expect(await goalTotal()).toBe(1_500_000);
    expect(await contributed()).toBe(1_500_000);
    // Undone, the transfer goes and so does what it moved: back where October left it.
    await undoGoalMonth(database, ws, umrahId, '2026-11');
    expect(await setAsideOn(thin.id)).toBe(1_000_000);
    expect(await goalTotal()).toBe(1_000_000);
  });

  it('set aside, then the promise moved elsewhere: Undo takes nothing and the month stays done', async () => {
    await saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 1, mode: 'set_aside', accountId: tahapan.id, toAccountId: null }, '2026-11-05');
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_000_000, accountId: tahapan.id, occurredOn: '2026-11-05' });
    await recordTaggedTransfer(database, ws, { occurredOn: '2026-11-06', description: 'Pindah', amountMinor: 1_000_000, fromAccountId: tahapan.id, toAccountId: tabunganC.id, goalId: umrahId });
    await expect(undoGoalMonth(database, ws, umrahId, '2026-11')).resolves.toEqual({ undone: false, takenMinor: 0, leftMinor: 1_000_000 });
    expect((await monthsOf())[0]).toMatchObject({ state: 'done', amountMinor: 1_000_000 });
    expect(await goalTotal()).toBe(1_000_000);
    await expect(setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_000_000, accountId: tahapan.id, occurredOn: TODAY })).rejects.toThrow('already done');
  });

  it('Change amount lowered past what is left records what the month actually has', async () => {
    await saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 1, mode: 'set_aside', accountId: tahapan.id, toAccountId: null }, '2026-11-05');
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_000_000, accountId: tahapan.id, occurredOn: '2026-11-05' });
    await recordTaggedTransfer(database, ws, { occurredOn: '2026-11-06', description: 'Pindah', amountMinor: 800_000, fromAccountId: tahapan.id, toAccountId: tabunganC.id, goalId: umrahId });
    // Asked for 300.000: 700.000 off, but only 200.000 is still in A. 1.000.000 − 200.000 stays on the month.
    await expect(changeGoalMonthAmount(database, ws, umrahId, '2026-11', 300_000)).resolves.toBe(800_000);
    expect(await setAsideOn(tahapan.id)).toBe(0);
    expect((await monthsOf())[0]).toMatchObject({ state: 'done', amountMinor: 800_000 });
    await expect(undoGoalMonth(database, ws, umrahId, '2026-11')).resolves.toEqual({ undone: false, takenMinor: 0, leftMinor: 800_000 });
  });

  it('a transfer moved to another workspace keeps its month done, and is undone there', async () => {
    await saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 1, mode: 'transfer', accountId: tahapan.id, toAccountId: tabunganB.id }, TODAY);
    const id = await transferGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_000_000, fromAccountId: tahapan.id, toAccountId: tabunganB.id, occurredOn: TODAY });
    const other = await createWorkspace(database, { name: 'Usaha', type: 'personal', baseCurrency: 'IDR' });
    await database.db.run(sql`UPDATE transactions SET status = 'void' WHERE id = ${id}`);
    await database.db.run(
      sql`INSERT INTO transactions (id, workspace_id, occurred_on, description, source, status, replaces_transaction_id, created_at) VALUES ('moved-copy', ${other.workspaceId}, ${TODAY}, 'Umrah · November', 'manual', 'posted', ${id}, ${TODAY})`,
    );
    expect((await monthsOf())[0]).toMatchObject({ state: 'done', transactionId: 'moved-copy' });
    await expect(undoGoalMonth(database, ws, umrahId, '2026-11')).rejects.toThrow('moved to another workspace');
  });

  it('the Monthly and its due are saved as one: a refused due changes nothing', async () => {
    await expect(
      saveGoalMonthly(database, ws, { goalId: umrahId, amountMinor: 2_500_000, due: { goalId: umrahId, on: true, day: 5, mode: 'transfer', accountId: tahapan.id, toAccountId: tahapan.id } }, TODAY),
    ).rejects.toThrow('Choose two different accounts');
    await expect(saveGoalMonthly(database, ws, { goalId: umrahId, amountMinor: 0, due: { goalId: umrahId, on: true, day: 5, mode: 'set_aside', accountId: tahapan.id, toAccountId: null } }, TODAY)).rejects.toThrow(
      'Enter an amount each month',
    );
    const [standing] = await database.db.values<[number]>(sql`SELECT standing_monthly_minor FROM goals WHERE id = ${umrahId}`);
    expect(standing).toEqual([1_000_000]);
    await expect(goalDueOf(database, ws, umrahId)).resolves.toBeNull();
    await saveGoalMonthly(database, ws, { goalId: umrahId, amountMinor: 2_500_000, due: { goalId: umrahId, on: true, day: 5, mode: 'set_aside', accountId: tahapan.id, toAccountId: null } }, TODAY);
    expect((await monthsOf())[0]).toMatchObject({ amountMinor: 2_500_000, dueOn: '2026-11-05' });
  });
});

describe('the day a set-aside is dated', () => {
  const zone = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('is the local day: 00:30 on the 1st in Jakarta counts in that month, not UTC’s last', async () => {
    process.env.TZ = 'Asia/Jakarta';
    await saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 1, mode: 'set_aside', accountId: tahapan.id, toAccountId: null }, '2026-11-01');
    vi.useFakeTimers({ toFake: ['Date'] });
    // 00:30 on 1 November in Jakarta is still 31 October in UTC.
    vi.setSystemTime(new Date('2026-10-31T17:30:00Z'));
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_700_000, accountId: tahapan.id, occurredOn: '2026-11-01' });
    vi.useRealTimers();
    const rows = await database.db.values<[string]>(sql`SELECT occurred_on FROM goal_contributions WHERE goal_id = ${umrahId}`);
    expect(rows).toEqual([['2026-11-01']]);
  });
});

describe('a due-month transfer edited later (fix round 2)', () => {
  let deposito: AccountRow;
  beforeEach(async () => {
    deposito = await createAccount(database, ws, { name: 'Bank Sejahtera Deposito', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-01-01' });
    // Giro holds 3.000.000 for the goal, 27.000.000 free; November transfers 1.000.000 Giro → Tabungan.
    await saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 1, mode: 'set_aside', accountId: tahapan.id, toAccountId: null }, '2026-10-05');
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-10', amountMinor: 3_000_000, accountId: tahapan.id, occurredOn: '2026-10-05' });
    await saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 1, mode: 'transfer', accountId: tahapan.id, toAccountId: tabungan.id }, TODAY);
  });

  const goalTotal = async () => (await listEarmarks(database, ws)).filter((row) => row.goalId === umrahId).reduce((sum, row) => sum + row.amountMinor, 0);
  const transfer = () => transferGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_000_000, fromAccountId: tahapan.id, toAccountId: tabungan.id, occurredOn: TODAY });
  const edit = (id: string, amountMinor: number, toId: string) =>
    replaceTransaction(database, ws, id, {
      occurredOn: TODAY,
      description: 'Umrah · November',
      lines: [
        { accountId: tahapan.id, amountMinor: -amountMinor, currency: 'IDR' },
        { accountId: toId, amountMinor, currency: 'IDR' },
      ],
    });

  it('raised, the extra is new money too, and Month history shows the new amount', async () => {
    const id = await transfer();
    expect(await goalTotal()).toBe(4_000_000);
    const edited = await edit(id, 1_500_000, tabungan.id);
    expect(await goalTotal()).toBe(4_500_000);
    expect(await setAsideOn(tahapan.id)).toBe(3_000_000);
    expect(await setAsideOn(tabungan.id)).toBe(1_500_000);
    expect((await monthsOf())[0]).toMatchObject({ month: '2026-11', state: 'done', amountMinor: 1_500_000, transactionId: edited });
    await undoGoalMonth(database, ws, umrahId, '2026-11');
    expect(await goalTotal()).toBe(3_000_000);
  });

  it('sent to another account, the goal keeps its promise in From and the month follows', async () => {
    const id = await transfer();
    const edited = await edit(id, 1_000_000, deposito.id);
    expect(await goalTotal()).toBe(4_000_000);
    expect(await setAsideOn(tahapan.id)).toBe(3_000_000);
    expect(await setAsideOn(tabungan.id)).toBe(0);
    expect(await setAsideOn(deposito.id)).toBe(1_000_000);
    expect((await monthsOf())[0]).toMatchObject({ state: 'done', amountMinor: 1_000_000, toAccountId: deposito.id, transactionId: edited });
  });

  it('refuses when From’s balance moved between reading its free money and writing', async () => {
    const cap = await dueCapFor(database, ws, tahapan.id, 1_000_000, TODAY);
    await recordTaggedTransfer(database, ws, { occurredOn: TODAY, description: 'Pindah', amountMinor: 200_000, fromAccountId: tahapan.id, toAccountId: deposito.id, goalId: null });
    await expect(database.transaction((tx) => checkDueCapTx(tx, ws, cap))).rejects.toThrow('Balances just changed. Try again.');
  });
});

describe('Activity’s undo of an edit to a due-month transfer (U1)', () => {
  let deposito: AccountRow;
  beforeEach(async () => {
    deposito = await createAccount(database, ws, { name: 'Bank Sejahtera Deposito', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-01-01' });
    await saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 1, mode: 'set_aside', accountId: tahapan.id, toAccountId: null }, '2026-10-05');
    await setAsideGoalMonth(database, ws, { goalId: umrahId, month: '2026-10', amountMinor: 3_000_000, accountId: tahapan.id, occurredOn: '2026-10-05' });
    await saveGoalDue(database, ws, { goalId: umrahId, on: true, day: 1, mode: 'transfer', accountId: tahapan.id, toAccountId: tabungan.id }, TODAY);
  });

  const goalTotal = async () => (await listEarmarks(database, ws)).filter((row) => row.goalId === umrahId).reduce((sum, row) => sum + row.amountMinor, 0);
  const moveLines = (amountMinor: number, toId: string) => ({
    occurredOn: TODAY,
    description: 'Umrah · November',
    lines: [
      { accountId: tahapan.id, amountMinor: -amountMinor, currency: 'IDR' },
      { accountId: toId, amountMinor, currency: 'IDR' },
    ],
  });
  const undoLastEdit = async () => {
    const [line] = await activityOf(database, ws, { kind: 'edit' } as Parameters<typeof activityOf>[2]);
    await undoActivity(database, ws, line!.id);
  };

  it('undoing a To change keeps the goal at 4.000.000 and Giro’s promise at 3.000.000', async () => {
    const id = await transferGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_000_000, fromAccountId: tahapan.id, toAccountId: tabungan.id, occurredOn: TODAY });
    await replaceTransaction(database, ws, id, moveLines(1_000_000, deposito.id));
    await undoLastEdit();
    expect(await goalTotal()).toBe(4_000_000);
    expect(await setAsideOn(tahapan.id)).toBe(3_000_000);
    expect(await setAsideOn(tabungan.id)).toBe(1_000_000);
    expect((await monthsOf())[0]).toMatchObject({ state: 'done', amountMinor: 1_000_000, toAccountId: tabungan.id });
  });

  it('undoing a cut from 1.000.000 to 600.000 brings the goal back to 4.000.000', async () => {
    const id = await transferGoalMonth(database, ws, { goalId: umrahId, month: '2026-11', amountMinor: 1_000_000, fromAccountId: tahapan.id, toAccountId: tabungan.id, occurredOn: TODAY });
    await replaceTransaction(database, ws, id, moveLines(600_000, tabungan.id));
    expect(await goalTotal()).toBe(3_600_000);
    await undoLastEdit();
    expect(await goalTotal()).toBe(4_000_000);
    expect(await setAsideOn(tahapan.id)).toBe(3_000_000);
    expect((await monthsOf())[0]).toMatchObject({ state: 'done', amountMinor: 1_000_000 });
  });
});
