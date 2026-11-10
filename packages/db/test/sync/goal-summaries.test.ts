import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount, saveAssetProfile, saveEarmark, saveGoal, saveTradeTemplate, upsertRate, type Database, type WorkspaceContext } from '../../src/index';
import { ownGoalFunding, ownGoalMoves } from '../../src/sync/goals/summaries';
import { setupDb } from '../helpers';

/* What this phone sends of one member's own money for a shared goal (shared goals C5, C6, C16, C17): names and counted
   amounts only, never an account id, a balance or a short-by. */

const DAY = '2026-11-10';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${DAY}T09:00:00Z`));
});
afterEach(() => vi.useRealTimers());

const rate = (database: Database, fromCurrency: string, value: number) =>
  upsertRate(database, { fromCurrency, toCurrency: 'IDR', onDate: DAY, rate: value, source: 'manual', sourceDate: DAY });

async function world() {
  const { database, ws } = await setupDb();
  const acct = (name: string, openingBalanceMinor: number, currency = 'IDR') =>
    createAccount(database, ws, { name, kind: 'asset', subtype: 'savings', currency, openingBalanceMinor, openedOn: '2026-01-01', openingRateToBase: currency === 'IDR' ? undefined : 16_000 });
  const main = await acct('Main Savings', 30_000_000);
  const daily = await acct('Daily Account', 5_000_000);
  const dollars = await acct('Travel Dollars', 10_000, 'USD');
  const goalId = await saveGoal(database, ws, {
    name: 'Trip Fund',
    kind: 'other',
    growthBps: 0,
    returnBps: 0,
    standingMonthlyMinor: 500_000,
    stages: [{ name: 'Trip', targetMinor: 60_000_000, targetMonths: null, dueOn: '2027-11-10' }],
  });
  return { database, ws, main: main.id, daily: daily.id, dollars: dollars.id, goalId };
}

async function withBuy(database: Database, ws: WorkspaceContext, goalId: string) {
  const gold = await createAccount(database, ws, { name: 'Gold Pot', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  const cash = await createAccount(database, ws, { name: 'Cash Wallet', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 9_000_000, openedOn: '2026-01-01' });
  await saveTradeTemplate(database, ws, { accountId: gold.id, cashAccountId: cash.id, amountMinor: 1_000_000, unitsMicro: null, dayOfMonth: 5, active: true, goalId, kind: 'buy' });
}

describe('a member\'s own funding for a goal', () => {
  it('names each account and the amount it counts', async () => {
    const { database, ws, main, goalId } = await world();
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 20_000_000 });
    expect((await ownGoalFunding(database, ws, goalId, DAY)).lines).toEqual([{ ref: expect.any(String), name: 'Main Savings', kind: 'earmark', amountMinor: 20_000_000, risk: null, currency: 'IDR' }]);
  });

  it('a promise above the balance travels as what is counted', async () => {
    const { database, ws, daily, goalId } = await world();
    await saveEarmark(database, ws, { goalId, accountId: daily, amountMinor: 8_000_000 });
    expect((await ownGoalFunding(database, ws, goalId, DAY)).lines[0]!.amountMinor).toBe(5_000_000);
  });

  it('foreign account: in the goal\'s money at this phone\'s rate, or null without one', async () => {
    const { database, ws, dollars, goalId } = await world();
    await saveEarmark(database, ws, { goalId, accountId: dollars, amountMinor: 10_000 });
    expect((await ownGoalFunding(database, ws, goalId, DAY)).lines[0]!.amountMinor).toBeNull();
    await rate(database, 'USD', 16_000);
    expect((await ownGoalFunding(database, ws, goalId, DAY)).lines[0]!.amountMinor).toBe(1_600_000);
  });

  it('the ref is the same on every read and differs by account', async () => {
    const { database, ws, main, daily, goalId } = await world();
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 1_000_000 });
    await saveEarmark(database, ws, { goalId, accountId: daily, amountMinor: 1_000_000 });
    const a = (await ownGoalFunding(database, ws, goalId, DAY)).lines.map((l) => l.ref);
    const b = (await ownGoalFunding(database, ws, goalId, DAY)).lines.map((l) => l.ref);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(2);
  });

  it('carries no account id, balance or short-by', async () => {
    const { database, ws, main, daily, dollars, goalId } = await world();
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 20_000_000 });
    await saveEarmark(database, ws, { goalId, accountId: daily, amountMinor: 8_000_000 });
    const text = JSON.stringify(await ownGoalFunding(database, ws, goalId, DAY));
    for (const id of [main, daily, dollars]) expect(text).not.toContain(id);
    expect(text).not.toMatch(/short|balance|promised/i);
  });

  it('planned monthly is the standing amount plus monthly buys', async () => {
    const { database, ws, goalId } = await world();
    expect((await ownGoalFunding(database, ws, goalId, DAY)).plannedMonthlyMinor).toBe(500_000);
    await withBuy(database, ws, goalId);
    expect((await ownGoalFunding(database, ws, goalId, DAY)).plannedMonthlyMinor).toBe(1_500_000);
  });
});

describe('a member\'s own History lines', () => {
  it('have ids that do not change between reads', async () => {
    const { database, ws, main, goalId } = await world();
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 20_000_000 });
    const a = await ownGoalMoves(database, ws, goalId, 'member-f', DAY);
    const b = await ownGoalMoves(database, ws, goalId, 'member-f', DAY);
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ goalId, kind: 'set-aside', amountMinor: 20_000_000, currency: 'IDR', text: 'Main Savings', memberId: 'member-f', stageId: null, occurredOn: DAY });
  });

  it('keep every line, not the card\'s newest six', async () => {
    const { database, ws, main, goalId } = await world();
    for (let i = 1; i <= 8; i++) await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: i * 1_000_000 });
    expect(await ownGoalMoves(database, ws, goalId, 'member-f', DAY)).toHaveLength(8);
  });
});
