import { afterEach, describe, expect, it } from 'vitest';
import {
  categoryIdsByKey,
  clearCategoryNeed,
  createAccount,
  createBook,
  createDatabase,
  createWorkspace,
  inBook,
  listAccounts,
  listBooks,
  listCategoryNeeds,
  migrate,
  MIGRATIONS,
  resolvedCategoryNeeds,
  saveCategoryNeed,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

describe('marking a category', () => {
  it('passes a parent’s mark to every child that has none of its own', async () => {
    const { database, ws } = await setupDb();
    const keys = await categoryIdsByKey(database, ws);
    await saveCategoryNeed(database, ws, keys['food_beverage']!, 'lifestyle');

    const resolved = await resolvedCategoryNeeds(database.db, ws);
    expect(resolved[keys['food_beverage.restaurants']!]).toBe('lifestyle');
    expect(resolved[keys['household.groceries']!]).toBe('essential');
    expect(await listCategoryNeeds(database, ws)).toEqual({ [keys['food_beverage']!]: 'lifestyle' });
  });

  it('lets a child keep its own mark, and clearing it hands it back to the parent', async () => {
    const { database, ws } = await setupDb();
    const keys = await categoryIdsByKey(database, ws);
    await saveCategoryNeed(database, ws, keys['food_beverage']!, 'lifestyle');
    await saveCategoryNeed(database, ws, keys['food_beverage.school_catering']!, 'essential');
    expect((await resolvedCategoryNeeds(database.db, ws))[keys['food_beverage.school_catering']!]).toBe('essential');

    await clearCategoryNeed(database, ws, keys['food_beverage.school_catering']!);
    expect((await resolvedCategoryNeeds(database.db, ws))[keys['food_beverage.school_catering']!]).toBe('lifestyle');
  });

  it('refuses what is not a spending category', async () => {
    const { database, ws } = await setupDb();
    const keys = await categoryIdsByKey(database, ws);
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await expect(saveCategoryNeed(database, ws, keys['income.salary']!, 'essential')).rejects.toMatchObject({ code: 'NOT_A_CATEGORY' });
    await expect(saveCategoryNeed(database, ws, bank.id, 'essential')).rejects.toMatchObject({ code: 'NOT_A_CATEGORY' });
    await expect(saveCategoryNeed(database, ws, 'nope', 'essential')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(saveCategoryNeed(database, ws, keys['food_beverage']!, 'luxury' as never)).rejects.toMatchObject({ code: 'BAD_NEED' });
  });

  it('refuses a category of another workspace’s book', async () => {
    const { database, ws } = await setupDb();
    const personal = (await listBooks(database, ws)).find((book) => book.kind === 'personal')!;
    const businessId = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    const businessRestaurants = (await categoryIdsByKey(database, inBook(ws, businessId)))['food_beverage.restaurants']!;

    await expect(saveCategoryNeed(database, inBook(ws, personal.id), businessRestaurants, 'lifestyle')).rejects.toMatchObject({ code: 'OTHER_BOOK' });
  });

  it('travels with a copied tree, onto the copy’s own ids', async () => {
    const { database, ws } = await setupDb();
    const personal = (await listBooks(database, ws)).find((book) => book.kind === 'personal')!;
    const personalKeys = await categoryIdsByKey(database, inBook(ws, personal.id));
    await saveCategoryNeed(database, inBook(ws, personal.id), personalKeys['food_beverage']!, 'lifestyle');

    const businessId = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    const businessKeys = await categoryIdsByKey(database, inBook(ws, businessId));
    expect(businessKeys['food_beverage']).not.toBe(personalKeys['food_beverage']);
    expect((await listCategoryNeeds(database, ws))[businessKeys['food_beverage']!]).toBe('lifestyle');
  });

  it('marks nothing on a database stopped before 0053, and refuses to write', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;

    expect(await listCategoryNeeds(database, ws)).toEqual({});
    expect((await resolvedCategoryNeeds(database.db, ws))[groceries]).toBe('essential');
    await expect(saveCategoryNeed(database, ws, groceries, 'lifestyle')).rejects.toMatchObject({ code: 'NO_TABLES' });
  });
});
