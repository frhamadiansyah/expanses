import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addSetCategory,
  archiveAccount,
  categoryIdsByKey,
  CategoryLookError,
  createAccount,
  createBook,
  createCategorySet,
  createDatabase,
  createWorkspace,
  inBook,
  listAccounts,
  listCategoryColours,
  migrate,
  MIGRATIONS,
  moveCategory,
  setCategoryColour,
  setCategoryIcon,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
let bare: NodeExecutor | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
  bare?.close();
  bare = undefined;
});

async function setup() {
  current = await setupDb();
  const { database, ws } = current;
  const keys = await categoryIdsByKey(database, ws);
  const make = async (name: string, parentId: string | null = null, kind: 'expense' | 'income' = 'expense') =>
    (await createAccount(database, ws, { name, kind, subtype: 'category', currency: null, parentId })).id;
  return { ...current, keys, make };
}

const parentOf = async (t: TestDb, id: string) => (await listAccounts(t.database, t.ws, { includeArchived: true })).find((a) => a.id === id)!.parentId;

const refusal = (promise: Promise<unknown>, code: CategoryLookError['code']) =>
  expect(promise).rejects.toSatisfy((e: unknown) => e instanceof CategoryLookError && e.code === code && e.message.length > 0);

describe('migration 0059', () => {
  it('is version 59 and named category_colours', () => {
    expect(MIGRATIONS.find((m) => m.version === 59)).toMatchObject({ name: 'category_colours' });
  });

  it('adds an empty table to a database stopped at 55, and refuses a colour that is not #rrggbb', async () => {
    bare = createNodeExecutor();
    const database = createDatabase(bare);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 55));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    expect(await listCategoryColours(database, ws)).toEqual({});
    const food = (await categoryIdsByKey(database, ws)).food_beverage!;
    await refusal(setCategoryColour(database, ws, food, '#dc2626'), 'NO_TABLES');

    expect(await migrate(database)).toContain(59);
    await setCategoryColour(database, ws, food, '#dc2626');
    expect(await listCategoryColours(database, ws)).toEqual({ [food]: '#dc2626' });
    await expect(database.execScript(`INSERT INTO category_colours (category_account_id, workspace_id, colour) VALUES ('x', 'w', 'red')`)).rejects.toThrow();
    await expect(database.execScript(`INSERT INTO category_colours (category_account_id, workspace_id, colour) VALUES ('x', 'w', '#DC2626')`)).rejects.toThrow();
  });
});

describe('moveCategory', () => {
  it('files a top-level category under another, and back to the top', async () => {
    const t = await setup();
    const mine = await t.make('Syalala');
    await moveCategory(t.database, t.ws, mine, t.keys.food_beverage!);
    expect(await parentOf(t, mine)).toBe(t.keys.food_beverage);
    await moveCategory(t.database, t.ws, mine, null);
    expect(await parentOf(t, mine)).toBeNull();
  });

  it('moves a subcategory from one parent to another', async () => {
    const t = await setup();
    const restaurants = t.keys['food_beverage.restaurants']!;
    await moveCategory(t.database, t.ws, restaurants, t.keys.entertainment!);
    expect(await parentOf(t, restaurants)).toBe(t.keys.entertainment);
  });

  it('drops the colour of a category that gains a parent', async () => {
    const t = await setup();
    const mine = await t.make('Syalala');
    await setCategoryColour(t.database, t.ws, mine, '#7c3aed');
    await moveCategory(t.database, t.ws, mine, t.keys.food_beverage!);
    expect(await listCategoryColours(t.database, t.ws)).toEqual({});
  });

  it('refuses every move that would break the tree', async () => {
    const t = await setup();
    const mine = await t.make('Syalala');
    const withChild = await t.make('Hobbies');
    await t.make('Lego', withChild);
    const salary = t.keys['income.salary']!;
    const incomeTop = await t.make('Side gigs', null, 'income');

    await refusal(moveCategory(t.database, t.ws, 'nope', null), 'NOT_FOUND');
    const bank = await createAccount(t.database, t.ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await refusal(moveCategory(t.database, t.ws, bank.id, t.keys.food_beverage!), 'NOT_A_CATEGORY');
    await refusal(moveCategory(t.database, t.ws, mine, mine), 'SELF');
    await refusal(moveCategory(t.database, t.ws, mine, 'nope'), 'PARENT_NOT_FOUND');
    await refusal(moveCategory(t.database, t.ws, mine, bank.id), 'PARENT_NOT_FOUND');
    await refusal(moveCategory(t.database, t.ws, mine, incomeTop), 'PARENT_KIND');
    await refusal(moveCategory(t.database, t.ws, salary, t.keys.food_beverage!), 'PARENT_KIND');
    await refusal(moveCategory(t.database, t.ws, mine, t.keys['food_beverage.restaurants']!), 'PARENT_NOT_TOP');
    await refusal(moveCategory(t.database, t.ws, withChild, t.keys.food_beverage!), 'HAS_SUBCATEGORIES');
    await expect(moveCategory(t.database, t.ws, withChild, t.keys.food_beverage!)).rejects.toThrow('Move or archive its subcategories first');

    const gone = await t.make('Gone');
    await archiveAccount(t.database, t.ws, gone);
    await refusal(moveCategory(t.database, t.ws, mine, gone), 'PARENT_ARCHIVED');
    await refusal(moveCategory(t.database, t.ws, gone, null), 'ARCHIVED');

    const setId = await createCategorySet(t.database, t.ws, 'Wedding');
    const catering = await addSetCategory(t.database, t.ws, setId, 'Catering');
    await refusal(moveCategory(t.database, t.ws, catering, t.keys.food_beverage!), 'IN_A_SET');
    await refusal(moveCategory(t.database, t.ws, mine, catering), 'PARENT_IN_A_SET');

    // Nothing moved on any refusal.
    expect(await parentOf(t, mine)).toBeNull();
    expect(await parentOf(t, withChild)).toBeNull();
  });

  it('lets a parent with only archived subcategories move', async () => {
    const t = await setup();
    const withChild = await t.make('Hobbies');
    await archiveAccount(t.database, t.ws, await t.make('Lego', withChild));
    await moveCategory(t.database, t.ws, withChild, t.keys.entertainment!);
    expect(await parentOf(t, withChild)).toBe(t.keys.entertainment);
  });

  it('keeps a move inside one book, and a book to its own categories', async () => {
    const t = await setup();
    const biz = await createBook(t.database, t.ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const inBiz = inBook(t.ws, biz);
    const bizTop = (await createAccount(t.database, inBiz, { name: 'Stock', kind: 'expense', subtype: 'category', currency: null })).id;
    const personalTop = await t.make('Syalala');
    await refusal(moveCategory(t.database, t.ws, personalTop, bizTop), 'PARENT_OTHER_BOOK');
    await refusal(moveCategory(t.database, inBiz, personalTop, null), 'OTHER_BOOK');
  });

  it('refuses a category of another workspace', async () => {
    const t = await setup();
    const other = await createWorkspace(t.database, { name: 'Other', type: 'personal', baseCurrency: 'IDR' });
    const theirs = (await categoryIdsByKey(t.database, other)).food_beverage!;
    const mine = await t.make('Syalala');
    await refusal(moveCategory(t.database, t.ws, theirs, null), 'NOT_FOUND');
    await refusal(moveCategory(t.database, t.ws, mine, theirs), 'PARENT_NOT_FOUND');
  });
});

describe('setCategoryIcon', () => {
  it('sets an icon of its own, and clears it back to inheriting', async () => {
    const t = await setup();
    const mine = await t.make('Syalala');
    await setCategoryIcon(t.database, t.ws, mine, 'coffee');
    const icon = async () => (await listAccounts(t.database, t.ws)).find((a) => a.id === mine)!.icon;
    expect(await icon()).toBe('coffee');
    await setCategoryIcon(t.database, t.ws, mine, null);
    expect(await icon()).toBeNull();
  });

  it('refuses a name that is not an icon name, and a category it cannot change', async () => {
    const t = await setup();
    const mine = await t.make('Syalala');
    await refusal(setCategoryIcon(t.database, t.ws, mine, 'Coffee Cup'), 'BAD_ICON');
    await refusal(setCategoryIcon(t.database, t.ws, mine, '<svg>'), 'BAD_ICON');
    await refusal(setCategoryIcon(t.database, t.ws, mine, ''), 'BAD_ICON');
    await refusal(setCategoryIcon(t.database, t.ws, 'nope', 'coffee'), 'NOT_FOUND');
    const bank = await createAccount(t.database, t.ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await refusal(setCategoryIcon(t.database, t.ws, bank.id, 'coffee'), 'NOT_A_CATEGORY');
    await archiveAccount(t.database, t.ws, mine);
    await refusal(setCategoryIcon(t.database, t.ws, mine, 'coffee'), 'ARCHIVED');
  });
});

describe('setCategoryColour', () => {
  it('picks a palette colour for a top-level category, and goes back to automatic', async () => {
    const t = await setup();
    const food = t.keys.food_beverage!;
    await setCategoryColour(t.database, t.ws, food, '#2563eb');
    await setCategoryColour(t.database, t.ws, food, '#16a34a');
    expect(await listCategoryColours(t.database, t.ws)).toEqual({ [food]: '#16a34a' });
    await setCategoryColour(t.database, t.ws, food, null);
    expect(await listCategoryColours(t.database, t.ws)).toEqual({});
  });

  it('reads only its own workspace', async () => {
    const t = await setup();
    await setCategoryColour(t.database, t.ws, t.keys.food_beverage!, '#2563eb');
    const other = await createWorkspace(t.database, { name: 'Other', type: 'personal', baseCurrency: 'IDR' });
    expect(await listCategoryColours(t.database, other)).toEqual({});
  });

  it('refuses a colour off the palette, a subcategory, a set category and another workspace’s', async () => {
    const t = await setup();
    const food = t.keys.food_beverage!;
    await refusal(setCategoryColour(t.database, t.ws, food, '#123456'), 'BAD_COLOUR');
    await refusal(setCategoryColour(t.database, t.ws, food, 'red'), 'BAD_COLOUR');
    await refusal(setCategoryColour(t.database, t.ws, t.keys['food_beverage.restaurants']!, '#2563eb'), 'NOT_TOP_LEVEL');
    const setId = await createCategorySet(t.database, t.ws, 'Wedding');
    await refusal(setCategoryColour(t.database, t.ws, await addSetCategory(t.database, t.ws, setId, 'Catering'), '#2563eb'), 'IN_A_SET');
    const other = await createWorkspace(t.database, { name: 'Other', type: 'personal', baseCurrency: 'IDR' });
    await refusal(setCategoryColour(t.database, t.ws, (await categoryIdsByKey(t.database, other)).food_beverage!, '#2563eb'), 'NOT_FOUND');
    const rows = await t.database.db.values<[number]>(sql`SELECT count(*) FROM category_colours`);
    expect(Number(rows[0]![0])).toBe(0);
  });
});
