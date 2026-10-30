import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  type Database,
  deleteGoal,
  goalLinksFor,
  goalPlansFor,
  listEarmarks,
  listTrades,
  recordTrade,
  saveAssetProfile,
  saveEarmark,
  saveGoal,
  upsertPrice,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;

const oneGoal = (name: string) =>
  saveGoal(database, ws, { name, kind: 'other', growthBps: 0, returnBps: 500, stages: [{ name, targetMinor: 50_000_000, targetMonths: null, dueOn: '2030-06-30' }] });

beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

describe('deleteGoal', () => {
  it('releases what was set aside, untags the purchases and removes the goal', async () => {
    const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
    const gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-11', priceMicro: 1_800_000_000_000 });
    const doomed = await oneGoal('Doomed');
    const kept = await oneGoal('Kept');
    await saveEarmark(database, ws, { goalId: doomed, accountId: bank.id, amountMinor: 8_000_000 });
    await saveEarmark(database, ws, { goalId: kept, accountId: bank.id, amountMinor: 1_000_000 });
    await recordTrade(database, ws, { accountId: gold.id, kind: 'buy', occurredOn: '2026-03-09', unitsMicro: 2_000_000, grossMinor: 3_600_000, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id, goalId: doomed });

    await deleteGoal(database, ws, doomed);

    const plans = (await goalPlansFor(database, ws, '2026-09-12')).plans;
    expect(plans.map((plan) => plan.goalId)).toEqual([kept]);
    expect((await listEarmarks(database, ws)).map((row) => row.goalId)).toEqual([kept]);
    expect((await goalLinksFor(database, ws, '2026-09-12')).every((link) => link.goalId === kept)).toBe(true);
    expect((await listTrades(database, ws)).every((trade) => trade.goalId !== doomed)).toBe(true);
    expect((await listTrades(database, ws)).length).toBe(1);
  });

  it('refuses a goal that is not in the workspace', async () => {
    await expect(deleteGoal(database, ws, 'nope')).rejects.toThrow('Goal not found');
  });
});
