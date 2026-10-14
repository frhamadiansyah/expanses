import { DEFAULT_CATEGORIES } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  archiveBook,
  contextOf,
  createBook,
  createDatabase,
  createWorkspace,
  type Database,
  ensureCategoryKeys,
  listWorkspaces,
  migrate,
  MIGRATIONS,
  personalBook,
} from '../src/index';
import { defaultCategoryIdOf } from '../src/repos/categories';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/*
 * Travel's Transport, Souvenirs and Others: built in for a new workspace, and added to the Travel of every book an
 * existing workspace already has when the app opens on the new version — once, under an id every device works out
 * alike, and never on top of a Travel that was put away or a child of the same name that was already there.
 */

const ADDED = ['travel.transport', 'travel.souvenirs', 'travel.others'] as const;
const ARCHIVED = "'2026-09-11T00:00:00.000Z'";

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

type Row = { id: string; key: string | null; name: string; parent: string | null; sort: number; archived: string | null };

/** Every category in one book (or, before books, the workspace), with its parent's key. */
async function categoriesOf(database: Database, bookId: string): Promise<Row[]> {
  const rows = await database.db.values<[string, string | null, string, string | null, number, string | null]>(sql`
    SELECT a.id, a.system_key, a.name, p.system_key, a.sort_order, a.archived_at
      FROM accounts a
      JOIN book_categories b ON b.category_account_id = a.id
      LEFT JOIN accounts p ON p.id = a.parent_id
     WHERE b.book_id = ${bookId} AND a.subtype = 'category'`);
  return rows.map(([id, key, name, parent, sort, archived]) => ({ id, key, name, parent, sort: Number(sort), archived }));
}

const travelChildren = (rows: Row[]) =>
  rows
    .filter((row) => row.parent === 'travel')
    .sort((a, b) => a.sort - b.sort)
    .map((row) => [row.key, row.name]);

/** Takes the three out again, as a workspace made before they were built in held it. */
async function asBeforeTheUpgrade(database: Database): Promise<void> {
  const keys = ADDED.map((key) => `'${key}'`).join(', ');
  await database.execScript(`
    DELETE FROM book_categories WHERE category_account_id IN (SELECT id FROM accounts WHERE system_key IN (${keys}));
    DELETE FROM accounts WHERE system_key IN (${keys});`);
}

describe('Travel sub-categories', () => {
  it('are built in, after Activities, for a new workspace', async () => {
    const travel = DEFAULT_CATEGORIES.find((category) => category.key === 'travel')!;
    expect(travel.children!.map((child) => [child.key, child.name])).toEqual([
      ['travel.flights', 'Flights'],
      ['travel.hotels', 'Hotels'],
      ['travel.activities', 'Activities'],
      ['travel.transport', 'Transport'],
      ['travel.souvenirs', 'Souvenirs'],
      ['travel.others', 'Others'],
    ]);

    const db = await setupDb();
    executor = db.executor;
    const book = await personalBook(db.database, db.ws);
    expect(travelChildren(await categoriesOf(db.database, book.id))).toEqual(travel.children!.map((child) => [child.key, child.name]));
    // Nothing is left for the app's open to add.
    expect(await ensureCategoryKeys(db.database, db.ws)).toEqual({ keyed: [], created: [] });
  });

  it('are added once to a workspace from before books, under ids worked out from its Personal book', async () => {
    // A database from before migration 0042: its Personal book is named 'book-' + the workspace id by the migration.
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 41));
    await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    await asBeforeTheUpgradeWithoutBooks(database);
    await migrate(database);
    const ws = contextOf((await listWorkspaces(database))[0]!);
    const book = await personalBook(database, ws);
    expect(book.id).toBe(`book-${ws.workspaceId}`);

    const result = await ensureCategoryKeys(database, ws);
    expect(result.created).toEqual([...ADDED]);

    const rows = await categoriesOf(database, book.id);
    expect(travelChildren(rows)).toEqual([
      ['travel.flights', 'Flights'],
      ['travel.hotels', 'Hotels'],
      ['travel.activities', 'Activities'],
      ['travel.transport', 'Transport'],
      ['travel.souvenirs', 'Souvenirs'],
      ['travel.others', 'Others'],
    ]);
    for (const key of ADDED) expect(rows.find((row) => row.key === key)!.id).toBe(await defaultCategoryIdOf(book.id, key));

    // Run again — the app opens every day — and nothing more is made.
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
    expect((await categoriesOf(database, book.id)).filter((row) => row.parent === 'travel')).toHaveLength(6);
  });

  it('are added to the Travel of every book that has one, and only there', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const personal = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    const empty = await createBook(database, ws, { name: 'Side', kind: 'family', baseCurrency: 'IDR' });
    const archived = await createBook(database, ws, { name: 'Old', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    await archiveBook(database, ws, archived);

    const result = await ensureCategoryKeys(database, ws);
    expect(result.created).toEqual([...ADDED, ...ADDED]);

    for (const bookId of [personal.id, business]) {
      const rows = await categoriesOf(database, bookId);
      const travel = rows.find((row) => row.key === 'travel')!;
      for (const key of ADDED) {
        const made = rows.filter((row) => row.key === key);
        expect(made).toHaveLength(1);
        expect(made[0]!.id).toBe(await defaultCategoryIdOf(bookId, key));
        expect(made[0]!.parent).toBe('travel');
        expect(travel).toBeDefined();
      }
    }
    // A book with no Travel gets no Travel children, and an archived book is left as it was put away.
    expect((await categoriesOf(database, empty)).filter((row) => row.key?.startsWith('travel'))).toEqual([]);
    expect((await categoriesOf(database, archived)).filter((row) => ADDED.includes(row.key as (typeof ADDED)[number]))).toEqual([]);

    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
  });

  it('are not added under a Travel that was archived', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    await database.execScript(`UPDATE accounts SET archived_at = ${ARCHIVED} WHERE system_key LIKE 'travel%'`);

    expect((await ensureCategoryKeys(database, ws)).created).toEqual([]);
    expect(travelChildren(await categoriesOf(database, book.id))).toEqual([
      ['travel.flights', 'Flights'],
      ['travel.hotels', 'Hotels'],
      ['travel.activities', 'Activities'],
    ]);
  });

  it('take over a child of the same name already under Travel instead of making a second one', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    // Made by hand before the upgrade: one spelled the same but for case, one archived.
    const travelId = (await categoriesOf(database, book.id)).find((row) => row.key === 'travel')!.id;
    await database.execScript(`
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, valuation_mode, sort_order, archived_at, created_at) VALUES
        ('own-souvenirs', '${ws.workspaceId}', '${travelId}', 'expense', 'category', 'souvenirs ', 'derived', 3, NULL, '2026-09-01T00:00:00Z'),
        ('own-others', '${ws.workspaceId}', '${travelId}', 'expense', 'category', 'Others', 'derived', 4, ${ARCHIVED}, '2026-09-01T00:00:00Z');
      INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES
        ('own-souvenirs', '${ws.workspaceId}', '${book.id}'),
        ('own-others', '${ws.workspaceId}', '${book.id}');`);

    const result = await ensureCategoryKeys(database, ws);
    expect(result.created).toEqual(['travel.transport']);
    expect(result.keyed.sort()).toEqual(['travel.others', 'travel.souvenirs']);

    const children = (await categoriesOf(database, book.id)).filter((row) => row.parent === 'travel').sort((a, b) => a.sort - b.sort);
    expect(children.map((row) => [row.id, row.key, row.name, row.archived])).toEqual([
      [expect.any(String), 'travel.flights', 'Flights', null],
      [expect.any(String), 'travel.hotels', 'Hotels', null],
      [expect.any(String), 'travel.activities', 'Activities', null],
      ['own-souvenirs', 'travel.souvenirs', 'souvenirs ', null],
      ['own-others', 'travel.others', 'Others', ARCHIVED.slice(1, -1)],
      [await defaultCategoryIdOf(book.id, 'travel.transport'), 'travel.transport', 'Transport', null],
    ]);
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
  });

  it('are made under the renamed Travel, since the key is what names it', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    await database.execScript(`UPDATE accounts SET name = 'Holidays' WHERE system_key = 'travel'`);
    expect((await ensureCategoryKeys(database, ws)).created).toEqual([...ADDED]);
    expect(travelChildren(await categoriesOf(database, book.id)).slice(3)).toEqual(ADDED.map((key, i) => [key, ['Transport', 'Souvenirs', 'Others'][i]]));
  });
});

/** The same as `asBeforeTheUpgrade`, for a database with no book tables yet. */
async function asBeforeTheUpgradeWithoutBooks(database: Database): Promise<void> {
  await database.execScript(`DELETE FROM accounts WHERE system_key IN (${ADDED.map((key) => `'${key}'`).join(', ')})`);
}
