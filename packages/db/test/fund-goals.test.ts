import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  type Database,
  goalLinksFor,
  listTrades,
  recordTrade,
  recordValuation,
  retagTrade,
  saveAssetProfile,
  saveGoal,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let fund: AccountRow;
let bank: AccountRow;
let umroh: string;
let house: string;

const goal = (name: string) =>
  saveGoal(database, ws, { name, kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name: 'All of it', targetMinor: 10_000_000, targetMonths: null, dueOn: '2030-01-01' }] });

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bank = await createAccount(database, ws, { name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-01' });
  fund = await createAccount(database, ws, { name: 'Sucor Money Market', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: fund.id, assetKind: 'fund' });
  umroh = await goal('Umroh');
  house = await goal('House');
});

const money = (kind: 'buy' | 'sell', occurredOn: string, grossMinor: number, goalId: string | null) =>
  recordTrade(database, ws, { accountId: fund.id, kind, occurredOn, unitsMicro: 0, grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id, goalId });

async function filled() {
  await money('buy', '2026-08-01', 600_000, umroh);
  await money('buy', '2026-08-02', 400_000, house);
  await money('buy', '2026-08-03', 500_000, null);
  await recordValuation(database, ws, { accountId: fund.id, asOf: '2026-10-01', valueMinor: 1_552_000, basis: 'estimate' });
}

const linksOn = async (date: string) => (await goalLinksFor(database, ws, date)).filter((link) => link.kind === 'tagged');

describe('goals funded by a fund tracked by money', () => {
  it('holds each goal’s share of the value by the money it put in', async () => {
    await filled();
    const links = await linksOn('2026-10-01');
    expect(links.find((link) => link.goalId === umroh)).toMatchObject({ moneyMinor: 600_000, valueMinor: 620_800, unitsMicro: null });
    expect(links.find((link) => link.goalId === house)).toMatchObject({ moneyMinor: 400_000, valueMinor: 413_867 });
  });

  it('takes a sell named to a goal out of that goal, and refuses one that takes more than it put in', async () => {
    await filled();
    // Umroh's share is 620.800 of the 1.552.000; a sell of half of it takes 300.000 of its money.
    await money('sell', '2026-10-02', 310_400, umroh);
    const links = await linksOn('2026-10-02');
    expect(links.find((link) => link.goalId === umroh)).toMatchObject({ moneyMinor: 300_000, valueMinor: 310_400 });
    await expect(money('sell', '2026-10-03', 500_000, house)).rejects.toThrow('House has less in this fund than that sell takes out');
  });

  it('moves a buy to another goal with its money', async () => {
    await filled();
    const buy = (await listTrades(database, ws)).find((trade) => trade.goalId === umroh)!;
    await retagTrade(database, ws, buy.id, house);
    const links = await linksOn('2026-10-01');
    expect(links.find((link) => link.goalId === house)).toMatchObject({ moneyMinor: 1_000_000 });
    expect(links.find((link) => link.goalId === umroh)).toBeUndefined();
  });
});
