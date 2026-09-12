import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  categoryIdsByKey,
  createAccount,
  createWorkspace,
  type Database,
  goalLinksFor,
  goalPlansFor,
  listTrades,
  nativeBalances,
  postTransaction,
  recordTrade,
  retagTrade,
  saveAssetProfile,
  saveEarmark,
  saveGoal,
  saveTradeTemplate,
  upsertPrice,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-12';

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let gold: AccountRow;
let hajjId: string;
let eduId: string;

const g = (grams: number) => grams * 1_000_000;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-11', priceMicro: 1_800_000_000_000 });
  hajjId = await saveGoal(database, ws, {
    name: 'Hajj for two',
    kind: 'hajj',
    growthBps: 500,
    returnBps: 600,
    stages: [{ name: 'Setoran awal', targetMinor: 50_000_000, targetMonths: null, dueOn: '2027-06-30' }],
  });
  eduId = await saveGoal(database, ws, {
    name: 'University for Aisyah',
    kind: 'education',
    growthBps: 1000,
    returnBps: 1000,
    stages: [{ name: 'First year', targetMinor: 350_000_000, targetMonths: null, dueOn: '2038-07-31' }],
  });
});

const buyGold = (occurredOn: string, grams: number, goalId: string | null) =>
  recordTrade(database, ws, {
    accountId: gold.id,
    kind: 'buy',
    occurredOn,
    unitsMicro: g(grams),
    grossMinor: grams * 1_800_000,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId: bca.id,
    goalId,
  });

const sellGold = (occurredOn: string, grams: number, goalId: string | null) =>
  recordTrade(database, ws, {
    accountId: gold.id,
    kind: 'sell',
    occurredOn,
    unitsMicro: g(grams),
    grossMinor: grams * 1_900_000,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId: bca.id,
    goalId,
  });

describe('goalLinksFor', () => {
  it('funds a goal with the units tagged to it, at the latest price', async () => {
    await buyGold('2026-03-09', 10, hajjId);

    const links = await goalLinksFor(database, ws, TODAY);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ goalId: hajjId, accountId: gold.id, kind: 'tagged', unitsMicro: g(10), valueMinor: 18_000_000, risk: 'medium' });
  });

  it('splits one holding between two goals by the tag on each buy', async () => {
    await buyGold('2026-08-09', 1, eduId);
    await buyGold('2026-09-09', 2, hajjId);

    const links = await goalLinksFor(database, ws, TODAY);
    expect(links.find((link) => link.goalId === hajjId)).toMatchObject({ unitsMicro: g(2), valueMinor: 3_600_000 });
    expect(links.find((link) => link.goalId === eduId)).toMatchObject({ unitsMicro: g(1), valueMinor: 1_800_000 });
  });

  it('leaves an untagged buy funding nothing', async () => {
    await buyGold('2026-03-09', 10, null);

    await expect(goalLinksFor(database, ws, TODAY)).resolves.toEqual([]);
  });

  it('funds a goal with money set aside, capped at the balance', async () => {
    await saveEarmark(database, ws, { goalId: hajjId, accountId: bca.id, amountMinor: 80_000_000 });

    const links = await goalLinksFor(database, ws, TODAY);
    expect(links[0]).toMatchObject({ goalId: hajjId, accountId: bca.id, kind: 'earmark', unitsMicro: null, valueMinor: 50_000_000 });
  });
});

describe('retagTrade', () => {
  it('moves a buy to another goal without touching the ledger', async () => {
    const trade = await buyGold('2026-08-09', 1, eduId);
    const before = await nativeBalances(database, ws);

    await retagTrade(database, ws, trade.tradeId, hajjId);

    const links = await goalLinksFor(database, ws, TODAY);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ goalId: hajjId, unitsMicro: g(1) });
    await expect(nativeBalances(database, ws)).resolves.toEqual(before);
    const trades = await listTrades(database, ws, { accountId: gold.id });
    expect(trades).toHaveLength(1);
    expect(trades[0]!.transactionId).toBe(trade.transactionId);
  });

  it('can take a buy off every goal', async () => {
    const trade = await buyGold('2026-08-09', 1, eduId);

    await retagTrade(database, ws, trade.tradeId, null);

    await expect(goalLinksFor(database, ws, TODAY)).resolves.toEqual([]);
  });

  it('refuses a goal from another workspace', async () => {
    const trade = await buyGold('2026-08-09', 1, eduId);
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });

    await expect(retagTrade(database, other, trade.tradeId, hajjId)).rejects.toThrow();
  });
});

describe('selling from a goal', () => {
  it('takes units from the goal named and leaves the others alone', async () => {
    await buyGold('2026-03-09', 10, hajjId);
    await buyGold('2026-08-09', 4, eduId);

    await sellGold('2026-09-10', 3, eduId);

    const links = await goalLinksFor(database, ws, TODAY);
    expect(links.find((link) => link.goalId === hajjId)!.unitsMicro).toBe(g(10));
    expect(links.find((link) => link.goalId === eduId)!.unitsMicro).toBe(g(1));
  });

  it('refuses a sell the goal cannot cover, naming the goal', async () => {
    await buyGold('2026-03-09', 10, hajjId);
    await buyGold('2026-08-09', 1, eduId);

    await expect(sellGold('2026-09-10', 2, eduId)).rejects.toThrow(/University for Aisyah/);
    await expect(listTrades(database, ws, { accountId: gold.id })).resolves.toHaveLength(2);
  });
});

describe('goalPlansFor', () => {
  async function salaryAndSpending() {
    const categories = await categoryIdsByKey(database, ws);
    for (const month of ['06', '07', '08']) {
      await postTransaction(database, ws, {
        occurredOn: `2026-${month}-28`,
        description: 'Salary',
        lines: [
          { accountId: bca.id, amountMinor: 30_000_000, currency: 'IDR' },
          { accountId: categories['income.salary']!, amountMinor: -30_000_000, currency: 'IDR' },
        ],
      });
      await postTransaction(database, ws, {
        occurredOn: `2026-${month}-15`,
        description: 'Living',
        lines: [
          { accountId: categories['food.groceries']!, amountMinor: 20_000_000, currency: 'IDR' },
          { accountId: bca.id, amountMinor: -20_000_000, currency: 'IDR' },
        ],
      });
    }
  }

  it('gives each goal its plan, ranked, with what it needs each month', async () => {
    await buyGold('2026-03-09', 10, hajjId);
    await salaryAndSpending();

    const summary = await goalPlansFor(database, ws, TODAY);
    expect(summary.plans.map((plan) => plan.goal.name)).toEqual(['Hajj for two', 'University for Aisyah']);
    expect(summary.plans[0]!.currentMinor).toBe(18_000_000);
    expect(summary.plans[0]!.requiredMonthlyMinor).toBeGreaterThan(0);
    expect(summary.neededMonthlyMinor).toBe(summary.plans.reduce((total, plan) => total + plan.requiredMonthlyMinor, 0));
  });

  it('counts the standing amount and tagged monthly buys as set up', async () => {
    await saveGoal(database, ws, {
      id: hajjId,
      name: 'Hajj for two',
      kind: 'hajj',
      growthBps: 500,
      returnBps: 600,
      standingMonthlyMinor: 1_000_000,
      stages: [{ name: 'Setoran awal', targetMinor: 50_000_000, targetMonths: null, dueOn: '2027-06-30' }],
    });
    await saveTradeTemplate(database, ws, { accountId: gold.id, cashAccountId: bca.id, amountMinor: 2_000_000, unitsMicro: null, dayOfMonth: 9, active: true, goalId: hajjId });

    const summary = await goalPlansFor(database, ws, TODAY);
    expect(summary.plans.find((plan) => plan.goalId === hajjId)!.plannedMonthlyMinor).toBe(3_000_000);
  });

  it('works out what you can save from the last 12 months', async () => {
    await salaryAndSpending();

    const summary = await goalPlansFor(database, ws, TODAY);
    // Rp 90 jt in and Rp 60 jt out over 3 months with data: Rp 10 jt a month.
    expect(summary.capacityMonthlyMinor).toBe(10_000_000);
  });

  it('targets months of outgoings on an emergency goal', async () => {
    await salaryAndSpending();
    const emergencyId = await saveGoal(database, ws, {
      name: 'Emergency fund',
      kind: 'emergency',
      growthBps: 0,
      returnBps: 200,
      stages: [{ name: 'Emergency fund', targetMinor: null, targetMonths: 6, dueOn: '2028-12-31' }],
    });

    const summary = await goalPlansFor(database, ws, TODAY);
    const plan = summary.plans.find((row) => row.goalId === emergencyId)!;
    expect(plan.stages[0]!.todayMinor).toBe(6 * 20_000_000);
  });

  it('warns when more is set aside than the account holds', async () => {
    await saveEarmark(database, ws, { goalId: hajjId, accountId: bca.id, amountMinor: 80_000_000 });

    const summary = await goalPlansFor(database, ws, TODAY);
    expect(summary.plans.find((plan) => plan.goalId === hajjId)!.earmarkWarning).toContain('BCA Tahapan');
  });

  it('fits goals to what you can save, by rank', async () => {
    await salaryAndSpending();

    const summary = await goalPlansFor(database, ws, TODAY);
    expect(summary.fits.map((fit) => fit.goalId)).toEqual([hajjId, eduId]);
    expect(summary.fits.every((fit) => ['full', 'partial', 'none'].includes(fit.fits))).toBe(true);
  });

  it('keeps another workspace out', async () => {
    await buyGold('2026-03-09', 10, hajjId);
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });

    const summary = await goalPlansFor(database, other, TODAY);
    expect(summary.plans).toEqual([]);
  });
});
