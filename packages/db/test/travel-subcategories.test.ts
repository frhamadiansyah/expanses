import { DEFAULT_CATEGORIES } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  uncategorisedIdOf,
} from '../src/index';
import { defaultCategoryIdOf } from '../src/repos/categories';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/*
 * Travel's Transport, Souvenirs, Meals and Others: built in for a new workspace, and added to the Travel of every book an
 * existing workspace already has when the app opens on the new version — once, under an id every device works out
 * alike, and never on top of a Travel that was put away or a child of the same name that was already there.
 */

const ADDED = ['travel.transport', 'travel.souvenirs', 'travel.meals', 'travel.others'] as const;
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

/** Takes the four out again, as a workspace made before they were built in held it. */
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
      ['travel.meals', 'Meals'],
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
      ['travel.meals', 'Meals'],
      ['travel.others', 'Others'],
    ]);
    for (const key of ADDED) expect(rows.find((row) => row.key === key)!.id).toBe(await defaultCategoryIdOf(book.id, key));

    // Run again — the app opens every day — and nothing more is made.
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
    expect((await categoriesOf(database, book.id)).filter((row) => row.parent === 'travel')).toHaveLength(7);
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
    expect(result.created).toEqual(['travel.transport', 'travel.meals']);
    expect(result.keyed.sort()).toEqual(['travel.others', 'travel.souvenirs']);

    const children = (await categoriesOf(database, book.id)).filter((row) => row.parent === 'travel').sort((a, b) => a.sort - b.sort);
    expect(children.map((row) => [row.id, row.key, row.name, row.archived])).toEqual([
      [expect.any(String), 'travel.flights', 'Flights', null],
      [expect.any(String), 'travel.hotels', 'Hotels', null],
      [expect.any(String), 'travel.activities', 'Activities', null],
      ['own-souvenirs', 'travel.souvenirs', 'souvenirs ', null],
      [await defaultCategoryIdOf(book.id, 'travel.meals'), 'travel.meals', 'Meals', null],
      [await defaultCategoryIdOf(book.id, 'travel.transport'), 'travel.transport', 'Transport', null],
      ['own-others', 'travel.others', 'Others', ARCHIVED.slice(1, -1)],
    ]);
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
  });

  it("puts Meals before Others for an upgrade that already holds Transport, Souvenirs and Others, and leaves them in order", async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    // A workspace from build 14: everything but Meals, Others last.
    await database.execScript(`
      DELETE FROM book_categories WHERE category_account_id IN (SELECT id FROM accounts WHERE system_key = 'travel.meals');
      DELETE FROM accounts WHERE system_key = 'travel.meals';
      UPDATE accounts SET sort_order = 5 WHERE system_key = 'travel.others';`);

    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: ['travel.meals'] });
    const names = () => categoriesOf(database, book.id).then((rows) => travelChildren(rows).map(([, name]) => name));
    expect(await names()).toEqual(['Flights', 'Hotels', 'Activities', 'Transport', 'Souvenirs', 'Meals', 'Others']);
    const once = await categoriesOf(database, book.id);
    expect(once.find((row) => row.key === 'travel.meals')!.id).toBe(await defaultCategoryIdOf(book.id, 'travel.meals'));

    // Once: the next open changes nothing, sort order included.
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
    expect(await categoriesOf(database, book.id)).toEqual(once);
  });

  it('adopts an unkeyed "Meals" child under Travel instead of making a second one', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    const travelId = (await categoriesOf(database, book.id)).find((row) => row.key === 'travel')!.id;
    await database.execScript(`
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, valuation_mode, sort_order, created_at)
        VALUES ('own-meals', '${ws.workspaceId}', '${travelId}', 'expense', 'category', ' MEALS', 'derived', 3, '2026-09-01T00:00:00Z');
      INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES ('own-meals', '${ws.workspaceId}', '${book.id}');`);

    const result = await ensureCategoryKeys(database, ws);
    expect(result.keyed).toEqual(['travel.meals']);
    expect(result.created).not.toContain('travel.meals');
    const meals = (await categoriesOf(database, book.id)).filter((row) => row.parent === 'travel' && row.name.trim().toLowerCase() === 'meals');
    expect(meals.map((row) => [row.id, row.key])).toEqual([['own-meals', 'travel.meals']]);
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
    expect(travelChildren(await categoriesOf(database, book.id)).slice(3)).toEqual(ADDED.map((key, i) => [key, ['Transport', 'Souvenirs', 'Meals', 'Others'][i]]));
  });
});

describe('Travel sub-categories when adding them goes wrong', () => {
  it('skip the one book that failed, keep the rest of the open, and try that book again at the next open', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const personal = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    // Household sync's rule-4 Uncategorised, made without a key: the open keys it whatever happens to the Travel pass.
    const ruleFour = await uncategorisedIdOf(personal.id, 'expense');
    await database.execScript(`
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, valuation_mode, sort_order, created_at)
        VALUES ('${ruleFour}', '${ws.workspaceId}', NULL, 'expense', 'category', 'Uncategorised', 'derived', 999, '2026-10-01T00:00:00Z');
      INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES ('${ruleFour}', '${ws.workspaceId}', '${personal.id}');`);
    // Business's Souvenirs cannot be written: its Transport, made first in the same book, must not stay behind alone.
    const failing = await defaultCategoryIdOf(business, 'travel.souvenirs');
    await database.execScript(`CREATE TRIGGER refuse_souvenirs BEFORE INSERT ON accounts WHEN NEW.id = '${failing}' BEGIN SELECT RAISE(ABORT, 'forced'); END;`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await ensureCategoryKeys(database, ws);
      expect(result.created).toEqual([...ADDED]);
      expect(result.keyed).toContain('uncategorised');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
    expect((await categoriesOf(database, personal.id)).filter((row) => ADDED.includes(row.key as (typeof ADDED)[number]))).toHaveLength(4);
    expect((await categoriesOf(database, personal.id)).find((row) => row.id === ruleFour)?.key).toBe('uncategorised');
    expect((await categoriesOf(database, business)).filter((row) => ADDED.includes(row.key as (typeof ADDED)[number]))).toEqual([]);

    await database.execScript('DROP TRIGGER refuse_souvenirs');
    expect((await ensureCategoryKeys(database, ws)).created).toEqual([...ADDED]);
    expect((await categoriesOf(database, business)).filter((row) => ADDED.includes(row.key as (typeof ADDED)[number]))).toHaveLength(4);
  });

  it('still reach the books of this device when the first open book is one it joined', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const personal = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    // Personal put away by hand and a joined book listed first: the open's "Personal" is then the joined book.
    await database.execScript(`
      UPDATE books SET archived_at = ${ARCHIVED} WHERE id = '${personal.id}';
      INSERT INTO books (id, workspace_id, name, kind, base_currency, count_events_in_budget, sort_order, created_at)
        VALUES ('joined-book', '${ws.workspaceId}', 'Home', 'shared', 'IDR', 0, -1, '2026-10-01T00:00:00Z');
      INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at)
        VALUES ('joined-book', 'relay-joined', 1, 'member-joined', 'needs_invite', '2026-10-01T00:00:00Z');`);

    expect((await ensureCategoryKeys(database, ws)).created).toEqual([...ADDED]);
    expect((await categoriesOf(database, business)).filter((row) => ADDED.includes(row.key as (typeof ADDED)[number]))).toHaveLength(4);
    expect(await categoriesOf(database, 'joined-book')).toEqual([]);
  });
});

/** The same as `asBeforeTheUpgrade`, for a database with no book tables yet. */
async function asBeforeTheUpgradeWithoutBooks(database: Database): Promise<void> {
  await database.execScript(`DELETE FROM accounts WHERE system_key IN (${ADDED.map((key) => `'${key}'`).join(', ')})`);
}
