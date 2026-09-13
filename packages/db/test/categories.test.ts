import { DEFAULT_CATEGORY_KEYS } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { categoryIdsByKey, createWorkspace, ensureCategoryKeys, listAccounts } from '../src/index';
import { setupDb, type TestDb } from './helpers';

const NEW_DEFAULTS = ['business', 'donation.charity', 'donation.obligation', 'government_taxes.estimated_tax', 'income.realized_gains', 'personal_care.sports_fitness', 'property.real_estate', 'utilities.gas_energy'];
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
  // Children first: a parent cannot go while its child still points at it.
  await current.database.execScript(`DELETE FROM accounts WHERE system_key IN (${quoted}) AND parent_id IS NOT NULL`);
  await current.database.execScript(`DELETE FROM accounts WHERE system_key IN (${quoted}) AND parent_id IS NULL`);
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

  it('creates the defaults a workspace from before the catalogue never had', async () => {
    const { database, ws } = await v0Workspace();
    expect([...(await ensureCategoryKeys(database, ws)).created].sort()).toEqual(NEW_DEFAULTS);
    const all = await listAccounts(database, ws);
    const named = (name: string) => all.find((account) => account.name === name)!;
    expect(named('Gas & energy')).toMatchObject({ kind: 'expense', subtype: 'category', systemKey: 'utilities.gas_energy', parentId: named('Utilities').id });
    expect(named('Real estate').parentId).toBe(named('Property').id);
    expect(named('Charity').parentId).toBe(named('Donation').id);
    expect(named('Obligation').parentId).toBe(named('Donation').id);
    expect(named('Business & Invoices')).toMatchObject({ kind: 'expense', parentId: null, systemKey: 'business' });
    expect(named('Sports & fitness')).toMatchObject({ systemKey: 'personal_care.sports_fitness', parentId: named('Personal care').id });
  });

  it('skips a renamed default and does not recreate it', async () => {
    const { database, ws } = await v0Workspace();
    await database.execScript(`UPDATE accounts SET name = 'Supermarket' WHERE name = 'Groceries'`);
    const result = await ensureCategoryKeys(database, ws);
    expect(result.keyed).not.toContain('household.groceries');
    expect(result.created).not.toContain('household.groceries');
    const names = (await listAccounts(database, ws)).map((account) => account.name);
    expect(names).toContain('Supermarket');
    expect(names).not.toContain('Groceries');
    expect(await categoryIdsByKey(database, ws)).not.toHaveProperty(['household.groceries']);
  });

  it('neither keys nor creates children under a renamed parent', async () => {
    const { database, ws } = await v0Workspace();
    await database.execScript(`UPDATE accounts SET name = 'Bills' WHERE name = 'Utilities'`);
    const result = await ensureCategoryKeys(database, ws);
    expect(result.keyed.filter((key) => key.startsWith('utilities'))).toEqual([]);
    expect(result.created).not.toContain('utilities.gas_energy');
  });

  it('changes nothing on a second run, even after a created category is archived', async () => {
    const { database, ws } = await v0Workspace();
    await ensureCategoryKeys(database, ws);
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
    await database.execScript(`UPDATE accounts SET archived_at = ${ARCHIVED} WHERE system_key = 'utilities.gas_energy'`);
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
    await database.execScript(`UPDATE accounts SET archived_at = ${ARCHIVED} WHERE system_key = 'miscellaneous.interest'`);
    const ids = await categoryIdsByKey(database, ws);
    expect(Object.keys(ids).sort()).toEqual(ALL_KEYS.filter((key) => key !== 'miscellaneous.interest'));
    expect(ids['household.groceries']).toBe(all.find((account) => account.name === 'Groceries')!.id);
    expect(ids).not.toHaveProperty('opening_balance');
    const other = await createWorkspace(database, { name: 'Travel', type: 'travel', baseCurrency: 'IDR' });
    expect((await categoryIdsByKey(database, other)).food_beverage).not.toBe(ids.food_beverage);
  });
});
