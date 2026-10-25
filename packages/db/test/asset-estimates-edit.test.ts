import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  assetValuesAt,
  changeOriginalCost,
  createAccount,
  deleteValuation,
  type Database,
  editValuation,
  listValuations,
  nativeBalances,
  openingsOf,
  recordValuation,
  saveAcquired,
  saveAssetProfile,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let house: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  house = await createAccount(database, ws, { name: 'House', kind: 'asset', subtype: 'property', currency: 'IDR', openingBalanceMinor: 1_000_000_000, openedOn: '2024-01-01' });
  await saveAssetProfile(database, ws, { accountId: house.id, assetKind: 'property' });
});

const row = async (date: string, accountId = house.id) => (await assetValuesAt(database, ws, date)).find((r) => r.accountId === accountId)!;

describe('original cost', () => {
  it('changes the opening entry in place, so cost and gain follow', async () => {
    await recordValuation(database, ws, { accountId: house.id, asOf: '2025-06-01', valueMinor: 1_200_000_000, basis: 'estimate' });
    await changeOriginalCost(database, ws, house.id, 900_000_000, '2026-10-25');
    expect(await row('2026-10-25')).toMatchObject({ costMinor: 900_000_000, valueMinor: 1_200_000_000 });
    const opening = (await openingsOf(database, ws, [house.id]))[house.id]!;
    expect(opening).toMatchObject({ occurredOn: '2024-01-01', amountMinor: 900_000_000 });
    expect((await nativeBalances(database, ws))[house.id]).toBe(900_000_000);
  });

  it('moves the value before the first estimate, which is the cost', async () => {
    await recordValuation(database, ws, { accountId: house.id, asOf: '2025-06-01', valueMinor: 1_200_000_000, basis: 'estimate' });
    await changeOriginalCost(database, ws, house.id, 900_000_000, '2026-10-25');
    expect((await row('2024-06-01')).valueMinor).toBe(900_000_000);
    expect((await row('2025-07-01')).valueMinor).toBe(1_200_000_000);
  });

  it('zero removes the cost; a cost can be given again on the acquired day', async () => {
    await saveAcquired(database, ws, house.id, { on: '2023-05-05', precision: 'day' });
    await changeOriginalCost(database, ws, house.id, 0, '2026-10-25');
    expect(await openingsOf(database, ws, [house.id])).toEqual({});
    expect((await row('2026-10-25')).costMinor).toBe(0);
    await changeOriginalCost(database, ws, house.id, 800_000_000, '2026-10-25');
    expect((await openingsOf(database, ws, [house.id]))[house.id]).toMatchObject({ occurredOn: '2023-05-05', amountMinor: 800_000_000 });
  });

  it('refuses a negative cost and a foreign cost with no rate and no entry', async () => {
    await expect(changeOriginalCost(database, ws, house.id, -1, '2026-10-25')).rejects.toThrow(/negative/);
    const usd = await createAccount(database, ws, { name: 'Bike', kind: 'asset', subtype: 'vehicle', currency: 'USD' });
    await expect(changeOriginalCost(database, ws, usd.id, 100_000, '2026-10-25')).rejects.toThrow(/rate/);
    await changeOriginalCost(database, ws, usd.id, 100_000, '2026-10-25', 16_000);
    expect((await openingsOf(database, ws, [usd.id]))[usd.id]).toMatchObject({ amountMinor: 100_000, fxRateToBase: 16_000 });
  });

  it('keeps a foreign opening at its rate when the amount changes', async () => {
    const usd = await createAccount(database, ws, { name: 'Bike', kind: 'asset', subtype: 'vehicle', currency: 'USD', openingBalanceMinor: 100_000, openedOn: '2025-01-01', openingRateToBase: 16_000 });
    await changeOriginalCost(database, ws, usd.id, 120_000, '2026-10-25');
    expect((await openingsOf(database, ws, [usd.id]))[usd.id]).toMatchObject({ amountMinor: 120_000, fxRateToBase: 16_000 });
  });
});

describe('editing and deleting an estimate', () => {
  it('edits value, date and note of the same row, and the latest value follows', async () => {
    const first = await recordValuation(database, ws, { accountId: house.id, asOf: '2025-01-01', valueMinor: 1_100_000_000, basis: 'estimate', note: 'agent' });
    await recordValuation(database, ws, { accountId: house.id, asOf: '2025-06-01', valueMinor: 1_200_000_000, basis: 'estimate' });
    await editValuation(database, ws, first, { asOf: '2025-09-01', valueMinor: 1_300_000_000, note: ' new note ' });
    const list = await listValuations(database, ws, house.id);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: first, asOf: '2025-09-01', valueMinor: 1_300_000_000, note: 'new note' });
    expect((await row('2026-10-25')).valueMinor).toBe(1_300_000_000);
    await expect(editValuation(database, ws, first, { asOf: '2025-09-01', valueMinor: -5 })).rejects.toThrow(/negative/);
    await expect(editValuation(database, ws, 'nope', { asOf: '2025-09-01', valueMinor: 5 })).rejects.toThrow(/not in this workspace/);
  });

  it('deleting the latest falls back to the previous estimate, then to the cost', async () => {
    await recordValuation(database, ws, { accountId: house.id, asOf: '2025-01-01', valueMinor: 1_100_000_000, basis: 'estimate' });
    const latest = await recordValuation(database, ws, { accountId: house.id, asOf: '2025-06-01', valueMinor: 1_200_000_000, basis: 'estimate' });
    await deleteValuation(database, ws, latest);
    expect((await row('2026-10-25')).valueMinor).toBe(1_100_000_000);
    const [only] = await listValuations(database, ws, house.id);
    await deleteValuation(database, ws, only!.id);
    expect(await row('2026-10-25')).toMatchObject({ valueMinor: 1_000_000_000, source: 'cost' });
  });

  it('keeps the only estimate of an asset with no cost', async () => {
    const bare = await createAccount(database, ws, { name: 'Land', kind: 'asset', subtype: 'property', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: bare.id, assetKind: 'property' });
    const id = await recordValuation(database, ws, { accountId: bare.id, asOf: '2025-01-01', valueMinor: 500_000_000, basis: 'estimate' });
    await expect(deleteValuation(database, ws, id)).rejects.toThrow(/cannot be deleted/);
    expect(await listValuations(database, ws, bare.id)).toHaveLength(1);
  });
});
