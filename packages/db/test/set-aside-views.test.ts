import { expenseLines, transferLines } from '@expanses/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  archiveGoal,
  createAccount,
  type Database,
  goalLinksFor,
  goalPlansFor,
  idleCash,
  nativeBalances,
  netWorthAt,
  postTransaction,
  saveEarmark,
  saveGoal,
  setAsideView,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const DAY = '2026-09-19';
let database: Database;
let ws: WorkspaceContext;
let jenius: AccountRow;
let bca: AccountRow;
let electronics: AccountRow;
let efId: string;
let umrahId: string;

const goal = (name: string, targetMinor: number) =>
  saveGoal(database, ws, { name, kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name, targetMinor, targetMonths: null, dueOn: '2027-12-31' }] });
const laptop = (amountMinor: number, setAside?: Parameters<typeof postTransaction>[2]['setAside']) =>
  postTransaction(database, ws, { occurredOn: DAY, description: 'Laptop', lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: jenius.id, amountMinor, currency: 'IDR' }), setAside });

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  jenius = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 42_500_000, openedOn: '2026-01-01' });
  bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  electronics = await createAccount(database, ws, { name: 'Electronics', kind: 'expense', subtype: 'category', currency: null });
  efId = await goal('Emergency fund', 30_000_000);
  umrahId = await goal('Umrah 2027', 7_500_000);
  await saveEarmark(database, ws, { goalId: efId, accountId: jenius.id, amountMinor: 30_000_000 });
  await saveEarmark(database, ws, { goalId: umrahId, accountId: jenius.id, amountMinor: 7_500_000 });
});

describe('setAsideView', () => {
  it('says what is free on the account, in its own money', async () => {
    expect(await setAsideView(database, ws, jenius.id, { date: DAY })).toMatchObject({ name: 'Jenius', currency: 'IDR', balanceMinor: 42_500_000, setAsideMinor: 37_500_000, freeMinor: 5_000_000, state: 'covered' });
    expect(await setAsideView(database, ws, bca.id, { date: DAY })).toBeNull();
  });

  it('keeps a foreign account in its own money, never converted', async () => {
    const wise = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD', openingBalanceMinor: 11_003, openedOn: '2026-01-01', openingRateToBase: 16_000 });
    await saveEarmark(database, ws, { goalId: umrahId, accountId: wise.id, amountMinor: 10_003 });
    // US$110,03 held, US$100,03 promised: US$10,00 free, in cents. Converted, it would read 16.000.000-odd.
    expect(await setAsideView(database, ws, wise.id, { date: DAY })).toMatchObject({ currency: 'USD', balanceMinor: 11_003, setAsideMinor: 10_003, freeMinor: 1_000 });
    // And the rupiah account beside it is untouched by it.
    expect((await setAsideView(database, ws, jenius.id, { date: DAY }))!.freeMinor).toBe(5_000_000);
  });

  it('shows an edit of a future-dated payment against today\'s balance, not below it', async () => {
    const later = await postTransaction(database, ws, { occurredOn: '2026-12-01', description: 'Laptop', lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: jenius.id, amountMinor: 6_800_000, currency: 'IDR' }) });
    // Today's balance does not hold the December payment, so leaving it out changes nothing (not +6.800.000).
    expect((await setAsideView(database, ws, jenius.id, { date: DAY, excludeTransactionId: later }))!.freeMinor).toBe(5_000_000);
  });

  it('gives a future-dated spend back to the promise when that spend is the one being edited', async () => {
    const later = await postTransaction(database, ws, {
      occurredOn: '2026-12-01',
      description: 'Tickets',
      lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: jenius.id, amountMinor: 6_800_000, currency: 'IDR' }),
      setAside: { accountId: jenius.id, goalId: umrahId, intent: 'spend', overMinor: 1_800_000 },
    });
    // The promise is not dated: the December spend lowered it to 700.000 today. Left out, it reads 7.500.000 again.
    const without = await setAsideView(database, ws, jenius.id, { date: DAY, excludeTransactionId: later });
    expect(without!.goals.find((g) => g.goalId === umrahId)!.promisedMinor).toBe(7_500_000);
    expect(without!.freeMinor).toBe(5_000_000);
  });

  it('stops counting an archived goal\'s promise', async () => {
    await archiveGoal(database, ws, umrahId);
    expect((await setAsideView(database, ws, jenius.id, { date: DAY }))!.freeMinor).toBe(12_500_000);
  });

  it('shows the account as if an edited transaction had not been recorded', async () => {
    const borrowed = await laptop(6_800_000, { accountId: jenius.id, goalId: efId, intent: 'borrow', overMinor: 1_800_000 });
    expect((await setAsideView(database, ws, jenius.id, { date: DAY }))!.goals[0]).toMatchObject({ goalId: efId, shortMinor: 1_800_000 });
    const without = await setAsideView(database, ws, jenius.id, { date: DAY, excludeTransactionId: borrowed });
    expect(without).toMatchObject({ balanceMinor: 42_500_000, shortMinor: 0, freeMinor: 5_000_000 });
  });

  it('gives a spend back to the promise when that spend is the one being edited', async () => {
    const spent = await laptop(6_800_000, { accountId: jenius.id, goalId: umrahId, intent: 'spend', overMinor: 1_800_000 });
    const without = await setAsideView(database, ws, jenius.id, { date: DAY, excludeTransactionId: spent });
    expect(without!.goals.find((g) => g.goalId === umrahId)!.promisedMinor).toBe(7_500_000);
    expect(without!.freeMinor).toBe(5_000_000);
  });
});

describe('goalLinksFor, shared out', () => {
  it('never counts the same money for two goals', async () => {
    const hajj = await goal('Hajj', 100_000_000);
    const edu = await goal('Education', 100_000_000);
    await saveEarmark(database, ws, { goalId: hajj, accountId: bca.id, amountMinor: 30_000_000 });
    await saveEarmark(database, ws, { goalId: edu, accountId: bca.id, amountMinor: 30_000_000 });
    const links = (await goalLinksFor(database, ws, DAY)).filter((link) => link.accountId === bca.id);
    // Education ranks after Hajj, so it carries the 10.000.000 the account does not hold.
    expect(links.find((l) => l.goalId === hajj)).toMatchObject({ valueMinor: 30_000_000, promisedMinor: 30_000_000, shortMinor: 0, overBalance: false });
    expect(links.find((l) => l.goalId === edu)).toMatchObject({ valueMinor: 20_000_000, promisedMinor: 30_000_000, shortMinor: 10_000_000, overBalance: true });
    // The old per-goal cap counted 60.000.000 out of a 50.000.000 account.
    expect(links.reduce((total, link) => total + link.valueMinor, 0)).toBe(50_000_000);
  });

  it('puts a borrow on the goal borrowed from, though it ranks first', async () => {
    await laptop(6_800_000, { accountId: jenius.id, goalId: efId, intent: 'borrow', overMinor: 1_800_000 });
    const summary = await goalPlansFor(database, ws, DAY);
    const ef = summary.plans.find((p) => p.goalId === efId)!;
    expect(ef.currentMinor).toBe(28_200_000);
    expect(ef.earmarkWarning).toContain('Jenius');
    expect(ef.earmarkWarning).toContain('1.800.000');
    expect(ef.unconvertedWarning).toBeNull();
    expect(summary.plans.find((p) => p.goalId === umrahId)!.currentMinor).toBe(7_500_000);
  });
});

describe('a promise is not a balance', () => {
  it('leaves balances and net worth exactly where a twin without set-asides has them', async () => {
    const twin = await setupDb();
    const tJenius = await createAccount(twin.database, twin.ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 42_500_000, openedOn: '2026-01-01' });
    const tBca = await createAccount(twin.database, twin.ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
    const tCat = await createAccount(twin.database, twin.ws, { name: 'Electronics', kind: 'expense', subtype: 'category', currency: null });
    await postTransaction(twin.database, twin.ws, { occurredOn: DAY, description: 'Laptop', lines: expenseLines({ categoryAccountId: tCat.id, paymentAccountId: tJenius.id, amountMinor: 6_800_000, currency: 'IDR' }) });
    await postTransaction(twin.database, twin.ws, { occurredOn: DAY, description: 'Move', lines: transferLines({ fromAccountId: tJenius.id, toAccountId: tBca.id, amountMinor: 20_000_000, currency: 'IDR' }) });

    await laptop(6_800_000, { accountId: jenius.id, goalId: umrahId, intent: 'spend', overMinor: 1_800_000 });
    await postTransaction(database, ws, { occurredOn: DAY, description: 'Move', lines: transferLines({ fromAccountId: jenius.id, toAccountId: bca.id, amountMinor: 20_000_000, currency: 'IDR' }), setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 15_000_000, toAccountId: bca.id } });

    expect((await netWorthAt(database, ws, DAY, {})).netWorthMinor).toBe((await netWorthAt(twin.database, twin.ws, DAY, {})).netWorthMinor);
    expect(Object.values(await nativeBalances(database, ws)).sort()).toEqual(Object.values(await nativeBalances(twin.database, twin.ws)).sort());
  });
});

describe('idleCash', () => {
  it('counts only what is free, never claimed money', async () => {
    const rows = await idleCash(database, ws, DAY);
    expect(rows.find((row) => row.accountId === jenius.id)!.amountMinor).toBe(5_000_000);
    expect(rows.find((row) => row.accountId === bca.id)!.amountMinor).toBe(50_000_000);
    await saveEarmark(database, ws, { goalId: efId, accountId: jenius.id, amountMinor: 45_000_000 });
    expect((await idleCash(database, ws, DAY)).find((row) => row.accountId === jenius.id)!.amountMinor).toBe(0);
  });
});
