import { expenseLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addSetCategory,
  budgetSheetFor,
  categoryIdsByKey,
  categorySetMembership,
  createAccount,
  createCategorySet,
  ensureCategoryKeys,
  ensureDefaultCategorySets,
  listAccounts,
  listCategorySets,
  listSetCategories,
  postTransaction,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const setNamed = async (db: TestDb, name: string) => (await listCategorySets(db.database, db.ws)).find((set) => set.name === name)!;

/** A workspace as the app opens it: migrated, then given the sets it does not have yet. */
async function opened(): Promise<TestDb> {
  const db = await setupDb();
  await ensureDefaultCategorySets(db.database, db.ws);
  return db;
}

describe('the sets a workspace starts with', () => {
  it('seeds Holiday, Newborn and Renovation with their categories', async () => {
    current = await opened();
    const sets = await listCategorySets(current.database, current.ws);
    expect(sets.map((set) => set.name)).toEqual(['Holiday', 'Newborn', 'Renovation']);

    const holiday = await listSetCategories(current.database, current.ws, (await setNamed(current, 'Holiday')).id);
    expect(holiday.map((row) => row.name)).toEqual([
      'Flights', 'Lodging', 'Activities', 'Transport', 'Meals', 'Shopping', 'Souvenirs', 'Miscellaneous', 'Business H', 'Intercity', 'Photo',
    ]);
    const renovation = await listSetCategories(current.database, current.ws, (await setNamed(current, 'Renovation')).id);
    expect(renovation[0]!.name).toBe('Design & Planning');
    expect(renovation).toHaveLength(10);
    const newborn = await listSetCategories(current.database, current.ws, (await setNamed(current, 'Newborn')).id);
    expect(newborn).toHaveLength(11);
  });

  it('keeps the categories of a set out of the monthly budget', async () => {
    current = await opened();
    const { database, ws } = current;
    const bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const flights = (await listSetCategories(database, ws, (await setNamed(current, 'Holiday')).id)).find((row) => row.name === 'Flights')!;

    await postTransaction(database, ws, {
      occurredOn: '2026-09-09',
      description: 'Garuda',
      lines: expenseLines({ categoryAccountId: flights.id, paymentAccountId: bca.id, amountMinor: 4_000_000, currency: 'IDR' }),
    });

    const sheet = await budgetSheetFor(database, ws, '2026-09');
    expect(sheet.lines.map((line) => line.name)).not.toContain('Flights');
  });
});

describe('set categories and the category keys', () => {
  /**
   * The seeds collide by name on purpose: Holiday has a root Shopping, Holiday and Renovation both
   * have a root Miscellaneous, and the monthly tree has roots of both names. Keys are matched by name
   * and parent, so a set category is exactly what could be keyed by mistake — and a keyed category is
   * what card rules are written against.
   */
  it('never keys a set category, even one named exactly like a monthly root', async () => {
    current = await opened();
    const { database, ws } = current;
    const monthly = (await listAccounts(database, ws)).filter((account) => account.subtype === 'category');
    const monthlyShopping = monthly.find((account) => account.systemKey === 'shopping')!;
    const monthlyMisc = monthly.find((account) => account.systemKey === 'miscellaneous')!;

    // A workspace from before keys existed: every category unkeyed, sets included.
    await database.execScript(`UPDATE accounts SET system_key = NULL WHERE subtype = 'category'`);
    await ensureCategoryKeys(database, ws);

    const ids = await categoryIdsByKey(database, ws);
    expect(ids.shopping).toBe(monthlyShopping.id);
    expect(ids.miscellaneous).toBe(monthlyMisc.id);

    const membership = await categorySetMembership(database, ws);
    for (const [key, id] of Object.entries(ids)) expect(membership[id], `${key} belongs to a set`).toBeUndefined();
  });
});

describe('seeding the defaults', () => {
  it('adds nothing on a second open, and leaves a renamed set alone', async () => {
    current = await opened();
    const { database, ws } = current;
    expect(await ensureDefaultCategorySets(database, ws)).toEqual([]);

    const holiday = await setNamed(current, 'Holiday');
    await database.execScript(`UPDATE category_sets SET name = 'Trips' WHERE id = '${holiday.id}'`);
    // Renaming is the owner's business; the default is a starting point, not something to restore.
    expect(await ensureDefaultCategorySets(database, ws)).toEqual(['Holiday']);
  });
});

describe('adding to a set', () => {
  it('adds a category that belongs to the set and not to the monthly tree', async () => {
    current = await opened();
    const { database, ws } = current;
    const setId = await createCategorySet(database, ws, 'Wedding');
    const id = await addSetCategory(database, ws, setId, 'Catering');

    expect((await listSetCategories(database, ws, setId)).map((row) => row.name)).toEqual(['Catering']);
    expect((await categorySetMembership(database, ws))[id]).toBe(setId);

    const sheet = await budgetSheetFor(database, ws, '2026-09');
    expect(sheet.lines.map((line) => line.name)).not.toContain('Catering');
  });
});
