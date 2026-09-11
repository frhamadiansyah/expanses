import { DEFAULT_CATEGORY_KEYS } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { categoryIdsByKey, createWorkspace, ensureCategoryKeys, listAccounts } from '../src/index';
import { setupDb, type TestDb } from './helpers';

const NEW_DEFAULTS = ['business', 'entertainment.sports', 'gifts_donations.donations', 'gifts_donations.gifts', 'government', 'housing.real_estate', 'utilities.gas'];
const ALL_KEYS = [...DEFAULT_CATEGORY_KEYS].sort();
const ARCHIVED = "'2026-09-11T00:00:00.000Z'";

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/** A workspace as v0 seeded it: categories without keys and without the defaults added for the catalogue. */
async function v0Workspace(): Promise<TestDb> {
  current = await setupDb();
  const quoted = NEW_DEFAULTS.map((key) => `'${key}'`).join(', ');
  await current.database.execScript(`DELETE FROM accounts WHERE system_key IN (${quoted})`);
  await current.database.execScript(`UPDATE accounts SET system_key = NULL WHERE subtype = 'category'`);
  return current;
}

describe('ensureCategoryKeys', () => {
  it('keys an old workspace seeded without keys', async () => {
    const { database, ws } = await v0Workspace();
    const result = await ensureCategoryKeys(database, ws);
    expect([...result.keyed].sort()).toEqual(ALL_KEYS.filter((key) => !NEW_DEFAULTS.includes(key)));
    expect(Object.keys(await categoryIdsByKey(database, ws)).sort()).toEqual(ALL_KEYS);
  });

  it('creates Gas, Real Estate, Gifts, Donations, Government & Taxes, Business & Invoices, and Sports & Fitness', async () => {
    const { database, ws } = await v0Workspace();
    expect([...(await ensureCategoryKeys(database, ws)).created].sort()).toEqual(NEW_DEFAULTS);
    const all = await listAccounts(database, ws);
    const named = (name: string) => all.find((account) => account.name === name)!;
    expect(named('Gas')).toMatchObject({ kind: 'expense', subtype: 'category', systemKey: 'utilities.gas', parentId: named('Bills & Utilities').id });
    expect(named('Real Estate').parentId).toBe(named('Housing').id);
    expect(named('Gifts').parentId).toBe(named('Gifts & Donations').id);
    expect(named('Donations').parentId).toBe(named('Gifts & Donations').id);
    expect(named('Government & Taxes')).toMatchObject({ kind: 'expense', parentId: null, systemKey: 'government' });
    expect(named('Business & Invoices')).toMatchObject({ kind: 'expense', parentId: null, systemKey: 'business' });
    expect(named('Sports & Fitness')).toMatchObject({ systemKey: 'entertainment.sports', parentId: named('Entertainment').id });
  });

  it('skips a renamed default and does not recreate it', async () => {
    const { database, ws } = await v0Workspace();
    await database.execScript(`UPDATE accounts SET name = 'Supermarket' WHERE name = 'Groceries'`);
    const result = await ensureCategoryKeys(database, ws);
    expect(result.keyed).not.toContain('food.groceries');
    expect(result.created).not.toContain('food.groceries');
    const names = (await listAccounts(database, ws)).map((account) => account.name);
    expect(names).toContain('Supermarket');
    expect(names).not.toContain('Groceries');
    expect(await categoryIdsByKey(database, ws)).not.toHaveProperty(['food.groceries']);
  });

  it('neither keys nor creates children under a renamed parent', async () => {
    const { database, ws } = await v0Workspace();
    await database.execScript(`UPDATE accounts SET name = 'Bills' WHERE name = 'Bills & Utilities'`);
    const result = await ensureCategoryKeys(database, ws);
    expect(result.keyed.filter((key) => key.startsWith('utilities'))).toEqual([]);
    expect(result.created).not.toContain('utilities.gas');
  });

  it('changes nothing on a second run, even after a created category is archived', async () => {
    const { database, ws } = await v0Workspace();
    await ensureCategoryKeys(database, ws);
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
    await database.execScript(`UPDATE accounts SET archived_at = ${ARCHIVED} WHERE system_key = 'utilities.gas'`);
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
  });

  it('leaves a new workspace unchanged', async () => {
    current = await setupDb();
    expect(await ensureCategoryKeys(current.database, current.ws)).toEqual({ keyed: [], created: [] });
  });
});

describe('categoryIdsByKey', () => {
  it('returns only keyed, active categories of the workspace', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const all = await listAccounts(database, ws);
    await database.execScript(`UPDATE accounts SET archived_at = ${ARCHIVED} WHERE system_key = 'fees.interest'`);
    const ids = await categoryIdsByKey(database, ws);
    expect(Object.keys(ids).sort()).toEqual(ALL_KEYS.filter((key) => key !== 'fees.interest'));
    expect(ids['food.groceries']).toBe(all.find((account) => account.name === 'Groceries')!.id);
    expect(ids).not.toHaveProperty('opening_balance');
    const other = await createWorkspace(database, { name: 'Travel', type: 'travel', baseCurrency: 'IDR' });
    expect((await categoryIdsByKey(database, other)).food).not.toBe(ids.food);
  });
});
