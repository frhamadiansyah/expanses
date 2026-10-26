import { currencyInfo } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  goalIsFunded,
  goalLinksFor,
  goalPlansFor,
  listGoals,
  migrate,
  MIGRATIONS,
  saveEarmark,
  saveGoal,
  upsertRate,
  viaBaseMinor,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const TODAY = '2026-09-12';

let database: Database;
let ws: WorkspaceContext;

const exp = (code: string) => currencyInfo(code).exponent;

const rate = (fromCurrency: string, value: number) =>
  upsertRate(database, { fromCurrency, toCurrency: 'IDR', onDate: TODAY, rate: value, source: 'manual', sourceDate: TODAY });

const stage = (targetMinor: number) => [{ name: 'Payment', targetMinor, targetMonths: null, dueOn: '2027-09-12' }];

const goalIn = (currency: string | undefined, targetMinor: number, extra: { standingMonthlyMinor?: number; name?: string } = {}) =>
  saveGoal(database, ws, {
    name: extra.name ?? 'Overseas goal',
    kind: 'other',
    growthBps: 0,
    returnBps: 0,
    currency,
    standingMonthlyMinor: extra.standingMonthlyMinor,
    stages: stage(targetMinor),
  });

const idr = async (name: string, openingBalanceMinor: number): Promise<AccountRow> =>
  createAccount(database, ws, { name, kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor, openedOn: '2026-01-01' });

const foreign = async (name: string, currency: string, openingBalanceMinor: number, openingRateToBase: number): Promise<AccountRow> =>
  createAccount(database, ws, { name, kind: 'asset', subtype: 'bank', currency, openingBalanceMinor, openedOn: '2026-01-01', openingRateToBase });

beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

describe('migration 0091', () => {
  it('gives every existing goal its workspace base currency', async () => {
    const old = createDatabase(createNodeExecutor());
    await migrate(old, MIGRATIONS.filter((m) => m.version <= 90));
    const oldWs = await createWorkspace(old, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    await old.execScript(
      `INSERT INTO goals (id, workspace_id, name, kind, rank, growth_bps, return_bps, standing_monthly_minor, status, created_at)
       VALUES ('old', '${oldWs.workspaceId}', 'Old goal', 'hajj', 0, 0, 0, 0, 'active', '2026-01-01T00:00:00Z')`,
    );
    await migrate(old, MIGRATIONS);
    const rows = await old.db.values<[string]>(sql`SELECT currency FROM goals WHERE id = 'old'`);
    expect(rows[0]![0]).toBe('IDR');
    expect((await listGoals(old, oldWs))[0]!.currency).toBe('IDR');
  });
});

describe("a goal's currency", () => {
  it('is the workspace base unless one is chosen, and is kept across saves that do not name it', async () => {
    const plain = await goalIn(undefined, 5_000_000);
    const usd = await goalIn('USD', 500_000, { name: 'Tuition' });
    const byId = Object.fromEntries((await listGoals(database, ws)).map((goal) => [goal.id, goal.currency]));
    expect(byId[plain]).toBe('IDR');
    expect(byId[usd]).toBe('USD');
    await saveGoal(database, ws, { id: usd, name: 'Tuition', kind: 'other', growthBps: 0, returnBps: 0, stages: stage(600_000) });
    expect((await listGoals(database, ws)).find((goal) => goal.id === usd)!.currency).toBe('USD');
  });

  it('rejects something that is not a currency code', async () => {
    await expect(goalIn('dollars', 1_000)).rejects.toThrow();
  });

  it('can change while nothing is counted toward the goal, and is fixed once money is set aside', async () => {
    const id = await goalIn('USD', 500_000);
    expect(await goalIsFunded(database, id)).toBe(false);
    await saveGoal(database, ws, { id, name: 'Overseas goal', kind: 'other', growthBps: 0, returnBps: 0, currency: 'EUR', stages: stage(500_000) });
    expect((await listGoals(database, ws)).find((goal) => goal.id === id)!.currency).toBe('EUR');

    const bca = await idr('BCA', 50_000_000);
    await saveEarmark(database, ws, { goalId: id, accountId: bca.id, amountMinor: 1_000_000 });
    expect(await goalIsFunded(database, id)).toBe(true);
    await expect(saveGoal(database, ws, { id, name: 'Overseas goal', kind: 'other', growthBps: 0, returnBps: 0, currency: 'USD', stages: stage(500_000) })).rejects.toThrow(/currency cannot change/);
    // Saving with the same currency is still fine.
    await saveGoal(database, ws, { id, name: 'Renamed', kind: 'other', growthBps: 0, returnBps: 0, currency: 'EUR', stages: stage(500_000) });
  });
});

describe("progress in the goal's currency", () => {
  it("counts base-currency money in a USD goal at the day's rate", async () => {
    const id = await goalIn('USD', 100_000);
    const bca = await idr('BCA', 50_000_000);
    await rate('USD', 16_000);
    await saveEarmark(database, ws, { goalId: id, accountId: bca.id, amountMinor: 16_000_000 });
    const plan = (await goalPlansFor(database, ws, TODAY)).plans.find((row) => row.goalId === id)!;
    const expected = Math.round((16_000_000 / 16_000) * 10 ** (exp('USD') - exp('IDR')));
    expect(plan.currency).toBe('USD');
    expect(plan.currentMinor).toBe(expected);
    expect(plan.links[0]!.goalMinor).toBe(expected);
    expect(plan.links[0]!.baseMinor).toBe(16_000_000);
    expect(plan.currentBaseMinor).toBe(16_000_000);
    expect(plan.unconvertedWarning).toBeNull();
  });

  it('keeps same-currency money exact with no rate stored', async () => {
    const id = await goalIn('USD', 500_000);
    const wise = await foreign('Wise USD', 'USD', 20_001, 16_000);
    await saveEarmark(database, ws, { goalId: id, accountId: wise.id, amountMinor: 10_003 });
    const plan = (await goalPlansFor(database, ws, TODAY)).plans.find((row) => row.goalId === id)!;
    expect(plan.currentMinor).toBe(10_003);
    expect(plan.links[0]!.goalMinor).toBe(10_003);
    expect(plan.unconvertedWarning).toBeNull();
  });

  it('crosses a USD pocket into a EUR goal through the base, rounding to the euro cent', async () => {
    const id = await goalIn('EUR', 300_000, { name: 'Bag' });
    const wise = await foreign('Wise USD', 'USD', 20_000, 16_000);
    await rate('USD', 16_000);
    await rate('EUR', 18_000);
    await saveEarmark(database, ws, { goalId: id, accountId: wise.id, amountMinor: 10_000 });
    const plan = (await goalPlansFor(database, ws, TODAY)).plans.find((row) => row.goalId === id)!;
    // US$100,00 x 16.000 / 18.000 = EUR 88,888... -> 88,89
    expect(plan.currentMinor).toBe(8_889);
    expect(plan.currency).toBe('EUR');
    expect(plan.currentBaseMinor).toBe(viaBaseMinor(8_889, 'EUR', 'IDR', 'IDR', { EUR: 18_000 }));
  });

  it('counts a zero-decimal JPY goal in whole yen from base money', async () => {
    const id = await goalIn('JPY', 200_000, { name: 'Holiday' });
    const bca = await idr('BCA', 500_000_000);
    await rate('JPY', 105);
    const rupiah = 1_050_000 * 10 ** exp('IDR');
    await saveEarmark(database, ws, { goalId: id, accountId: bca.id, amountMinor: rupiah });
    const plan = (await goalPlansFor(database, ws, TODAY)).plans.find((row) => row.goalId === id)!;
    // Rp 1.050.000 at 105 a yen is 10.000 yen; JPY has no minor unit, so 10_000.
    expect(plan.currentMinor).toBe(10_000);
    expect(plan.totalTargetMinor).toBe(200_000);
  });

  it("leaves money with no rate out, and says so in the goal's currency", async () => {
    const id = await goalIn('USD', 100_000);
    const bca = await idr('BCA', 50_000_000);
    await saveEarmark(database, ws, { goalId: id, accountId: bca.id, amountMinor: 1_000_000 });
    const plan = (await goalPlansFor(database, ws, TODAY)).plans.find((row) => row.goalId === id)!;
    expect(plan.links[0]!.goalMinor).toBeNull();
    expect(plan.currentMinor).toBe(0);
    expect(plan.unconvertedWarning).toMatch(/no USD rate/);
  });

  it('adds goals up in the base currency for the totals only', async () => {
    const usd = await goalIn('USD', 120_000, { standingMonthlyMinor: 10_000, name: 'Tuition' });
    const home = await goalIn(undefined, 12_000_000 * 10 ** exp('IDR'), { name: 'Home', standingMonthlyMinor: 50_000 });
    await rate('USD', 16_000);
    const summary = await goalPlansFor(database, ws, TODAY);
    const usdPlan = summary.plans.find((row) => row.goalId === usd)!;
    const homePlan = summary.plans.find((row) => row.goalId === home)!;
    // US$100,00 a month stands at Rp 1.600.000.
    expect(usdPlan.plannedMonthlyMinor).toBe(10_000);
    expect(usdPlan.plannedMonthlyBaseMinor).toBe(1_600_000 * 10 ** exp('IDR'));
    expect(homePlan.plannedMonthlyBaseMinor).toBe(50_000);
    expect(summary.plannedMonthlyMinor).toBe((usdPlan.plannedMonthlyBaseMinor ?? 0) + 50_000);
    expect(summary.neededMonthlyMinor).toBe((usdPlan.requiredMonthlyBaseMinor ?? 0) + (homePlan.requiredMonthlyBaseMinor ?? 0));
    expect(usdPlan.requiredMonthlyMinor).toBeGreaterThan(0);
  });

  it("links carry the goal's money from goalLinksFor too", async () => {
    const id = await goalIn('SAR', 1_000_000, { name: 'Hajj' });
    const bca = await idr('BCA', 50_000_000);
    await rate('SAR', 4_200);
    await saveEarmark(database, ws, { goalId: id, accountId: bca.id, amountMinor: 4_200_000 });
    const link = (await goalLinksFor(database, ws, TODAY)).find((row) => row.goalId === id)!;
    expect(link.goalMinor).toBe(Math.round((4_200_000 / 4_200) * 10 ** (exp('SAR') - exp('IDR'))));
  });
});

describe('viaBaseMinor', () => {
  it('is exact for the same currency and null without a rate', () => {
    expect(viaBaseMinor(10_003, 'USD', 'USD', 'IDR', {})).toBe(10_003);
    expect(viaBaseMinor(10_003, 'USD', 'EUR', 'IDR', { USD: 16_000 })).toBeNull();
    expect(viaBaseMinor(500, 'JPY', 'JPY', 'IDR', {})).toBe(500);
  });
});
