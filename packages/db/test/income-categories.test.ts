import { categoryVisual, DEFAULT_CATEGORIES } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCategoryStart,
  createBook,
  createDatabase,
  createWorkspace,
  type Database,
  ensureCategoryKeys,
  migrate,
  MIGRATIONS,
  personalBook,
  type WorkspaceContext,
} from '../src/index';
import { defaultCategoryIdOf } from '../src/repos/categories';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/*
 * Income categories (owner, 16 Nov 2026): Salary, Bonus and Gifts Received get clearer names, by migration 0117 and only
 * where the owner kept the app's name; "Side business and selling" is new, built in for a new workspace and added on
 * open to every book of an existing one that still holds the personal income list, before Other Income.
 */

const SIDE = 'income.side_business';
const ARCHIVED = "'2026-11-01T00:00:00.000Z'";

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

type Row = { id: string; key: string | null; name: string; sort: number; archived: string | null };

/** The top-level income categories of one book, in the order the app lists them. */
async function incomeOf(database: Database, bookId: string): Promise<Row[]> {
  const rows = await database.db.values<[string, string | null, string, number, string | null]>(sql`
    SELECT a.id, a.system_key, a.name, a.sort_order, a.archived_at
      FROM accounts a JOIN book_categories b ON b.category_account_id = a.id
     WHERE b.book_id = ${bookId} AND a.subtype = 'category' AND a.kind = 'income' AND a.parent_id IS NULL
     ORDER BY a.sort_order, a.id`);
  return rows.map(([id, key, name, sort, archived]) => ({ id, key, name, sort: Number(sort), archived }));
}

const open = (rows: Row[]) => rows.filter((row) => row.archived === null).map((row) => row.name);

/** A workspace as an older build left it: the old three names, no Side business, and 0117 not run yet. Not captured. */
async function asBeforeTheUpgrade(database: Database): Promise<void> {
  await database.execScript(`
    UPDATE accounts SET name = 'Salary' WHERE system_key = 'income.salary';
    UPDATE accounts SET name = 'Bonus' WHERE system_key = 'income.bonus';
    UPDATE accounts SET name = 'Gifts Received' WHERE system_key = 'income.gifts';
    DELETE FROM book_categories WHERE category_account_id IN (SELECT id FROM accounts WHERE system_key = '${SIDE}');
    DELETE FROM accounts WHERE system_key = '${SIDE}';
    DELETE FROM schema_migrations WHERE version = 117;`);
}

const OLD_LIST = ['Salary', 'Bonus', 'Investment Income', 'Realized Gains', 'Cashback & Rewards', 'Gifts Received', 'Other Income'];
const NEW_LIST = ['Salary, wage, or pay', 'Bonus and benefits', 'Investment Income', 'Realized Gains', 'Cashback & Rewards', 'Gifts, awards, and grants', 'Side business and selling', 'Other Income'];

describe('the built-in income list', () => {
  it('is the owner-approved eight, in order, keys unchanged', () => {
    expect(DEFAULT_CATEGORIES.filter((category) => category.kind === 'income').map((category) => [category.key, category.name])).toEqual([
      ['income.salary', 'Salary, wage, or pay'],
      ['income.bonus', 'Bonus and benefits'],
      ['income.investment', 'Investment Income'],
      ['income.realized_gains', 'Realized Gains'],
      ['income.cashback', 'Cashback & Rewards'],
      ['income.gifts', 'Gifts, awards, and grants'],
      [SIDE, 'Side business and selling'],
      ['income.other', 'Other Income'],
    ]);
  });

  it('draws Side business with the store icon in the income colour', () => {
    expect(categoryVisual(SIDE, SIDE)).toEqual({ icon: 'store', colour: categoryVisual('income.salary', 'income.salary').colour });
  });

  it('is what a new workspace starts with, and its first open adds nothing', async () => {
    const db = await setupDb();
    executor = db.executor;
    const book = await personalBook(db.database, db.ws);
    expect(open(await incomeOf(db.database, book.id))).toEqual(NEW_LIST);
    expect(await ensureCategoryKeys(db.database, db.ws)).toEqual({ keyed: [], created: [] });
  });
});

describe('migration 0117 (income category names)', () => {
  async function before0117(): Promise<{ database: Database; ws: WorkspaceContext }> {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version < 117));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    await asBeforeTheUpgrade(database);
    return { database, ws };
  }

  it('is version 117 and named income_category_names', () => {
    expect(MIGRATIONS.find((m) => m.version === 117)).toMatchObject({ name: 'income_category_names' });
  });

  it('renames the three in every book where the app’s name is kept, and keeps ids and keys', async () => {
    const { database, ws } = await before0117();
    const personal = await personalBook(database, ws);
    const business = await createBook(database, ws, { name: 'Side shop', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    const before = { personal: await incomeOf(database, personal.id), business: await incomeOf(database, business) };
    expect(open(before.personal)).toEqual(OLD_LIST);

    expect(await migrate(database)).toEqual(MIGRATIONS.map((m) => m.version).filter((v) => v >= 117));

    for (const [bookId, rows] of [[personal.id, before.personal], [business, before.business]] as const) {
      const after = await incomeOf(database, bookId);
      expect(after.map((row) => [row.id, row.key])).toEqual(rows.map((row) => [row.id, row.key]));
      expect(open(after)).toEqual(NEW_LIST.filter((name) => name !== 'Side business and selling'));
    }
  });

  it('never overwrites a name the owner changed, even by case, nor an unkeyed category of the same name', async () => {
    const { database, ws } = await before0117();
    const personal = await personalBook(database, ws);
    await database.execScript(`
      UPDATE accounts SET name = 'Gaji pokok' WHERE system_key = 'income.salary';
      UPDATE accounts SET name = 'bonus' WHERE system_key = 'income.bonus';
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, valuation_mode, sort_order, created_at)
        VALUES ('own-gifts', '${ws.workspaceId}', NULL, 'income', 'category', 'Gifts Received', 'derived', 40, '2026-09-01T00:00:00Z');
      INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES ('own-gifts', '${ws.workspaceId}', '${personal.id}');
      UPDATE accounts SET system_key = NULL WHERE system_key = 'income.gifts';`);

    await migrate(database);

    const rows = await incomeOf(database, personal.id);
    expect(rows.find((row) => row.key === 'income.salary')?.name).toBe('Gaji pokok');
    expect(rows.find((row) => row.key === 'income.bonus')?.name).toBe('bonus');
    expect(rows.filter((row) => row.name === 'Gifts Received')).toHaveLength(2);
    expect(rows.filter((row) => row.key === 'income.gifts')).toEqual([]);
  });

  it('moves a kept name with its row, so a share coming back does not take the rename for a change made while down', async () => {
    const { database, ws } = await before0117();
    const personal = await personalBook(database, ws);
    const rows = await incomeOf(database, personal.id);
    const salary = rows.find((row) => row.key === 'income.salary')!.id;
    const bonus = rows.find((row) => row.key === 'income.bonus')!.id;
    await database.execScript(`
      UPDATE accounts SET name = 'Tunjangan' WHERE id = '${bonus}';
      INSERT INTO sync_kept_clocks (book_id, entity, id, field, hlc, value_json) VALUES
        ('${personal.id}', 'category', '${salary}', 'name', 'h1', '"Salary"'),
        ('${personal.id}', 'category', '${salary}', 'icon', 'h1', 'null'),
        ('${personal.id}', 'category', '${bonus}', 'name', 'h1', '"Bonus"');`);

    await migrate(database);

    const kept = await database.db.values<[string, string, string]>(sql`SELECT id, field, value_json FROM sync_kept_clocks ORDER BY id, field`);
    expect(kept).toEqual(
      [
        [salary, 'icon', 'null'],
        [salary, 'name', '"Salary, wage, or pay"'],
        // Renamed by hand while the share was down: that change is still told apart, and still goes out.
        [bonus, 'name', '"Bonus"'],
      ].sort((a, b) => (a[0]! + a[1]! < b[0]! + b[1]! ? -1 : 1)),
    );
  });

  it('writes nothing to send', async () => {
    const { database } = await before0117();
    await migrate(database);
    expect(await database.db.values(sql`SELECT * FROM sync_outbox`)).toEqual([]);
  });
});

describe('Side business and selling on open', () => {
  it('is added once to every book of an existing workspace, before Other Income, under the id worked out from the book', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const personal = await personalBook(database, ws);
    const second = await createBook(database, ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    await asBeforeTheUpgrade(database);
    await migrate(database);

    const result = await ensureCategoryKeys(database, ws);
    expect(result).toEqual({ keyed: [], created: [SIDE, SIDE] });
    for (const bookId of [personal.id, second]) {
      const rows = await incomeOf(database, bookId);
      expect(open(rows)).toEqual(NEW_LIST);
      expect(rows.find((row) => row.key === SIDE)?.id).toBe(await defaultCategoryIdOf(bookId, SIDE));
    }

    const once = await incomeOf(database, personal.id);
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
    expect(await incomeOf(database, personal.id)).toEqual(once);
  });

  it('goes before Other Income with the owner’s own income categories left where they were', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const personal = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    await database.execScript(`
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, valuation_mode, sort_order, created_at)
        VALUES ('own-rent', '${ws.workspaceId}', NULL, 'income', 'category', 'Kos rental', 'derived', 30, '2026-09-01T00:00:00Z');
      INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES ('own-rent', '${ws.workspaceId}', '${personal.id}');`);

    await ensureCategoryKeys(database, ws);
    expect(open(await incomeOf(database, personal.id)).slice(-3)).toEqual(['Side business and selling', 'Kos rental', 'Other Income']);
  });

  it('takes over an unkeyed top-level income category of the same name instead of making a second', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const personal = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    await database.execScript(`
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, valuation_mode, sort_order, created_at)
        VALUES ('own-side', '${ws.workspaceId}', NULL, 'income', 'category', 'side business and selling', 'derived', 30, '2026-09-01T00:00:00Z');
      INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES ('own-side', '${ws.workspaceId}', '${personal.id}');`);

    const result = await ensureCategoryKeys(database, ws);
    expect(result).toEqual({ keyed: [SIDE], created: [] });
    const side = (await incomeOf(database, personal.id)).filter((row) => row.name.toLowerCase() === 'side business and selling');
    expect(side.map((row) => [row.id, row.key, row.name])).toEqual([['own-side', SIDE, 'side business and selling']]);
  });

  it('is not added to a book whose personal income list was put away (an empty or business start)', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const personal = await personalBook(database, ws);
    const empty = await createBook(database, ws, { name: 'Blank', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    const shop = await createBook(database, ws, { name: 'Shop', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    await applyCategoryStart(database, ws, { bookId: empty, start: 'empty' });
    await applyCategoryStart(database, ws, { bookId: shop, start: 'business' });
    await asBeforeTheUpgrade(database);
    await migrate(database);

    expect((await ensureCategoryKeys(database, ws)).created).toEqual([SIDE]);
    expect((await incomeOf(database, empty)).filter((row) => row.key === SIDE)).toEqual([]);
    expect((await incomeOf(database, shop)).filter((row) => row.key === SIDE)).toEqual([]);
    expect((await incomeOf(database, personal.id)).filter((row) => row.key === SIDE)).toHaveLength(1);
  });

  it('is not added where Salary was archived by hand, and is once it is back', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const personal = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    await database.execScript(`UPDATE accounts SET archived_at = ${ARCHIVED} WHERE system_key = 'income.salary'`);
    expect((await ensureCategoryKeys(database, ws)).created).toEqual([]);
    await database.execScript(`UPDATE accounts SET archived_at = NULL WHERE system_key = 'income.salary'`);
    expect((await ensureCategoryKeys(database, ws)).created).toEqual([SIDE]);
    expect((await incomeOf(database, personal.id)).filter((row) => row.key === SIDE)).toHaveLength(1);
  });
});

describe('keying a workspace from before keys', () => {
  it('still keys an unkeyed Salary, Bonus and Gifts Received by the names they had, and keeps those names', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const personal = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    await migrate(database);
    await database.execScript(`
      UPDATE accounts SET name = 'Salary' WHERE system_key = 'income.salary';
      UPDATE accounts SET system_key = NULL WHERE system_key IN ('income.salary', 'income.bonus', 'income.gifts');
      UPDATE accounts SET name = 'Bonus' WHERE kind = 'income' AND name = 'Bonus and benefits';`);

    const result = await ensureCategoryKeys(database, ws);
    expect(result.keyed.sort()).toEqual(['income.bonus', 'income.gifts', 'income.salary']);
    const rows = await incomeOf(database, personal.id);
    expect(rows.filter((row) => ['income.salary', 'income.bonus', 'income.gifts'].includes(row.key ?? '')).map((row) => [row.key, row.name])).toEqual([
      ['income.salary', 'Salary'],
      ['income.bonus', 'Bonus'],
      ['income.gifts', 'Gifts, awards, and grants'],
    ]);
  });
});
